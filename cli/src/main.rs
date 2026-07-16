//! Agentero headless CLI (`agentero`).
//!
//! Vault / Catalog machine interface — no BYOA, no paper-reader.
//! See `docs/development/cli.md`.

mod commands;
mod config;
mod error;
mod output;
mod prompt;
mod resolve;

use clap::builder::styling::{AnsiColor, Effects, Styles};
use clap::{ColorChoice, CommandFactory, FromArgMatches, Parser, Subcommand, ValueEnum};
use error::{CliError, ExitCode};
use output::{emit_err, emit_ok, OutputFormat};
use resolve::GlobalOpts;
use std::path::PathBuf;
use std::process::ExitCode as StdExitCode;

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ColorWhen {
    Auto,
    Always,
    Never,
}

/// High-contrast help styles so sections / flags / placeholders are easy to scan.
///
/// | Part | Color | Examples |
/// |---|---|---|
/// | header | magenta + bold + underline | `Commands:`, `Options:` |
/// | usage | bright white + bold | `Usage:` |
/// | literal | bright green + bold | `paper`, `--vault`, `list` |
/// | placeholder | bright yellow | `<PATH>`, `<COMMAND>` |
/// | valid | bright cyan | `text`, `json`, `auto` |
/// | error / invalid | bright red + bold | parse errors |
fn clap_styles() -> Styles {
    Styles::styled()
        .header(
            AnsiColor::BrightMagenta
                .on_default()
                .effects(Effects::BOLD | Effects::UNDERLINE),
        )
        .usage(AnsiColor::BrightWhite.on_default().effects(Effects::BOLD))
        .literal(AnsiColor::BrightGreen.on_default().effects(Effects::BOLD))
        .placeholder(AnsiColor::BrightYellow.on_default())
        .valid(AnsiColor::BrightCyan.on_default())
        .invalid(AnsiColor::BrightRed.on_default().effects(Effects::BOLD))
        .error(AnsiColor::BrightRed.on_default().effects(Effects::BOLD))
}

/// Peek `--color` before full parse so help itself is styled correctly.
///
/// Priority: explicit `--color` → `CLICOLOR_FORCE` → `NO_COLOR` / `CLICOLOR=0` → auto.
fn peek_color_when() -> ColorWhen {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--color" {
            return match args.next().as_deref() {
                Some("always") => ColorWhen::Always,
                Some("never") => ColorWhen::Never,
                Some("auto") | None => ColorWhen::Auto,
                Some(_) => ColorWhen::Auto,
            };
        }
        if let Some(v) = arg.strip_prefix("--color=") {
            return match v {
                "always" => ColorWhen::Always,
                "never" => ColorWhen::Never,
                _ => ColorWhen::Auto,
            };
        }
    }
    // Env only applies when the flag is omitted.
    if matches!(
        std::env::var("CLICOLOR_FORCE").as_deref(),
        Ok(v) if v != "0" && !v.is_empty()
    ) {
        return ColorWhen::Always;
    }
    if std::env::var_os("NO_COLOR").is_some()
        || matches!(std::env::var("CLICOLOR").as_deref(), Ok("0"))
    {
        return ColorWhen::Never;
    }
    ColorWhen::Auto
}

fn color_choice(when: ColorWhen) -> ColorChoice {
    match when {
        ColorWhen::Auto => ColorChoice::Auto,
        ColorWhen::Always => ColorChoice::Always,
        ColorWhen::Never => ColorChoice::Never,
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "agentero",
    version,
    about = "Agentero headless CLI — Vault / Catalog machine interface (no BYOA)",
    long_about = "Discover, manage, and expose a local Agentero research vault and catalog.\n\
                  Does not run agents or paper-reader. Prefer --json for scripts and external agents.\n\
                  Design: docs/development/cli.md",
    styles = clap_styles(),
    propagate_version = true
)]
struct Cli {
    /// Vault root (absolute or relative). Overrides env / walk-up / config.
    #[arg(short = 'v', long = "vault", global = true, value_name = "PATH")]
    vault: Option<PathBuf>,

    /// Emit JSON on stdout (alias for `-o json`).
    #[arg(long = "json", global = true)]
    json: bool,

    /// Output format (`text` | `json`). Prefer `--json` for scripts.
    /// Note: short `-o` is reserved for command-local file outputs (e.g. `export bib -o`).
    #[arg(long = "output", global = true, value_enum, default_value = "text")]
    output: OutputFormat,

    /// Quiet success messages (errors still on stderr).
    #[arg(short = 'q', long = "quiet", global = true)]
    quiet: bool,

    /// Skip confirmation for destructive ops.
    #[arg(short = 'y', long = "yes", global = true)]
    yes: bool,

    /// Override Translator base URL.
    #[arg(long = "translator-url", global = true, value_name = "URL")]
    translator_url: Option<String>,

    /// Colorize help / errors (`auto` = TTY; `always` overrides NO_COLOR).
    #[arg(long = "color", global = true, value_enum, default_value = "auto")]
    color: ColorWhen,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Vault lifecycle: create, resolve, inspect.
    Vault {
        #[command(subcommand)]
        cmd: commands::vault::VaultCmd,
    },
    /// List vault-relative file tree.
    Tree {
        /// Subpath under vault (default: root).
        path: Option<String>,
        /// Max depth (default 3; -1 = unlimited).
        #[arg(long = "depth", default_value = "3")]
        depth: i32,
    },
    /// Paper catalog operations.
    Paper {
        #[command(subcommand)]
        cmd: commands::paper::PaperCmd,
    },
    /// Import papers into the vault.
    Import {
        #[command(subcommand)]
        cmd: commands::import::ImportCmd,
    },
    /// Export catalog data.
    Export {
        #[command(subcommand)]
        cmd: commands::export::ExportCmd,
    },
    /// CLI-only configuration (not GUI settings).
    Config {
        #[command(subcommand)]
        cmd: commands::config_cmd::ConfigCmd,
    },
}

fn main() -> StdExitCode {
    // Apply color choice before parse so `--help` / usage errors use the same styles.
    let mut cmd = Cli::command()
        .styles(clap_styles())
        .color(color_choice(peek_color_when()));
    let matches = match cmd.try_get_matches_from_mut(std::env::args_os()) {
        Ok(m) => m,
        Err(err) => {
            // clap prints help / usage itself (styled).
            err.exit();
        }
    };
    let cli = match Cli::from_arg_matches(&matches) {
        Ok(c) => c,
        Err(err) => err.exit(),
    };

    // Honor AGENTERO_OUTPUT when -o / --json not set explicitly via env default later.
    let format = resolve_format(&cli);
    let globals = GlobalOpts {
        vault_flag: cli.vault.clone(),
        yes: cli.yes,
        quiet: cli.quiet,
        translator_url: cli.translator_url.clone(),
        format,
    };

    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("failed to start async runtime: {e}");
            return StdExitCode::from(ExitCode::Business as u8);
        }
    };

    let result = rt.block_on(run(cli.command, &globals));
    match result {
        Ok(value) => {
            if let Err(e) = emit_ok(&globals, &value) {
                eprintln!("{e}");
                return StdExitCode::from(ExitCode::Business as u8);
            }
            StdExitCode::SUCCESS
        }
        Err(err) => {
            let code = err.exit_code();
            let _ = emit_err(&globals, &err);
            StdExitCode::from(code as u8)
        }
    }
}

fn resolve_format(cli: &Cli) -> OutputFormat {
    if cli.json {
        return OutputFormat::Json;
    }
    if matches!(cli.output, OutputFormat::Json) {
        return OutputFormat::Json;
    }
    match std::env::var("AGENTERO_OUTPUT")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "json" => OutputFormat::Json,
        _ => cli.output,
    }
}

async fn run(command: Commands, globals: &GlobalOpts) -> Result<serde_json::Value, CliError> {
    match command {
        Commands::Vault { cmd } => commands::vault::run(cmd, globals).await,
        Commands::Tree { path, depth } => commands::tree::run(path.as_deref(), depth, globals),
        Commands::Paper { cmd } => commands::paper::run(cmd, globals).await,
        Commands::Import { cmd } => commands::import::run(cmd, globals).await,
        Commands::Export { cmd } => commands::export::run(cmd, globals).await,
        Commands::Config { cmd } => commands::config_cmd::run(cmd, globals),
    }
}

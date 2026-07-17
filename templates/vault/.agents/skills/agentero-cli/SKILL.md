---
name: agentero-cli
description: >-
  Use the Agentero CLI (bin `agentero`) to create, discover, and expose a local
  research vault and catalog—list/get papers, import by id/URL, download assets,
  parse PAPER.md, export bib—without BYOA. Prefer --json. Use when managing a
  vault headless, scripting Motif/Agentero, or exploring papers via machine APIs
  ($agentero-cli / /agentero-cli).
---

# Agentero CLI

## Role

You use the **`agentero` CLI** as a stable machine interface to an Agentero vault.
You do **not** treat the CLI as a chat runtime: it has **no BYOA**, no ACP, no
paper-reader. Reading and writing lecture-style `NOTES.md` is **your** job (or
use the separate `paper-reader` skill / desktop Zap workflow).

Design reference (repo): `docs/development/cli.md`.

## Prerequisites

- Binary name: **`agentero`** (crate lives at repo `cli/` when built).
- Prefer always passing **`--json`** for machine parsing (disables interactive
  prompts from `inquire`).
- Destructive file deletes: pass **`-y` / `--yes`** under `--json` / non-TTY;
  humans on a TTY may confirm via prompt instead.
- Resolve vault with (first wins): `--vault <path>` → env `AGENTERO_VAULT` →
  cwd walk-up (`.agentero/catalog.sqlite` or standard dirs) → CLI config
  `default_vault`.

If `agentero` is missing from PATH, say so and fall back to reading Vault files
directly; do not invent catalog rows.

## Hard boundaries

| Do | Do not |
|---|---|
| Call CLI for vault/catalog/import/assets | Spawn coding agents via CLI |
| Read files at returned paths | Assume CLI wrote full lecture NOTES |
| Progressive disclosure L0→L4 | Dump entire PDF/TeX into the prompt by default |
| Skip overwrite of user NOTES on re-import | Force-overwrite without explicit user ask |

## Progressive disclosure (same as Vault model)

1. **L0** — `AGENTS.md` (if present)
2. **L1** — `agentero paper list --json` (catalog; no full-text)
3. **L2** — `{paper}/NOTES.md`
4. **L2.5** — `{paper}/highlights.md`
5. **L3** — `{paper}/PAPER.md` (if no TeX)
6. **L4** — `{paper}/source/**` (TeX preferred when present)

After `paper get --json`, use `data.suggestedReads` / `paper paths` then
`read_file` those paths. Do **not** paste whole sources unless needed.

## Default agent protocol

```bash
# 1) Confirm vault root
agentero vault which --json
# or: agentero vault info --json

# 2) L1 index (optional filters: --unread, --query, --tag)
agentero paper list --json
agentero paper tags --json
agentero paper list --tag nlp --json

# 3) One paper: meta + asset flags + suggested paths
agentero paper get <path|id> --json
# minimal paths only:
agentero paper paths <path|id> --json

# 4) Read files yourself in order: NOTES → highlights → PAPER.md / TeX

# 5) Import (exact id / DOI / URL) — creates shell NOTES, not lecture body
agentero import id <arxiv|doi|url> --json

# 6) After you finish your own notes, optional catalog flags only:
agentero paper set-read <path|id> --json
agentero paper set-tags <path|id> nlp survey --json
# incremental: --add / --remove (mutually exclusive with bare replace tags)
```

## Command map (MVP)

Global: `--vault`, `--json` / `--output json`, `-y` / `--yes`, `--translator-url`.

| Intent | Command |
|---|---|
| Create vault | `agentero vault create <path> --json` |
| Current vault path | `agentero vault which --json` |
| Summary / health | `agentero vault info --json` / `vault check --json` |
| File tree | `agentero tree [path] --json` |
| List papers | `agentero paper list [--unread] [--query …] [--tag …] --json` |
| List tags | `agentero paper tags --json` |
| Get paper | `agentero paper get <path\|id> --json` |
| Paths only | `agentero paper paths <path\|id> --json` |
| Download PDF/TeX | `agentero paper download <path\|id> --json` |
| PDF → PAPER.md | `agentero paper parse <path\|id> [--force] --json` |
| Delete catalog (± files) | `agentero paper delete <path> [--files -y] --json` |
| Mark is_read | `agentero paper set-read <path\|id> [--false] --json` |
| Set tags | `agentero paper set-tags <path\|id> [tags…] [--add\|--remove] --json` |
| Magic-wand import | `agentero import id <text> [--parent papers/…] --json` |
| Bib import/export | `agentero import bib <file\|-> --json` / `export bib [-o\|--out file\|-] --json` |
| Graph (later) | `agentero graph backlinks|export|rebuild --json` |

## JSON contract

Success:

```json
{ "ok": true, "data": { } }
```

Failure (non-zero exit):

```json
{
  "ok": false,
  "error": { "code": "paper_not_found", "message": "…", "details": {} }
}
```

Stdout = result; stderr = progress/diagnostics. Parse `error.code` when retrying.

Common codes: `vault_not_found`, `vault_invalid`, `paper_not_found`,
`paper_ambiguous`, `import_failed`, `export_failed`, `asset_missing`,
`needs_confirmation`.

## Path / id resolution

- Prefer **Vault-relative `path`** (e.g. `papers/1706.03762`).
- Bare **id**: if multiple catalog rows match, CLI errors with candidates—retry with full `path`.

## Workflow recipes

### Explore an existing vault

1. `vault which` / `vault info`
2. `paper list`
3. For each target: `paper get` → read `suggestedReads`
4. Cite Vault-relative paths in your answer; end with `## Sources` when substantial

### Ingest then take notes yourself

1. `import id <ref> --json` → note `data.path`
2. If needed: `paper download` / `paper parse`
3. Write or update `{path}/NOTES.md` (preserve user prose; do not wipe highlights)
4. Optional: `paper set-read <path>` only after notes are done
5. For full lecture structure, invoke **`paper-reader`** skill instead of expecting CLI to write it

### Batch / scripts

```bash
export AGENTERO_VAULT=/path/to/vault
while read -r id; do
  agentero import id "$id" --json || echo "fail $id" >&2
done < ids.txt
```

## Activation notes

Agentero may inject this entire SKILL.md. Depending on the agent:

- **Codex**: `$agentero-cli`
- **Claude**: `/agentero-cli`
- **Other**: follow this body; do not wait for a separate `$` / `/` command

## Rules

- Keep Obsidian wikilinks `[[...]]` when you edit Markdown.
- Never invent catalog metadata; trust CLI / files.
- Never overwrite user-written NOTES without explicit request.
- Prefer short tool loops: list → get → read files → answer.
- If the binary is not built yet (dev: `cargo build -p agentero-cli`), report that and use filesystem + desktop app as fallback.

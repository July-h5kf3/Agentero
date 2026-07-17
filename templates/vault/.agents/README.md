# `.agents/` — vault-local agent assets

Agentero (and many ACP agents) look here for **vault-scoped** agent configuration.

## Layout

```text
.agents/
├── README.md          # this file
└── skills/            # optional Agentero / Codex-style skills
    └── <skill-id>/
        └── SKILL.md
```

## Skills

- Each skill is a folder under `skills/` containing a `SKILL.md` file.
- Chat Composer: type `$` to pick skills from this vault, plus global
  `~/.agents/skills` and `${CODEX_HOME:-~/.codex}/skills`.
- Keep each `SKILL.md` small (Agentero loads at most 64 KiB per skill, 5 per prompt).
- **Bundled** (Create Vault seeds; no overwrite if already present):
  - `skills/paper-reader/` — file-tree Zap (精读) → structured `NOTES.md`.
  - `skills/agentero-cli/` — how external agents use the headless `agentero` CLI
    (vault discover / paper list / import; **no** BYOA). Design: `docs/development/cli.md`.
  Existing vaults can copy those folders, or install under `~/.agents/skills/<id>/`.
- **Runtime triggers** (not the Composer `$` picker): Codex `$id`, Claude often
  `/id` (e.g. `$paper-reader`, `$agentero-cli`); other agents follow Agentero-injected body.

Add a skill:

```text
.agents/skills/my-skill/SKILL.md
```

```markdown
---
name: my-skill
description: Short description for the picker
---

# Instructions for the agent
...
```

Do not put model API keys here — Agentero is BYOA; keys stay with the agent CLI.

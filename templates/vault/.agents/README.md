# `.agents/` — vault-local agent assets

Motif (and many ACP agents) look here for **vault-scoped** agent configuration.

## Layout

```text
.agents/
├── README.md          # this file
└── skills/            # optional Motif / Codex-style skills
    └── <skill-id>/
        └── SKILL.md
```

## Skills

- Each skill is a folder under `skills/` containing a `SKILL.md` file.
- Chat Composer: type `$` to pick skills from this vault, plus global
  `~/.agents/skills` and `${CODEX_HOME:-~/.codex}/skills`.
- Keep each `SKILL.md` small (Motif loads at most 64 KiB per skill, 5 per prompt).
- **Bundled**: Create Vault seeds `skills/paper-reader/` for the file-tree
  Eye (精读) workflow. Existing vaults can copy that folder manually.

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

Do not put model API keys here — Motif is BYOA; keys stay with the agent CLI.

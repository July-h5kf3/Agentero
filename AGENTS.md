# AGENTS.md

## Project overview

Motif is a Tauri 2 + React 19 local-first research workspace. The vault is the source of truth: Markdown, `metadata.json`, source files, and generated indexes must remain readable outside the app.

## Current app shape

- Frontend: `src/` (React, TypeScript, Tailwind CSS 4, shadcn/ui, AI Elements).
- Host: `src-tauri/` (Rust, Tauri commands, local FS, wiki index, ACP client).
- Workbench layout:
  - left: Vault file tree and paper info;
  - center: Markdown / PDF / HTML view;
  - right preview area: rendered Markdown or paper `NOTES.md`;
  - optional right sidebar: `Agent` or `Backlinks`.
- Backlinks sidebar layout: Backlinks on top, Graph below. There is no separate top-level Graph tab.
- Graph data must be derived from Markdown wikilinks or rebuildable indexes, never from a hand-maintained graph database.

## Development rules

- Prefer small, focused changes over broad refactors.
- Keep local-first behavior: do not introduce proprietary storage as a source of truth.
- Do not overwrite user-authored vault files without an explicit confirmation path.
- Preserve Obsidian-compatible wikilink text (`[[...]]`) when editing or generating Markdown.
- Agent integration is BYOA: Motif configures how to launch local ACP-compatible agents; it must not require users to enter model API keys in Motif.
- UI should stay minimal: icon buttons need accessible labels and tooltips; avoid persistent explanatory text unless it resolves a real empty/error state.

## Useful commands

```bash
pnpm install
pnpm dev
pnpm tauri dev
pnpm build
pnpm lint
pnpm format
pnpm tauri build
```

Before reporting implementation work as complete, run the narrowest relevant validation. For UI changes, prefer running the app and checking the affected flow; if the dev port is already occupied or browser verification is not possible, say so explicitly.

## Documentation map

- `README.md`: project overview, quick start, release notes, doc index.
- `docs/ROADMAP.md`: implementation status and prioritized roadmap.
- `docs/TODO.md`: actionable backlog.
- `docs/UI.md`: UI layout, component, shortcut, and settings conventions.
- `docs/TECH.md`: architecture and module design.
- `docs/PRD.md`: product requirements and acceptance criteria.
- `docs/reference/API.md`: Tauri command and event contracts.
- `docs/reference/WIKILINKS.md`: wikilink, backlink, and graph design.
- `docs/reference/DATA_MODEL.md`: vault file model.
- `docs/reference/COMPONENTS.md`: AI Elements and component conventions.

When changing UI, data contracts, release flow, or vault semantics, update the relevant docs in the same change.

## Release flow

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds Tauri installers on macOS, Ubuntu, and Windows and uploads them to a draft GitHub Release.

Do not add signing, notarization, or publishing steps without documenting the required secrets and keeping local development builds independent of release credentials.

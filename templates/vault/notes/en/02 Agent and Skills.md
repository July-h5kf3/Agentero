# Agent & Skills

Agentero uses **BYOA** (Bring Your Own Agent). You install and log in to an ACP-compatible agent on your machine; Agentero passes the current Vault context to it. No API key is required inside Agentero.

## Connect an Agent

1. Open **Settings** (`⌘,`).
2. Go to **Agent**.
3. Pick a detected agent or add a custom one.
4. Fill in the absolute path if the app cannot detect it.
5. Choose the default agent.
6. Run a test conversation.

## Agent Panel

When a paper is open, the current paper is added to the agent context automatically. You can:

- Type a question directly.
- Click suggestion chips like **Summarize** or **Draft Related Work**.
- Use `@` to mention any Vault path.
- Drag a file or folder from the tree into the composer.

While the agent is running you can keep typing; later messages are queued and sent after the current reply finishes.

## Permission Mode

Settings → Agent → **Permission Mode**:

| Mode | Behavior |
|---|---|
| Restricted | Default. Limits writes and sensitive operations. |
| Ask | Confirm every permission request. |
| Auto | Approve automatically for trusted agents. |

## Skills

Skills live under `.agents/skills/<id>/SKILL.md`. They define reusable workflows the agent can invoke via `$skill-id` or `/skill-id`.

To change a skill, edit its `SKILL.md`. To add a new skill, create a new folder with a `SKILL.md` under `.agents/skills/`.

Bundled skills include:

- `paper-reader` — deep-read a paper and write `NOTES.md`.
- `agentero-cli` — run headless Vault commands via the CLI.
- `vault-normalizer` — reorganize an existing research directory into Vault layout.
- `deep-research` — multi-step research with citations.
- `idea-evaluator` — evaluate research ideas across dimensions.

## Paper Reader

For papers with a local PDF and readable text (TeX or `PAPER.md`):

- **Manual**: click the **Zap** icon on an unread paper row.
- **Auto**: enable **autoPaperReader** in Settings → Agent.

The result is written to the paper's `NOTES.md` and the paper is marked as read.

## Next

- [[01 Markdown and Wikilinks]]
- [[03 Papers and Import]]

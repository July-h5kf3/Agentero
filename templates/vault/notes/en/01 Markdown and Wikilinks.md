# Markdown & Wikilinks

Agentero notes are plain Markdown files. You can edit them inside the app or with any external editor.

## Basic Markdown

```markdown
# Heading 1

## Heading 2

- bullet
- another bullet

1. numbered
2. numbered

**bold**, *italic*, `inline code`
```

```rust
// code block
// Click the top-right button to switch language or copy code
```

> [!NOTE]
> Obsidian-style callouts are supported.

````

Callouts render with icons and theme colors. Click the title or icon to edit the type and title inline. Supported types include `note`, `tip`, `info`, `warning`, `danger`, `success`, `question`, `quote`, `example`, and `failure`.

## Math

Inline math: `$E=mc^2$`

Block math:

```markdown
$$\int_a^b f(x) dx$$
````

> [!TIP]
> Typing `\$a\$` keeps it as plain text; `$a$` is rendered as math.

## Slash Commands

Type `/` in the editor to open a lightweight command menu. Use the arrow keys to navigate and `Enter` to insert. Commands include headings, lists, todos, quotes, code blocks, diagrams, links, and callouts.

Common commands:

| Command        | Inserts                                        |
| -------------- | ---------------------------------------------- |
| `/mermaid`     | A live-rendered Mermaid diagram                |
| `/code`        | A code block (pick language from the selector) |
| `/callout`     | An Obsidian callout (`note` type by default)   |
| `/link`        | An internal wikilink `[[]]`                    |
| `/heading 1–3` | A heading block                                |

> [!NOTE]
> `/` must be at the start of a line or after a space. It does not trigger inside code blocks or when a wikilink completion menu is open.

## Diagrams (Mermaid)

Use `/mermaid` or select **Mermaid** from a code block's language selector. The diagram preview appears below the source code:

```mermaid
graph LR
    A[Paper] --> B[Read]
    B --> C[Notes]
    C --> D[Next Steps]
```

> [!TIP]
> Mermaid diagrams are read-only previews — edit the source code above to change them.

## Wikilinks

Link to another note with double brackets:

```markdown
[[03 Papers and Import]]
```

Link to a heading inside a note:

```markdown
[[03 Papers and Import#Library]]
```

Nested headings use the full path:

```markdown
[[03 Papers and Import#Import#Zotero]]
```

Agentero indexes all `[[...]]` links for the **Backlinks** panel and the **Graph** view.

## Embeds

Prefix a wikilink with `!` to embed its content inline (read-only):

```markdown
![[03 Papers and Import#Library]]
```

You can embed:

- **Note sections** — any heading path: `![[note#Section#Subsection]]`
- **Images** — `![[diagram.png]]` or `![](./assets/diagram.png)`
- **PDF pages** — `![[paper.pdf]]`

Embedded content stays in sync with the source. Editing the original file updates all embeds automatically. The embed itself is read-only — edit the source file to change content.

## Images

Paste an image into a Markdown note and Agentero stores it under the note's `assets/` folder:

```markdown
![diagram](./assets/diagram.png)
```

If an image is no longer referenced, it is cleaned up automatically.

## Next

- [[02 Agent and Skills]]
- [[03 Papers and Import]]

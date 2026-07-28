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

```rust
// code block
```

> [!NOTE]
> Obsidian-style callouts are supported.
```

## Math

Inline math: `$E=mc^2$`

Block math:

```markdown
$$\int_a^b f(x) dx$$
```

> [!TIP]
> Typing `\$a\$` keeps it as plain text; `$a$` is rendered as math.

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

## Images

Paste an image into a Markdown note and Agentero stores it under the note's `assets/` folder:

```markdown
![diagram](./assets/diagram.png)
```

If an image is no longer referenced, it is cleaned up automatically.

## Next

- [[02 Agent and Skills]]
- [[03 Papers and Import]]

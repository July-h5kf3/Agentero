# Papers & Import

Papers are the core unit in Agentero. Each paper lives in its own folder under `papers/`.

## Paper Folder Layout

```text
papers/<id>/
├── NOTES.md          # your working notes
├── PAPER.md          # derived readable text (optional)
├── metadata.json     # catalog projection
├── marks/            # PDF highlights and comments
└── source/           # PDF, TeX, or other source files
```

- `NOTES.md` is yours to edit.
- `PAPER.md` is generated when no TeX source is available.
- Do not edit `metadata.json` by hand; update metadata through the Library or Paper Info panel.

## Import Methods

### Magic Wand

Click the magic-wand button in the sidebar and paste an arXiv ID, DOI, or URL. Agentero downloads metadata and the PDF into a new paper folder.

### Local PDF

Drag a PDF into the file tree or use the import command to create a paper folder from a local file.

### Zotero Connector

Enable Settings → General → **Zotero Connector**, then use the official Zotero browser extension to save items directly into the current Vault.

### CLI

```bash
agentero paper import <source>
```

## Library

The Library table shows all papers in the catalog. You can:

- Sort by clicking column headers.
- Right-click a header to choose visible columns and reorder them.
- Filter by tags or search for title, author, abstract, or tag substrings.
- Use **Rescan** to discover paper folders that exist on disk but are not yet in the catalog.

## Tags

Add or remove tags in the **Paper Info** panel. Tags are stored in `catalog.sqlite` and shown as colored chips in the Library.

## Download

If a paper row shows **Download**, it means the PDF or readable text is missing. Click it to fetch the missing resource.

## Next

- [[01 Markdown and Wikilinks]]
- [[02 Agent and Skills]]

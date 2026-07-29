---
name: release
description: >-
  Prepare and optionally update Agentero GitHub Release notes from merged pull
  requests and uncovered first-parent commits. Use when the user asks to
  prepare, dry-run, review, or update a release; summarize changes between
  versions or tags; or fill a Draft GitHub Release after the v* release
  workflow. Produce mirrored English and Chinese notes and require explicit
  approval before changing GitHub state.
---

# Agentero Release

Prepare evidence-backed bilingual Release notes. Keep dry runs read-only and
separate note approval from every GitHub mutation.

## Establish the release range

1. Read `git status`, the current branch, local and remote tags, and the target
   Release state. Preserve unrelated working-tree changes.
2. Resolve both endpoints to immutable commits and verify that the base is an
   ancestor of the target.
3. For a stable target, default to the latest earlier published stable Release
   reachable from the target. For a prerelease, prefer the preceding prerelease
   in the same version series, then fall back to the latest stable Release.
4. Display the selected `<base>..<target>` range. Stop for user direction when
   the target, release channel, ancestry, or previous Release is ambiguous.
5. Never move or overwrite an existing remote tag. Treat a tag already observed
   by GitHub Actions or attached to a Release as immutable.

## Collect evidence

Run the bundled collector from the repository root:

```bash
node .agents/skills/release/scripts/collect-release-context.mjs <base> <target>
```

Use merged pull requests as the main narrative units. Always inspect uncovered
first-parent commits as a second source; the presence of one PR does not make
other mainline commits disappear.

For each candidate change:

- Prefer the PR title, body, linked issues, labels, and changed behavior.
- Use the first-parent commit subject, body, and changed files when no merged PR
  covers the commit.
- Inspect the relevant diff or documentation when the public effect is unclear.
- Collect issues closed during the release range that are not already covered by
  a merged PR. Use `gh issue list --state closed --search "closed:>={base-date}"`
  or inspect `Closes` / `Fixes` references in commit messages.
- Exclude release bumps, formatting, tests, internal refactors, and routine
  documentation unless they change installation, compatibility, security, or
  visible behavior.
- Combine multiple commits that implement one user-visible outcome.
- Keep a PR, commit, or issue URL as evidence for every bullet.
- Report uncertainty or conflicting evidence instead of inventing behavior.

## Draft the notes

Write English first and Chinese second. Mirror the same groups, bullet count,
order, meaning, and evidence links across both languages.

Use this shape:

```markdown
## Summary

<One short paragraph describing the release theme and user impact.>

## Features

- **<Keyword or short phrase>**: <One or two concrete sentences.> ([#123](...))

## Improvements

- **<Keyword or short phrase>**: <One or two concrete sentences.> ([commit](...))

## Fixes

- **<Keyword or short phrase>**: <One or two concrete sentences.> ([#124](...))

## Resolved Issues

- **<Keyword or short phrase>**: <One or two concrete sentences.> ([#125](...))

---

## 概要

<一段简短文字，说明本次发布主题和用户影响。>

## 新功能

- **<关键词或短语>**: <一到两句具体介绍。>（[#123](...)）

## 改进

- **<关键词或短语>**: <一到两句具体介绍。>（[commit](...)）

## 修复

- **<关键词或短语>**: <一到两句具体介绍。>（[#124](...)）

## 已解决问题

- **<关键词或短语>**: <一到两句具体介绍。>（[#125](...)）
```

Apply these writing rules:

- Start the body exactly at `## Summary`. Do not repeat the Release title,
  version, or date inside the body.
- Do not add `English` or `中文` wrapper headings or language navigation links.
  Separate the English and Chinese sections with a standalone Markdown
  horizontal rule (`---`), then begin Chinese content at `## 概要`.
- Keep `Summary` / `概要` as prose, not a bullet list.
- Start every grouped bullet with `**<keyword or short phrase>**: `. Keep the
  colon and following space outside the bold markers in both languages; never
  write `**<keyword>:**` or `**<关键词>：**`.
- Follow the keyword with one or two specific, user-facing sentences.
- Use `Features / 新功能`, `Improvements / 改进`, `Fixes / 修复`, and
  `Resolved Issues / 已解决问题` when evidence exists. `Resolved Issues` is for
  issues closed during the release that are not already covered by a merged PR.
  Add mirrored groups such as `Security / 安全性`,
  `Breaking Changes / 破坏性变更`, or `Known Limitations / 已知限制` only when
  needed.
- Omit empty groups.
- Describe shipped behavior, not implementation activity or test counts.
- Keep terminology and factual scope equivalent across languages; do not make
  one language a shortened translation of the other.
- End with a compare link when the repository and both refs are available.

## Dry run

Treat preparation as a dry run unless the user explicitly requests a write.
Return:

1. The selected range and evidence coverage: PR count, uncovered first-parent
   commit count, and any warnings.
2. The complete bilingual Release note candidate.
3. A statement that no version, commit, tag, push, workflow, or GitHub Release
   was changed.

Do not create a repository note file for a dry run unless requested.

## Update a Draft Release

Only update GitHub after the user approves the exact rendered body.

1. Verify the remote tag still points to the reviewed target commit.
2. Verify the Release exists and is a Draft.
3. Verify the required Release workflow completed successfully and expected
   assets exist.
4. Write the approved body to a temporary file and run:

   ```bash
   gh release edit "<tag>" \
     --repo poco-ai/Agentero \
     --verify-tag \
     --notes-file "<temporary-file>"
   ```

5. Fetch the Release again and confirm the stored body matches the approved
   body.
6. Remove the temporary file.

Do not publish the Draft, push commits, create or move tags, or change version
files unless the user separately requests those actions. Publishing with
`gh release edit "<tag>" --draft=false` requires explicit approval after the
final body and assets have been reviewed.

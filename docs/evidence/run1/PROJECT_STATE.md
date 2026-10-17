# Project State

## Goal
A zero-dependency Node.js CLI that converts a Markdown file to HTML and prints it to stdout.
Usage: `node cli.js path/to/file.md`. Tests run with `node --test`.

## File layout
- `src/convert.js`        – pure function `convert(markdown) -> html` (CommonJS, exports `convert` and `inline`)
- `cli.js`                – reads the .md path from argv, calls convert, prints HTML
- `test/convert.test.js`  – node:test + node:assert tests
- `PROJECT_STATE.md`, `PLAN_LOG.md`, `DECISIONS.md`, `CHECKPOINTS/` – workspace memory

## Features
### Session 1 (this session)
- Headings `#`, `##`, `###` -> h1/h2/h3
- Paragraphs (consecutive non-blank lines, separated by blank lines)
- `**bold**` -> strong, `*italic*` -> em
- HTML escaping of `& < >` in text
- CLI + basic tests
### Session 2 (done: unordered `-` lists and links; ordered lists, `*` bullets deferred)
- Unordered lists (`-`, `*`) and ordered lists (`1.`)
- Links `[text](url)`
- Possibly: nested inline formatting inside links/lists, more CLI error cases, tests for all of the above
- Out of scope so far: code blocks, images, blockquotes, tables

## Current status
Session 2 complete (code written, tests NOT executed: no execution tool in either session). Implemented: `- ` unordered lists, `[text](url)` links (http/https/mailto/relative only), 8 new tests (15 total), README.md. User reported 'test failed' from their machine with no output, so the failure is unidentified; hand-tracing found no failing case.

## Next steps
1. Run `node --test` and paste the full failure output; fix the failing test(s) in src/convert.js or test/convert.test.js.
2. Optional: ordered lists (`1.`), `*` bullets, nested lists, code blocks.

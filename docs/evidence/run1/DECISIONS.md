# Decisions (append-only)

## 2026-10-16T22:11:42.120Z Line-by-line block parsing + regex only for inline formatting
Decision: convert.js splits the document into lines and walks them once, building blocks (heading, paragraph) with a small state machine. Regexes are used only per line/block for headings and for inline **bold** / *italic*, never over the whole document. Text is HTML-escaped (& < >) before inline tags are inserted. Module is CommonJS and exports convert() and inline().
Why: Whole-document regexes get fragile once block types interact (lists and links arrive in Session 2). A line-by-line walker makes it easy to add a new block type as one more branch, keeps paragraph grouping explicit, and is easy to test. Escaping first prevents raw user HTML from passing through.

## 2026-10-16T22:14:26.374Z Links: placeholder extraction and URL scheme allow-list; lists use '- ' only
Decision: inline() pulls [text](url) links out first into placeholders (\u0000N\u0000), applies bold/italic to the rest, then restores links as <a href="..."> with the link text formatted. Only http, https, mailto and relative URLs become links; others (e.g. javascript:) are left as plain escaped text. Unordered lists are recognised by '- ' at line start only (not '*', to avoid ambiguity with italic). Ordered lists remain out of scope.
Why: Placeholders stop '*' or '_' inside URLs from being turned into em/strong. The scheme allow-list prevents javascript: XSS since output is HTML. '- ' matches the requested feature and keeps scope small.


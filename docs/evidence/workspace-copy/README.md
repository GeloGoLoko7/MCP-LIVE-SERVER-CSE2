# Markdown to HTML converter

A zero-dependency Node.js CLI that converts a Markdown file to HTML and prints it to stdout.

## Usage

```
node cli.js path/to/file.md
```

Save the output to a file with a shell redirect:

```
node cli.js notes.md > notes.html
```

If the file is missing or unreadable, the CLI prints an error and exits with code 1.

You can also use it as a module:

```js
const { convert } = require('./src/convert');
convert('# Hi'); // '<h1>Hi</h1>'
```

## Supported Markdown

| Markdown | HTML |
| --- | --- |
| `# H1`, `## H2`, `### H3` | `<h1>`, `<h2>`, `<h3>` |
| Consecutive lines | `<p>` (blank line starts a new paragraph) |
| `**bold**`, `*italic*`, `***both***` | `<strong>`, `<em>` |
| `- item` lines | `<ul><li>...</li></ul>` |
| `[text](url)` | `<a href="url">text</a>` |

Notes:

- `& < >` in text are HTML-escaped.
- Only `http:`, `https:`, `mailto:` and relative URLs become links; other schemes (such as `javascript:`) are left as plain text.
- List items are recognised by `- ` only. Nested and ordered lists are not supported.
- Not supported: code blocks, images, blockquotes, tables.

## Tests

```
node --test
```

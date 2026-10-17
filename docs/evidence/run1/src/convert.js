'use strict';

// Escape characters that are special in HTML.
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline formatting: **bold**, *italic* (and ***both***).
// Text is escaped first so raw HTML in the input is never passed through.
function emphasis(escaped) {
  return escaped
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

const LINK_RE = /\[([^\]]+)\]\(([^()\s]+)\)/g;
const SAFE_URL_RE = /^(https?:|mailto:|[^:]*$)/i;

// Links are pulled out first (as placeholders) so '*' or '_' inside a URL
// is never treated as emphasis. Unsafe schemes (e.g. javascript:) stay as text.
function inline(text) {
  const links = [];
  const escaped = escapeHtml(text).replace(LINK_RE, (match, label, url) => {
    if (!SAFE_URL_RE.test(url)) return match;
    links.push('<a href="' + url.replace(/"/g, '&quot;') + '">' + emphasis(label) + '</a>');
    return '\u0000' + (links.length - 1) + '\u0000';
  });
  return emphasis(escaped).replace(/\u0000(\d+)\u0000/g, (m, i) => links[Number(i)]);
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM_RE = /^\s*-\s+(.+?)\s*$/;

// Convert a Markdown string to an HTML string, line by line.
function convert(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let items = [];

  function flushParagraph() {
    if (paragraph.length > 0) {
      out.push('<p>' + inline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }
  }

  function flushList() {
    if (items.length > 0) {
      out.push('<ul>\n' + items.map((i) => '<li>' + inline(i) + '</li>').join('\n') + '\n</ul>');
      items = [];
    }
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
      continue;
    }
    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      flushParagraph();
      items.push(item[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return out.join('\n');
}

module.exports = { convert, inline };

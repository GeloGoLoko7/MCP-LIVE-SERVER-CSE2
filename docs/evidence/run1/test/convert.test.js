'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { convert } = require('../src/convert');

test('converts h1, h2 and h3 headings', () => {
  assert.strictEqual(convert('# One'), '<h1>One</h1>');
  assert.strictEqual(convert('## Two'), '<h2>Two</h2>');
  assert.strictEqual(convert('### Three'), '<h3>Three</h3>');
});

test('converts a paragraph', () => {
  assert.strictEqual(convert('Hello world'), '<p>Hello world</p>');
});

test('joins consecutive lines and splits paragraphs on blank lines', () => {
  assert.strictEqual(
    convert('line one\nline two\n\nsecond para'),
    '<p>line one line two</p>\n<p>second para</p>'
  );
});

test('converts **bold** and *italic*', () => {
  assert.strictEqual(
    convert('This is **bold** and *italic*.'),
    '<p>This is <strong>bold</strong> and <em>italic</em>.</p>'
  );
});

test('supports inline formatting inside headings', () => {
  assert.strictEqual(convert('# A **big** *title*'), '<h1>A <strong>big</strong> <em>title</em></h1>');
});

test('handles a mixed document', () => {
  const md = '# Title\n\nSome **text**.\n\n## Sub\n\nMore *text*.';
  assert.strictEqual(
    convert(md),
    '<h1>Title</h1>\n<p>Some <strong>text</strong>.</p>\n<h2>Sub</h2>\n<p>More <em>text</em>.</p>'
  );
});

test('escapes HTML special characters', () => {
  assert.strictEqual(convert('a < b & c'), '<p>a &lt; b &amp; c</p>');
});

test('converts an unordered list', () => {
  assert.strictEqual(
    convert('- one\n- two\n- three'),
    '<ul>\n<li>one</li>\n<li>two</li>\n<li>three</li>\n</ul>'
  );
});

test('list items support inline formatting', () => {
  assert.strictEqual(convert('- a **b** *c*'), '<ul>\n<li>a <strong>b</strong> <em>c</em></li>\n</ul>');
});

test('lists end at blank lines, headings and paragraphs', () => {
  assert.strictEqual(
    convert('Intro\n- a\n- b\n\n- c\n# H\n- d\nafter'),
    '<p>Intro</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ul>\n<li>c</li>\n</ul>\n<h1>H</h1>\n<ul>\n<li>d</li>\n</ul>\n<p>after</p>'
  );
});

test('converts links', () => {
  assert.strictEqual(
    convert('See [the site](https://example.com) now.'),
    '<p>See <a href="https://example.com">the site</a> now.</p>'
  );
});

test('links work in list items and escape & in the URL', () => {
  assert.strictEqual(
    convert('- [q](https://x.com/?a=1&b=2)'),
    '<ul>\n<li><a href="https://x.com/?a=1&amp;b=2">q</a></li>\n</ul>'
  );
});

test('link text can be formatted and URLs are not emphasised', () => {
  assert.strictEqual(
    convert('[**bold**](https://x.com/a*b*c)'),
    '<p><a href="https://x.com/a*b*c"><strong>bold</strong></a></p>'
  );
});

test('unsafe link schemes are left as plain text', () => {
  const html = convert('[x](javascript:alert(1))');
  assert.ok(!html.includes('<a '));
});

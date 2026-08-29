import { describe, it, expect } from 'vitest';
import { render, format, parseInline, isSafeUrl, detection } from './load-markdown.mjs';

describe('Markdown render', () => {
  it('renders headings, emphasis, and paragraphs', () => {
    const html = render('# Title\n\nHello **world** and *italic* and ~~gone~~.');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Hello <strong>world</strong> and <em>italic</em> and <del>gone</del>.</p>');
  });

  it('renders fenced code without interpreting markdown inside', () => {
    const html = render('```js\nconst x = 1;\n# not a heading\n```');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('# not a heading');
    expect(html).not.toContain('<h1>');
  });

  it('emits mermaid fences as escaped diagram sources', () => {
    const html = render('```mermaid\nflowchart TD\n  A-->B\n  C["<script>x</script>"]\n```');
    expect(html).toContain('<pre class="mermaid-source">');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('A--&gt;B');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('class="language-mermaid"');
  });

  it('treats mermaid fence info case-insensitively', () => {
    const html = render('```MERMAID\nsequenceDiagram\n  Alice->>Bob: hi\n```');
    expect(html).toContain('<pre class="mermaid-source">');
    expect(html).toContain('sequenceDiagram');
  });

  it('keeps adjacent mermaid fences as separate diagram sources', () => {
    const html = render('```mermaid\nflowchart TD\n  A-->B\n```\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: hi\n```');
    const blocks = html.match(/<pre class="mermaid-source">[\s\S]*?<\/pre>/g) || [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('flowchart TD');
    expect(blocks[0]).not.toContain('sequenceDiagram');
    expect(blocks[1]).toContain('sequenceDiagram');
    expect(blocks[1]).not.toContain('flowchart TD');
  });

  it('closes mermaid fences even when the closer is indented', () => {
    const html = render('```mermaid\nflowchart TD\n  A-->B\n    ```\n\nAfter');
    expect(html).toContain('<pre class="mermaid-source">');
    expect(html).toContain('A--&gt;B');
    expect(html).toContain('<p>After</p>');
    expect(html).not.toContain('After</pre>');
  });

  it('renders lists, task lists, and nested lists', () => {
    const html = render('- one\n- two\n  - nested\n\n- [x] done\n- [ ] todo');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<ul><li>nested</li></ul>');
    expect(html).toContain('two');
    expect(html).toContain('class="task-list"');
    expect(html).toContain('checked');
    expect(html).toContain('todo');
  });

  it('renders ordered lists with start attribute', () => {
    const html = render('3. three\n4. four');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<li>three</li>');
  });

  it('renders blockquotes, tables, links, and images', () => {
    const md = [
      '> quoted **text**',
      '',
      '| A | B |',
      '| --- | ---: |',
      '| 1 | 2 |',
      '',
      'See [docs](https://example.com) and ![logo](https://example.com/logo.png).'
    ].join('\n');
    const html = render(md);
    expect(html).toContain('<blockquote><p>quoted <strong>text</strong></p></blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('text-align:right');
    expect(html).toContain('>2</td>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>');
    expect(html).toContain('<img src="https://example.com/logo.png" alt="logo">');
  });

  it('renders horizontal rules and setext headings', () => {
    expect(render('---')).toBe('<hr>');
    expect(render('Heading\n======')).toContain('<h1>Heading</h1>');
    expect(render('Sub\n---')).toContain('<h2>Sub</h2>');
  });

  it('renders inline code and hard line breaks', () => {
    expect(parseInline('use `code`')).toBe('use <code>code</code>');
    const html = render('line one  \nline two');
    expect(html).toContain('line one<br>\nline two');
  });

  it('escapes raw HTML and unsafe URLs', () => {
    const html = render('<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n![x](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('src="javascript:');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('[click](javascript:alert(1))');
  });

  it('rejects data HTML URLs but allows http images', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>x</script>')).toBe(false);
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('#section')).toBe(true);
    expect(isSafeUrl('data:image/png;base64,abc', { image: true })).toBe(true);
    expect(isSafeUrl('data:image/png;base64,abc', { image: false })).toBe(false);
  });

  it('does not treat snake_case as emphasis', () => {
    expect(parseInline('foo_bar_baz')).toBe('foo_bar_baz');
  });
});

describe('Markdown format', () => {
  it('normalizes ATX headings and trailing space', () => {
    expect(format('##   Hello world   \n')).toBe('## Hello world\n');
  });

  it('does not rewrite fenced code contents', () => {
    const src = '```\n##   keep\n```\n';
    expect(format(src)).toBe(src);
  });

  it('collapses extra blank lines and keeps a trailing newline', () => {
    expect(format('a\n\n\n\nb')).toBe('a\n\n\nb\n');
  });

  it('normalizes list marker spacing', () => {
    expect(format('-    item')).toBe('- item\n');
  });
});

describe('Markdown detection signatures', () => {
  function score(content) {
    const countMatches = (text, items) => items.filter((item) => text.includes(item)).length;
    const contentLines = content.split('\n').slice(0, 20);
    let result = 0;
    if (detection.keywords) result += countMatches(contentLines.join('\n'), detection.keywords) * 2;
    if (detection.patterns) result += detection.patterns.filter((pattern) => pattern.test(content)).length * 5;
    return result;
  }

  it('scores typical markdown above the detection threshold', () => {
    const md = '# Title\n\nSee [docs](https://example.com)\n\n```js\ntrue\n```\n';
    expect(score(md)).toBeGreaterThanOrEqual(5);
  });

  it('does not treat a python comment as markdown', () => {
    expect(score('# comment\nprint("hello")\n')).toBeLessThan(5);
  });
});

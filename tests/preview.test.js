import { describe, it, expect } from 'vitest';
import {
  previewKind,
  isSvg,
  sanitizeMarkup,
  sanitizeMermaidSvg,
  mermaidTheme,
  mermaidConfig,
  renderMermaidSvg,
  buildHtmlSrcdoc,
  buildSvgSrcdoc,
  isUnsafeUrl
} from './load-preview.mjs';

describe('previewKind', () => {
  it('selects markdown, html, and svg', () => {
    expect(previewKind('markdown', '# hi')).toBe('markdown');
    expect(previewKind('html', '<h1>Hi</h1>')).toBe('html');
    expect(previewKind('xml', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('svg');
    expect(previewKind('html', '<svg viewBox="0 0 10 10"></svg>')).toBe('svg');
  });

  it('does not preview generic XML', () => {
    expect(previewKind('xml', '<note><to>A</to></note>')).toBeNull();
    expect(previewKind('javascript', 'const x = 1')).toBeNull();
    expect(previewKind('css', 'body { color: red }')).toBeNull();
  });
});

describe('isSvg', () => {
  it('detects SVG with xml prolog and comments', () => {
    expect(isSvg('<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"></svg>')).toBe(true);
    expect(isSvg('<svg/>')).toBe(true);
    expect(isSvg('<html><body>no</body></html>')).toBe(false);
    expect(isSvg('<note/>')).toBe(false);
  });
});

describe('HTML/SVG sanitizer', () => {
  it('strips script tags and event handlers', () => {
    const html = sanitizeMarkup('<p onclick="alert(1)">ok</p><script>alert(1)</script>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick/i);
    expect(html).toContain('ok');
  });

  it('neutralizes javascript URLs', () => {
    expect(isUnsafeUrl('javascript:alert(1)')).toBe(true);
    expect(isUnsafeUrl('https://example.com')).toBe(false);
    const html = sanitizeMarkup('<a href="javascript:alert(1)">x</a>');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('strips iframe and foreignObject', () => {
    const html = sanitizeMarkup('<iframe src="https://evil.test"></iframe><svg><foreignObject><script>x</script></foreignObject></svg>');
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/foreignObject/i);
  });

  it('wraps HTML fragments with a script-blocking CSP', () => {
    const doc = buildHtmlSrcdoc('<h1>Hello</h1>', 'vs-dark');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain('script-src \'none\'');
    expect(doc).toContain('<h1>Hello</h1>');
    expect(doc).not.toMatch(/<script/i);
  });

  it('keeps full HTML documents but still strips scripts', () => {
    const doc = buildHtmlSrcdoc('<!DOCTYPE html><html><head></head><body><h1>Page</h1><script>alert(1)</script></body></html>', 'vs');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain('Page');
    expect(doc).not.toMatch(/<script/i);
  });

  it('wraps SVG in a centered document', () => {
    const doc = buildSvgSrcdoc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="5"/></svg>', 'vs-dark');
    expect(doc).toContain('<svg');
    expect(doc).toContain('circle');
    expect(doc).not.toMatch(/onload/i);
    expect(doc).toContain('script-src \'none\'');
  });
});

describe('Mermaid preview helpers', () => {
  it('maps editor themes to mermaid themes', () => {
    expect(mermaidTheme('vs-dark')).toBe('dark');
    expect(mermaidTheme('hc-black')).toBe('dark');
    expect(mermaidTheme('vs')).toBe('default');
    expect(mermaidTheme('hc-light')).toBe('default');
  });

  it('locks mermaid to strict security and no auto-start', () => {
    const config = mermaidConfig('vs-dark');
    expect(config.securityLevel).toBe('strict');
    expect(config.startOnLoad).toBe(false);
    expect(config.theme).toBe('dark');
    expect(config.flowchart.htmlLabels).toBe(false);
  });

  it('strips scripts and handlers from mermaid SVG without dropping foreignObject', () => {
    const svg = sanitizeMermaidSvg(
      '<svg><script>alert(1)</script><g onclick="alert(1)"><foreignObject><div>label</div></foreignObject></g></svg>'
    );
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/onclick/i);
    expect(svg).toContain('foreignObject');
    expect(svg).toContain('label');
  });

  it('renders mermaid SVG through the sanitizer', async () => {
    const mermaid = {
      render: async (id, source) => ({
        svg: `<svg id="${id}"><script>alert(1)</script><text>${source}</text></svg>`
      })
    };
    const svg = await renderMermaidSvg('flowchart TD; A-->B', mermaid, { id: 't1' });
    expect(svg).toContain('id="t1"');
    expect(svg).toContain('flowchart TD; A-->B');
    expect(svg).not.toMatch(/<script/i);
  });

  it('rejects empty mermaid sources', async () => {
    await expect(renderMermaidSvg('   ', { render: async () => ({ svg: '<svg/>' }) })).rejects.toThrow('Empty diagram');
  });
});

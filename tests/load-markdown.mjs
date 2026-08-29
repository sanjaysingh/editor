/**
 * Helper to load client/markdown.js in Node.js tests.
 */
const markdownPath = new URL('../client/markdown.js', import.meta.url).pathname;
await import(markdownPath);

export const {
  render,
  format,
  parseInline,
  isSafeUrl,
  detection
} = globalThis.MarkdownSupport;

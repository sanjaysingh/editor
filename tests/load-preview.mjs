const previewPath = new URL('../client/preview.js', import.meta.url).pathname;
await import(previewPath);

export const {
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
} = globalThis.PreviewSupport;

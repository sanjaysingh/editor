const previewPath = new URL('../client/preview.js', import.meta.url).pathname;
await import(previewPath);

export const {
  previewKind,
  isSvg,
  sanitizeMarkup,
  buildHtmlSrcdoc,
  buildSvgSrcdoc,
  isUnsafeUrl
} = globalThis.PreviewSupport;

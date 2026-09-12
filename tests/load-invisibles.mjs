const invisiblesPath = new URL('../client/invisibles.js', import.meta.url).pathname;
await import(invisiblesPath);

export const {
  invisibles,
  eolLabel,
  eolMarkerLines,
  buildEolDecorations
} = globalThis.InvisiblesSupport;

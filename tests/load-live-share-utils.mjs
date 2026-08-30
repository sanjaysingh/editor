const utilsPath = new URL('../client/live-share-utils.js', import.meta.url).pathname;
await import(utilsPath);

export const {
  buildShareLink,
  stripLegacyShareQuery,
  applySharedEditorState
} = globalThis.LiveShareUtils;

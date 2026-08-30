const path = new URL('../client/monaco-preload.js', import.meta.url).pathname;
await import(path);
export const {
  MONACO_VS,
  MONACO_VS_VERSION,
  LANGUAGE_MODULES,
  WORKER_FILES,
  WORKER_LANGUAGES,
  modulesFor,
  workerUrls
} = globalThis.MonacoPreload;

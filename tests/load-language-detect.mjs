/**
 * Helper to load client/language-detect.js in Node.js tests.
 */
const detectPath = new URL('../client/language-detect.js', import.meta.url).pathname;
await import(detectPath);

export const {
  fromContent,
  fromFile,
  extensionMap,
  markdownSignals,
  yamlSignals
} = globalThis.LanguageDetect;

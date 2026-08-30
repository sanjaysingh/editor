/**
 * Prefetch Monaco language packs and workers when the app opens
 * so switching languages later does not hit the network.
 */
(function (root) {
  const MONACO_VS_VERSION = '0.52.2';
  const MONACO_VS = `https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/${MONACO_VS_VERSION}/min/vs`;

  const LANGUAGE_MODULES = {
    cpp: ['vs/basic-languages/cpp/cpp'],
    csharp: ['vs/basic-languages/csharp/csharp'],
    css: ['vs/basic-languages/css/css', 'vs/language/css/cssMode'],
    go: ['vs/basic-languages/go/go'],
    html: ['vs/basic-languages/html/html', 'vs/language/html/htmlMode'],
    java: ['vs/basic-languages/java/java'],
    javascript: ['vs/basic-languages/javascript/javascript', 'vs/language/typescript/tsMode'],
    json: ['vs/language/json/jsonMode'],
    markdown: ['vs/basic-languages/markdown/markdown'],
    php: ['vs/basic-languages/php/php'],
    powershell: ['vs/basic-languages/powershell/powershell'],
    python: ['vs/basic-languages/python/python'],
    ruby: ['vs/basic-languages/ruby/ruby'],
    sql: ['vs/basic-languages/sql/sql'],
    typescript: ['vs/basic-languages/typescript/typescript', 'vs/language/typescript/tsMode'],
    xml: ['vs/basic-languages/xml/xml'],
    yaml: ['vs/basic-languages/yaml/yaml']
  };

  const WORKER_FILES = [
    'base/worker/workerMain.js',
    'language/css/cssWorker.js',
    'language/html/htmlWorker.js',
    'language/json/jsonWorker.js',
    'language/typescript/tsWorker.js'
  ];

  const WORKER_LANGUAGES = ['css', 'html', 'json', 'javascript', 'typescript'];

  function modulesFor(languageIds) {
    const modules = new Set();
    (languageIds || []).forEach((id) => {
      (LANGUAGE_MODULES[id] || []).forEach((mod) => modules.add(mod));
    });
    return [...modules];
  }

  function workerUrls() {
    return WORKER_FILES.map((file) => `${MONACO_VS}/${file}`);
  }

  function requireModules(requireFn, modules) {
    if (!modules.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      requireFn(modules, () => resolve(), (err) => reject(err || new Error('Failed to load Monaco language modules')));
    });
  }

  async function prefetchWorkers(fetchFn) {
    const load = fetchFn || (typeof fetch === 'function' ? fetch.bind(root) : null);
    if (!load) return;
    await Promise.all(workerUrls().map((url) => load(url, { mode: 'cors', credentials: 'omit' }).catch(() => null)));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function workerResourcesLoaded() {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return false;
    const loaded = new Set(performance.getEntriesByType('resource').map((entry) => entry.name));
    return workerUrls().every((url) => loaded.has(url));
  }

  async function waitForWorkers(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (workerResourcesLoaded()) return true;
      await delay(50);
    }
    return workerResourcesLoaded();
  }

  async function waitUntilNetworkSettled(quietMs = 400, timeoutMs = 8000) {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) {
      await delay(quietMs);
      return;
    }
    const start = Date.now();
    let last = performance.getEntriesByType('resource').length;
    let quiet = 0;
    while (Date.now() - start < timeoutMs) {
      await delay(50);
      const count = performance.getEntriesByType('resource').length;
      if (count === last) {
        quiet += 50;
        if (quiet >= quietMs) return;
      } else {
        last = count;
        quiet = 0;
      }
    }
  }

  function warmWorkers(monacoApi) {
    if (!monacoApi?.editor?.createModel) return [];
    return WORKER_LANGUAGES.map((language) => monacoApi.editor.createModel('', language));
  }

  async function activateLanguages(monacoApi, model, languageIds) {
    if (!monacoApi?.editor?.setModelLanguage || !model) return;
    const ids = (languageIds || []).filter((id) => id && id !== 'plaintext');
    for (const language of ids) {
      monacoApi.editor.setModelLanguage(model, language);
      await delay(0);
    }
    monacoApi.editor.setModelLanguage(model, 'plaintext');
  }

  async function preload({ requireFn, fetchFn, monacoApi, languageIds, editor } = {}) {
    const ids = languageIds || Object.keys(LANGUAGE_MODULES);
    await requireModules(requireFn, modulesFor(ids));
    await prefetchWorkers(fetchFn);
    const models = warmWorkers(monacoApi);
    const model = editor?.getModel?.() || models[0];
    await activateLanguages(monacoApi, model, ids);
    await waitForWorkers();
    await waitUntilNetworkSettled();
    return models;
  }

  const api = {
    MONACO_VS_VERSION,
    MONACO_VS,
    LANGUAGE_MODULES,
    WORKER_FILES,
    WORKER_LANGUAGES,
    modulesFor,
    workerUrls,
    preload,
    waitForWorkers
  };
  root.MonacoPreload = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

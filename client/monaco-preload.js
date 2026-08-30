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

  function warmWorkers(monacoApi) {
    if (!monacoApi?.editor?.createModel) return [];
    return WORKER_LANGUAGES.map((language) => monacoApi.editor.createModel('', language));
  }

  async function preload({ requireFn, fetchFn, monacoApi, languageIds } = {}) {
    const ids = languageIds || Object.keys(LANGUAGE_MODULES);
    await requireModules(requireFn, modulesFor(ids));
    await prefetchWorkers(fetchFn);
    return warmWorkers(monacoApi);
  }

  const api = {
    MONACO_VS_VERSION,
    MONACO_VS,
    LANGUAGE_MODULES,
    WORKER_FILES,
    WORKER_LANGUAGES,
    modulesFor,
    workerUrls,
    preload
  };
  root.MonacoPreload = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

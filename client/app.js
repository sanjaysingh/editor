let editor;

// Fix iOS Safari 100vh issues by setting a custom --app-vh variable
(function setViewportUnitFix(){
  function updateVh(){
    const vh = window.innerHeight;
    document.documentElement.style.setProperty('--app-vh', vh + 'px');
  }
  updateVh();
  window.addEventListener('resize', updateVh);
  window.addEventListener('orientationchange', updateVh);
})();

// Centralized language configuration
const supportedLanguages = {
    plaintext: { displayName: 'Plain Text' },
    cpp: { displayName: 'C++' },
    csharp: { displayName: 'C#' },
    css: { displayName: 'CSS' },
    go: { displayName: 'Go' },
    html: { displayName: 'HTML' },
    java: { displayName: 'Java' },
    javascript: { displayName: 'JavaScript' },
    json: { displayName: 'JSON' },
    markdown: { displayName: 'Markdown' },
    php: { displayName: 'PHP' },
    powershell: { displayName: 'PowerShell' },
    python: { displayName: 'Python' },
    ruby: { displayName: 'Ruby' },
    sql: { displayName: 'SQL' },
    typescript: { displayName: 'TypeScript' },
    xml: { displayName: 'XML' },
    yaml: { displayName: 'YAML' },
    // Add new languages here
    // example: rust: { displayName: 'Rust' }
};

// Editor themes
const editorThemes = {
    'vs-dark': 'Dark',
    'vs': 'Light',
    'hc-black': 'High Contrast Dark',
    'hc-light': 'High Contrast Light'
};

// Editor settings
const editorSettings = {
    theme: 'vs-dark',
    fontSize: 14,
    tabSize: 2,
    wordWrap: 'on',
    minimap: false,
    lineNumbers: true,
    formatOnPaste: true,
    formatOnType: false,
    autoIndent: 'advanced',
    useTabStops: true
};

// Preserve network APIs for Live Share and for the startup preload.
// The actual lock happens after Monaco language packs have finished loading.
try {
    window.__origFetch = window.fetch?.bind(window);
    window.__origWebSocket = window.WebSocket;
    window.__origCreateElement = document.createElement.bind(document);
} catch {}

function lockNetworkExceptLiveShare() {
    if (window.__networkLocked) return;
    window.__networkLocked = true;
    window.fetch = () => Promise.reject(new Error('Network requests are disabled'));
    window.XMLHttpRequest = function() { throw new Error('Network requests are disabled'); };
    window.WebSocket = function() { throw new Error('Network requests are disabled'); };

    const originalCreateElement = window.__origCreateElement || document.createElement.bind(document);
    document.createElement = function(tag) {
        const element = originalCreateElement.call(document, tag);
        if (tag.toLowerCase() === 'script') {
            Object.defineProperty(element, 'src', {
                set: () => { throw new Error('Dynamic script loading is disabled'); }
            });
        }
        return element;
    };
}

window.addEventListener('load', () => {
    populateLanguageDropdown();
    populateThemeDropdown();
});

// Populate language dropdown from the supportedLanguages object
function populateLanguageDropdown() {
    const selectElement = document.getElementById('language-select');
    
    // Clear existing options
    selectElement.innerHTML = '';
    
    // Create and append options based on the configured languages
    Object.entries(supportedLanguages).forEach(([langId, langInfo]) => {
        const option = document.createElement('option');
        option.value = langId;
        option.textContent = langInfo.displayName;
        selectElement.appendChild(option);
    });
}

// Populate theme dropdown
function populateThemeDropdown() {
    // Only create theme dropdown if it exists in the HTML
    const themeSelect = document.getElementById('theme-select');
    if (!themeSelect) return;
    
    // Clear existing options
    themeSelect.innerHTML = '';
    
    // Create and append options based on available themes
    Object.entries(editorThemes).forEach(([themeId, themeName]) => {
        const option = document.createElement('option');
        option.value = themeId;
        option.textContent = themeName;
        if (themeId === editorSettings.theme) {
            option.selected = true;
        }
        themeSelect.appendChild(option);
    });
}

// Initialize Monaco Editor
const loadMonaco = () => {
    const vs = (typeof MonacoPreload !== 'undefined' && MonacoPreload.MONACO_VS)
        ? MonacoPreload.MONACO_VS
        : 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs';
    const start = () => {
        require.config({ paths: { vs } });
        require(['vs/editor/editor.main'], initializeEditor);
    };
    if (typeof require === 'function') {
        start();
        return;
    }
    const script = (window.__origCreateElement || document.createElement.bind(document))('script');
    script.src = `${vs}/loader.js`;
    script.onload = start;
    document.body.appendChild(script);
};

const languageDetector = (typeof LanguageDetect !== 'undefined')
    ? LanguageDetect
    : {
        fromContent() { return 'plaintext'; },
        fromFile() { return 'plaintext'; }
    };

const defaultFileExtensions = {
    plaintext: 'txt',
    cpp: 'cpp',
    csharp: 'cs',
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    javascript: 'js',
    json: 'json',
    markdown: 'md',
    php: 'php',
    powershell: 'ps1',
    python: 'py',
    ruby: 'rb',
    sql: 'sql',
    typescript: 'ts',
    xml: 'xml',
    yaml: 'yml'
};

function getDownloadFilename() {
    const current = document.getElementById('file-path')?.textContent?.trim();
    if (current && current !== 'No file opened') return current;
    const lang = editor?.getModel?.()?.getLanguageId?.() || 'plaintext';
    const content = editor?.getValue?.() || '';
    if (lang === 'xml' && typeof PreviewSupport !== 'undefined' && PreviewSupport.isSvg(content)) {
        return 'untitled.svg';
    }
    return `untitled.${defaultFileExtensions[lang] || 'txt'}`;
}

function downloadEditorContent() {
    const content = editor.getValue();
    const filename = getDownloadFilename();
    let type = 'text/plain';
    if (/\.(md|markdown)$/i.test(filename)) type = 'text/markdown';
    else if (/\.(html|htm|xhtml)$/i.test(filename)) type = 'text/html';
    else if (/\.svg$/i.test(filename)) type = 'image/svg+xml';
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// File handling
async function handleFile(file) {
    try {
        const text = await file.text();
        editor.setValue(text);

        // Detect language and update UI
        const language = languageDetector.fromFile(file, text);
        document.getElementById('language-select').value = language;
        monaco.editor.setModelLanguage(editor.getModel(), language);

        // Update file info in UI
        document.getElementById('file-path').textContent = file.name;
        document.title = `${file.name} - Offline Code Editor`;
        
        // Format code after opening
        setTimeout(() => formatCode(), 100);
    } catch (error) {
        console.error('Error reading file:', error);
        alert('Error reading file. Please try again.');
    }
}

// Format code in editor
async function formatCode() {
    try {
        const model = editor.getModel();
        if (!model) return;
        const languageId = model.getLanguageId();

        if (languageId === 'markdown' && typeof MarkdownSupport !== 'undefined') {
            const formatted = MarkdownSupport.format(model.getValue());
            if (formatted !== model.getValue()) {
                model.setValue(formatted);
            }
            return;
        }

        // Special-case JSON to ensure pretty-printing even if built-in formatter is limited
        if (languageId === 'json') {
            try {
                const text = model.getValue();
                const { insertSpaces, tabSize } = model.getOptions ? model.getOptions() : { insertSpaces: true, tabSize: editorSettings.tabSize };
                const indent = insertSpaces ? ' '.repeat(tabSize) : '\t';
                const eol = model.getEOL ? model.getEOL() : '\n';
                const parsed = JSON.parse(text);
                let formatted = JSON.stringify(parsed, null, indent);
                if (eol !== '\n') {
                    formatted = formatted.replace(/\n/g, eol);
                }
                model.setValue(formatted);
                return;
            } catch {}
        }

        // Use Monaco formatters for other languages
        await editor.getAction('editor.action.formatDocument').run();
    } catch (error) {
        console.error('Formatting failed:', error);
        const currentModel = editor.getModel();
        if (currentModel) {
            const { insertSpaces, tabSize } = currentModel.getOptions ? currentModel.getOptions() : { insertSpaces: true, tabSize: editorSettings.tabSize };
            const edits = await monaco.languages.getFormattingEditsForDocument(currentModel, {
                insertSpaces,
                tabSize
            });
            if (edits) {
                currentModel.pushEditOperations([], edits, null);
            }
        }
    }
}

// Register additional language formatters
function registerFormatters() {
    // HTML formatter
    monaco.languages.registerDocumentFormattingEditProvider('html', {
        provideDocumentFormattingEdits: function(model) {
            const text = model.getValue();
            const { insertSpaces, tabSize } = model.getOptions ? model.getOptions() : { insertSpaces: true, tabSize: editorSettings.tabSize };
            const indentUnit = insertSpaces ? ' '.repeat(tabSize) : '\t';
            const eol = model.getEOL ? model.getEOL() : '\n';
            let formatted = '';
            let indent = 0;
            const normalized = text.replace(/>\s*</g, '>' + eol + '<');
            const lines = normalized.split(/\r\n|\r|\n/);

            lines.forEach(line => {
                line = line.trim();
                if (line.endsWith('/>')) {
                    formatted += indentUnit.repeat(indent) + line + eol;
                }
                else if (line.match(/<\/[\w-:.]+>/)) {
                    if (!line.match(/<[^/][^>]*>/)) {
                        indent--;
                    }
                    formatted += indentUnit.repeat(Math.max(0, indent)) + line + eol;
                }
                else if (line.match(/<[^/][^>]*>/)) {
                    formatted += indentUnit.repeat(indent) + line + eol;
                    if (!line.match(/<\/[\w-:.]+>/) && !line.endsWith('/>')) {
                        indent++;
                    }
                }
                else {
                    formatted += indentUnit.repeat(indent) + line + eol;
                }
            });

            return [{
                range: model.getFullModelRange(),
                text: formatted.trim()
            }];
        }
    });
    
    // XML formatter
    monaco.languages.registerDocumentFormattingEditProvider('xml', {
        provideDocumentFormattingEdits: function(model) {
            const text = model.getValue();
            const { insertSpaces, tabSize } = model.getOptions ? model.getOptions() : { insertSpaces: true, tabSize: editorSettings.tabSize };
            const indentUnit = insertSpaces ? ' '.repeat(tabSize) : '\t';
            const eol = model.getEOL ? model.getEOL() : '\n';
            let formatted = '';
            let indent = 0;
            // Expand minified XML by inserting newlines between tags first
            const normalized = text.replace(/>\s*</g, '>' + eol + '<');
            const lines = normalized.split(/\r\n|\r|\n/);

            lines.forEach(rawLine => {
                let line = rawLine.trim();
                if (!line) {
                    return;
                }
                // XML declaration or comments stay at current level
                if (/^<\?/.test(line) || /^<!--/.test(line) || /^<!\[CDATA\[/.test(line)) {
                    formatted += indentUnit.repeat(indent) + line + eol;
                    return;
                }
                // Closing tag -> decrease first
                if (/^<\//.test(line)) {
                    indent--;
                    formatted += indentUnit.repeat(Math.max(0, indent)) + line + eol;
                    return;
                }
                // Self-closing tag
                if (/^<[^!?][^>]*\/>\s*$/.test(line)) {
                    formatted += indentUnit.repeat(indent) + line + eol;
                    return;
                }
                // Opening tag
                if (/^<[^!?/][^>]*>\s*$/.test(line)) {
                    formatted += indentUnit.repeat(indent) + line + eol;
                    indent++;
                    return;
                }
                // Text node or mixed content
                formatted += indentUnit.repeat(indent) + line + eol;
            });

            return [{
                range: model.getFullModelRange(),
                text: formatted.trim()
            }];
        }
    });
    
    // JSON formatter (pretty-print with correct indentation and newlines)
    monaco.languages.registerDocumentFormattingEditProvider('json', {
        provideDocumentFormattingEdits: function(model) {
            const text = model.getValue();
            try {
                const value = JSON.parse(text);
                const { insertSpaces, tabSize } = model.getOptions ? model.getOptions() : { insertSpaces: true, tabSize: editorSettings.tabSize };
                const indent = insertSpaces ? ' '.repeat(tabSize) : '\t';
                const eol = model.getEOL ? model.getEOL() : '\n';
                let formatted = JSON.stringify(value, null, indent);
                if (eol !== '\n') {
                    formatted = formatted.replace(/\n/g, eol);
                }
                return [{
                    range: model.getFullModelRange(),
                    text: formatted
                }];
            } catch (e) {
                // Invalid JSON, do not modify
                return [];
            }
        }
    });
}

// Register keyboard shortcuts and commands
function registerCommands() {
    // Save shortcut (Ctrl+S) - shows save dialog since we can't actually save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
        downloadEditorContent();
    });
    
    // Format code shortcut (Alt+Shift+F)
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, formatCode);
    
    // Toggle comment (Ctrl+/)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, function() {
        editor.getAction('editor.action.commentLine').run();
    });
    
    // Find (Ctrl+F)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, function() {
        editor.getAction('actions.find').run();
    });
    
    // Replace (Ctrl+H)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, function() {
        editor.getAction('editor.action.startFindReplaceAction').run();
    });
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM, function() {
        if (typeof PreviewSupport !== 'undefined') {
            PreviewSupport.preview.cycleMode();
        }
    });

    // Go to line (Ctrl+G)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, function() {
        editor.getAction('editor.action.gotoLine').run();
    });
}

// Change editor theme
function changeTheme(theme) {
    monaco.editor.setTheme(theme);
    editorSettings.theme = theme;
    if (typeof PreviewSupport !== 'undefined') {
        PreviewSupport.preview.setTheme(theme);
    }
    if (typeof InvisiblesSupport !== 'undefined') {
        InvisiblesSupport.invisibles.onThemeChanged();
    }
}

// Initialize editor
function initializeEditor() {
    // Register language formatters
    registerFormatters();
    if (typeof MarkdownSupport !== 'undefined') {
        MarkdownSupport.registerWithMonaco(monaco);
    }
    
    // Create editor instance with improved settings
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '',
        language: 'plaintext',
        theme: editorSettings.theme,
        minimap: { enabled: editorSettings.minimap },
        automaticLayout: true,
        fontSize: editorSettings.fontSize,
        tabSize: editorSettings.tabSize,
        renderWhitespace: 'selection',
        scrollBeyondLastLine: false,
        lineNumbers: editorSettings.lineNumbers ? 'on' : 'off',
        folding: true,
        renderIndentGuides: true,
        contextmenu: true,
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        formatOnPaste: editorSettings.formatOnPaste,
        formatOnType: editorSettings.formatOnType,
        autoIndent: editorSettings.autoIndent,
        wordWrap: editorSettings.wordWrap,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 3,
        fixedOverflowWidgets: true,
        suggest: {
            snippetsPreventQuickSuggestions: false,
            showWords: true,
            showClasses: true,
            showFunctions: true
        },
        quickSuggestions: {
            other: true,
            comments: true,
            strings: true
        },
        parameterHints: { enabled: true },
        smartSelect: { selectSubwords: true },
        bracketPairColorization: { enabled: true },
        find: { autoFindInSelection: 'multiline' },
        accessibilitySupport: 'on',
        cursorBlinking: 'smooth',
        mouseWheelZoom: true,
        guides: {
            indentation: true,
            bracketPairs: true
        },
        renderControlCharacters: true
    });
    window.editor = editor;
    
    // Register keyboard shortcuts and commands
    registerCommands();

    if (typeof PreviewSupport !== 'undefined') {
        PreviewSupport.preview.attach(editor);
        PreviewSupport.preview.setTheme(editorSettings.theme);
    }
    if (typeof InvisiblesSupport !== 'undefined') {
        InvisiblesSupport.invisibles.attach(editor);
    }
    if (typeof window.liveShareFlushPending === 'function') {
        window.liveShareFlushPending();
    }

    preloadEditorAssets().finally(() => {
        lockNetworkExceptLiveShare();
        window.__editorAssetsReady = true;
    });

    // Set up event listeners
    setupEventListeners();
    
    // Create a status bar with information
    createStatusBar();
    
    // Mobile optimization
    if ('ontouchstart' in window) {
        editor.updateOptions({
            fontSize: 16,
            lineHeight: 24,
            padding: { top: 10, bottom: 10 }
        });
    }
}

async function preloadEditorAssets() {
    if (typeof MonacoPreload === 'undefined' || typeof require !== 'function') return;
    const models = await MonacoPreload.preload({
        requireFn: require,
        fetchFn: window.__origFetch || window.fetch?.bind(window),
        monacoApi: monaco,
        languageIds: Object.keys(supportedLanguages),
        editor
    });
    window.__monacoWarmModels = models;
}

// Create a status bar with additional information
function createStatusBar() {
    const statusBar = document.createElement('div');
    statusBar.id = 'status-bar';
    statusBar.className = 'status-bar';
    
    const positionInfo = document.createElement('div');
    positionInfo.id = 'position-info';
    positionInfo.className = 'status-item';
    positionInfo.textContent = 'Ln 1, Col 1';
    
    const languageInfo = document.createElement('div');
    languageInfo.id = 'language-info';
    languageInfo.className = 'status-item';
    languageInfo.textContent = 'plaintext';
    
    statusBar.appendChild(positionInfo);
    statusBar.appendChild(languageInfo);
    
    document.body.appendChild(statusBar);
    
    // Update position and language info when cursor position changes
    editor.onDidChangeCursorPosition((e) => {
        const position = editor.getPosition();
        positionInfo.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
    });
    
    // Update language info when language changes
    editor.onDidChangeModelLanguage((e) => {
        languageInfo.textContent = e.newLanguage;
    });
}

// Set up all event listeners
function setupEventListeners() {
    const dropZone = document.getElementById('drop-zone');

    // Drag and drop handling
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('active');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (e.target === dropZone) {
            dropZone.classList.remove('active');
        }
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        const file = e.dataTransfer.files[0];
        if (file) {
            await handleFile(file);
        }
    });

    // File input handling
    document.getElementById('file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await handleFile(file);
        }
        e.target.value = '';
    });

    // Window resize handling
    window.addEventListener('resize', () => editor.layout());

    function maybeDetectLanguage() {
        if (window.liveShareRole === 'viewer') return;
        const model = editor.getModel();
        if (!model) return;
        const currentLanguage = model.getLanguageId();
        const content = model.getValue();
        const isEmptyOrMinimal = content.trim().length < 10;
        if (currentLanguage !== 'plaintext' && !isEmptyOrMinimal) return;
        const detectedLanguage = languageDetector.fromContent(content);
        if (detectedLanguage && detectedLanguage !== 'plaintext') {
            document.getElementById('language-select').value = detectedLanguage;
            monaco.editor.setModelLanguage(model, detectedLanguage);
        }
    }

    let detectTimer = 0;
    function scheduleDetectLanguage() {
        clearTimeout(detectTimer);
        detectTimer = setTimeout(maybeDetectLanguage, 150);
    }

    // Mobile and some paste paths insert text without a single onDidPaste /
    // 40+ character change. While the editor is still plaintext, debounce
    // detection on any content change.
    editor.onDidPaste(scheduleDetectLanguage);
    editor.onDidChangeModelContent(scheduleDetectLanguage);

    // Language selection handling
    document.getElementById('language-select').addEventListener('change', (e) => {
        if (e.target.value) {
            monaco.editor.setModelLanguage(editor.getModel(), e.target.value);
            // Trigger live share sync if host
            if (window.liveShareRole === 'host' && window.liveShareScheduleSend) {
                window.liveShareScheduleSend();
            }
        }
    });
    
    // Theme selection handling if exists in HTML
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                changeTheme(e.target.value);
            }
        });
    }
    
    // Add custom keyboard shortcut handling
    document.addEventListener('keydown', (e) => {
        // Ctrl+S to trigger save dialog
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            editor.getAction('editor.action.formatDocument').run().then(() => {
                downloadEditorContent();
            });
        }
    });
}

// Initialize the application
loadMonaco(); 
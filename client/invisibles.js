/**
 * Toggle display of hidden characters: spaces, tabs, and end-of-line markers.
 */
(function (root) {
  const REFRESH_MS = 50;
  const BUTTON_ID = 'invisibles-btn';

  function eolLabel(eol) {
    if (eol === '\r\n') return 'CRLF';
    if (eol === '\r') return 'CR';
    return 'LF';
  }

  function eolMarkerLines(lineCount) {
    const count = Number(lineCount) || 0;
    if (count < 2) return [];
    const lines = [];
    for (let line = 1; line < count; line += 1) {
      lines.push(line);
    }
    return lines;
  }

  function buildEolDecorations(editor) {
    const model = editor?.getModel?.();
    if (!model || typeof model.getLineMaxColumn !== 'function') return [];
    const label = eolLabel(model.getEOL());
    return eolMarkerLines(model.getLineCount()).map((lineNumber) => {
      const column = model.getLineMaxColumn(lineNumber);
      return {
        range: {
          startLineNumber: lineNumber,
          startColumn: column,
          endLineNumber: lineNumber,
          endColumn: column
        },
        options: {
          after: {
            content: label,
            inlineClassName: 'eol-marker'
          },
          showIfCollapsed: true
        }
      };
    });
  }

  const invisibles = {
    editor: null,
    enabled: false,
    debounce: null,
    decorations: null,
    decorationIds: null,

    attach(editor) {
      this.editor = editor;
      this.enabled = false;
      const btn = typeof document !== 'undefined' ? document.getElementById(BUTTON_ID) : null;
      if (btn) btn.addEventListener('click', () => this.toggle());
      editor.onDidChangeModelContent(() => this.scheduleRefresh());
      if (typeof editor.onDidChangeModel === 'function') {
        editor.onDidChangeModel(() => this.refresh());
      }
      this.apply();
    },

    toggle() {
      this.setEnabled(!this.enabled);
    },

    setEnabled(enabled) {
      this.enabled = !!enabled;
      this.apply();
    },

    apply() {
      if (!this.editor) return;
      this.editor.updateOptions({
        renderWhitespace: this.enabled ? 'all' : 'selection'
      });
      this.refresh();
      this.syncButton();
    },

    onThemeChanged() {
      if (!this.editor || !this.enabled) return;
      // Theme swaps rebuild Monaco's view and drop whitespace glyphs
      // plus injected EOL markers unless both are reapplied.
      this.editor.updateOptions({ renderWhitespace: 'none' });
      this.editor.updateOptions({ renderWhitespace: 'all' });
      this.refresh({ recreate: true });
    },

    syncButton() {
      const btn = typeof document !== 'undefined' ? document.getElementById(BUTTON_ID) : null;
      if (!btn) return;
      btn.setAttribute('aria-pressed', this.enabled ? 'true' : 'false');
    },

    scheduleRefresh() {
      if (!this.enabled) return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.refresh(), REFRESH_MS);
    },

    refresh(options) {
      if (!this.editor) return;
      const recreate = !!(options && options.recreate);
      const next = this.enabled ? buildEolDecorations(this.editor) : [];
      if (typeof this.editor.createDecorationsCollection === 'function') {
        if (recreate && this.decorations && typeof this.decorations.clear === 'function') {
          this.decorations.clear();
          this.decorations = null;
        }
        if (!this.decorations) {
          this.decorations = this.editor.createDecorationsCollection([]);
        }
        this.decorations.set(next);
        return;
      }
      if (typeof this.editor.deltaDecorations === 'function') {
        this.decorationIds = this.editor.deltaDecorations(this.decorationIds || [], next);
      }
    }
  };

  const api = {
    invisibles,
    eolLabel,
    eolMarkerLines,
    buildEolDecorations
  };

  root.InvisiblesSupport = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

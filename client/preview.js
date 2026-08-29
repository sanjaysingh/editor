/**
 * Live preview for Markdown, HTML, and SVG.
 * HTML/SVG render in a scriptless sandboxed iframe. Markdown uses the existing renderer.
 */
(function (root) {
  const PREVIEW_MODES = ['split', 'preview', 'off'];
  const STORAGE_KEY = 'previewMode';
  const LEGACY_STORAGE_KEY = 'markdownPreviewMode';
  const FORBIDDEN_TAGS = /^(script|iframe|object|embed|applet|frame|frameset|base|link|template)$/i;

  function isSvg(text) {
    let stripped = String(text || '').replace(/^\uFEFF/, '').trim();
    stripped = stripped.replace(/^<\?xml[\s\S]*?\?>\s*/i, '');
    while (/^<!--/.test(stripped)) {
      const end = stripped.indexOf('-->');
      if (end === -1) break;
      stripped = stripped.slice(end + 3).trim();
    }
    return /^<svg(\s|>|\/|$)/i.test(stripped);
  }

  function previewKind(language, content) {
    if (language === 'markdown') return 'markdown';
    if (language === 'html') return isSvg(content) ? 'svg' : 'html';
    if (language === 'xml' && isSvg(content)) return 'svg';
    return null;
  }

  function isUnsafeUrl(url) {
    const value = String(url || '').trim();
    if (/^(javascript|vbscript|livescript|mocha):/i.test(value)) return true;
    if (/^data:/i.test(value) && !/^data:image\//i.test(value)) return true;
    return false;
  }

  function sanitizeWithRegex(markup) {
    let out = String(markup || '');
    out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    out = out.replace(/<script\b[^>]*\/?>/gi, '');
    out = out.replace(/<(iframe|object|embed|applet|frame|frameset|base|link|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    out = out.replace(/<(iframe|object|embed|applet|frame|frameset|base|link|template|meta)\b[^>]*\/?>/gi, '');
    out = out.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '');
    out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    out = out.replace(/\s(href|src|xlink:href|action)\s*=\s*(["'])\s*(javascript|vbscript|data\s*:text)[^"']*\2/gi, ' $1="#"');
    out = out.replace(/(javascript|vbscript)\s*:/gi, 'blocked:');
    return out;
  }

  function sanitizeWithDom(markup) {
    const parser = new DOMParser();
    const full = /<!DOCTYPE\s+html|<html[\s>]/i.test(markup);
    const doc = parser.parseFromString(full ? markup : `<!DOCTYPE html><html><body>${markup}</body></html>`, 'text/html');
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
    const remove = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const tag = el.tagName || '';
      if (FORBIDDEN_TAGS.test(tag) || tag.toLowerCase() === 'foreignobject') {
        remove.push(el);
        continue;
      }
      if (tag.toLowerCase() === 'meta') {
        const httpEquiv = (el.getAttribute('http-equiv') || '').toLowerCase();
        if (httpEquiv && httpEquiv !== 'content-type') remove.push(el);
        continue;
      }
      [...el.attributes].forEach((attr) => {
        const name = attr.name;
        const value = attr.value || '';
        if (/^on/i.test(name) || name === 'srcdoc') {
          el.removeAttribute(name);
          return;
        }
        if (/^(href|src|xlink:href|action|formaction|poster)$/i.test(name) && isUnsafeUrl(value)) {
          el.removeAttribute(name);
        }
      });
    }
    remove.forEach((el) => el.remove());
    if (full) {
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    }
    return doc.body ? doc.body.innerHTML : sanitizeWithRegex(markup);
  }

  function sanitizeMarkup(markup) {
    if (typeof DOMParser !== 'undefined') {
      try {
        return sanitizeWithDom(markup);
      } catch {
        return sanitizeWithRegex(markup);
      }
    }
    return sanitizeWithRegex(markup);
  }

  function themeColors(theme) {
    if (theme === 'vs' || theme === 'hc-light') {
      return { bg: theme === 'hc-light' ? '#ffffff' : '#f6f8fa', text: '#1f2328' };
    }
    if (theme === 'hc-black') return { bg: '#000000', text: '#ffffff' };
    return { bg: '#1e1e1e', text: '#d4d4d4' };
  }

  function cspMeta() {
    return '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\';">';
  }

  function injectCsp(html) {
    if (/http-equiv=["']Content-Security-Policy/i.test(html)) return html;
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${cspMeta()}`);
    }
    if (/<html[\s>]/i.test(html)) {
      return html.replace(/<html([^>]*)>/i, `<html$1><head>${cspMeta()}</head>`);
    }
    return `<!DOCTYPE html><html><head>${cspMeta()}</head><body>${html}</body></html>`;
  }

  function isFullHtmlDocument(src) {
    return /<!DOCTYPE\s+html|<html[\s>]/i.test(src);
  }

  function buildHtmlSrcdoc(source, theme) {
    const colors = themeColors(theme);
    const sanitized = sanitizeMarkup(source);
    if (isFullHtmlDocument(source)) {
      return injectCsp(sanitized);
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${cspMeta()}<style>html,body{margin:0;padding:16px;background:${colors.bg};color:${colors.text};font-family:system-ui,sans-serif;}</style></head><body>${sanitized}</body></html>`;
  }

  function buildSvgSrcdoc(source, theme) {
    const colors = themeColors(theme);
    const sanitized = sanitizeMarkup(source);
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${cspMeta()}<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:${colors.bg};}svg{max-width:100%;max-height:100%;}</style></head><body>${sanitized}</body></html>`;
  }

  const preview = {
    editor: null,
    mode: 'split',
    debounce: null,
    observer: null,
    theme: 'vs-dark',
    lastKind: null,

    attach(editor) {
      this.editor = editor;
      this.mode = this.readStoredMode();
      const btn = document.getElementById('preview-btn');
      if (btn) btn.addEventListener('click', () => this.cycleMode());
      editor.onDidChangeModelContent(() => this.schedule());
      editor.onDidChangeModelLanguage(() => this.syncLanguage());
      this.observer = null;
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => {
          try { editor.layout(); } catch {}
        });
        const container = document.getElementById('editor-container');
        if (container) this.observer.observe(container);
      }
      this.syncLanguage();
    },

    readStoredMode() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
        if (PREVIEW_MODES.includes(stored)) return stored;
      } catch {}
      return 'split';
    },

    storeMode() {
      try { localStorage.setItem(STORAGE_KEY, this.mode); } catch {}
    },

    currentKind() {
      const language = this.editor?.getModel?.()?.getLanguageId?.();
      return previewKind(language, this.editor?.getValue?.() || '');
    },

    cycleMode() {
      if (!this.currentKind()) return;
      const idx = PREVIEW_MODES.indexOf(this.mode);
      this.mode = PREVIEW_MODES[(idx + 1) % PREVIEW_MODES.length];
      this.storeMode();
      this.applyMode();
      this.render();
    },

    syncLanguage() {
      const kind = this.currentKind();
      if (kind) {
        if (!PREVIEW_MODES.includes(this.mode)) this.mode = 'split';
        this.applyMode();
        this.render();
      } else {
        this.applyMode(true);
      }
    },

    applyMode(forceOff) {
      const workspace = document.getElementById('workspace');
      const pane = document.getElementById('preview-pane');
      const btn = document.getElementById('preview-btn');
      const header = document.getElementById('preview-header');
      const kind = forceOff ? null : this.currentKind();
      const active = !!kind;
      const mode = active ? this.mode : 'off';

      if (workspace) {
        workspace.classList.toggle('split-preview', mode === 'split');
        workspace.classList.toggle('preview-only', mode === 'preview');
        workspace.classList.toggle('editor-only', mode === 'off' || !active);
      }
      if (pane) pane.hidden = !active || mode === 'off';
      if (header) {
        header.textContent = kind === 'html' ? 'HTML Preview' : kind === 'svg' ? 'SVG Preview' : 'Preview';
      }
      if (btn) {
        btn.hidden = !active;
        btn.setAttribute('aria-pressed', active && mode !== 'off' ? 'true' : 'false');
        const titles = {
          split: 'Split preview — click for preview only (Ctrl+Shift+M)',
          preview: 'Preview only — click for editor only (Ctrl+Shift+M)',
          off: 'Editor only — click for split preview (Ctrl+Shift+M)'
        };
        btn.title = titles[mode] || titles.split;
        const icon = btn.querySelector('i');
        if (icon) {
          icon.className = mode === 'preview' ? 'fas fa-eye' : mode === 'off' ? 'fas fa-eye-slash' : 'fas fa-columns';
        }
      }
      requestAnimationFrame(() => {
        try { this.editor?.layout?.(); } catch {}
      });
    },

    schedule() {
      const kind = this.currentKind();
      if (kind !== this.lastKind) {
        this.lastKind = kind;
        this.applyMode(!kind);
        if (!kind) return;
      }
      if (!kind || this.mode === 'off') return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.render(), 120);
    },

    setTheme(theme) {
      this.theme = theme || 'vs-dark';
      const pane = document.getElementById('preview-pane');
      if (pane) pane.setAttribute('data-theme', this.theme);
      this.render();
    },

    render() {
      const body = document.getElementById('markdown-preview-body');
      const frame = document.getElementById('html-preview-frame');
      if (!this.editor) return;
      const kind = this.currentKind();
      if (!kind || this.mode === 'off') return;
      const source = this.editor.getValue();

      if (!source.trim()) {
        if (body) {
          body.hidden = false;
          body.innerHTML = '<p class="preview-empty">Nothing to preview</p>';
        }
        if (frame) {
          frame.hidden = true;
          frame.removeAttribute('srcdoc');
        }
        return;
      }

      if (kind === 'markdown') {
        if (frame) {
          frame.hidden = true;
          frame.removeAttribute('srcdoc');
        }
        if (body) {
          body.hidden = false;
          const scroll = body.scrollTop;
          body.innerHTML = (root.MarkdownSupport && root.MarkdownSupport.render)
            ? root.MarkdownSupport.render(source)
            : '';
          body.scrollTop = scroll;
        }
        return;
      }

      if (body) {
        body.hidden = true;
        body.innerHTML = '';
      }
      if (frame) {
        frame.hidden = false;
        frame.srcdoc = kind === 'svg' ? buildSvgSrcdoc(source, this.theme) : buildHtmlSrcdoc(source, this.theme);
      }
    }
  };

  const api = {
    preview,
    previewKind,
    isSvg,
    sanitizeMarkup,
    buildHtmlSrcdoc,
    buildSvgSrcdoc,
    isUnsafeUrl
  };

  root.PreviewSupport = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

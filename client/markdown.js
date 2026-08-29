/**
 * Markdown rendering, formatting, and live preview.
 * XSS-safe: user text is escaped; only http(s)/mailto/# links and http(s)/data-image sources are allowed.
 */
(function (root) {
  const PREVIEW_MODES = ['split', 'preview', 'off'];
  const STORAGE_KEY = 'markdownPreviewMode';

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isSafeUrl(raw, { image = false } = {}) {
    const url = String(raw || '').trim();
    if (!url) return false;
    if (/[\s<>"]/.test(url)) return false;
    if (/^#/.test(url)) return true;
    const colon = url.indexOf(':');
    if (colon === -1) return !url.startsWith('//');
    const protocol = url.slice(0, colon).toLowerCase();
    if (protocol === 'https' || protocol === 'http' || protocol === 'mailto') return true;
    if (image && protocol === 'data') {
      return /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(url);
    }
    return false;
  }

  function attrEscape(url) {
    return escapeHtml(url).replace(/'/g, '&#39;');
  }

  function parseInline(src) {
    const s = String(src || '');
    let i = 0;
    let html = '';

    function peek() {
      return s[i];
    }

    function startsWith(str) {
      return s.slice(i, i + str.length) === str;
    }

    function findClosing(delim, from) {
      let j = from;
      while (j < s.length) {
        if (s[j] === '\\' && j + 1 < s.length) {
          j += 2;
          continue;
        }
        if (s.slice(j, j + delim.length) === delim) return j;
        j++;
      }
      return -1;
    }

    function parseLinkOrImage(isImage) {
      const open = i;
      if (isImage) {
        if (!startsWith('![')) return false;
        i += 2;
      } else {
        if (peek() !== '[') return false;
        i += 1;
      }
      const textStart = i;
      let depth = 1;
      while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) {
          i += 2;
          continue;
        }
        if (s[i] === '[') depth++;
        else if (s[i] === ']') {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      if (i >= s.length || s[i] !== ']') {
        i = open;
        return false;
      }
      const inner = s.slice(textStart, i);
      i++;
      if (s[i] !== '(') {
        i = open;
        return false;
      }
      i++;
      const urlStart = i;
      if (s[i] === '<') {
        i++;
        const end = s.indexOf('>', i);
        if (end === -1) {
          i = open;
          return false;
        }
        const url = s.slice(i, end).trim();
        i = end + 1;
        while (s[i] === ' ') i++;
        let title = '';
        if (s[i] === '"' || s[i] === "'") {
          const q = s[i++];
          const tEnd = s.indexOf(q, i);
          if (tEnd === -1) {
            i = open;
            return false;
          }
          title = s.slice(i, tEnd);
          i = tEnd + 1;
        }
        if (s[i] !== ')') {
          i = open;
          return false;
        }
        i++;
        return emitLink(isImage, inner, url, title);
      }
      while (i < s.length && s[i] !== ')' && !/\s/.test(s[i])) i++;
      const url = s.slice(urlStart, i).trim();
      while (s[i] === ' ' || s[i] === '\t') i++;
      let title = '';
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i++];
        const tEnd = s.indexOf(q, i);
        if (tEnd === -1) {
          i = open;
          return false;
        }
        title = s.slice(i, tEnd);
        i = tEnd + 1;
        while (s[i] === ' ' || s[i] === '\t') i++;
      }
      if (s[i] !== ')') {
        i = open;
        return false;
      }
      i++;
      return emitLink(isImage, inner, url, title);
    }

    function emitLink(isImage, inner, url, title) {
      const safe = isSafeUrl(url, { image: isImage });
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      if (isImage) {
        if (!safe) {
          html += escapeHtml(`![${inner}](${url})`);
          return true;
        }
        html += `<img src="${attrEscape(url)}" alt="${escapeHtml(inner)}"${titleAttr}>`;
        return true;
      }
      if (!safe) {
        html += escapeHtml(`[${inner}](${url})`);
        return true;
      }
      html += `<a href="${attrEscape(url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${parseInline(inner)}</a>`;
      return true;
    }

    while (i < s.length) {
      if (s[i] === '\\' && i + 1 < s.length) {
        html += escapeHtml(s[i + 1]);
        i += 2;
        continue;
      }

      if (s[i] === '\n') {
        html += '<br>\n';
        i++;
        continue;
      }

      if (s[i] === '`') {
        let ticks = 1;
        while (s[i + ticks] === '`') ticks++;
        const closer = '`'.repeat(ticks);
        const end = s.indexOf(closer, i + ticks);
        if (end !== -1) {
          const code = s.slice(i + ticks, end).replace(/\n/g, ' ');
          html += `<code>${escapeHtml(code)}</code>`;
          i = end + ticks;
          continue;
        }
      }

      if (startsWith('![') && parseLinkOrImage(true)) continue;
      if (s[i] === '[' && parseLinkOrImage(false)) continue;

      const auto = s.slice(i).match(/^<(https?:\/\/[^>\s]+)>/);
      if (auto && isSafeUrl(auto[1])) {
        html += `<a href="${attrEscape(auto[1])}" target="_blank" rel="noopener noreferrer">${escapeHtml(auto[1])}</a>`;
        i += auto[0].length;
        continue;
      }

      const gfmAuto = s.slice(i).match(/^(https?:\/\/[^\s<]+[^\s<.,:;!?)\]])/);
      if (gfmAuto && isSafeUrl(gfmAuto[1]) && (i === 0 || /\s/.test(s[i - 1]))) {
        html += `<a href="${attrEscape(gfmAuto[1])}" target="_blank" rel="noopener noreferrer">${escapeHtml(gfmAuto[1])}</a>`;
        i += gfmAuto[1].length;
        continue;
      }

      if (startsWith('~~')) {
        const end = findClosing('~~', i + 2);
        if (end !== -1) {
          html += `<del>${parseInline(s.slice(i + 2, end))}</del>`;
          i = end + 2;
          continue;
        }
      }

      if (startsWith('**') || startsWith('__')) {
        const delim = s.slice(i, i + 2);
        const end = findClosing(delim, i + 2);
        if (end !== -1 && end > i + 2) {
          html += `<strong>${parseInline(s.slice(i + 2, end))}</strong>`;
          i = end + 2;
          continue;
        }
      }

      if (s[i] === '*' || s[i] === '_') {
        const delim = s[i];
        const prev = s[i - 1];
        if (delim === '_' && prev && /[A-Za-z0-9]/.test(prev)) {
          html += delim;
          i++;
          continue;
        }
        const end = findClosing(delim, i + 1);
        if (end !== -1 && end > i + 1 && s[end + 1] !== delim) {
          html += `<em>${parseInline(s.slice(i + 1, end))}</em>`;
          i = end + 1;
          continue;
        }
      }

      html += escapeHtml(s[i]);
      i++;
    }

    return html;
  }

  function matchListMarker(line) {
    const m = String(line).match(/^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(?:(\[[ xX]\])\s+)?(.*)$/);
    if (!m) return null;
    const indent = m[1].replace(/\t/g, '    ').length;
    const ordered = !!m[3];
    const marker = ordered ? m[3] + m[4] : m[2];
    return {
      indent,
      ordered,
      start: ordered ? parseInt(m[3], 10) : null,
      task: !!m[6],
      checked: m[6] ? /x/i.test(m[6]) : false,
      content: m[7],
      contentIndent: indent + marker.length + m[5].length
    };
  }

  function isHr(line) {
    return /^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})\s*$/.test(line) && !matchListMarker(line + ' x');
  }

  function isAtxHeading(line) {
    return /^ {0,3}#{1,6}(?:\s+|$).*/.test(line) && /^ {0,3}#{1,6}(?:\s|$)/.test(line);
  }

  function isFence(line) {
    return /^ {0,3}(?:`{3,}|~{3,})/.test(line);
  }

  function isBlockquote(line) {
    return /^ {0,3}>/.test(line);
  }

  function isTableSep(line) {
    return /^ {0,3}\|? *:?-{3,}:? *(?:\| *:?-{3,}:? *)+\|?\s*$/.test(line);
  }

  function looksLikeTableRow(line) {
    return /^ {0,3}\|/.test(line) || (/\|/.test(line) && /\|/.test(line.slice(1)));
  }

  function splitTableRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map((cell) => cell.trim());
  }

  function parseTableAlign(sep) {
    return splitTableRow(sep).map((cell) => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });
  }

  function isInterruptingBlock(line) {
    if (/^\s*$/.test(line)) return true;
    if (isFence(line) || isAtxHeading(line) || isBlockquote(line)) return true;
    if (/^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})\s*$/.test(line)) return true;
    const list = matchListMarker(line);
    return !!(list && list.indent <= 3);
  }

  function parseBlocks(src) {
    const lines = String(src || '').split('\n');
    let i = 0;
    const parts = [];

    function takeFence() {
      const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      const delim = open[1][0];
      const fenceLen = open[1].length;
      const info = (open[2] || '').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_-]/g, '');
      i++;
      const body = [];
      while (i < lines.length) {
        const close = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === delim && close[1].length >= fenceLen) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      const langClass = info ? ` class="language-${escapeHtml(info)}"` : '';
      parts.push(`<pre><code${langClass}>${escapeHtml(body.join('\n'))}</code></pre>`);
    }

    function takeHeading() {
      const m = lines[i].match(/^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#*)?\s*$/);
      const level = m[1].length;
      const text = (m[2] || '').replace(/\s+#+\s*$/, '').trim();
      i++;
      parts.push(`<h${level}>${parseInline(text)}</h${level}>`);
    }

    function takeQuote() {
      const quoted = [];
      while (i < lines.length && (isBlockquote(lines[i]) || (/^\s*$/.test(lines[i]) && i + 1 < lines.length && isBlockquote(lines[i + 1])))) {
        if (/^\s*$/.test(lines[i])) quoted.push('');
        else quoted.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      parts.push(`<blockquote>${parseBlocks(quoted.join('\n'))}</blockquote>`);
    }

    function takeList() {
      const first = matchListMarker(lines[i]);
      const ordered = first.ordered;
      const baseIndent = first.indent;
      const items = [];
      let start = first.start;

      while (i < lines.length) {
        const marker = matchListMarker(lines[i]);
        if (!marker || marker.indent < baseIndent) break;
        if (marker.indent > baseIndent) break;
        if (marker.ordered !== ordered) break;

        const itemLines = [marker.content];
        i++;
        while (i < lines.length) {
          const line = lines[i];
          if (/^\s*$/.test(line)) {
            if (i + 1 < lines.length) {
              const peekNext = lines[i + 1];
              const nextMarker = matchListMarker(peekNext);
              if (nextMarker && nextMarker.indent <= baseIndent) break;
              if (/^\s*$/.test(peekNext)) {
                i++;
                break;
              }
              itemLines.push('');
              i++;
              continue;
            }
            break;
          }
          const nextMarker = matchListMarker(line);
          if (nextMarker && nextMarker.indent <= baseIndent) break;
          const visual = line.replace(/\t/g, '    ');
          if (nextMarker && nextMarker.indent > baseIndent) {
            itemLines.push(visual.slice(marker.contentIndent) || line.trimStart());
            i++;
            continue;
          }
          if (visual.startsWith(' '.repeat(Math.max(1, marker.contentIndent)))) {
            itemLines.push(visual.slice(marker.contentIndent));
            i++;
            continue;
          }
          break;
        }
        let inner = parseBlocks(itemLines.join('\n'));
        const single = inner.match(/^<p>(.*)<\/p>$/s);
        if (single && !single[1].includes('<p>')) inner = single[1];
        const wrapped = marker.task
          ? `<li class="task-list-item"><input type="checkbox" disabled${marker.checked ? ' checked' : ''}> ${inner}</li>`
          : `<li>${inner}</li>`;
        items.push(wrapped);
      }

      const startAttr = ordered && start > 1 ? ` start="${start}"` : '';
      const cls = items.some((item) => item.includes('task-list-item')) ? ' class="task-list"' : '';
      parts.push(ordered ? `<ol${startAttr}${cls}>${items.join('')}</ol>` : `<ul${cls}>${items.join('')}</ul>`);
    }

    function takeTable() {
      const header = splitTableRow(lines[i]);
      const align = parseTableAlign(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && looksLikeTableRow(lines[i]) && !isTableSep(lines[i]) && !/^\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const th = header.map((cell, idx) => {
        const a = align[idx] ? ` style="text-align:${align[idx]}"` : '';
        return `<th${a}>${parseInline(cell)}</th>`;
      }).join('');
      const body = rows.map((row) => {
        const tds = header.map((_, idx) => {
          const a = align[idx] ? ` style="text-align:${align[idx]}"` : '';
          return `<td${a}>${parseInline(row[idx] || '')}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      parts.push(`<table><thead><tr>${th}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table>`);
    }

    function takeParagraph() {
      const para = [];
      while (i < lines.length) {
        const line = lines[i];
        if (/^\s*$/.test(line)) break;
        if (para.length && (/^ {0,3}=+\s*$/.test(line) || /^ {0,3}-+\s*$/.test(line))) break;
        if (para.length && isInterruptingBlock(line)) break;
        if (looksLikeTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
        const hard = / {2}$/.test(line) || /\\$/.test(line);
        para.push(hard ? line.replace(/\s+$/, /\\$/.test(line) ? '\\' : '  ') : line.trimEnd());
        i++;
      }
      if (i < lines.length && para.length === 1 && /^ {0,3}=+\s*$/.test(lines[i])) {
        i++;
        parts.push(`<h1>${parseInline(para[0].trim())}</h1>`);
        return;
      }
      if (i < lines.length && para.length === 1 && /^ {0,3}-+\s*$/.test(lines[i]) && !isHr(para[0])) {
        i++;
        parts.push(`<h2>${parseInline(para[0].trim())}</h2>`);
        return;
      }
      let joined = '';
      for (let p = 0; p < para.length; p++) {
        const line = para[p];
        const hard = / {2}$/.test(line) || /\\$/.test(line);
        const cleaned = line.replace(/ {2}$/, '').replace(/\\$/, '');
        joined += cleaned;
        if (p < para.length - 1) joined += hard ? '\n' : ' ';
      }
      parts.push(`<p>${parseInline(joined)}</p>`);
    }

    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }
      if (isFence(line)) {
        takeFence();
        continue;
      }
      if (isAtxHeading(line)) {
        takeHeading();
        continue;
      }
      if (/^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})\s*$/.test(line)) {
        parts.push('<hr>');
        i++;
        continue;
      }
      if (looksLikeTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        takeTable();
        continue;
      }
      if (isBlockquote(line)) {
        takeQuote();
        continue;
      }
      const list = matchListMarker(line);
      if (list && list.indent <= 3) {
        takeList();
        continue;
      }
      takeParagraph();
    }

    return parts.join('');
  }

  function renderMarkdown(src) {
    const html = parseBlocks(String(src ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    return html || '';
  }

  function formatMarkdown(src) {
    const text = String(src ?? '');
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out = [];
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        const ticks = fence[1];
        if (!inFence) {
          inFence = true;
          fenceChar = ticks[0];
          fenceLen = ticks.length;
          const info = (fence[2] || '').trim();
          out.push(ticks + (info ? ' ' + info.replace(/\s+/g, ' ') : ''));
          continue;
        }
        if (ticks[0] === fenceChar && ticks.length >= fenceLen && !(fence[2] || '').trim()) {
          inFence = false;
          out.push(ticks);
          continue;
        }
      }
      if (inFence) {
        out.push(line);
        continue;
      }

      const atx = line.match(/^ {0,3}(#{1,6})(\s+)(.*)$/);
      if (atx) {
        const content = atx[3].replace(/\s+#+\s*$/, '').replace(/\s+$/, '').trim();
        out.push(`${atx[1]}${content ? ' ' + content : ''}`);
        continue;
      }

      if (line.trim() !== '' && /\s+$/.test(line)) {
        const hardBreak = / {2,}$/.test(line);
        line = line.replace(/\s+$/, hardBreak ? '  ' : '');
      }

      const list = line.match(/^(\s*(?:[-*+]|\d+[.)]))\s+(.*)$/);
      if (list) {
        out.push(`${list[1]} ${list[2].replace(/\s+$/, '')}`);
        continue;
      }

      out.push(line);
    }

    const collapsed = [];
    let blanks = 0;
    for (const line of out) {
      if (line.trim() === '') {
        blanks += 1;
        if (blanks <= 2) collapsed.push('');
      } else {
        blanks = 0;
        collapsed.push(line);
      }
    }
    while (collapsed.length && collapsed[collapsed.length - 1] === '') collapsed.pop();
    collapsed.push('');
    return collapsed.join(newline);
  }

  const detection = {
    keywords: ['```', '](http', '](https', '- [ ]', '- [x]', '* [ ]', '* [x]', '](mailto:'],
    patterns: [
      /^ {0,3}```[a-zA-Z0-9_-]*\s*$/m,
      /\[[^\]]+\]\([^)\s]+\)/,
      /^ {0,3}>\s+\S/m,
      /^\s*[-*+]\s+\[[ xX]\]\s+\S/m,
      /^ {0,3}\|?.+\|.+\|\s*$/m,
      /^ {0,3}(?:\*|-|_){3,}\s*$/m
    ]
  };

  const preview = {
    editor: null,
    mode: 'split',
    debounce: null,
    observer: null,

    attach(editor) {
      this.editor = editor;
      this.mode = this.readStoredMode();
      const btn = document.getElementById('markdown-preview-btn');
      if (btn) {
        btn.addEventListener('click', () => this.cycleMode());
      }
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
        const stored = localStorage.getItem(STORAGE_KEY);
        if (PREVIEW_MODES.includes(stored)) return stored;
      } catch {}
      return 'split';
    },

    storeMode() {
      try { localStorage.setItem(STORAGE_KEY, this.mode); } catch {}
    },

    isMarkdown() {
      return this.editor?.getModel?.()?.getLanguageId?.() === 'markdown';
    },

    cycleMode() {
      if (!this.isMarkdown()) return;
      const idx = PREVIEW_MODES.indexOf(this.mode);
      this.mode = PREVIEW_MODES[(idx + 1) % PREVIEW_MODES.length];
      this.storeMode();
      this.applyMode();
      this.render();
    },

    syncLanguage() {
      if (this.isMarkdown()) {
        if (!PREVIEW_MODES.includes(this.mode)) this.mode = 'split';
        this.applyMode();
        this.render();
      } else {
        this.applyMode(true);
      }
    },

    applyMode(forceOff) {
      const workspace = document.getElementById('workspace');
      const pane = document.getElementById('markdown-preview-pane');
      const btn = document.getElementById('markdown-preview-btn');
      const markdown = this.isMarkdown() && !forceOff;
      const mode = markdown ? this.mode : 'off';

      if (workspace) {
        workspace.classList.toggle('split-markdown', mode === 'split');
        workspace.classList.toggle('preview-only', mode === 'preview');
        workspace.classList.toggle('editor-only', mode === 'off' || !markdown);
      }
      if (pane) pane.hidden = !markdown || mode === 'off';
      if (btn) {
        btn.hidden = !markdown;
        btn.setAttribute('aria-pressed', markdown && mode !== 'off' ? 'true' : 'false');
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
      if (!this.isMarkdown() || this.mode === 'off') return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.render(), 120);
    },

    setTheme(theme) {
      const pane = document.getElementById('markdown-preview-pane');
      if (pane) pane.setAttribute('data-theme', theme || 'vs-dark');
      this.render();
    },

    render() {
      const body = document.getElementById('markdown-preview-body');
      if (!body || !this.editor) return;
      if (!this.isMarkdown() || this.mode === 'off') return;
      const source = this.editor.getValue();
      const scroll = body.scrollTop;
      if (!source.trim()) {
        body.innerHTML = '<p class="markdown-preview-empty">Nothing to preview</p>';
      } else {
        body.innerHTML = renderMarkdown(source);
      }
      body.scrollTop = scroll;
    }
  };

  function registerWithMonaco(monaco) {
    monaco.languages.registerDocumentFormattingEditProvider('markdown', {
      provideDocumentFormattingEdits(model) {
        const text = model.getValue();
        const formatted = formatMarkdown(text);
        if (formatted === text) return [];
        return [{ range: model.getFullModelRange(), text: formatted }];
      }
    });
  }

  const api = {
    render: renderMarkdown,
    format: formatMarkdown,
    parseInline,
    isSafeUrl,
    detection,
    preview,
    registerWithMonaco
  };

  root.MarkdownSupport = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

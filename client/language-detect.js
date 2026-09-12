/**
 * Language detection for the editor's closed set of languages.
 *
 * Generic auto-detectors were evaluated and not used as the primary engine:
 * - highlight.js highlightAuto() is a highlighter relevance score. It mislabels
 *   common samples (markdown fences as Ruby, short Python as CSS).
 * - guesslang / @vscode/vscode-languagedetection is stronger on large source
 *   files but ships ~1MB of TensorFlow weights, is awkward without a bundler,
 *   and is weak on short pastes (the usual editor path).
 *
 * This module uses exclusive high-confidence checks first, then linguist-style
 * structure scoring, with explicit markdown vs YAML disambiguation. File
 * extensions still win when a known extension is present.
 */
(function (root) {
  const SUPPORTED = {
    plaintext: true,
    cpp: true,
    csharp: true,
    css: true,
    go: true,
    html: true,
    java: true,
    javascript: true,
    json: true,
    markdown: true,
    php: true,
    powershell: true,
    python: true,
    ruby: true,
    sql: true,
    typescript: true,
    xml: true,
    yaml: true
  };

  const EXTENSION_MAP = {
    js: 'javascript',
    ts: 'typescript',
    html: 'html',
    htm: 'html',
    xhtml: 'html',
    xml: 'xml',
    svg: 'xml',
    css: 'css',
    py: 'python',
    java: 'java',
    cs: 'csharp',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'cpp',
    hpp: 'cpp',
    rb: 'ruby',
    go: 'go',
    php: 'php',
    sql: 'sql',
    md: 'markdown',
    markdown: 'markdown',
    mdown: 'markdown',
    mkd: 'markdown',
    mdtxt: 'markdown',
    mdtext: 'markdown',
    json: 'json',
    ps1: 'powershell',
    psm1: 'powershell',
    psd1: 'powershell',
    txt: 'plaintext',
    yaml: 'yaml',
    yml: 'yaml'
  };

  const MIN_SCORE = 8;
  const MIN_MARGIN = 2;

  function supported(lang) {
    return SUPPORTED[lang] ? lang : 'plaintext';
  }

  function isSvg(text) {
    if (root.PreviewSupport && typeof root.PreviewSupport.isSvg === 'function') {
      return root.PreviewSupport.isSvg(text);
    }
    let stripped = String(text || '').replace(/^\uFEFF/, '').trim();
    stripped = stripped.replace(/^<\?xml[\s\S]*?\?>\s*/i, '');
    while (/^<!--/.test(stripped)) {
      const end = stripped.indexOf('-->');
      if (end === -1) break;
      stripped = stripped.slice(end + 3).trim();
    }
    return /^<svg(\s|>|\/|$)/i.test(stripped);
  }

  function countMatches(text, pattern) {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    const matches = String(text).match(new RegExp(pattern.source, flags));
    return matches ? matches.length : 0;
  }

  function hasProseParagraph(content) {
    return String(content).split(/\r?\n/).some((line) => {
      const t = line.trim();
      if (t.length < 25) return false;
      if (/^(#{1,6}\s|[-*+]\s|>\s|```|~~~)/.test(t)) return false;
      if (/^\w[\w.-]*:\s/.test(t)) return false;
      const codey = (t.match(/[{}();=<>]/g) || []).length;
      if (codey >= 3) return false;
      return /^[A-Za-z]/.test(t);
    });
  }

  function countSetextHeadings(content) {
    const re = /^(.+)\n {0,3}(?:=+|-+)[ \t]*$/gm;
    let count = 0;
    let match;
    while ((match = re.exec(content))) {
      const title = match[1].trim();
      if (!title || /^---$/.test(title)) continue;
      if (/^[\w./-]+:\s+\S/.test(title)) continue;
      if (/^[-*+]\s+/.test(title)) continue;
      count += 1;
    }
    return count;
  }

  function markdownSignals(content) {
    const exclusive =
      countMatches(content, /^ {0,3}```[^\n`]*$/m) +
      countMatches(content, /^ {0,3}~~~[^\n~]*$/m) +
      countMatches(content, /\[[^\]]+\]\([^)\s]+\)/) +
      countMatches(content, /!\[[^\]]*\]\([^)\s]+\)/) +
      countMatches(content, /^ {0,3}[-*+]\s+\[[ xX]\]/m) +
      countMatches(content, /^ {0,3}\|?.+\|.+\|[ \t]*$/m) +
      countMatches(content, /^ {0,3}>\s+\S/m) +
      countSetextHeadings(content) +
      countMatches(content, /^ {0,3}#{2,6}[ \t]+\S/m);

    const heading = /^ {0,3}#{1,6}[ \t]+\S/m.test(content);
    const list = /^ {0,3}[-*+][ \t]+\S/m.test(content);
    const prose = hasProseParagraph(content);
    const emphasis = /(?:\*\*|__).+\S(?:\*\*|__)/.test(content);
    const hr = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/m.test(content);

    let score = exclusive * 8;
    if (heading) score += 6;
    if (list && heading) score += 6;
    if (prose && (heading || list)) score += 5;
    if (emphasis) score += 3;
    if (hr && heading) score += 3;
    return { exclusive, heading, list, prose, emphasis, score };
  }

  function yamlSignals(content) {
    const lines = String(content).split(/\r?\n/);
    let strong = 0;
    let weakList = 0;
    let other = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^#{1,6}[ \t]+\S/.test(line) && !/^#[ \t]*[a-z0-9]/.test(line)) continue;
      if (/^#/.test(line)) continue;
      if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
        strong += 1;
        continue;
      }
      if (/^(?:-\s+)?[\w./-]+(?:\s+[\w./-]+)*:\s+[|>]/.test(line)) {
        strong += 1;
        continue;
      }
      if (/^-\s+[\w./-]+:\s+\S/.test(line)) {
        strong += 1;
        continue;
      }
      if (/^[\w./-]+:\s+\S/.test(line)) {
        strong += 1;
        continue;
      }
      if (/^[\w./-]+:[ \t]*$/.test(line)) {
        strong += 1;
        continue;
      }
      if (/^-\s+\S/.test(line) && !/:\s/.test(line)) {
        weakList += 1;
        continue;
      }
      other += 1;
    }

    const considered = strong + weakList + other;
    const ratio = considered ? strong / considered : 0;
    const score = strong * 4 - weakList - other * 2;
    return { strong, weakList, other, ratio, score };
  }

  function detectMarkup(content) {
    const md = markdownSignals(content);
    const yaml = yamlSignals(content);

    if (md.exclusive > 0 && md.exclusive >= yaml.strong) {
      return { language: 'markdown', score: 24 + md.exclusive };
    }
    if (md.heading && (md.prose || md.list) && yaml.strong === 0) {
      return { language: 'markdown', score: 22 };
    }
    if (md.heading && md.list && yaml.strong < 2) {
      return { language: 'markdown', score: 20 };
    }
    if (yaml.strong >= 2 && md.exclusive === 0 && !md.prose && !md.heading) {
      return { language: 'yaml', score: 18 + yaml.strong };
    }
    if (yaml.ratio >= 0.55 && yaml.strong >= 1 && md.exclusive === 0 && !md.heading && !md.prose) {
      return { language: 'yaml', score: 16 + yaml.strong };
    }
    if (md.score >= MIN_SCORE && md.score >= yaml.score + MIN_MARGIN) {
      return { language: 'markdown', score: md.score };
    }
    if (yaml.score >= MIN_SCORE && md.exclusive === 0 && yaml.score >= md.score + MIN_MARGIN) {
      return { language: 'yaml', score: yaml.score };
    }
    return null;
  }

  function looksLikeHtml(content) {
    if (/<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content)) return true;
    const tags = countMatches(
      content,
      /<\/?(?:div|span|p|a|img|script|link|meta|body|head|section|article|nav|header|footer|button|input|form|table|thead|tbody|tr|td|ul|ol|li|h[1-6]|br|hr|main|aside|figure|label|textarea|select|option)\b/i
    );
    return tags >= 2;
  }

  function looksLikeXml(content) {
    if (/<\?xml\b/i.test(content)) return true;
    if (isSvg(content)) return true;
    return /<\/?[A-Za-z][\w:-]*(\s[^>]*)?>/.test(content) && /<\/[A-Za-z][\w:-]*>/.test(content);
  }

  function looksLikeCss(content) {
    const blocks = countMatches(content, /(?:^|[,}\s])(?:[.#]?[\w-]+(?:[.#:][\w-]+)*)\s*\{[^}]*[a-z-]+\s*:[^}]+\}/);
    const atRules = countMatches(content, /@(?:media|import|keyframes|font-face|charset)\b/i);
    const props = countMatches(
      content,
      /\b(?:margin|padding|border|color|display|position|font-size|background(?:-color)?|flex|grid|width|height|z-index)\s*:/
    );
    if (/\b(?:function|const|let|var|class|def|package|import)\b/.test(content) && blocks === 0) return 0;
    return blocks * 8 + atRules * 6 + Math.min(props, 6) * 2;
  }

  function parseJson(content) {
    const t = String(content).trim();
    if (!t) return false;
    if (!(t.startsWith('{') || t.startsWith('['))) return false;
    try {
      const parsed = JSON.parse(t);
      return parsed !== null && typeof parsed === 'object';
    } catch {
      return false;
    }
  }

  function shebangLanguage(content) {
    const first = String(content).split(/\r?\n/, 1)[0];
    if (!first.startsWith('#!')) return '';
    if (/\bpython(?:\d+(?:\.\d+)?)?\b/.test(first)) return 'python';
    if (/\b(?:node|nodejs)\b/.test(first)) return 'javascript';
    if (/\bruby\b/.test(first)) return 'ruby';
    if (/\bphp\b/.test(first)) return 'php';
    if (/\bpwsh\b|\bpowershell\b/.test(first)) return 'powershell';
    return '';
  }

  const CODE_RULES = {
    typescript: {
      strong: [
        /\binterface\s+[A-Za-z_]\w*\s*[{<]/,
        /\btype\s+[A-Za-z_]\w*\s*=/,
        /:\s*(?:string|number|boolean|void|any|unknown|never|undefined|null)\b/,
        /\bas\s+const\b/,
        /\benum\s+[A-Za-z_]\w*\s*\{/,
        /\bimplements\s+[A-Za-z_]/,
        /\breadonly\s+[A-Za-z_]/,
        /\bnamespace\s+[A-Za-z_]/
      ],
      weak: [/\b(?:export|import)\s+/, /\basync\s+function\b/, /=>/]
    },
    javascript: {
      strong: [
        /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
        /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/,
        /\b(?:module\.exports|require\s*\()/,
        /\bexport\s+(?:default|const|function|class|async)\b/,
        /\bimport\s+(?:[\w*{]|['"])/
      ],
      weak: [/=>/, /\bconsole\.log\s*\(/, /\basync\s+function\b/, /\bawait\s+/]
    },
    python: {
      strong: [
        /^(?:async\s+)?def\s+\w+\s*\(.*\)\s*:/m,
        /^class\s+\w+\s*(?:\([^)]*\))?\s*:/m,
        /if\s+__name__\s*==\s*['"]__main__['"]/,
        /^(?:from\s+[\w.]+\s+import|import\s+[\w.]+)/m
      ],
      weak: [/\belif\s+/, /\bexcept\s+/, /\bprint\s*\(/, /\byield\s+/, /\bself\./, /:\s*(?:#.*)?$/m]
    },
    csharp: {
      strong: [
        /\busing\s+[\w.]+;/,
        /\bnamespace\s+[\w.]+/,
        /\bpublic\s+static\s+void\s+Main\s*\(/,
        /\b(?:get|set);/,
        /\b(?:class|record|struct)\s+\w+\s*[:{]/
      ],
      weak: [/\b(?:public|private|protected|internal)\s+/, /\bConsole\.Write/, /\bstring\s+\w+\s*=/]
    },
    java: {
      strong: [
        /\bpublic\s+class\s+\w+/,
        /\bpublic\s+static\s+void\s+main\s*\(\s*String\s*\[\]/,
        /\bimport\s+java[\w.]*;/,
        /\bpackage\s+[\w.]+;/
      ],
      weak: [/\bSystem\.out\.println\s*\(/, /\b@Override\b/, /\bimplements\s+\w+/, /\bnew\s+\w+\s*\(/]
    },
    go: {
      strong: [
        /^package\s+\w+/m,
        /\bfunc\s+(?:\([^)]+\)\s*)?\w+\s*\(/,
        /\w+\s+:=\s+/,
        /\btype\s+\w+\s+struct\s*\{/
      ],
      weak: [/\bfmt\./, /\bdefer\s+/, /\bchan\s+/, /\bgo\s+\w+/]
    },
    ruby: {
      strong: [
        /^class\s+\w+(?:\s*<\s*\w+)?\s*$/m,
        /^def\s+\w+[?!]?(?:\s|\()/m,
        /\brequire(?:_relative)?\s+['"]/
      ],
      weak: [/\bdo\s+\|/, /^\s*end\s*$/m, /\bputs\s+/, /@\w+/, /\bunless\b/]
    },
    php: {
      strong: [/<\?(?:php|=)\b/i, /\bnamespace\s+[\w\\]+;/, /\bfunction\s+\w+\s*\(.*\$/],
      weak: [/\$this->/, /\$_(?:GET|POST|SERVER|SESSION)\b/, /\becho\s+/]
    },
    powershell: {
      strong: [
        /\b(?:Write|Get|Set|New|Remove|Import|Export|Select|Where|ForEach)-(?:[A-Z][A-Za-z]+)/,
        /\[CmdletBinding\s*\(/,
        /\$PSScriptRoot\b/,
        /\bparam\s*\(/
      ],
      weak: [/\$\w+/, /\$_\b/, /\b-eq\b/, /\b-ne\b/, /\bforeach\s*\(/i]
    },
    sql: {
      strong: [
        /\bSELECT\b[\s\S]+\bFROM\b/i,
        /\bINSERT\s+INTO\b/i,
        /\bUPDATE\s+\w+\s+SET\b/i,
        /\bCREATE\s+TABLE\b/i,
        /\bALTER\s+TABLE\b/i
      ],
      weak: [/\bWHERE\b/i, /\bJOIN\b/i, /\bGROUP\s+BY\b/i, /\bORDER\s+BY\b/i]
    },
    cpp: {
      strong: [
        /^\s*#include\s*[<"]/m,
        /\bstd::\w+/,
        /\bint\s+main\s*\(/,
        /\b(?:cout|cin|endl)\b/
      ],
      weak: [/\bnullptr\b/, /\btemplate\s*</, /\bnamespace\s+\w+/, /::/]
    }
  };

  function scoreCode(content) {
    const scores = {};
    for (const [lang, rules] of Object.entries(CODE_RULES)) {
      let score = 0;
      for (const pattern of rules.strong) {
        if (pattern.test(content)) score += 8;
      }
      for (const pattern of rules.weak) {
        if (pattern.test(content)) score += 2;
      }
      if (score) scores[lang] = score;
    }

    if (scores.typescript && scores.javascript) {
      const tsOnly = CODE_RULES.typescript.strong.some((pattern) => pattern.test(content));
      if (tsOnly) scores.javascript -= 10;
      else scores.typescript -= 10;
    }
    if (scores.csharp && scores.java) {
      if (/\busing\s+[\w.]+;/.test(content) || /\bnamespace\s+[\w.]+/.test(content)) scores.java -= 8;
      if (/\bpackage\s+[\w.]+;/.test(content) || /\bimport\s+java/.test(content)) scores.csharp -= 8;
    }
    return scores;
  }

  function pickWinner(scores) {
    const ranked = Object.entries(scores)
      .filter(([, score]) => score >= MIN_SCORE)
      .sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return '';
    if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < MIN_MARGIN) return '';
    return ranked[0][0];
  }

  function exclusiveDetect(content) {
    if (/<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content)) return 'html';
    if (isSvg(content)) return 'xml';
    if (parseJson(content)) return 'json';
    if (/<\?(?:php|=)\b/i.test(content)) return 'php';
    return shebangLanguage(content);
  }

  function fromContent(content) {
    const text = String(content || '');
    if (text.trim().length < 8) return 'plaintext';

    const exclusive = exclusiveDetect(text);
    if (exclusive) return supported(exclusive);

    const markup = detectMarkup(text);
    const cssScore = looksLikeCss(text);
    const htmlish = looksLikeHtml(text);
    const scores = scoreCode(text);

    if (markup) scores[markup.language] = Math.max(scores[markup.language] || 0, markup.score);
    if (cssScore) scores.css = Math.max(scores.css || 0, cssScore);
    if (htmlish) scores.html = Math.max(scores.html || 0, 20);

    const winner = pickWinner(scores);
    if (winner) return supported(winner);

    if (htmlish) return 'html';
    if (looksLikeXml(text) && !markup) return 'xml';
    return 'plaintext';
  }

  function extensionOf(filename) {
    const name = String(filename || '');
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return '';
    return name.slice(dot + 1).toLowerCase();
  }

  function fromFile(file, content) {
    const name = typeof file === 'string' ? file : file && file.name;
    const ext = extensionOf(name);
    const fromExt = ext && EXTENSION_MAP[ext];
    if (fromExt && fromExt !== 'plaintext') return supported(fromExt);
    return fromContent(content);
  }

  const api = {
    fromContent,
    fromFile,
    extensionMap: EXTENSION_MAP,
    markdownSignals,
    yamlSignals
  };

  root.LanguageDetect = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

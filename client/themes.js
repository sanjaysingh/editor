/**
 * Extra Monaco color themes (GitHub, Dracula, One Dark).
 * Palettes follow the well-known editor themes; rules use Monaco token names.
 */
(function (root) {
  const LIGHT_THEMES = ['vs', 'hc-light', 'github-light'];

  function hex(value) {
    return String(value || '').replace(/^#/, '');
  }

  function rules(tokens) {
    return Object.entries(tokens).map(([token, spec]) => {
      if (typeof spec === 'string') return { token, foreground: hex(spec) };
      const rule = { token };
      if (spec.fg) rule.foreground = hex(spec.fg);
      if (spec.fontStyle) rule.fontStyle = spec.fontStyle;
      return rule;
    });
  }

  function theme(base, chrome, tokens) {
    return {
      base,
      inherit: true,
      colors: {
        'editor.background': chrome.bg,
        'editor.foreground': chrome.fg,
        'editor.selectionBackground': chrome.selection,
        'editor.inactiveSelectionBackground': chrome.inactiveSelection || chrome.selection,
        'editor.lineHighlightBackground': chrome.line,
        'editorCursor.foreground': chrome.cursor || chrome.fg,
        'editorWhitespace.foreground': chrome.whitespace,
        'editorIndentGuide.background': chrome.whitespace,
        'editorLineNumber.foreground': chrome.lineNumber || chrome.comment
      },
      rules: rules(tokens)
    };
  }

  const monacoTokens = (palette) => ({
    comment: { fg: palette.comment, fontStyle: 'italic' },
    'comment.doc': { fg: palette.comment, fontStyle: 'italic' },
    string: palette.string,
    'string.escape': palette.number,
    keyword: palette.keyword,
    'keyword.flow': palette.keyword,
    number: palette.number,
    regexp: palette.regexp || palette.string,
    type: palette.type,
    'type.identifier': palette.type,
    class: palette.type,
    interface: palette.type,
    function: palette.func,
    'function.declaration': palette.func,
    variable: palette.variable || palette.fg,
    'variable.predefined': palette.constant || palette.number,
    constant: palette.constant || palette.number,
    identifier: palette.variable || palette.fg,
    tag: palette.tag,
    'tag.id': palette.attribute || palette.number,
    'tag.class': palette.attribute || palette.number,
    'attribute.name': palette.attribute || palette.number,
    'attribute.value': palette.string,
    key: palette.keyword,
    'string.key': palette.keyword,
    delimiter: palette.fg,
    'delimiter.bracket': palette.fg,
    operator: palette.operator || palette.keyword,
    annotation: palette.type,
    invalid: palette.invalid || palette.keyword
  });

  const githubDark = theme(
    'vs-dark',
    {
      bg: '#24292e',
      fg: '#e1e4e8',
      selection: '#3392FF44',
      line: '#2b3036',
      whitespace: '#6a737d',
      comment: '#959da5',
      cursor: '#c8e1ff'
    },
    monacoTokens({
      fg: '#e1e4e8',
      comment: '#959da5',
      keyword: '#f97583',
      string: '#9ecbff',
      number: '#79b8ff',
      type: '#79b8ff',
      func: '#b392f0',
      tag: '#85e89d',
      attribute: '#ffab70',
      constant: '#79b8ff',
      operator: '#f97583'
    })
  );

  const githubLight = theme(
    'vs',
    {
      bg: '#ffffff',
      fg: '#24292e',
      selection: '#c8c8fa',
      line: '#f6f8fa',
      whitespace: '#d1d5da',
      comment: '#6a737d',
      cursor: '#24292e'
    },
    monacoTokens({
      fg: '#24292e',
      comment: '#6a737d',
      keyword: '#d73a49',
      string: '#032f62',
      number: '#005cc5',
      type: '#005cc5',
      func: '#6f42c1',
      tag: '#22863a',
      attribute: '#e36209',
      constant: '#005cc5',
      operator: '#d73a49'
    })
  );

  const dracula = theme(
    'vs-dark',
    {
      bg: '#282a36',
      fg: '#f8f8f2',
      selection: '#44475a',
      line: '#44475a',
      whitespace: '#6272a4',
      comment: '#6272a4',
      cursor: '#f8f8f0'
    },
    monacoTokens({
      fg: '#f8f8f2',
      comment: '#6272a4',
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      type: '#8be9fd',
      func: '#50fa7b',
      tag: '#ff79c6',
      attribute: '#50fa7b',
      constant: '#bd93f9',
      operator: '#ff79c6',
      regexp: '#f1fa8c'
    })
  );

  const oneDark = theme(
    'vs-dark',
    {
      bg: '#282c34',
      fg: '#abb2bf',
      selection: '#3e4451',
      line: '#2c313c',
      whitespace: '#4b5263',
      comment: '#5c6370',
      cursor: '#528bff'
    },
    monacoTokens({
      fg: '#abb2bf',
      comment: '#5c6370',
      keyword: '#c678dd',
      string: '#98c379',
      number: '#d19a66',
      type: '#e5c07b',
      func: '#61afef',
      tag: '#e06c75',
      attribute: '#d19a66',
      constant: '#d19a66',
      operator: '#56b6c2',
      regexp: '#56b6c2'
    })
  );

  const customThemes = {
    'github-dark': githubDark,
    'github-light': githubLight,
    dracula,
    'one-dark': oneDark
  };

  const previewColors = {
    'vs-dark': { bg: '#1e1e1e', text: '#d4d4d4' },
    vs: { bg: '#f6f8fa', text: '#1f2328' },
    'hc-black': { bg: '#000000', text: '#ffffff' },
    'hc-light': { bg: '#ffffff', text: '#1f2328' },
    'github-dark': { bg: '#24292e', text: '#e1e4e8' },
    'github-light': { bg: '#ffffff', text: '#24292e' },
    dracula: { bg: '#282a36', text: '#f8f8f2' },
    'one-dark': { bg: '#282c34', text: '#abb2bf' }
  };

  function isLightTheme(theme) {
    return LIGHT_THEMES.includes(theme);
  }

  function themeColors(theme) {
    return previewColors[theme] || previewColors['vs-dark'];
  }

  function register(monacoApi) {
    if (!monacoApi?.editor?.defineTheme) return;
    Object.entries(customThemes).forEach(([id, data]) => {
      monacoApi.editor.defineTheme(id, data);
    });
  }

  const api = {
    LIGHT_THEMES,
    customThemes,
    isLightTheme,
    themeColors,
    register
  };

  root.ThemesSupport = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

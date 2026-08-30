/**
 * Testable Live Share helpers: share URLs and applying remote editor state.
 */
(function (root) {
  function buildShareLink(href, key) {
    const currentUrl = new URL(href);
    const basePath = currentUrl.pathname.replace(/\/[^\/]*$/, '/');
    return `${currentUrl.origin}${basePath}?share=${encodeURIComponent(key)}`;
  }

  function stripLegacyShareQuery(href) {
    const url = new URL(href);
    if (!url.searchParams.has('e')) return null;
    url.searchParams.delete('e');
    const search = url.searchParams.toString();
    return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  }

  function applySharedEditorState(ed, content, language, hooks) {
    if (!ed) return false;
    const { setLanguage, refreshPreview } = hooks || {};
    if (typeof content === 'string' && ed.getValue() !== content) {
      const pos = typeof ed.getScrollTop === 'function' ? ed.getScrollTop() : 0;
      ed.setValue(content);
      if (typeof ed.setScrollTop === 'function') ed.setScrollTop(pos);
    }
    if (language) {
      const currentLang = ed.getModel?.()?.getLanguageId?.();
      if (currentLang !== language && typeof setLanguage === 'function') {
        setLanguage(language);
      }
    }
    if (typeof refreshPreview === 'function') refreshPreview();
    return true;
  }

  const api = { buildShareLink, stripLegacyShareQuery, applySharedEditorState };
  root.LiveShareUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);

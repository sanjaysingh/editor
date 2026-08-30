import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  buildShareLink,
  stripLegacyShareQuery,
  applySharedEditorState
} from './load-live-share-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const liveShareSrc = readFileSync(join(__dirname, '../client/live-share.js'), 'utf-8');

function mockEditor({ value = '', language = 'plaintext' } = {}) {
  let current = value;
  let lang = language;
  let scroll = 0;
  return {
    getValue: () => current,
    setValue: (next) => { current = next; },
    getScrollTop: () => scroll,
    setScrollTop: (pos) => { scroll = pos; },
    getModel: () => ({ getLanguageId: () => lang }),
    _setLanguage(next) { lang = next; }
  };
}

describe('buildShareLink', () => {
  it('builds a share URL without the legacy e=1 flag', () => {
    expect(buildShareLink('https://editor.sanjaysingh.net/', 'ABC-234'))
      .toBe('https://editor.sanjaysingh.net/?share=ABC-234');
    expect(buildShareLink('https://example.test/app/index.html', 'XYZ-789'))
      .toBe('https://example.test/app/?share=XYZ-789');
    expect(buildShareLink('http://localhost:8080/index.html?foo=1', 'ABC-234'))
      .toBe('http://localhost:8080/?share=ABC-234');
  });

  it('does not append e=1 for any share link', () => {
    const link = buildShareLink('https://editor.sanjaysingh.net/', 'ABC-234');
    expect(link).not.toContain('e=1');
    expect(link).not.toMatch(/[?&]e=/);
  });
});

describe('stripLegacyShareQuery', () => {
  it('removes e=1 and leaves the share key', () => {
    expect(stripLegacyShareQuery('https://editor.sanjaysingh.net/?share=ABC-234&e=1'))
      .toBe('/?share=ABC-234');
  });

  it('returns null when there is no legacy e param', () => {
    expect(stripLegacyShareQuery('https://editor.sanjaysingh.net/?share=ABC-234')).toBeNull();
  });
});

describe('applySharedEditorState', () => {
  it('applies content, language, and refreshes preview', () => {
    const ed = mockEditor();
    const setLanguage = vi.fn((language) => ed._setLanguage(language));
    const refreshPreview = vi.fn();

    const ok = applySharedEditorState(ed, '# Hello', 'markdown', { setLanguage, refreshPreview });

    expect(ok).toBe(true);
    expect(ed.getValue()).toBe('# Hello');
    expect(ed.getModel().getLanguageId()).toBe('markdown');
    expect(setLanguage).toHaveBeenCalledWith('markdown');
    expect(refreshPreview).toHaveBeenCalledTimes(1);
  });

  it('refreshes preview even when only language changes', () => {
    const ed = mockEditor({ value: '<h1>Hi</h1>', language: 'plaintext' });
    const setLanguage = vi.fn((language) => ed._setLanguage(language));
    const refreshPreview = vi.fn();

    applySharedEditorState(ed, '<h1>Hi</h1>', 'html', { setLanguage, refreshPreview });

    expect(ed.getValue()).toBe('<h1>Hi</h1>');
    expect(setLanguage).toHaveBeenCalledWith('html');
    expect(refreshPreview).toHaveBeenCalledTimes(1);
  });

  it('skips language hook when already matching but still refreshes preview', () => {
    const ed = mockEditor({ value: '# Hi', language: 'markdown' });
    const setLanguage = vi.fn();
    const refreshPreview = vi.fn();

    applySharedEditorState(ed, '# Hello', 'markdown', { setLanguage, refreshPreview });

    expect(ed.getValue()).toBe('# Hello');
    expect(setLanguage).not.toHaveBeenCalled();
    expect(refreshPreview).toHaveBeenCalledTimes(1);
  });

  it('returns false when the editor is missing', () => {
    const refreshPreview = vi.fn();
    expect(applySharedEditorState(null, '# Hi', 'markdown', { refreshPreview })).toBe(false);
    expect(refreshPreview).not.toHaveBeenCalled();
  });
});

describe('live-share.js integration', () => {
  it('uses LiveShareUtils for share links and no longer hardcodes e=1', () => {
    expect(liveShareSrc).toContain('typeof LiveShareUtils');
    expect(liveShareSrc).toContain('buildShareLink');
    expect(liveShareSrc).not.toMatch(/&e=1/);
  });

  it('applies shared state through LiveShareUtils and refreshes preview', () => {
    expect(liveShareSrc).toContain('applySharedEditorState');
    expect(liveShareSrc).toContain('PreviewSupport.preview');
    expect(liveShareSrc).toContain('refreshPreview');
  });
});

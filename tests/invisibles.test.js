import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  invisibles,
  eolLabel,
  eolMarkerLines,
  buildEolDecorations
} from './load-invisibles.mjs';

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '../client');
const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf-8');
const appSrc = readFileSync(join(clientDir, 'app.js'), 'utf-8');

describe('eolLabel', () => {
  it('maps common EOLs to Notepad++-style labels', () => {
    expect(eolLabel('\n')).toBe('LF');
    expect(eolLabel('\r\n')).toBe('CRLF');
    expect(eolLabel('\r')).toBe('CR');
  });

  it('falls back to LF for unknown values', () => {
    expect(eolLabel('')).toBe('LF');
    expect(eolLabel(undefined)).toBe('LF');
  });
});

describe('eolMarkerLines', () => {
  it('marks every line except the last', () => {
    expect(eolMarkerLines(0)).toEqual([]);
    expect(eolMarkerLines(1)).toEqual([]);
    expect(eolMarkerLines(2)).toEqual([1]);
    expect(eolMarkerLines(4)).toEqual([1, 2, 3]);
  });
});

describe('buildEolDecorations', () => {
  it('places an after-content marker at the end of each EOL line', () => {
    const editor = {
      getModel() {
        return {
          getEOL: () => '\r\n',
          getLineCount: () => 3,
          getLineMaxColumn: (line) => (line === 1 ? 6 : 4)
        };
      }
    };

    const decorations = buildEolDecorations(editor);
    expect(decorations).toHaveLength(2);
    expect(decorations[0].range).toEqual({
      startLineNumber: 1,
      startColumn: 6,
      endLineNumber: 1,
      endColumn: 6
    });
    expect(decorations[0].options.after.content).toBe('CRLF');
    expect(decorations[0].options.after.inlineClassName).toBe('eol-marker');
    expect(decorations[1].range.startLineNumber).toBe(2);
    expect(decorations[1].options.after.content).toBe('CRLF');
  });

  it('returns no decorations without a model', () => {
    expect(buildEolDecorations({ getModel: () => null })).toEqual([]);
    expect(buildEolDecorations({ getModel: () => ({}) })).toEqual([]);
  });
});

describe('invisibles toggle', () => {
  beforeEach(() => {
    invisibles.editor = null;
    invisibles.enabled = false;
    invisibles.decorations = null;
    invisibles.decorationIds = null;
  });

  it('starts disabled and does not persist', () => {
    expect(invisibles.enabled).toBe(false);
    expect(indexHtml).not.toMatch(/localStorage/);
    expect(readFileSync(join(clientDir, 'invisibles.js'), 'utf-8')).not.toMatch(/localStorage/);
  });

  it('toggles Monaco whitespace rendering and decorations', () => {
    const options = [];
    const collection = { last: null, set(next) { this.last = next; } };
    const editor = {
      updateOptions(opts) { options.push(opts); },
      createDecorationsCollection() { return collection; },
      onDidChangeModelContent() {},
      onDidChangeModel() {},
      getModel() {
        return {
          getEOL: () => '\n',
          getLineCount: () => 2,
          getLineMaxColumn: () => 3
        };
      }
    };

    invisibles.attach(editor);
    expect(invisibles.enabled).toBe(false);
    expect(options.at(-1)).toEqual({ renderWhitespace: 'selection' });
    expect(collection.last).toEqual([]);

    invisibles.setEnabled(true);
    expect(invisibles.enabled).toBe(true);
    expect(options.at(-1)).toEqual({ renderWhitespace: 'all' });
    expect(collection.last).toHaveLength(1);
    expect(collection.last[0].options.after.content).toBe('LF');
  });

  it('reapplies whitespace and decorations after a theme change', () => {
    const options = [];
    const collection = {
      last: null,
      set(next) { this.last = next; },
      clear() { this.last = []; }
    };
    let created = 0;
    const editor = {
      updateOptions(opts) { options.push(opts); },
      createDecorationsCollection() {
        created += 1;
        return collection;
      },
      onDidChangeModelContent() {},
      onDidChangeModel() {},
      getModel() {
        return {
          getEOL: () => '\n',
          getLineCount: () => 2,
          getLineMaxColumn: () => 3
        };
      }
    };

    invisibles.attach(editor);
    invisibles.setEnabled(true);
    options.length = 0;
    invisibles.onThemeChanged();
    expect(options).toEqual([
      { renderWhitespace: 'none' },
      { renderWhitespace: 'all' }
    ]);
    expect(created).toBe(2);
    expect(collection.last).toHaveLength(1);
    expect(collection.last[0].options.after.content).toBe('LF');
  });

  it('leaves rendering alone on theme change when the toggle is off', () => {
    const options = [];
    const editor = {
      updateOptions(opts) { options.push(opts); },
      createDecorationsCollection() { return { set() {}, clear() {} }; },
      onDidChangeModelContent() {},
      onDidChangeModel() {},
      getModel() {
        return {
          getEOL: () => '\n',
          getLineCount: () => 2,
          getLineMaxColumn: () => 3
        };
      }
    };

    invisibles.attach(editor);
    options.length = 0;
    invisibles.onThemeChanged();
    expect(options).toEqual([]);
  });
});

describe('toolbar wiring', () => {
  it('adds the toggle button and loads the module before app.js', () => {
    expect(indexHtml).toMatch(/id="invisibles-btn"/);
    expect(indexHtml).toMatch(/Show hidden characters/);
    expect(indexHtml).toMatch(/invisibles\.js\?v=__CACHE_VERSION__/);
    expect(indexHtml.indexOf('invisibles.js')).toBeLessThan(indexHtml.indexOf('app.js'));
    expect(appSrc).toMatch(/InvisiblesSupport\.invisibles\.attach/);
  });
});

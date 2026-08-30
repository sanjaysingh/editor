import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  MONACO_VS,
  LANGUAGE_MODULES,
  WORKER_FILES,
  WORKER_LANGUAGES,
  modulesFor,
  workerUrls
} from './load-monaco-preload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'client/app.js'), 'utf-8');
const indexHtml = readFileSync(join(root, 'client/index.html'), 'utf-8');

const supportedLanguages = {
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

describe('Monaco language preload', () => {
  it('maps every selectable language except plaintext', () => {
    const ids = Object.keys(supportedLanguages).filter((id) => id !== 'plaintext');
    expect(ids.sort()).toEqual(Object.keys(LANGUAGE_MODULES).sort());
  });

  it('includes basic-language and rich-language worker modes', () => {
    expect(modulesFor(['python'])).toEqual(['vs/basic-languages/python/python']);
    expect(modulesFor(['css'])).toEqual(expect.arrayContaining([
      'vs/basic-languages/css/css',
      'vs/language/css/cssMode'
    ]));
    expect(modulesFor(['javascript', 'typescript'])).toEqual(expect.arrayContaining([
      'vs/basic-languages/javascript/javascript',
      'vs/basic-languages/typescript/typescript',
      'vs/language/typescript/tsMode'
    ]));
    expect(modulesFor(['json'])).toContain('vs/language/json/jsonMode');
  });

  it('prefetches the Monaco worker scripts used after language switch', () => {
    const urls = workerUrls();
    expect(urls.every((url) => url.startsWith(`${MONACO_VS}/`))).toBe(true);
    expect(WORKER_FILES).toEqual(expect.arrayContaining([
      'base/worker/workerMain.js',
      'language/css/cssWorker.js',
      'language/html/htmlWorker.js',
      'language/json/jsonWorker.js',
      'language/typescript/tsWorker.js'
    ]));
    expect(WORKER_LANGUAGES).toEqual(['css', 'html', 'json', 'javascript', 'typescript']);
  });

  it('loads the preload helper and defers the network lock until assets are ready', () => {
    expect(indexHtml).toContain('monaco-preload.js');
    expect(appSrc).toContain('MonacoPreload.preload');
    expect(appSrc).toContain('lockNetworkExceptLiveShare');
    expect(appSrc).not.toMatch(/window\.addEventListener\('load'[\s\S]*window\.fetch\s*=/);
  });
});

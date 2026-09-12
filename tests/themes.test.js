import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  LIGHT_THEMES,
  customThemes,
  isLightTheme,
  themeColors,
  register
} from './load-themes.mjs';

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '../client');
const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf-8');
const appSrc = readFileSync(join(clientDir, 'app.js'), 'utf-8');

describe('custom themes', () => {
  it('registers GitHub Dark, GitHub Light, Dracula, and One Dark', () => {
    expect(Object.keys(customThemes).sort()).toEqual([
      'dracula',
      'github-dark',
      'github-light',
      'one-dark'
    ]);
    expect(customThemes['github-light'].base).toBe('vs');
    expect(customThemes['github-dark'].base).toBe('vs-dark');
    expect(customThemes.dracula.colors['editor.background']).toBe('#282a36');
    expect(customThemes['one-dark'].colors['editor.background']).toBe('#282c34');
  });

  it('classifies light vs dark themes for preview and mermaid', () => {
    expect(LIGHT_THEMES).toEqual(['vs', 'hc-light', 'github-light']);
    expect(isLightTheme('github-light')).toBe(true);
    expect(isLightTheme('vs')).toBe(true);
    expect(isLightTheme('dracula')).toBe(false);
    expect(isLightTheme('one-dark')).toBe(false);
    expect(themeColors('github-dark')).toEqual({ bg: '#24292e', text: '#e1e4e8' });
    expect(themeColors('unknown')).toEqual({ bg: '#1e1e1e', text: '#d4d4d4' });
  });

  it('defines each custom theme on Monaco', () => {
    const defined = [];
    register({
      editor: {
        defineTheme(id, data) { defined.push({ id, base: data.base }); }
      }
    });
    expect(defined.map((item) => item.id).sort()).toEqual([
      'dracula',
      'github-dark',
      'github-light',
      'one-dark'
    ]);
  });
});

describe('theme wiring', () => {
  it('loads themes.js before the editor and lists the new options', () => {
    expect(indexHtml).toMatch(/themes\.js\?v=__CACHE_VERSION__/);
    expect(indexHtml.indexOf('themes.js')).toBeLessThan(indexHtml.indexOf('app.js'));
    expect(appSrc).toMatch(/ThemesSupport\.register/);
    expect(appSrc).toMatch(/github-dark/);
    expect(appSrc).toMatch(/github-light/);
    expect(appSrc).toMatch(/dracula/);
    expect(appSrc).toMatch(/one-dark/);
  });
});

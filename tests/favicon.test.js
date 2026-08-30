import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'client');
const html = readFileSync(join(client, 'index.html'), 'utf-8');

describe('app icons', () => {
  it('ships favicon, apple touch, and manifest assets', () => {
    for (const file of [
      'favicon.svg',
      'favicon.ico',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'site.webmanifest'
    ]) {
      expect(existsSync(join(client, file)), file).toBe(true);
    }
  });

  it('links icons from index.html so browsers stop requesting a missing favicon', () => {
    expect(html).toContain('rel="icon" href="favicon.svg"');
    expect(html).toContain('rel="icon" href="favicon.ico"');
    expect(html).toContain('rel="apple-touch-icon" href="apple-touch-icon.png"');
    expect(html).toContain('rel="manifest" href="site.webmanifest"');
    expect(html).toContain('theme-color');
  });

  it('uses an SVG mark with the editor palette', () => {
    const svg = readFileSync(join(client, 'favicon.svg'), 'utf-8');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('#007acc');
    expect(svg).toContain('#f4f4f4');
  });
});

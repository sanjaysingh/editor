/**
 * Integration tests for Live Share encrypted state flow.
 * Verifies that encrypted payloads can be round-tripped through the expected format.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { encrypt, decrypt } = require('./crypto-impl.cjs');

describe('Live Share Encrypted State Flow', () => {
  it('host payload format matches viewer expectation', async () => {
    const encKey = 'ABCDEF';
    const payload = {
      type: 'state',
      content: 'const x = 1;',
      selection: { start: 5, end: 10 },
      language: 'javascript',
      version: 1
    };
    const plain = JSON.stringify(payload);
    const cipher = await encrypt(plain, encKey);

    // Simulate what host sends
    const hostMessage = { type: 'state', content: cipher, encrypted: true };

    // Simulate what viewer receives and decrypts
    const decrypted = JSON.parse(await decrypt(hostMessage.content, encKey));
    expect(decrypted.content).toBe(payload.content);
    expect(decrypted.selection).toEqual(payload.selection);
    expect(decrypted.language).toBe(payload.language);
    expect(decrypted.version).toBe(payload.version);
  });

  it('snapshot format decrypts correctly', async () => {
    const encKey = 'XYZABC';
    const snapshotPayload = {
      type: 'state',
      content: 'function hello() { return "world"; }',
      selection: { start: 0, end: 0 },
      language: 'javascript',
      version: 1
    };
    const plain = JSON.stringify(snapshotPayload);
    const cipher = await encrypt(plain, encKey);

    // Simulate server snapshot response (content is cipher)
    const snap = { active: true, content: cipher, selection: { start: 0, end: 0 }, language: 'plaintext', version: 1 };

    // Simulate applySnapshot decryption
    const decrypted = JSON.parse(await decrypt(String(snap.content), encKey));
    expect(decrypted.content).toBe(snapshotPayload.content);
    expect(decrypted.language).toBe(snapshotPayload.language);
  });

  it('multiple state updates work with same key', async () => {
    const encKey = 'ABCDEF';
    const updates = [
      { content: 'v1', language: 'plaintext', version: 1 },
      { content: 'v2', language: 'javascript', version: 2 },
      { content: 'v3\n\nmulti', language: 'python', version: 3 }
    ];

    for (const u of updates) {
      const payload = { type: 'state', content: u.content, selection: { start: 0, end: 0 }, language: u.language, version: u.version };
      const cipher = await encrypt(JSON.stringify(payload), encKey);
      const decrypted = JSON.parse(await decrypt(cipher, encKey));
      expect(decrypted.content).toBe(u.content);
      expect(decrypted.language).toBe(u.language);
      expect(decrypted.version).toBe(u.version);
    }
  });
});

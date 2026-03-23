/**
 * Unit tests for Live Share encryption/decryption.
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { encrypt, decrypt, normalizeEncryptionKey, validateEncryptionKey, generateEncryptionKey } = require('./crypto-impl.cjs');

describe('Live Share Crypto', () => {
  describe('normalizeEncryptionKey', () => {
    it('strips non-digits and formats with hyphen', () => {
      expect(normalizeEncryptionKey('abc123')).toBe('123');
      expect(normalizeEncryptionKey('123456')).toBe('123-456');
      expect(normalizeEncryptionKey('  123-456  ')).toBe('123-456');
      expect(normalizeEncryptionKey('1a2b3c4d5e6f')).toBe('123-456');
    });

    it('limits to 6 digits', () => {
      expect(normalizeEncryptionKey('1234567890')).toBe('123-456');
      expect(normalizeEncryptionKey('123-456-789')).toBe('123-456');
    });

    it('handles empty input', () => {
      expect(normalizeEncryptionKey('')).toBe('');
      expect(normalizeEncryptionKey(null)).toBe('');
    });
  });

  describe('validateEncryptionKey', () => {
    it('accepts valid 6-digit keys in XXX-XXX format', () => {
      expect(validateEncryptionKey('123-456')).toBe(true);
      expect(validateEncryptionKey('000-000')).toBe(true);
      expect(validateEncryptionKey('999-999')).toBe(true);
    });

    it('rejects invalid keys', () => {
      expect(validateEncryptionKey('ABC')).toBe(false);
      expect(validateEncryptionKey('')).toBe(false);
      expect(validateEncryptionKey('123456')).toBe(false); // missing hyphen
      expect(validateEncryptionKey('   ')).toBe(false);
      expect(validateEncryptionKey('12-3456')).toBe(false); // wrong format
      expect(validateEncryptionKey('ABC-DEF')).toBe(false); // letters not allowed
    });
  });

  describe('generateEncryptionKey', () => {
    it('returns 7-character key (6 digits + 1 hyphen)', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(7);
      expect(key).toMatch(/^[0-9]{3}-[0-9]{3}$/);
    });

    it('generates different keys', () => {
      const keys = new Set();
      for (let i = 0; i < 50; i++) {
        keys.add(generateEncryptionKey());
      }
      expect(keys.size).toBeGreaterThan(40); // very unlikely to have duplicates
    });
  });

  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts plain text', async () => {
      const passphrase = '123-456';
      const plaintext = 'Hello, World!';
      const cipher = await encrypt(plaintext, passphrase);
      expect(cipher).toBeTruthy();
      expect(cipher).not.toBe(plaintext);
      expect(typeof cipher).toBe('string');
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts JSON state payload', async () => {
      const passphrase = '789-012';
      const payload = {
        type: 'state',
        content: 'function foo() { return 42; }',
        selection: { start: 5, end: 10 },
        language: 'javascript',
        version: 1
      };
      const plain = JSON.stringify(payload);
      const cipher = await encrypt(plain, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(JSON.parse(decrypted)).toEqual(payload);
    });

    it('produces different ciphertext each time (random IV/salt)', async () => {
      const passphrase = '123-456';
      const plaintext = 'same content';
      const c1 = await encrypt(plaintext, passphrase);
      const c2 = await encrypt(plaintext, passphrase);
      expect(c1).not.toBe(c2);
      expect(await decrypt(c1, passphrase)).toBe(plaintext);
      expect(await decrypt(c2, passphrase)).toBe(plaintext);
    });

    it('fails decryption with wrong key', async () => {
      const cipher = await encrypt('secret', '123-456');
      await expect(decrypt(cipher, '999-999')).rejects.toThrow();
    });

    it('fails decryption with tampered ciphertext', async () => {
      const cipher = await encrypt('secret', '123-456');
      const tampered = cipher.slice(0, -2) + 'XX';
      await expect(decrypt(tampered, '123-456')).rejects.toThrow();
    });

    it('handles unicode content', async () => {
      const passphrase = '123-456';
      const plaintext = '日本語 🎉 émojis';
      const cipher = await encrypt(plaintext, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it('handles empty content', async () => {
      const passphrase = '123-456';
      const plaintext = '';
      const cipher = await encrypt(plaintext, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe('');
    });

    it('handles large content', async () => {
      const passphrase = '123-456';
      const plaintext = 'x'.repeat(10000);
      const cipher = await encrypt(plaintext, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe(plaintext);
    });
  });
});

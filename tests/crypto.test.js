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
    it('uppercases and strips non-letters', () => {
      expect(normalizeEncryptionKey('abc123')).toBe('ABC');
      expect(normalizeEncryptionKey('abcdef')).toBe('ABCDEF');
      expect(normalizeEncryptionKey('  xYz  ')).toBe('XYZ');
    });

    it('limits to 6 characters', () => {
      expect(normalizeEncryptionKey('ABCDEFGH')).toBe('ABCDEF');
      expect(normalizeEncryptionKey('abcdef')).toBe('ABCDEF');
    });

    it('handles empty input', () => {
      expect(normalizeEncryptionKey('')).toBe('');
      expect(normalizeEncryptionKey(null)).toBe('');
    });
  });

  describe('validateEncryptionKey', () => {
    it('accepts valid 6-char keys', () => {
      expect(validateEncryptionKey('ABCDEF')).toBe(true);
      expect(validateEncryptionKey('XYZABC')).toBe(true);
      expect(validateEncryptionKey('abcdef')).toBe(true);
    });

    it('rejects invalid keys', () => {
      expect(validateEncryptionKey('ABC')).toBe(false);
      expect(validateEncryptionKey('')).toBe(false);
      expect(validateEncryptionKey('123456')).toBe(false);
      expect(validateEncryptionKey('   ')).toBe(false);
    });
  });

  describe('generateEncryptionKey', () => {
    it('returns 6-character key', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(6);
      expect(key).toMatch(/^[A-Z]{6}$/);
    });

    it('excludes I and O', () => {
      for (let i = 0; i < 50; i++) {
        const key = generateEncryptionKey();
        expect(key).not.toMatch(/[IO]/);
      }
    });
  });

  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts plain text', async () => {
      const passphrase = 'ABCDEF';
      const plaintext = 'Hello, World!';
      const cipher = await encrypt(plaintext, passphrase);
      expect(cipher).toBeTruthy();
      expect(cipher).not.toBe(plaintext);
      expect(typeof cipher).toBe('string');
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts JSON state payload', async () => {
      const passphrase = 'XYZABC';
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
      const passphrase = 'ABCDEF';
      const plaintext = 'same content';
      const c1 = await encrypt(plaintext, passphrase);
      const c2 = await encrypt(plaintext, passphrase);
      expect(c1).not.toBe(c2);
      expect(await decrypt(c1, passphrase)).toBe(plaintext);
      expect(await decrypt(c2, passphrase)).toBe(plaintext);
    });

    it('fails decryption with wrong key', async () => {
      const cipher = await encrypt('secret', 'ABCDEF');
      await expect(decrypt(cipher, 'WRONGK')).rejects.toThrow();
    });

    it('fails decryption with tampered ciphertext', async () => {
      const cipher = await encrypt('secret', 'ABCDEF');
      const tampered = cipher.slice(0, -2) + 'XX';
      await expect(decrypt(tampered, 'ABCDEF')).rejects.toThrow();
    });

    it('handles unicode content', async () => {
      const passphrase = 'ABCDEF';
      const plaintext = '日本語 🎉 émojis';
      const cipher = await encrypt(plaintext, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it('handles empty content', async () => {
      const passphrase = 'ABCDEF';
      const plaintext = '';
      const cipher = await encrypt(plaintext, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe('');
    });

    it('handles large content', async () => {
      const passphrase = 'ABCDEF';
      const plaintext = 'x'.repeat(10000);
      const cipher = await encrypt(plaintext, passphrase);
      const decrypted = await decrypt(cipher, passphrase);
      expect(decrypted).toBe(plaintext);
    });
  });
});

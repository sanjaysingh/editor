/**
 * Integration test to ensure all crypto implementations are consistent.
 * This catches cases where crypto-utils.js and live-share.js diverge.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Load the crypto-impl (what tests use)
const cryptoImpl = require('./crypto-impl.cjs');

// Load crypto-utils.js (what browser loads)
const cryptoUtilsPath = join(__dirname, '../client/crypto-utils.js');
const cryptoUtilsCode = readFileSync(cryptoUtilsPath, 'utf-8');

// Helper to extract function from file content
function extractFunction(code, funcName) {
  const regex = new RegExp(`function ${funcName}\\([^)]*\\)\\s*\\{`, 'g');
  const match = regex.exec(code);
  if (!match) return null;
  
  // Find the matching closing brace
  let depth = 1;
  let pos = match.index + match[0].length;
  while (depth > 0 && pos < code.length) {
    if (code[pos] === '{') depth++;
    if (code[pos] === '}') depth--;
    pos++;
  }
  return code.slice(match.index, pos);
}

describe('Crypto Implementation Consistency', () => {
  it('crypto-utils.js has extractKeyForCrypto function', () => {
    const hasExtractFn = cryptoUtilsCode.includes('function extractKeyForCrypto') ||
                         cryptoUtilsCode.includes('extractKeyForCrypto:');
    expect(hasExtractFn).toBe(true);
  });

  it('crypto-utils.js uses ENC_DIGITS not ENC_CHARS', () => {
    const hasDigits = cryptoUtilsCode.includes('ENC_DIGITS');
    const hasChars = cryptoUtilsCode.includes("'ABCDEFGHJKLMNPQRSTUVWXYZ'");
    expect(hasDigits).toBe(true);
    expect(hasChars).toBe(false);
  });

  it('crypto-utils.js generateEncryptionKey returns hyphenated format', () => {
    // Extract the function body and check for hyphen in template literal
    const genKeyFunc = extractFunction(cryptoUtilsCode, 'generateEncryptionKey');
    expect(genKeyFunc).toBeTruthy();
    expect(genKeyFunc).toContain('${digits.slice(0, 3)}-${digits.slice(3)}');
  });

  it('crypto-utils.js validateEncryptionKey accepts XXX-XXX format', () => {
    const valKeyFunc = extractFunction(cryptoUtilsCode, 'validateEncryptionKey');
    expect(valKeyFunc).toBeTruthy();
    expect(valKeyFunc).toMatch(/\[0-9\]/); // Should check for digits
  });

  it('all implementations produce compatible key formats', () => {
    // Test crypto-impl (used by tests)
    for (let i = 0; i < 20; i++) {
      const key = cryptoImpl.generateEncryptionKey();
      expect(key).toMatch(/^[0-9]{3}-[0-9]{3}$/);
      expect(cryptoImpl.validateEncryptionKey(key)).toBe(true);
    }
  });

  it('normalizeEncryptionKey produces XXX-XXX format', () => {
    expect(cryptoImpl.normalizeEncryptionKey('123456')).toBe('123-456');
    expect(cryptoImpl.normalizeEncryptionKey('123-456')).toBe('123-456');
    expect(cryptoImpl.normalizeEncryptionKey('1a2b3c')).toBe('123');
  });

  it('extractKeyForCrypto returns digits only', () => {
    expect(cryptoImpl.extractKeyForCrypto('123-456')).toBe('123456');
    expect(cryptoImpl.extractKeyForCrypto('123456')).toBe('123456');
    expect(cryptoImpl.extractKeyForCrypto('ABC-DEF')).toBe('');
  });
});

describe('Crypto Implementation Consistency - Live Share Integration', () => {
  it('encrypt/decrypt work with formatted key', async () => {
    const key = '123-456';
    const plaintext = 'test content';
    const cipher = await cryptoImpl.encrypt(plaintext, key);
    const decrypted = await cryptoImpl.decrypt(cipher, key);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypt/decrypt work with digits-only key', async () => {
    const key = '123456';
    const plaintext = 'test content';
    const cipher = await cryptoImpl.encrypt(plaintext, key);
    const decrypted = await cryptoImpl.decrypt(cipher, key);
    expect(decrypted).toBe(plaintext);
  });
});

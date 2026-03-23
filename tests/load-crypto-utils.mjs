/**
 * Helper to load crypto-utils.js in Node.js test environment.
 * Sets up the global crypto API that the browser file expects.
 */
import { webcrypto } from 'node:crypto';

// Set up global crypto for browser-compatible code (Node 18+ uses webcrypto differently)
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true
});

// Load the actual crypto-utils.js file
const cryptoUtilsPath = new URL('../client/crypto-utils.js', import.meta.url).pathname;
await import(cryptoUtilsPath);

// Export the LiveShareCrypto API that was set on global
export const { generateEncryptionKey, normalizeEncryptionKey, validateEncryptionKey, extractKeyForCrypto, encrypt, decrypt } = globalThis.LiveShareCrypto;

/**
 * Crypto implementation for tests - same logic as client/crypto-utils.js
 */
const crypto = globalThis.crypto;
const ENC_DIGITS = '0123456789';
const PBKDF2_ITERATIONS = 100000;
const SALT_LEN = 16;
const IV_LEN = 12;

function generateEncryptionKey() {
  const digits = Array.from({ length: 6 }, () => ENC_DIGITS[Math.floor(Math.random() * ENC_DIGITS.length)]).join('');
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function normalizeEncryptionKey(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (digits.length === 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return digits;
}

function validateEncryptionKey(key) {
  return /^[0-9]{3}-[0-9]{3}$/.test(String(key || '').trim());
}

function extractKeyForCrypto(key) {
  return String(key || '').replace(/[^0-9]/g, '');
}

async function encrypt(plaintext, passphrase) {
  const enc = new TextEncoder();
  // Use digits-only key for crypto operations
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(extractKeyForCrypto(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  const combined = new Uint8Array(salt.length + iv.length + ct.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ct), salt.length + iv.length);
  return Buffer.from(combined).toString('base64');
}

async function decrypt(base64Cipher, passphrase) {
  const raw = new Uint8Array(Buffer.from(base64Cipher, 'base64'));
  const salt = raw.slice(0, SALT_LEN);
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertext = raw.slice(SALT_LEN + IV_LEN);
  const enc = new TextEncoder();
  // Use digits-only key for crypto operations
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(extractKeyForCrypto(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(dec);
}

module.exports = { generateEncryptionKey, normalizeEncryptionKey, validateEncryptionKey, extractKeyForCrypto, encrypt, decrypt };

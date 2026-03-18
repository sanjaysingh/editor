/**
 * Crypto implementation for tests - same logic as client/crypto-utils.js
 */
const crypto = globalThis.crypto;
const ENC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PBKDF2_ITERATIONS = 100000;
const SALT_LEN = 16;
const IV_LEN = 12;

function generateEncryptionKey() {
  return Array.from({ length: 6 }, () => ENC_CHARS[Math.floor(Math.random() * ENC_CHARS.length)]).join('');
}

function normalizeEncryptionKey(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}

function validateEncryptionKey(key) {
  const k = normalizeEncryptionKey(key);
  return k.length === 6;
}

async function encrypt(plaintext, passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
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
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(dec);
}

module.exports = { generateEncryptionKey, normalizeEncryptionKey, validateEncryptionKey, encrypt, decrypt };

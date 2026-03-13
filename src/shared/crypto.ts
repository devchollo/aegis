import {
  AUTH_CHECK_VALUE,
  DEFAULT_KDF_ITERATIONS,
  VAULT_VERSION
} from "./constants";
import type { VaultMeta } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function importPasswordKey(password: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
}

export async function deriveVaultKey(
  password: string,
  saltB64: string,
  iterations = DEFAULT_KDF_ITERATIONS,
  extractable = true
) {
  const passwordKey = await importPasswordKey(password);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltB64),
      iterations,
      hash: "SHA-256"
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    extractable,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(key: CryptoKey, value: string) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value)
  );

  return {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64: bytesToBase64(iv)
  };
}

export async function decryptText(
  key: CryptoKey,
  ciphertextB64: string,
  ivB64: string
) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(ivB64)
    },
    key,
    base64ToBytes(ciphertextB64)
  );

  return decoder.decode(plaintext);
}

export async function createVaultMeta(password: string): Promise<{
  key: CryptoKey;
  meta: VaultMeta;
}> {
  const salt = randomBytes(16);
  const saltB64 = bytesToBase64(salt);
  const key = await deriveVaultKey(password, saltB64, DEFAULT_KDF_ITERATIONS, true);
  const authCheck = await encryptText(key, AUTH_CHECK_VALUE);

  return {
    key,
    meta: {
      version: VAULT_VERSION,
      saltB64,
      kdf: "PBKDF2",
      iterations: DEFAULT_KDF_ITERATIONS,
      hash: "SHA-256",
      authCheckCiphertextB64: authCheck.ciphertextB64,
      authCheckIvB64: authCheck.ivB64
    }
  };
}

export async function verifyVaultPassword(password: string, meta: VaultMeta) {
  try {
    const key = await deriveVaultKey(password, meta.saltB64, meta.iterations, true);
    const decrypted = await decryptText(
      key,
      meta.authCheckCiphertextB64,
      meta.authCheckIvB64
    );

    return decrypted === AUTH_CHECK_VALUE ? key : null;
  } catch {
    return null;
  }
}

export async function exportSessionKey(key: CryptoKey) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw));
}

export async function importSessionKey(rawKeyB64: string) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(rawKeyB64),
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

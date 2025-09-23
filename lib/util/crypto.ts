// Lightweight Web Crypto helpers for browser/Next.js with graceful fallbacks/errors

const textEncoder = new TextEncoder();

const getWebCrypto = (): Crypto => {
  const c = (typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined) as Crypto | undefined;
  if (!c) {
    throw new Error("Web Crypto API is not available (globalThis.crypto missing). Use a modern browser over HTTPS.");
  }
  return c;
};

const getSubtle = (): SubtleCrypto => {
  const c = getWebCrypto();
  const s = c?.subtle as SubtleCrypto | undefined;
  if (!s) {
    // Typically occurs on insecure (non-HTTPS) context or very old browser
    throw new Error("Web Crypto 'subtle' API is unavailable. Open this page over HTTPS (secure context) and use a modern browser.");
  }
  return s;
};

export const randomBytes = (n: number): Uint8Array => {
  const a = new Uint8Array(n);
  getWebCrypto().getRandomValues(a);
  return a;
};

export const importKeyFromPasswordPBKDF2 = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: 'SHA-256' | 'SHA-384' | 'SHA-512' = 'SHA-256'
): Promise<CryptoKey> => {
  const subtle = getSubtle();
  const keyMaterial = await subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  // Ensure salt is passed as an ArrayBuffer slice (BufferSource)
  const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations, hash },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const aesGcmEncrypt = async (
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array
): Promise<Uint8Array> => {
  const subtle = getSubtle();
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ptBuf = plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer;
  const buf = await subtle.encrypt({ name: 'AES-GCM', iv: ivBuf }, key, ptBuf);
  return new Uint8Array(buf);
};

export const aesGcmDecrypt = async (
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> => {
  const subtle = getSubtle();
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ctBuf = ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer;
  const buf = await subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, key, ctBuf);
  return new Uint8Array(buf);
};

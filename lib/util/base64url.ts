const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  }
  throw new Error("Base64 encoding is not supported in this environment");
};

const fromBase64 = (base64: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error("Base64 decoding is not supported in this environment");
};

export const toBase64Url = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");

export const fromBase64Url = (base64Url: string): Uint8Array => {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4;
  const base64 = padding ? `${padded}${"=".repeat(4 - padding)}` : padded;
  return fromBase64(base64);
};

// Base80 encoder/decoder for fragment-only URLs
// Alphabet (80 chars) avoids '/' and '%':
// 0-9 (10), A-Z (26), a-z (26), and 18 unreserved/sub-delims commonly safe in URL fragments
// Using "-_.!~*'()$&+,;=:@?" (note: '&' instead of '%') => 18
// Total = 80

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_.!~*'()$&+,;=:@?" as const;

const BASE = 80;

// Map characters to values
const CHAR_TO_VAL: Record<string, number> = (() => {
  const map: Record<string, number> = Object.create(null);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    map[ALPHABET[i] as unknown as string] = i;
  }
  return map;
})();


/**
 * Encode bytes into Base80 string (minimal length, preserves leading 0x00 as leading '0').
 */
export function toBase80(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Count leading zeros
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // Base conversion: base256 -> base80 (similar to Base58 algorithm)
  let input = bytes.subarray(zeros);
  const digits: number[] = [];
  while (input.length > 0) {
    let remainder = 0;
    const next: number[] = [];
    for (let i = 0; i < input.length; i += 1) {
      const acc = (remainder << 8) | input[i]!;
      const q = Math.floor(acc / BASE);
      remainder = acc % BASE;
      if (next.length > 0 || q > 0) next.push(q);
    }
    digits.push(remainder);
    input = Uint8Array.from(next);
  }

  let out = "";
  // Leading zeros map to leading '0'
  for (let i = 0; i < zeros; i += 1) out += ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]!];
  return out;
}

/**
 * Decode Base80 string back into bytes. Throws on invalid characters.
 */
export function fromBase80(text: string): Uint8Array {
  if (!text) return new Uint8Array(0);

  // Count leading zero chars
  let zeros = 0;
  while (zeros < text.length && text.charAt(zeros) === ALPHABET[0]) zeros += 1;

  // Map chars to values
  const vals: number[] = [];
  for (let i = zeros; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const v = CHAR_TO_VAL[ch];
    if (v === undefined) {
      throw new Error(`Invalid Base80 character: '${ch}'`);
    }
    vals.push(v);
  }

  // Base conversion: base80 -> base256
  const bytes: number[] = [];
  while (vals.length > 0) {
    let remainder = 0;
    const next: number[] = [];
    for (let i = 0; i < vals.length; i += 1) {
      const acc = remainder * BASE + vals[i]!;
      const q = Math.floor(acc / 256);
      remainder = acc % 256;
      if (next.length > 0 || q > 0) next.push(q);
    }
    bytes.push(remainder);
    vals.splice(0, vals.length, ...next); // mutate in place
  }

  const out = new Uint8Array(zeros + bytes.length);
  // leading zeros
  for (let i = 0; i < zeros; i += 1) out[i] = 0;
  // rest (reverse order)
  for (let i = 0; i < bytes.length; i += 1) {
    out[zeros + i] = bytes[bytes.length - 1 - i]!;
  }
  return out;
}

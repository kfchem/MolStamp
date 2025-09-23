import { elements } from "../chem/atomUtils";

// Codes are atomic numbers (Z). 1..118 fit in 7 bits.
const Z_INDEXED_SYMBOLS: string[] = (() => {
  const arr = new Array<string>(128).fill("X");
  for (const e of elements) {
    const z = (e as any).number as number | undefined;
    const sym = (e as any).symbol as string | undefined;
    if (typeof z === "number" && z > 0 && z < 128 && typeof sym === "string") {
      arr[z] = sym;
    }
  }
  // Fallback to Carbon
  arr[6] = arr[6] || "C";
  // index 0 fallback as Carbon too
  arr[0] = arr[6];
  return arr;
})();

const SYMBOL_TO_Z = (() => {
  const map = new Map<string, number>();
  for (const e of elements) {
    const sym = (e as any).symbol as string | undefined;
    const z = (e as any).number as number | undefined;
    if (typeof sym === "string" && typeof z === "number") {
      const key = sym.length === 1 ? sym.toUpperCase() : sym[0].toUpperCase() + sym.slice(1).toLowerCase();
      map.set(key, z);
    }
  }
  return map;
})();

export const symbolToCode = (symbol: string): number => {
  const s = symbol.trim();
  const key = s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1).toLowerCase();
  return SYMBOL_TO_Z.get(key) ?? 6;
};

export const codeToSymbol = (code: number): string => {
  return Z_INDEXED_SYMBOLS[code] ?? "C";
};

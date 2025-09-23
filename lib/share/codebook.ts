import { elements } from "../chem/atomUtils";

// v4 用: コード=原子番号(Z)。範囲は 1..118 を想定（7bit に収まる）。
// 内部: Z_INDEXED_SYMBOLS[Z] = symbol。未知コードや0にはフォールバックで"C"。
const Z_INDEXED_SYMBOLS: string[] = (() => {
  const arr = new Array<string>(128).fill("X");
  // 原子番号からシンボルへ
  for (const e of elements) {
    const z = (e as any).number as number | undefined;
    const sym = (e as any).symbol as string | undefined;
    if (typeof z === "number" && z > 0 && z < 128 && typeof sym === "string") {
      arr[z] = sym;
    }
  }
  // フォールバック用に炭素
  arr[6] = arr[6] || "C";
  // index 0 は通常使わないが安全のため
  arr[0] = arr[6];
  return arr;
})();

// symbol -> Z（未知は6=Carbonにフォールバック）
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

// 公開 API（現行の使用箇所に合わせて最小限）
export const symbolToCode = (symbol: string): number => {
  const s = symbol.trim();
  const key = s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1).toLowerCase();
  return SYMBOL_TO_Z.get(key) ?? 6; // fallback Carbon(Z=6)
};

export const codeToSymbol = (code: number): string => {
  return Z_INDEXED_SYMBOLS[code] ?? "C";
};

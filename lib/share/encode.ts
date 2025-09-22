import { deflate } from "pako";
import type { Molecule, StyleSettings } from "../chem/types";
import { toBase80 } from "../util/base80";
import { BitWriter } from "./bitstream";
import { SHARE_BASE_URL } from "./baseUrl";
import { symbolToCode } from "./codebook";

const encoder = new TextEncoder();

export type ShareStyle = Pick<
  StyleSettings,
  "material" | "atomScale" | "bondRadius" | "quality"
>;
export type ShareAtom = [string, number, number, number, number?];
export type ShareBond = [number, number, number];

export type SharePayloadV2 = {
  v: 2;
  atoms: ShareAtom[];
  bonds: ShareBond[];
  style: ShareStyle;
  meta?: {
    title?: string;
  };
};

export type SharePayload = SharePayloadV2;

export type ShareInput = {
  molecule: Molecule;
  style: ShareStyle;
  // When true, omit bonds from the compact bitstream and let decoder infer them.
  // Useful to shrink payload size for large molecules.
  omitBonds?: boolean;
  // When true, reduce coordinate precision by 1 bit (divide fixed-point ints by 2)
  // to improve compressibility and QR fit at the cost of slight positional loss.
  coarseCoords?: boolean;
  // Preferred: number of LSBs to drop from fixed-point coordinates (0..8)
  // Rounds to nearest multiple of 2^n while keeping overall scale the same.
  precisionDrop?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  // When false, do not use deltas; write absolute quantized coords for every atom.
  // Default false for robustness and to avoid long-jump surprises across components.
  useDelta?: boolean;
  // Optional short title to embed in the compact payload (v7+). Will be sanitized
  // to a 64-character alphabet and limited to 63 chars to minimize overhead.
  title?: string;
};

export type ShareEncodingResult = {
  encoded: string;
  byteLength: number;
  payload: SharePayload;
  // scale exponent e where M = 2^e
  scaleExp: number;
};

const round4 = (value: number): number => Number(value.toFixed(4));

const centreAtoms = (atoms: Molecule["atoms"]): ShareAtom[] => {
  if (atoms.length === 0) return [];
  const centroid = atoms.reduce(
    (acc, atom) => {
      acc.x += atom.x;
      acc.y += atom.y;
      acc.z += atom.z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );
  centroid.x /= atoms.length;
  centroid.y /= atoms.length;
  centroid.z /= atoms.length;

  return atoms.map((atom) => {
    const centred: ShareAtom = [
      atom.symbol,
      round4(atom.x - centroid.x),
      round4(atom.y - centroid.y),
      round4(atom.z - centroid.z),
    ];
    if (typeof atom.charge === "number" && atom.charge !== 0) {
      centred.push(atom.charge);
    }
    return centred;
  });
};

const mapBonds = (bonds: Molecule["bonds"]): ShareBond[] =>
  bonds.map((bond) => [bond.i, bond.j, bond.order]);

const ceilLog2 = (n: number): number => {
  if (n <= 1) return 0;
  return Math.ceil(Math.log2(n));
};

// 64-char compact title alphabet: [space, '-', 0-9, A-Z, a-z]
const TITLE_ALPHABET = (() => {
  const arr: string[] = [' ', '-'];
  for (let i = 0; i < 10; i++) arr.push(String(i));
  for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(65 + i));
  for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(97 + i));
  return arr;
})();
const TITLE_INDEX: Record<string, number> = Object.fromEntries(
  TITLE_ALPHABET.map((ch, i) => [ch, i])
);
const sanitizeTitle = (s: string | undefined | null): string => {
  if (!s) return "";
  let out = "";
  for (const ch of s) {
    if (ch in TITLE_INDEX) {
      out += ch;
    } else {
      // map common spaces to space; others to '-'
      if (/\s/.test(ch)) out += ' ';
      else out += '-';
    }
    if (out.length >= 63) break;
  }
  // trim excessive spaces/hyphens at ends
  out = out.replace(/\s{2,}/g, ' ').replace(/^-+/, '').replace(/-+$/, '').trim();
  return out.slice(0, 63);
};

export const encodeShareData = ({
  molecule,
  style,
  omitBonds = false,
  coarseCoords = false,
  precisionDrop,
  useDelta = false,
  title,
}: ShareInput): ShareEncodingResult => {
  // v5 ultra-compact base with BFS reorder; now extend to v6 for variable coord bits
  const atoms = molecule.atoms;
  const bonds = molecule.bonds;
  // UI向けの見やすい表示用に小数4桁に丸めた中心化座標（送信しないpayload用）
  const centredUi0 = centreAtoms(atoms);
  // エンコード用はフル精度で中心化（丸めなし）
  const centroid = atoms.reduce(
    (acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y, z: acc.z + a.z }),
    { x: 0, y: 0, z: 0 },
  );
  if (atoms.length > 0) {
    centroid.x /= atoms.length; centroid.y /= atoms.length; centroid.z /= atoms.length;
  }
  const centredExact0: ShareAtom[] = atoms.map((atom) => {
    const exact: ShareAtom = [
      atom.symbol,
      atom.x - centroid.x,
      atom.y - centroid.y,
      atom.z - centroid.z,
    ];
    if (typeof atom.charge === "number" && atom.charge !== 0) exact.push(atom.charge);
    return exact;
  });

  // Reorder atoms by BFS along bonds (start at highest-degree atom) to reduce coordinate deltas
  const N = centredExact0.length;
  const adj: number[][] = Array.from({ length: N }, () => []);
  for (const b of bonds) {
    if (b.i >= 0 && b.i < N && b.j >= 0 && b.j < N) {
      adj[b.i].push(b.j);
      adj[b.j].push(b.i);
    }
  }
  const degree = adj.map((lst) => lst.length);
  const visitedGlobal = new Array<boolean>(N).fill(false);
  // 連結成分を列挙
  const components: number[][] = [];
  for (let i = 0; i < N; i += 1) {
    if (visitedGlobal[i]) continue;
    const comp: number[] = [];
    const q: number[] = [i];
    visitedGlobal[i] = true;
    while (q.length) {
      const u = q.shift()!;
      comp.push(u);
      for (const v of adj[u]) {
        if (!visitedGlobal[v]) { visitedGlobal[v] = true; q.push(v); }
      }
    }
    components.push(comp);
  }
  // BFSヘルパ
  const bfsFrom = (start: number, maskVisited: boolean[]): number[] => {
    const out: number[] = [];
    const q: number[] = [start];
    maskVisited[start] = true;
    while (q.length) {
      const u = q.shift()!;
      out.push(u);
      const neigh = adj[u].slice().sort((a, b) => degree[b] - degree[a]);
      for (const v of neigh) {
        if (!maskVisited[v]) { maskVisited[v] = true; q.push(v); }
      }
    }
    return out;
  };
  // 成分の並び順と各成分の起点を決めて最終順序を作成
  const usedComp = new Array<boolean>(components.length).fill(false);
  const order: number[] = [];
  // 初回: 原点に最も近い原子を含む成分を選ぶ
  let curTail = { x: 0, y: 0, z: 0 };
  let firstComp = -1;
  let firstStart = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let ci = 0; ci < components.length; ci += 1) {
    const comp = components[ci]!;
    for (const idx of comp) {
      const a = centredExact0[idx]!;
      const m = Math.max(Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]));
      if (m < best) { best = m; firstComp = ci; firstStart = idx; }
    }
  }
  if (firstComp >= 0) {
    const vis = new Array<boolean>(N).fill(false);
    const seq = bfsFrom(firstStart, vis);
    order.push(...seq);
    usedComp[firstComp] = true;
    const last = seq[seq.length - 1]!;
    const a = centredExact0[last]!;
    curTail = { x: a[1], y: a[2], z: a[3] };
  }
  // 以降: 直前の末尾に最も近い起点を持つ成分を貪欲に選ぶ
  while (usedComp.some((u) => !u)) {
    let bestCi = -1;
    let bestStartIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let ci = 0; ci < components.length; ci += 1) {
      if (usedComp[ci]) continue;
      const comp = components[ci]!;
      for (const idx of comp) {
        const a = centredExact0[idx]!;
        const dx = a[1] - curTail.x;
        const dy = a[2] - curTail.y;
        const dz = a[3] - curTail.z;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < bestDist) { bestDist = d2; bestCi = ci; bestStartIdx = idx; }
      }
    }
    const vis = new Array<boolean>(N).fill(false);
    const seq = bfsFrom(bestStartIdx, vis);
    order.push(...seq);
    usedComp[bestCi] = true;
    const last = seq[seq.length - 1]!;
    const a = centredExact0[last]!;
    curTail = { x: a[1], y: a[2], z: a[3] };
  }
  const oldToNew = new Array<number>(N);
  for (let ni = 0; ni < N; ni += 1) oldToNew[order[ni]!] = ni;
  const centredUi = useDelta ? order.map((oi) => centredUi0[oi]!) : centredUi0.slice();
  const centredExact = useDelta ? order.map((oi) => centredExact0[oi]!) : centredExact0.slice();
  const bondsReordered = useDelta
    ? bonds.map((b) => ({ i: oldToNew[b.i] ?? b.i, j: oldToNew[b.j] ?? b.j, order: b.order }))
    : bonds.map((b) => ({ i: b.i, j: b.j, order: b.order }));

  // Choose power-of-two global scale M = 2^e so that |x/M|*1000 fits in int16 range
  let maxAbs = 0;
  for (const a of centredExact) {
    maxAbs = Math.max(maxAbs, Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]));
  }
  const need = maxAbs / 32.767; // since 32767/1000 ≈ 32.767
  let e = 0;
  while (e < 3 && (1 << e) < need) e += 1;
  let M = 1 << e;

  // Build dictionary of used species
  const usedCodes: number[] = [];
  const codeIndex = new Map<number, number>();
  for (const a of centredExact) {
    const c = symbolToCode(a[0]);
    if (!codeIndex.has(c)) {
      codeIndex.set(c, usedCodes.length);
      usedCodes.push(c);
      if (usedCodes.length === 127) break;
    }
  }
  const U = usedCodes.length || 1;
  const idxBits = Math.max(1, ceilLog2(U));

  const atomCount = Math.min(centredExact.length, 1023);
  const rawBondCount = Math.min(bondsReordered.length, 4095);
  const bondCount = omitBonds ? 0 : rawBondCount;
  const indexBits = Math.max(1, ceilLog2(atomCount));

  // style packing
  const materialMap: Record<StyleSettings["material"], number> = {
    standard: 0, metal: 1, toon: 2, glass: 3,
  };
  const material2 = materialMap[style.material] ?? 0;
  const atomScaleQ6 = Math.max(0, Math.min(63, Math.round(style.atomScale / 0.02)));
  const bondRadiusQ6 = Math.max(0, Math.min(63, Math.round(style.bondRadius / 0.02)));
  const qualityMap: Record<StyleSettings["quality"], number> = { low: 0, medium: 1, high: 2, ultra: 3 };
  const quality2 = qualityMap[style.quality] ?? 2;

  // Prepare fixed-point integers with precision drop
  const dropBits0 = Math.max(0, Math.min(8, precisionDrop ?? (coarseCoords ? 1 : 0)));
  const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, v));
  const step0 = 1 << dropBits0;
  const roundToStep = (v: number) => clamp16(Math.round(v / step0) * step0);
  const intsX = new Int32Array(atomCount);
  const intsY = new Int32Array(atomCount);
  const intsZ = new Int32Array(atomCount);
  const computeIntsAndMaxDelta = () => {
    for (let i = 0; i < atomCount; i += 1) {
      const [, x, y, z] = centredExact[i];
      const gx = (x / M) * 1000;
      const gy = (y / M) * 1000;
      const gz = (z / M) * 1000;
      const fx = clamp16(Math.round(gx / step0) * step0);
      const fy = clamp16(Math.round(gy / step0) * step0);
      const fz = clamp16(Math.round(gz / step0) * step0);
      intsX[i] = fx; intsY[i] = fy; intsZ[i] = fz;
    }
    let maxAbsCoord = 0;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < atomCount; i += 1) {
      const fx = intsX[i]!, fy = intsY[i]!, fz = intsZ[i]!;
      if (!useDelta) {
        // Absolute mode: measure absolute values only
        maxAbsCoord = Math.max(maxAbsCoord, Math.abs(fx), Math.abs(fy), Math.abs(fz));
      } else if (i === 0) {
        maxAbsCoord = Math.max(maxAbsCoord, Math.abs(fx), Math.abs(fy), Math.abs(fz));
        px = fx; py = fy; pz = fz;
      } else {
        const dx = fx - px; const dy = fy - py; const dz = fz - pz;
        maxAbsCoord = Math.max(maxAbsCoord, Math.abs(dx), Math.abs(dy), Math.abs(dz));
        px = fx; py = fy; pz = fz;
      }
    }
    return maxAbsCoord;
  };
  let maxAbsCoord = computeIntsAndMaxDelta();
  let neededBits = maxAbsCoord <= 0 ? 1 : Math.ceil(Math.log2(maxAbsCoord + 1)) + 1; // include sign
  while (neededBits > 16 && e < 3) {
    e += 1; M = 1 << e;
    maxAbsCoord = computeIntsAndMaxDelta();
    neededBits = maxAbsCoord <= 0 ? 1 : Math.ceil(Math.log2(maxAbsCoord + 1)) + 1;
  }
  const coordBits = Math.max(8, Math.min(16, neededBits));

  // Write bitstream (v7)
  const w = new BitWriter();
  w.writeUnsigned("Q".charCodeAt(0), 8);
  w.writeUnsigned("R".charCodeAt(0), 8);
  w.writeUnsigned("M".charCodeAt(0), 8);
  w.writeUnsigned(7, 8);
  w.writeUnsigned(atomCount, 10);
  w.writeUnsigned(bondCount, 12);
  w.writeUnsigned(e, 2);
  w.writeUnsigned(coordBits - 8, 4);
  w.writeUnsigned(material2, 2);
  w.writeUnsigned(atomScaleQ6, 6);
  w.writeUnsigned(bondRadiusQ6, 6);
  w.writeUnsigned(quality2, 2);
  w.writeUnsigned(useDelta ? 1 : 0, 1); // delta flag
  w.writeUnsigned(omitBonds ? 1 : 0, 1);
  w.writeUnsigned(U, 7);
  for (let i = 0; i < U; i += 1) w.writeUnsigned(usedCodes[i], 7);

  // Optional compact title block: flag(1), if 1 then len(6) + len*6-bit chars
  const titleSan = sanitizeTitle(title ?? molecule.title);
  if (titleSan && titleSan.length > 0) {
    w.writeUnsigned(1, 1);
    w.writeUnsigned(titleSan.length, 6);
    for (let i = 0; i < titleSan.length; i++) {
      const ch = titleSan[i]!;
      const idx = TITLE_INDEX[ch] ?? TITLE_INDEX['-'];
      w.writeUnsigned(idx, 6);
    }
  } else {
    w.writeUnsigned(0, 1);
  }

  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < atomCount; i += 1) {
  const [sym] = centredExact[i];
    const dictIndex = codeIndex.get(symbolToCode(sym))!;
    w.writeUnsigned(dictIndex, idxBits);
    const fx = intsX[i]!, fy = intsY[i]!, fz = intsZ[i]!;
    if (!useDelta || i === 0) {
      w.writeSigned(fx, coordBits);
      w.writeSigned(fy, coordBits);
      w.writeSigned(fz, coordBits);
      px = fx; py = fy; pz = fz;
    } else {
      w.writeSigned(fx - px, coordBits);
      w.writeSigned(fy - py, coordBits);
      w.writeSigned(fz - pz, coordBits);
      px = fx; py = fy; pz = fz;
    }
  }

  // bonds: i, j with indexBits; order 2 bits
  for (let k = 0; k < bondCount; k += 1) {
    const b = bondsReordered[k];
    const i = Math.max(0, Math.min(atomCount - 1, b.i));
    const j = Math.max(0, Math.min(atomCount - 1, b.j));
    const order3 = Math.max(1, Math.min(3, b.order));
    const ob = order3 === 1 ? 0b01 : order3 === 2 ? 0b10 : 0b11;
    w.writeUnsigned(i, indexBits);
    w.writeUnsigned(j, indexBits);
    w.writeUnsigned(ob, 2);
  }

  const binary = w.toUint8Array();
  const compressed = deflate(binary, { level: 9 });
  const encoded = toBase80(compressed);

  // Minimal v2-style payload for app state (not transmitted)
  const payload: SharePayload = {
    v: 2,
    atoms: centredUi,
    bonds: mapBonds(bondsReordered),
    style: { ...style },
    meta: (titleSan && titleSan.length > 0) ? { title: titleSan } : undefined,
  };

  return { encoded, byteLength: compressed.byteLength, payload, scaleExp: e };
};

export const buildShareUrl = (_origin: string, encoded: string): string => {
  const base = SHARE_BASE_URL.replace(/\/$/, "");
  return `${base}/qr#${encoded}`;
};

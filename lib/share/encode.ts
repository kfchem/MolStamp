import { deflate } from "pako";
import type { Molecule, StyleSettings } from "../chem/types";
import { toBase80 } from "../util/base80";
import { BitWriter } from "./bitstream";
import { SHARE_BASE_URL } from "./baseUrl";
import { symbolToCode } from "./codebook";
import { aesGcmEncrypt, importKeyFromPasswordPBKDF2, randomBytes } from "../util/crypto";

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
  meta?: { title?: string };
};
export type SharePayload = SharePayloadV2;

export type ShareInput = {
  molecule: Molecule;
  style: ShareStyle;
  omitBonds?: boolean;
  precisionDrop?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  useDelta?: boolean;
  title?: string;
};

export type ShareEncodingResult = {
  encoded: string;
  byteLength: number;
  payload: SharePayload;
  scaleExp: number;
};

const round4 = (value: number): number => Number(value.toFixed(4));
const ceilLog2 = (n: number): number => Math.max(0, Math.ceil(Math.log2(Math.max(1, n))));

const TITLE_ALPHABET = (() => {
  const arr: string[] = [' ', '-'];
  for (let i = 0; i < 10; i++) arr.push(String(i));
  for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(65 + i));
  for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(97 + i));
  return arr;
})();
const TITLE_INDEX = TITLE_ALPHABET.reduce<Record<string, number>>((acc, ch, i) => {
  acc[ch] = i;
  return acc;
}, {});
const sanitizeTitle = (title?: string): string | undefined => {
  if (!title) return undefined;
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  const out: string[] = [];
  for (const ch of trimmed) {
    out.push(TITLE_INDEX[ch] != null ? ch : '-');
    if (out.length >= 63) break;
  }
  return out.join("");
};

const centreAtoms = (atoms: Molecule["atoms"]): ShareAtom[] => {
  if (atoms.length === 0) return [];
  const centroid = atoms.reduce(
    (acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y, z: acc.z + a.z }),
    { x: 0, y: 0, z: 0 },
  );
  centroid.x /= atoms.length; centroid.y /= atoms.length; centroid.z /= atoms.length;
  return atoms.map((atom) => {
    const centred: ShareAtom = [
      atom.symbol,
      round4(atom.x - centroid.x),
      round4(atom.y - centroid.y),
      round4(atom.z - centroid.z),
    ];
    if (typeof atom.charge === "number" && atom.charge !== 0) centred.push(atom.charge);
    return centred;
  });
};

const mapBonds = (bonds: Array<{ i: number; j: number; order: number }>): ShareBond[] =>
  bonds.map((b) => [b.i, b.j, (b.order as 1 | 2 | 3) ?? 1]);

const buildInnerBitstream = (
  molecule: Molecule,
  style: ShareStyle,
  omitBonds: boolean,
  precisionDrop: ShareInput["precisionDrop"],
  useDelta: boolean,
  title?: string,
) => {
  const atoms = molecule.atoms;
  const bonds = molecule.bonds;
  const centredUi0 = centreAtoms(atoms);
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
  const usedComp = new Array<boolean>(components.length).fill(false);
  const order: number[] = [];
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

  let maxAbs = 0;
  for (const a of centredExact) {
    maxAbs = Math.max(maxAbs, Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]));
  }
  const need = maxAbs / 32.767;
  let e = 0;
  while (e < 3 && (1 << e) < need) e += 1;
  let M = 1 << e;

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

  const materialMap: Record<StyleSettings["material"], number> = {
    standard: 0, metal: 1, toon: 2, glass: 3,
  };
  const material2 = materialMap[style.material] ?? 0;
  const atomScaleQ6 = Math.max(0, Math.min(63, Math.round(style.atomScale / 0.02)));
  const bondRadiusQ6 = Math.max(0, Math.min(63, Math.round(style.bondRadius / 0.02)));
  const qualityMap: Record<StyleSettings["quality"], number> = { low: 0, medium: 1, high: 2, ultra: 3 };
  const quality2 = qualityMap[style.quality] ?? 2;

  const dropBits0 = Math.max(0, Math.min(8, precisionDrop ?? 0));
  const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, v));
  const step0 = 1 << dropBits0;
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

  const w = new BitWriter();
  // Inner layout v1 (no magic):
  // [atomCount:10][bondCount:12][e:2][coordBits-8:4]
  // [material2:2][atomScaleQ6:6][bondRadiusQ6:6][quality2:2]
  // [delta:1][omitBonds:1][U:7][U*dict(7)]
  w.writeUnsigned(atomCount, 10);
  w.writeUnsigned(bondCount, 12);
  w.writeUnsigned(e, 2);
  w.writeUnsigned(coordBits - 8, 4);
  w.writeUnsigned(material2, 2);
  w.writeUnsigned(atomScaleQ6, 6);
  w.writeUnsigned(bondRadiusQ6, 6);
  w.writeUnsigned(quality2, 2);
  w.writeUnsigned(useDelta ? 1 : 0, 1);
  w.writeUnsigned(omitBonds ? 1 : 0, 1);
  w.writeUnsigned(U, 7);
  for (let i = 0; i < U; i += 1) w.writeUnsigned(usedCodes[i], 7);

  // Optional title: flag(1), len(6), chars*6
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

  const payload: SharePayload = {
    v: 2,
    atoms: useDelta ? order.map((oi) => centredUi0[oi]!) : centredUi0.slice(),
    bonds: mapBonds(bondsReordered),
    style: { ...style },
    meta: (titleSan && titleSan.length > 0) ? { title: titleSan } : undefined,
  };
  return { innerCompressed: compressed, payload, scaleExp: e };
};

export const encodeShareData = ({
  molecule,
  style,
  omitBonds = false,
  precisionDrop,
  useDelta = false,
  title,
}: ShareInput): ShareEncodingResult => {
  const { innerCompressed, payload, scaleExp } = buildInnerBitstream(
    molecule,
    style,
    omitBonds,
    precisionDrop,
    useDelta,
    title,
  );
  // MS envelope v1: ['M','S', (ver<<4)|(flags4)] where bit0=enc
  const ver = 1;
  const flags4 = 0; // unencrypted
  const header = new Uint8Array(["M".charCodeAt(0), "S".charCodeAt(0), ((ver & 0x0f) << 4) | (flags4 & 0x0f)]);
  const out = new Uint8Array(header.byteLength + innerCompressed.byteLength);
  out.set(header, 0);
  out.set(innerCompressed, header.byteLength);
  const encoded = toBase80(out);
  return { encoded, byteLength: out.byteLength, payload, scaleExp };
};

export const buildShareUrl = (encoded: string): string => {
  const base = SHARE_BASE_URL.replace(/\/$/, "");
  // Always use clean "/qr#" in all environments per requirement.
  // Note: On some static hosts (e.g., GitHub Pages with trailingSlash), navigating may redirect
  // "/qr" -> "/qr/" but the generated link itself remains canonical as "/qr#...".
  return `${base}/qr#${encoded}`;
};

export const encodeShareDataEncrypted = async ({
  molecule,
  style,
  omitBonds = false,
  precisionDrop,
  useDelta = false,
  title,
  password,
}: ShareInput & { password: string }): Promise<ShareEncodingResult> => {
  const { innerCompressed, payload, scaleExp } = buildInnerBitstream(
    molecule,
    style,
    omitBonds,
    precisionDrop,
    useDelta,
    title,
  );
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  // Fixed PBKDF2 iterations for compact header
  const iterations = 100000;
  const key = await importKeyFromPasswordPBKDF2(password, salt, iterations);
  const ct = await aesGcmEncrypt(key, iv, innerCompressed);
  // Compact envelope v1 (encrypted): ['M','S', (ver<<4)|(flags4=1)], then salt(16)|iv(12)|ct
  const ver = 1;
  const flags4 = 0x1; // encrypted
  const header = new Uint8Array(["M".charCodeAt(0), "S".charCodeAt(0), ((ver & 0x0f) << 4) | (flags4 & 0x0f)]);
  const out = new Uint8Array(header.byteLength + salt.byteLength + iv.byteLength + ct.byteLength);
  out.set(header, 0);
  out.set(salt, header.byteLength + 0);
  out.set(iv, header.byteLength + salt.byteLength);
  out.set(ct, header.byteLength + salt.byteLength + iv.byteLength);
  const encoded = toBase80(out);
  return { encoded, byteLength: out.byteLength, payload, scaleExp };
};
 

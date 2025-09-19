import { deflate } from "pako";
import type { Molecule, StyleSettings } from "../chem/types";
import { toBase64Url } from "../util/base64url";
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
};

export type ShareEncodingResult = {
  encoded: string;
  byteLength: number;
  payload: SharePayload;
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

export const encodeShareData = ({
  molecule,
  style,
}: ShareInput): ShareEncodingResult => {
  // v4 ultra-compact format
  // magic 'QRM' + version 4
  const atoms = molecule.atoms;
  const bonds = molecule.bonds;
  const centred = centreAtoms(atoms);

  // Choose power-of-two global scale M = 2^e (e in 0..3) so that |x/M|*1000 fits in int16
  let maxAbs = 0;
  for (const a of centred) {
    maxAbs = Math.max(maxAbs, Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]));
  }
  const need = maxAbs / 32.767; // since 32767/1000 ≈ 32.767
  let e = 0;
  while (e < 3 && (1 << e) < need) e += 1;
  const M = 1 << e;

  // Build local dictionary of used species (dynamic), entries are 7-bit fixed codes
  const usedCodes: number[] = [];
  const codeIndex = new Map<number, number>();
  for (const a of centred) {
    const c = symbolToCode(a[0]);
    if (!codeIndex.has(c)) {
      codeIndex.set(c, usedCodes.length);
      usedCodes.push(c);
      if (usedCodes.length === 128) break;
    }
  }
  const U = usedCodes.length || 1;
  const idxBits = Math.max(1, ceilLog2(U));

  const atomCount = Math.min(centred.length, 1023);
  const bondCount = Math.min(bonds.length, 4095);
  const indexBits = Math.max(1, ceilLog2(atomCount));

  // style packing (more compact): mode 1b, atomScale 6b with step 0.02, bondRadius 6b with step 0.02, quality 2b
  const materialMap: Record<StyleSettings["material"], number> = {
    standard: 0,
    physical: 1,
    lambert: 2,
    toon: 3,
  };
  const material2 = materialMap[style.material] ?? 0;
  const atomScaleQ6 = Math.max(0, Math.min(63, Math.round(style.atomScale / 0.02)));
  const bondRadiusQ6 = Math.max(0, Math.min(63, Math.round(style.bondRadius / 0.02)));
  // 2-bit quality field: 0=low,1=medium,2=high,3=ultra
  const qualityMap: Record<StyleSettings["quality"], number> = { low: 0, medium: 1, high: 2, ultra: 3 };
  const quality2 = qualityMap[style.quality] ?? 2;

  const w = new BitWriter();
  // magic + version
  w.writeUnsigned("Q".charCodeAt(0), 8);
  w.writeUnsigned("R".charCodeAt(0), 8);
  w.writeUnsigned("M".charCodeAt(0), 8);
  w.writeUnsigned(4, 8);
  // counts + coord scale exponent
  w.writeUnsigned(atomCount, 10);
  w.writeUnsigned(bondCount, 12);
  w.writeUnsigned(e, 2);
  // style (material 2b)
  w.writeUnsigned(material2, 2);
  w.writeUnsigned(atomScaleQ6, 6);
  w.writeUnsigned(bondRadiusQ6, 6);
  w.writeUnsigned(quality2, 2);
  // delta flag (always 1 for now)
  w.writeUnsigned(1, 1);
  // dictionary size and entries
  w.writeUnsigned(U, 7);
  for (let i = 0; i < U; i += 1) w.writeUnsigned(usedCodes[i], 7);

  // atoms: symbol index + coords (first absolute, then deltas)
  let prevX = 0, prevY = 0, prevZ = 0;
  for (let i = 0; i < atomCount; i += 1) {
    const [sym, x, y, z] = centred[i];
    const code = symbolToCode(sym);
    const dictIndex = codeIndex.get(code)!;
    w.writeUnsigned(dictIndex, idxBits);
    const fx = Math.max(-32768, Math.min(32767, Math.round((x / M) * 1000)));
    const fy = Math.max(-32768, Math.min(32767, Math.round((y / M) * 1000)));
    const fz = Math.max(-32768, Math.min(32767, Math.round((z / M) * 1000)));
    if (i === 0) {
      w.writeSigned(fx, 16);
      w.writeSigned(fy, 16);
      w.writeSigned(fz, 16);
    } else {
      w.writeSigned(fx - prevX, 16);
      w.writeSigned(fy - prevY, 16);
      w.writeSigned(fz - prevZ, 16);
    }
    prevX = fx; prevY = fy; prevZ = fz;
  }

  // bonds: i, j with indexBits; order 2 bits
  for (let k = 0; k < bondCount; k += 1) {
    const b = bonds[k];
    const i = Math.max(0, Math.min(atomCount - 1, b.i));
    const j = Math.max(0, Math.min(atomCount - 1, b.j));
    const order = Math.max(1, Math.min(3, b.order));
    const ob = order === 1 ? 0b01 : order === 2 ? 0b10 : 0b11;
    w.writeUnsigned(i, indexBits);
    w.writeUnsigned(j, indexBits);
    w.writeUnsigned(ob, 2);
  }

  const binary = w.toUint8Array();
  const compressed = deflate(binary, { level: 9 });
  const encoded = toBase64Url(compressed);

  // Minimal v2-style payload for app state (not transmitted)
  const payload: SharePayload = {
    v: 2,
    atoms: centred,
    bonds: mapBonds(bonds),
    style: { ...style },
    meta: molecule.title ? { title: molecule.title } : undefined,
  };

  return { encoded, byteLength: compressed.byteLength, payload };
};

export const buildShareUrl = (_origin: string, encoded: string): string => {
  const base = SHARE_BASE_URL.replace(/\/$/, "");
  return `${base}/qr#${encoded}`;
};

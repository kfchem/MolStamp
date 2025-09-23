import { inflate } from "pako";
import type { Molecule, StyleSettings } from "../chem/types";
import { fromBase80 } from "../util/base80";
import type { ShareAtom, ShareBond, SharePayload, ShareStyle } from "./encode";
import { BitReader } from "./bitstream";
import { codeToSymbol } from "./codebook";
import { guessBonds } from "../chem/bondGuess";
import { aesGcmDecrypt, importKeyFromPasswordPBKDF2 } from "../util/crypto";

const isSharePayload = (value: unknown): value is SharePayload => {
  if (!value || typeof value !== "object") return false;
  return (value as { v?: number }).v === 2;
};

const toMolecule = (payload: SharePayload): Molecule => {
  const atoms = payload.atoms.map((atom: ShareAtom) => ({
    symbol: atom[0],
    x: atom[1],
    y: atom[2],
    z: atom[3],
    ...(typeof atom[4] === "number" ? { charge: atom[4] } : {}),
  }));

  const bonds = payload.bonds.map((bond: ShareBond) => ({
    i: bond[0],
    j: bond[1],
    order: (bond[2] as 1 | 2 | 3) ?? 1,
  }));

  return {
    atoms,
    bonds,
    title: payload.meta?.title,
  };
};

export type DecodedShare = {
  payload: SharePayload;
  molecule: Molecule;
  style: ShareStyle;
};

export const decodeShareSegment = (segment: string): DecodedShare => {
  let bytes: Uint8Array;
  try { bytes = fromBase80(segment); } catch { throw new Error("Invalid Base80 segment"); }

  // Check compact MTG envelope v1: ['M','T','G', (ver<<4)|(flags)]
  if (bytes.byteLength >= 4) {
    const magic3 = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    const vflags = bytes[3];
    const ver = (vflags >>> 4) & 0x0f;
    const flags = vflags & 0x0f;
    if (magic3 === "MTG" && ver === 1) {
      const enc = (flags & 0x01) !== 0;
      if (!enc) {
        // Unencrypted: inflate body after header (4 bytes)
        const raw = inflate(bytes.subarray(4));
        const u8 = new Uint8Array(raw);
        const r = new BitReader(u8);
        const atomCount = r.readUnsigned(10);
        const bondCount = r.readUnsigned(12);
        const e = r.readUnsigned(2);
        const coordBits = 8 + r.readUnsigned(4);
        const material2 = r.readUnsigned(2);
        const atomScaleQ6 = r.readUnsigned(6);
        const bondRadiusQ6 = r.readUnsigned(6);
        const quality2 = r.readUnsigned(2);
        const deltaFlag = r.readUnsigned(1);
        const omitBondsFlag = r.readUnsigned(1);
        const U = r.readUnsigned(7);
        const dict: number[] = [];
        for (let i = 0; i < U; i += 1) dict.push(r.readUnsigned(7));
        const idxBits = Math.max(1, Math.ceil(Math.log2(Math.max(1, U))));
        const indexBits = Math.max(1, Math.ceil(Math.log2(Math.max(1, atomCount))));
        const M = 1 << e;

        // Optional title
        let title: string | undefined;
        try {
          const flag = r.readUnsigned(1);
          if (flag === 1) {
            const len = r.readUnsigned(6);
            const alphabet = (() => {
              const arr: string[] = [' ', '-'];
              for (let i = 0; i < 10; i++) arr.push(String(i));
              for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(65 + i));
              for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(97 + i));
              return arr;
            })();
            const chars: string[] = [];
            for (let i = 0; i < len; i++) chars.push(alphabet[r.readUnsigned(6)] ?? '-');
            title = chars.join("").trim();
          }
        } catch {}

        const atoms: ShareAtom[] = [];
        let px = 0, py = 0, pz = 0;
        for (let i = 0; i < atomCount; i += 1) {
          const di = r.readUnsigned(idxBits);
          const code = dict[di] ?? 6;
          const dx = r.readSigned(coordBits);
          const dy = r.readSigned(coordBits);
          const dz = r.readSigned(coordBits);
          if (i === 0 || deltaFlag === 0) { px = dx; py = dy; pz = dz; } else { px += dx; py += dy; pz += dz; }
          atoms.push([
            codeToSymbol(code),
            (px / 1000) * M,
            (py / 1000) * M,
            (pz / 1000) * M,
          ]);
        }

        let bonds: ShareBond[] = [];
        if (omitBondsFlag === 1) {
          const inferred = guessBonds(atoms.map((a) => ({ symbol: a[0], x: a[1], y: a[2], z: a[3] })));
          bonds = inferred.map((b) => [b.i, b.j, b.order]);
        } else {
          for (let k = 0; k < bondCount; k += 1) {
            const i = r.readUnsigned(indexBits);
            const j = r.readUnsigned(indexBits);
            const ob = r.readUnsigned(2);
            const order = ob === 0b01 ? 1 : ob === 0b10 ? 2 : 3;
            bonds.push([i, j, order]);
          }
        }

        const materialMap: Record<number, StyleSettings["material"]> = { 0: "standard", 1: "metal", 2: "toon", 3: "glass" };
        const style: ShareStyle = {
          material: materialMap[material2] ?? "standard",
          atomScale: atomScaleQ6 * 0.02,
          bondRadius: bondRadiusQ6 * 0.02,
          quality: (quality2 === 0 ? "low" : quality2 === 1 ? "medium" : quality2 === 2 ? "high" : "ultra") as ShareStyle["quality"],
        } as ShareStyle;
        const payload: SharePayload = { v: 2, atoms, bonds, style, meta: title ? { title } : undefined };
        return { payload, molecule: toMolecule(payload), style };
      } else {
        throw new Error("Encrypted MTG segment: password required");
      }
    }
  }
  throw new Error("Unsupported segment: MTG v1 only");
};

export const decodeShareSegmentEncrypted = async (
  segment: string,
  password: string,
): Promise<DecodedShare> => {
  let bytes: Uint8Array;
  try { bytes = fromBase80(segment); } catch { throw new Error("Invalid Base80 segment"); }
  if (bytes.byteLength < 4) throw new Error("Invalid segment");
  const magic3 = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  const vflags = bytes[3];
  const ver = (vflags >>> 4) & 0x0f;
  const flags = vflags & 0x0f;
  if (magic3 !== "MTG" || ver !== 1 || (flags & 0x01) === 0) {
    throw new Error("Not an encrypted MT v1 segment");
  }
  if (bytes.byteLength < 4 + 16 + 12 + 16) {
    throw new Error("Encrypted segment too short");
  }
  const salt = bytes.subarray(4, 4 + 16);
  const iv = bytes.subarray(4 + 16, 4 + 16 + 12);
  const ct = bytes.subarray(4 + 16 + 12);
  const iterations = 100000;
  const key = await importKeyFromPasswordPBKDF2(password, salt, iterations);
  let plain: Uint8Array;
  try {
    plain = await aesGcmDecrypt(key, iv, ct);
  } catch (e) {
    const err = e as Error;
    if (err && err.name === 'OperationError') {
      throw new Error("Wrong password or data corrupted");
    }
    throw err;
  }
  const inflated = inflate(plain);
  const u8 = new Uint8Array(inflated);
  const r = new BitReader(u8);
  const atomCount = r.readUnsigned(10);
  const bondCount = r.readUnsigned(12);
  const e = r.readUnsigned(2);
  const coordBits = 8 + r.readUnsigned(4);
  const material2 = r.readUnsigned(2);
  const atomScaleQ6 = r.readUnsigned(6);
  const bondRadiusQ6 = r.readUnsigned(6);
  const quality2 = r.readUnsigned(2);
  const deltaFlag = r.readUnsigned(1);
  const omitBondsFlag = r.readUnsigned(1);
  const U = r.readUnsigned(7);
  const dict: number[] = [];
  for (let i = 0; i < U; i += 1) dict.push(r.readUnsigned(7));
  const idxBits = Math.max(1, Math.ceil(Math.log2(Math.max(1, U))));
  const indexBits = Math.max(1, Math.ceil(Math.log2(Math.max(1, atomCount))));
  const M = 1 << e;

  // Optional title
  let title: string | undefined;
  try {
    const flag = r.readUnsigned(1);
    if (flag === 1) {
      const len = r.readUnsigned(6);
      const alphabet = (() => {
        const arr: string[] = [' ', '-'];
        for (let i = 0; i < 10; i++) arr.push(String(i));
        for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(65 + i));
        for (let i = 0; i < 26; i++) arr.push(String.fromCharCode(97 + i));
        return arr;
      })();
      const chars: string[] = [];
      for (let i = 0; i < len; i++) chars.push(alphabet[r.readUnsigned(6)] ?? '-');
      title = chars.join("").trim();
    }
  } catch {}

  const atoms: ShareAtom[] = [];
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < atomCount; i += 1) {
    const di = r.readUnsigned(idxBits);
    const code = dict[di] ?? 6;
    const dx = r.readSigned(coordBits);
    const dy = r.readSigned(coordBits);
    const dz = r.readSigned(coordBits);
    if (i === 0 || deltaFlag === 0) { px = dx; py = dy; pz = dz; } else { px += dx; py += dy; pz += dz; }
    atoms.push([
      codeToSymbol(code),
      (px / 1000) * M,
      (py / 1000) * M,
      (pz / 1000) * M,
    ]);
  }

  let bonds: ShareBond[] = [];
  if (omitBondsFlag === 1) {
    const inferred = guessBonds(atoms.map((a) => ({ symbol: a[0], x: a[1], y: a[2], z: a[3] })));
    bonds = inferred.map((b) => [b.i, b.j, b.order]);
  } else {
    for (let k = 0; k < bondCount; k += 1) {
      const i = r.readUnsigned(indexBits);
      const j = r.readUnsigned(indexBits);
      const ob = r.readUnsigned(2);
      const order = ob === 0b01 ? 1 : ob === 0b10 ? 2 : 3;
      bonds.push([i, j, order]);
    }
  }

  const materialMap: Record<number, StyleSettings["material"]> = { 0: "standard", 1: "metal", 2: "toon", 3: "glass" };
  const style: ShareStyle = {
    material: materialMap[material2] ?? "standard",
    atomScale: atomScaleQ6 * 0.02,
    bondRadius: bondRadiusQ6 * 0.02,
    quality: (quality2 === 0 ? "low" : quality2 === 1 ? "medium" : quality2 === 2 ? "high" : "ultra") as ShareStyle["quality"],
  } as ShareStyle;
  const payload: SharePayload = { v: 2, atoms, bonds, style, meta: title ? { title } : undefined };
  return { payload, molecule: toMolecule(payload), style };
};

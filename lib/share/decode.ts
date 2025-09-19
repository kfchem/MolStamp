import { inflate } from "pako";
import type { Molecule, StyleSettings } from "../chem/types";
import { fromBase64Url } from "../util/base64url";
import type { ShareAtom, ShareBond, SharePayload, ShareStyle } from "./encode";
import { BitReader } from "./bitstream";
import { codeToSymbol, codeToSymbolLegacy } from "./codebook";

const decoder = new TextDecoder();

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
  const raw = inflate(fromBase64Url(segment));
  // Try binary v4/v3 first: needs at least 4 bytes for magic+version
  if (raw.byteLength >= 4) {
    const u8 = new Uint8Array(raw);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2]);
    const version = u8[3];
  if (magic === "QRM" && version === 4) {
      const r = new BitReader(u8.subarray(4));
  const atomCount = r.readUnsigned(10);
  const bondCount = r.readUnsigned(12);
  const e = r.readUnsigned(2);
  const material2 = r.readUnsigned(2);
      const atomScaleQ6 = r.readUnsigned(6);
      const bondRadiusQ6 = r.readUnsigned(6);
      const quality2 = r.readUnsigned(2);
      const deltaFlag = r.readUnsigned(1); // currently 1
      const U = r.readUnsigned(7);
      const dict: number[] = [];
      for (let i = 0; i < U; i += 1) dict.push(r.readUnsigned(7));
      const idxBits = Math.max(1, Math.ceil(Math.log2(Math.max(1, U))));
      const indexBits = Math.max(1, Math.ceil(Math.log2(Math.max(1, atomCount))));
      const M = 1 << e;

      const atoms: ShareAtom[] = [];
      let px = 0, py = 0, pz = 0;
      for (let i = 0; i < atomCount; i += 1) {
        const di = r.readUnsigned(idxBits);
  const code = dict[di] ?? 6; // Z=6 (C) fallback
        const dx = r.readSigned(16);
        const dy = r.readSigned(16);
        const dz = r.readSigned(16);
        if (i === 0 || deltaFlag === 0) {
          px = dx; py = dy; pz = dz;
        } else {
          px += dx; py += dy; pz += dz;
        }
        atoms.push([
          codeToSymbol(code),
          (px / 1000) * M,
          (py / 1000) * M,
          (pz / 1000) * M,
        ]);
      }

      const bonds: ShareBond[] = [];
      for (let k = 0; k < bondCount; k += 1) {
        const i = r.readUnsigned(indexBits);
        const j = r.readUnsigned(indexBits);
        const ob = r.readUnsigned(2);
        const order = ob === 0b01 ? 1 : ob === 0b10 ? 2 : 3;
        bonds.push([i, j, order]);
      }

      const materialMap: Record<number, StyleSettings["material"]> = {
        0: "standard",
        1: "physical",
        2: "lambert",
        3: "toon",
      };
      const style: ShareStyle = {
        material: materialMap[material2] ?? "standard",
        atomScale: atomScaleQ6 * 0.02,
        bondRadius: bondRadiusQ6 * 0.02,
        quality: (quality2 === 0 ? "low" : quality2 === 1 ? "medium" : quality2 === 2 ? "high" : "ultra") as ShareStyle["quality"],
      } as ShareStyle;

      const payload: SharePayload = { v: 2, atoms, bonds, style };
      return { payload, molecule: toMolecule(payload), style };
    }
  if (magic === "QRM" && version === 3) {
      const r = new BitReader(u8.subarray(4));
      const atomCount = r.readUnsigned(10);
      const bondCount = r.readUnsigned(12);
  const modeBit = r.readUnsigned(1);
      const atomScaleQ = r.readUnsigned(8);
      const bondRadiusQ = r.readUnsigned(8);
      const quality2 = r.readUnsigned(2);

      const atoms: ShareAtom[] = [];
      for (let i = 0; i < atomCount; i += 1) {
  const code = r.readUnsigned(7);
        const fx = r.readSigned(18);
        const fy = r.readSigned(18);
        const fz = r.readSigned(18);
        atoms.push([
          codeToSymbolLegacy(code),
          fx / 1000,
          fy / 1000,
          fz / 1000,
        ]);
      }

      const bonds: ShareBond[] = [];
      for (let k = 0; k < bondCount; k += 1) {
        const i = r.readUnsigned(10);
        const j = r.readUnsigned(10);
        const ob = r.readUnsigned(2);
        const order = ob === 0b01 ? 1 : ob === 0b10 ? 2 : 3;
        bonds.push([i, j, order]);
      }

      const style: ShareStyle = {
        // v3にはmaterial概念がないため標準に固定
        material: "standard",
        atomScale: atomScaleQ / 100,
        bondRadius: bondRadiusQ / 100,
        quality: (quality2 === 0 ? "low" : quality2 === 2 ? "high" : "medium") as ShareStyle["quality"],
      } as ShareStyle;

      const payload: SharePayload = {
        v: 2,
        atoms,
        bonds,
        style,
      };
      return { payload, molecule: toMolecule(payload), style };
    }
  }

  // Fallback to JSON v2
  const json = decoder.decode(raw);
  const parsed = JSON.parse(json) as SharePayload;
  if (!isSharePayload(parsed)) {
    throw new Error("Unsupported share payload format");
  }
  return { payload: parsed, molecule: toMolecule(parsed), style: parsed.style };
};

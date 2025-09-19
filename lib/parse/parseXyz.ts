import { Molecule } from "../chem/types";
import { guessBonds } from "../chem/bondGuess";
import { normaliseLineEndings } from "../util/file";

export const parseXyz = (input: string): Molecule => {
  const normalized = normaliseLineEndings(input).trim();
  const lines = normalized.split(/\n+/);

  if (lines.length < 2) {
    throw new Error("Malformed XYZ: insufficient lines");
  }

  const atomCount = Number.parseInt(lines[0].trim(), 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) {
    throw new Error("Malformed XYZ: invalid atom count");
  }

  const titleLine = lines[1]?.trim();
  const atoms = [];
  for (let i = 0; i < atomCount; i += 1) {
    const line = lines[2 + i];
    if (!line) {
      throw new Error("Malformed XYZ: missing atom line");
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) {
      throw new Error(`Malformed XYZ: invalid atom line at index ${i}`);
    }
    const symbol = tokens[0];
    const x = Number.parseFloat(tokens[1]);
    const y = Number.parseFloat(tokens[2]);
    const z = Number.parseFloat(tokens[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Malformed XYZ: invalid coordinates at index ${i}`);
    }
    atoms.push({ symbol, x, y, z });
  }

  const bonds = guessBonds(atoms);

  return {
    title: titleLine || undefined,
    atoms,
    bonds,
  };
};

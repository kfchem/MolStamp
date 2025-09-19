import { Molecule, Atom, Bond } from "../chem/types";
import { normaliseLineEndings } from "../util/file";

const CHARGE_MAP: Record<number, number> = {
  1: 3,
  2: 2,
  3: 1,
  5: -1,
  6: -2,
  7: -3,
};

const parseBondOrder = (raw: number): 1 | 2 | 3 => {
  if (raw === 2) return 2;
  if (raw === 3) return 3;
  return 1;
};

const parseV2000 = (lines: string[]): { atoms: Atom[]; bonds: Bond[] } => {
  const countsLine = lines[3]?.trim();
  if (!countsLine) {
    throw new Error("Malformed SDF: missing counts line");
  }
  const countTokens = countsLine.split(/\s+/).filter(Boolean);
  const atomCount = Number.parseInt(countTokens[0] ?? "0", 10);
  const bondCount = Number.parseInt(countTokens[1] ?? "0", 10);

  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) {
    throw new Error("Malformed SDF: invalid atom/bond counts");
  }

  const atoms: Atom[] = [];
  for (let i = 0; i < atomCount; i += 1) {
    const line = lines[4 + i];
    if (!line) {
      throw new Error("Malformed SDF: incomplete atom block");
    }

    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) {
      throw new Error(`Malformed SDF atom line at index ${i}`);
    }

    const x = Number.parseFloat(tokens[0]);
    const y = Number.parseFloat(tokens[1]);
    const z = Number.parseFloat(tokens[2]);
    const symbol = tokens[3];

    const chargeCode = tokens[5] ? Number.parseInt(tokens[5], 10) : 0;

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Malformed SDF atom coordinates at index ${i}`);
    }

    const atom: Atom = {
      symbol,
      x,
      y,
      z,
    };

    if (chargeCode && CHARGE_MAP[chargeCode]) {
      atom.charge = CHARGE_MAP[chargeCode];
    }

    atoms.push(atom);
  }

  const bonds: Bond[] = [];
  const bondStart = 4 + atomCount;
  for (let i = 0; i < bondCount; i += 1) {
    const line = lines[bondStart + i];
    if (!line) {
      throw new Error("Malformed SDF: incomplete bond block");
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 3) {
      throw new Error(`Malformed SDF bond line at index ${i}`);
    }
    const from = Number.parseInt(tokens[0], 10) - 1;
    const to = Number.parseInt(tokens[1], 10) - 1;
    const orderRaw = Number.parseInt(tokens[2], 10);

    if (Number.isNaN(from) || Number.isNaN(to)) {
      throw new Error(`Malformed SDF bond indices at index ${i}`);
    }

    bonds.push({
      i: from,
      j: to,
      order: parseBondOrder(orderRaw),
    });
  }

  for (let idx = bondStart + bondCount; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (!line) continue;
    if (line.startsWith("M  CHG")) {
      const tokens = line.trim().split(/\s+/);
      const n = Number.parseInt(tokens[2] ?? "0", 10);
      for (let k = 0; k < n; k += 1) {
        const atomIndex = Number.parseInt(tokens[3 + k * 2], 10) - 1;
        const charge = Number.parseInt(tokens[4 + k * 2], 10);
        if (atoms[atomIndex]) {
          atoms[atomIndex].charge = charge;
        }
      }
    }
  }

  return { atoms, bonds };
};

const parseV3000 = (lines: string[]): { atoms: Atom[]; bonds: Bond[] } => {
  const atoms: (Atom | undefined)[] = [];
  const bonds: Bond[] = [];
  let mode: "atom" | "bond" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("M  V30")) continue;
    const payload = trimmed.substring(6).trim();

    if (payload.startsWith("BEGIN ATOM")) {
      mode = "atom";
      continue;
    }
    if (payload.startsWith("END ATOM")) {
      mode = null;
      continue;
    }
    if (payload.startsWith("BEGIN BOND")) {
      mode = "bond";
      continue;
    }
    if (payload.startsWith("END BOND")) {
      mode = null;
      continue;
    }

    if (mode === "atom") {
      const tokens = payload.split(/\s+/);
      if (tokens.length < 5) {
        continue;
      }
      const index = Number.parseInt(tokens[0], 10) - 1;
      const symbol = tokens[1];
      const x = Number.parseFloat(tokens[2]);
      const y = Number.parseFloat(tokens[3]);
      const z = Number.parseFloat(tokens[4]);
      let charge: number | undefined;
      for (const token of tokens.slice(5)) {
        if (token.startsWith("CHG=") || token.startsWith("CHARGE=")) {
          const [, value] = token.split("=");
          charge = Number.parseInt(value ?? "0", 10);
        }
      }
      atoms[index] = {
        symbol,
        x,
        y,
        z,
        ...(charge !== undefined ? { charge } : {}),
      };
    }

    if (mode === "bond") {
      const tokens = payload.split(/\s+/);
      if (tokens.length < 4) {
        continue;
      }
      const orderCode = Number.parseInt(tokens[1], 10);
      const from = Number.parseInt(tokens[2], 10) - 1;
      const to = Number.parseInt(tokens[3], 10) - 1;
      bonds.push({
        i: from,
        j: to,
        order: parseBondOrder(orderCode),
      });
    }
  }

  const materializedAtoms: Atom[] = atoms.map((atom, idx) => {
    if (!atom) {
      throw new Error(`Malformed SDF V3000: missing atom ${idx + 1}`);
    }
    return atom;
  });

  return {
    atoms: materializedAtoms,
    bonds,
  };
};

export const parseSdf = (input: string): Molecule => {
  const normalized = normaliseLineEndings(input);
  const sections = normalized.split("$$$$");
  const block = sections[0];
  if (!block) {
    throw new Error("Empty SDF payload");
  }
  const lines = block.split("\n");
  const title = lines[0]?.trim() || undefined;

  const isV3000 = lines.some((line) => line.includes("V3000"));

  const { atoms, bonds } = isV3000 ? parseV3000(lines) : parseV2000(lines);

  if (!atoms.length) {
    throw new Error("Parsed SDF contains no atoms");
  }

  return {
    atoms,
    bonds,
    title,
  };
};

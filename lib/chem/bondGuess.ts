import { getRadius } from "./atomUtils";
import { Atom, Bond } from "./types";

const MIN_DISTANCE = 0.4;
const DEFAULT_TOLERANCE = 0.45;
const DEFAULT_RADIUS = 0.8;
const DEFAULT_VALENCE = 4;

const MAX_VALENCE: Record<string, number> = {
  H: 1,
  B: 3,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  Si: 4,
  P: 5,
  S: 6,
  Cl: 1,
  Br: 1,
  I: 1,
  Na: 1,
  Mg: 2,
  Fe: 6,
  Cu: 4,
  Zn: 2,
  Se: 2,
  Li: 1,
  K: 1,
};

const normaliseSymbol = (symbol: string): string => {
  if (!symbol) return symbol;
  if (symbol.length === 1) {
    return symbol.toUpperCase();
  }
  return `${symbol[0].toUpperCase()}${symbol.slice(1).toLowerCase()}`;
};

const getCovalentRadius = (symbol: string): number => {
  const radius = getRadius(normaliseSymbol(symbol), "single");
  return radius ?? DEFAULT_RADIUS;
};

const getValence = (symbol: string): number => {
  const normalised = normaliseSymbol(symbol);
  return MAX_VALENCE[normalised] ?? DEFAULT_VALENCE;
};

const squaredDistance = (a: Atom, b: Atom): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

export type BondGuessOptions = {
  tolerance?: number;
};

export const guessBonds = (
  atoms: Atom[],
  options: BondGuessOptions = {},
): Bond[] => {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const candidateBonds: Array<{ i: number; j: number; distance: number }> = [];

  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const atomA = atoms[i];
      const atomB = atoms[j];
      const radiusSum =
        getCovalentRadius(atomA.symbol) +
        getCovalentRadius(atomB.symbol) +
        tolerance;
      const distSq = squaredDistance(atomA, atomB);
      const dist = Math.sqrt(distSq);

      if (dist <= radiusSum && dist > MIN_DISTANCE) {
        candidateBonds.push({ i, j, distance: dist });
      }
    }
  }

  candidateBonds.sort((a, b) => a.distance - b.distance);

  const currentValence = new Array(atoms.length).fill(0);
  const result: Bond[] = [];

  for (const bond of candidateBonds) {
    const { i, j } = bond;
    const maxValenceI = getValence(atoms[i].symbol);
    const maxValenceJ = getValence(atoms[j].symbol);

    if (currentValence[i] >= maxValenceI || currentValence[j] >= maxValenceJ) {
      continue;
    }

    result.push({ i, j, order: 1 });
    currentValence[i] += 1;
    currentValence[j] += 1;
  }

  return result;
};

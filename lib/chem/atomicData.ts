const ATOMIC_DATA = {
  H: { covalentRadius: 0.31, cpkColor: "#ffffff" },
  B: { covalentRadius: 0.85, cpkColor: "#ffb5b5" },
  C: { covalentRadius: 0.76, cpkColor: "#909090" },
  N: { covalentRadius: 0.71, cpkColor: "#3050f8" },
  O: { covalentRadius: 0.66, cpkColor: "#ff0d0d" },
  F: { covalentRadius: 0.57, cpkColor: "#90e050" },
  Si: { covalentRadius: 1.11, cpkColor: "#f0c8a0" },
  P: { covalentRadius: 1.07, cpkColor: "#ff8000" },
  S: { covalentRadius: 1.05, cpkColor: "#ffff30" },
  Cl: { covalentRadius: 1.02, cpkColor: "#1ff01f" },
  Br: { covalentRadius: 1.2, cpkColor: "#a62929" },
  I: { covalentRadius: 1.39, cpkColor: "#940094" },
  Na: { covalentRadius: 1.66, cpkColor: "#ab5cf2" },
  Mg: { covalentRadius: 1.41, cpkColor: "#8aff00" },
  Fe: { covalentRadius: 1.26, cpkColor: "#e06633" },
  Cu: { covalentRadius: 1.32, cpkColor: "#c88033" },
  Zn: { covalentRadius: 1.22, cpkColor: "#7d80b0" },
} as const;

const DEFAULT_COLOR = "#7f7f7f";
const DEFAULT_RADIUS = 0.8;

const normaliseSymbol = (
  symbol: string,
): keyof typeof ATOMIC_DATA | undefined => {
  if (!symbol) return undefined;
  const upper = symbol.toUpperCase();
  if (upper.length === 1) {
    return upper as keyof typeof ATOMIC_DATA;
  }
  const normalised =
    `${upper[0]}${upper.slice(1).toLowerCase()}` as keyof typeof ATOMIC_DATA;
  if (normalised in ATOMIC_DATA) {
    return normalised;
  }
  if (upper in ATOMIC_DATA) {
    return upper as keyof typeof ATOMIC_DATA;
  }
  return undefined;
};

export const getCovalentRadius = (symbol: string): number => {
  const key = normaliseSymbol(symbol);
  if (!key) return DEFAULT_RADIUS;
  return ATOMIC_DATA[key]?.covalentRadius ?? DEFAULT_RADIUS;
};

export const getCpkColor = (symbol: string): string => {
  const key = normaliseSymbol(symbol);
  if (!key) return DEFAULT_COLOR;
  return ATOMIC_DATA[key]?.cpkColor ?? DEFAULT_COLOR;
};

export const listAtomicData = () =>
  Object.entries(ATOMIC_DATA).map(([symbol, data]) => ({
    symbol,
    ...data,
  }));

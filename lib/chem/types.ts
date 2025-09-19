export type Atom = {
  symbol: string;
  x: number;
  y: number;
  z: number;
  charge?: number;
};

export type Bond = {
  i: number;
  j: number;
  order: 1 | 2 | 3;
};

export type Molecule = {
  atoms: Atom[];
  bonds: Bond[];
  title?: string;
};

export type StyleSettings = {
  material: "standard" | "physical" | "lambert" | "toon";
  atomScale: number;
  bondRadius: number;
  quality: "low" | "medium" | "high" | "ultra";
};

export type MoleculeFormat = "sdf" | "xyz";

export type QualityPreset = StyleSettings["quality"];

import { encodeShareData } from "../lib/share/encode";
import { decodeShareSegment } from "../lib/share/decode";

(async () => {
  const mol = {
    atoms: [
      { symbol: 'C', x: 0, y: 0, z: 0 },
      { symbol: 'O', x: 1.2, y: 0, z: 0 },
    ],
    bonds: [ { i: 0, j: 1, order: 2 } ],
  };
  const style = { material: 'standard', atomScale: 0.6, bondRadius: 0.12, quality: 'high' } as const;
  const res = encodeShareData({ molecule: mol as any, style: style as any, precisionDrop: 0 });
  const seg = res.encoded;
  const dec = decodeShareSegment(seg);
  const out = { segLen: seg.length, byteLen: res.byteLength, atoms: dec.molecule.atoms.length, bonds: dec.molecule.bonds.length, style: dec.style.material, scaleExp: res.scaleExp };
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });

import { encodeShareDataEncrypted } from "../lib/share/encode";
import { decodeShareSegmentEncrypted } from "../lib/share/decode";

(async () => {
  const mol = {
    atoms: [
      { symbol: 'C', x: 0, y: 0, z: 0 },
      { symbol: 'O', x: 1.2, y: 0, z: 0 },
    ],
    bonds: [ { i: 0, j: 1, order: 2 } ],
  };
  const style = { material: 'standard', atomScale: 0.6, bondRadius: 0.12, quality: 'high' } as const;
  const password = process.env.MOLSTAMP_SMOKE_PW || 'testpw';
  const res = await encodeShareDataEncrypted({ molecule: mol as any, style: style as any, precisionDrop: 0, password });
  const seg = res.encoded;
  const dec = await decodeShareSegmentEncrypted(seg, password);
  const out = { segLen: seg.length, byteLen: res.byteLength, atoms: dec.molecule.atoms.length, bonds: dec.molecule.bonds.length, style: dec.style.material, scaleExp: res.scaleExp, enc: true };
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });

import * as THREE from "three";
import { Molecule, StyleSettings } from "../chem/types";
import { getVdwRadius, getColor } from "../chem/atomUtils";

const QUALITY_SEGMENTS = {
  low: { sphereWidth: 8, sphereHeight: 8, cylinder: 6 },
  medium: { sphereWidth: 16, sphereHeight: 16, cylinder: 12 },
  high: { sphereWidth: 24, sphereHeight: 24, cylinder: 16 },
  ultra: { sphereWidth: 32, sphereHeight: 32, cylinder: 24 },
} as const;

export type MoleculeMesh = {
  group: THREE.Group;
  dispose: () => void;
};

const axisY = new THREE.Vector3(0, 1, 0);
const position = new THREE.Vector3();
const target = new THREE.Vector3();
const scale = new THREE.Vector3();
const midpoint = new THREE.Vector3();
const direction = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const matrix = new THREE.Matrix4();
const atomColor = new THREE.Color();

export const buildMoleculeMesh = (
  molecule: Molecule,
  style: StyleSettings,
): MoleculeMesh => {
  const { atoms, bonds } = molecule;
  const segments = QUALITY_SEGMENTS[style.quality];
  const group = new THREE.Group();
  const instancedMeshes: THREE.InstancedMesh[] = [];

  // Material factory by style.material
  const createAtomMaterial = () => {
    switch (style.material) {
      case "metal":
        // 強い金属感 + 明るさ（環境マップ無しでも暗くなりすぎない）
        return new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 0.5,
          roughness: 0.25,
          clearcoat: 0.4,
          clearcoatRoughness: 0.1,
        });
      case "toon":
        // くっきりした陰影
        return new THREE.MeshToonMaterial({ color: 0xffffff });
      case "glass":
        // 透過 + 物質感（減衰と厚みでボリュームを出す）
        return new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 0.0,
          roughness: 0.06,
          transmission: 1.0,
          thickness: 2.0,
          attenuationDistance: 0.8,
          attenuationColor: new THREE.Color(0xeaf2ff),
          ior: 1.5,
          transparent: true,
          opacity: 0.65,
          depthWrite: true,
          side: THREE.FrontSide,
        });
      case "standard":
      default:
        // 標準: ややマット
        return new THREE.MeshStandardMaterial({
          color: 0xffffff,
          metalness: 0.05,
          roughness: 0.6,
        });
    }
  };
  const createBondMaterial = () => {
    switch (style.material) {
      case "metal":
        return new THREE.MeshPhysicalMaterial({
          color: 0xe9ecef,
          metalness: 0.5,
          roughness: 0.28,
          clearcoat: 0.35,
          clearcoatRoughness: 0.1,
        });
      case "toon":
        return new THREE.MeshToonMaterial({ color: 0xe9ecef });
      case "glass":
        return new THREE.MeshPhysicalMaterial({
          color: 0xe9ecef,
          metalness: 0.0,
          roughness: 0.08,
          transmission: 1.0,
          thickness: 2.0,
          attenuationDistance: 0.8,
          attenuationColor: new THREE.Color(0xeaf2ff),
          ior: 1.5,
          transparent: true,
          opacity: 0.7,
          depthWrite: true, // キャップが透けて見えないように
          side: THREE.FrontSide,
        });
      case "standard":
      default:
        return new THREE.MeshStandardMaterial({
          color: 0xe9ecef,
          metalness: 0.05,
          roughness: 0.45,
        });
    }
  };

  // Atoms (skip entirely if atomScale = 0)
  if (style.atomScale > 0) {
    const atomGeometry = new THREE.SphereGeometry(
    1,
    segments.sphereWidth,
    segments.sphereHeight,
    );
    const atomMaterial = createAtomMaterial();

    const atomMesh = new THREE.InstancedMesh(
      atomGeometry,
      atomMaterial,
      atoms.length,
    );

    atoms.forEach((atom, index) => {
      const radiusBase = getVdwRadius(atom.symbol) ?? 1.5;
      const radius = radiusBase * style.atomScale;

      position.set(atom.x, atom.y, atom.z);
      quaternion.identity();
      scale.set(radius, radius, radius);

      matrix.compose(position, quaternion, scale);
      atomMesh.setMatrixAt(index, matrix);

  atomColor.set(getColor(atom.symbol));
      atomMesh.setColorAt(index, atomColor);
    });
    atomMesh.instanceMatrix.needsUpdate = true;
    if (atomMesh.instanceColor) atomMesh.instanceColor.needsUpdate = true;
    group.add(atomMesh);
    instancedMeshes.push(atomMesh);
  }

  // Bonds: render as two half-cylinders that stop at atom surfaces
  if (bonds.length > 0 && style.bondRadius > 0) {
    // Cylinder of unit height centered at origin, oriented along +Y.
    const bondGeometry = new THREE.CylinderGeometry(
      1,
      1,
      1,
      segments.cylinder,
      1,
      false,
    );
    const bondMaterial = createBondMaterial();

    // Allocate up to 2 instances per bond; we'll set the actual count after placement
    const bondMesh = new THREE.InstancedMesh(
      bondGeometry,
      bondMaterial,
      bonds.length * 2,
    );

    let instanceIndex = 0;
    bonds.forEach((bond) => {
      const a = atoms[bond.i];
      const b = atoms[bond.j];
      if (!a || !b) return;

      position.set(a.x, a.y, a.z);
      target.set(b.x, b.y, b.z);
      direction.subVectors(target, position);
      const fullLength = direction.length();
      if (fullLength === 0) return;

    const dirNorm = direction.clone().normalize();
    const rA = (getVdwRadius(a.symbol) ?? 1.5) * style.atomScale;
    const rB = (getVdwRadius(b.symbol) ?? 1.5) * style.atomScale;
    // Slightly overlap bonds into atoms to avoid tiny visual gaps due to precision/shading
    const capInset = Math.min(0.06, Math.max(0.02, style.bondRadius * 0.75));
    const rAe = Math.max(0, rA - capInset);
    const rBe = Math.max(0, rB - capInset);
    const innerLength = fullLength - (rAe + rBe);

      // If atoms overlap or touch, skip rendering this bond
      if (innerLength <= 1e-3) return;

  const halfSpan = innerLength * 0.5; // total length of each half cylinder
      const halfHalf = halfSpan * 0.5; // distance from center of half cylinder to its end
      quaternion.setFromUnitVectors(axisY, dirNorm);

      // Half from A side: center at rA + quarter of inner length
      const centerA = new THREE.Vector3()
        .copy(position)
        .addScaledVector(dirNorm, rAe + halfHalf);
      scale.set(style.bondRadius, halfSpan, style.bondRadius);
      matrix.compose(centerA, quaternion, scale);
      bondMesh.setMatrixAt(instanceIndex++, matrix);

      // Half from B side: center at rB + quarter of inner length from B
      const centerB = new THREE.Vector3()
        .copy(target)
        .addScaledVector(dirNorm, -rBe - halfHalf);
      matrix.compose(centerB, quaternion, scale);
      bondMesh.setMatrixAt(instanceIndex++, matrix);
    });

    // Update the actual instance count to what we used
    bondMesh.count = instanceIndex;
    bondMesh.instanceMatrix.needsUpdate = true;
    group.add(bondMesh);
    instancedMeshes.push(bondMesh);
  }

  const dispose = () => {
    instancedMeshes.forEach((mesh) => {
      mesh.dispose();
    });
  };

  return {
    group,
    dispose,
  };
};

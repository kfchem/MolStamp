import * as THREE from "three";

const matrix = new THREE.Matrix4();
const color = new THREE.Color();

const convertInstancedMesh = (instanced: THREE.InstancedMesh) => {
  const group = new THREE.Group();
  group.name = instanced.name || "instanced";

  const baseMaterial = instanced.material;

  for (let index = 0; index < instanced.count; index += 1) {
    instanced.getMatrixAt(index, matrix);
    if (instanced.instanceColor) {
      instanced.getColorAt(index, color);
    } else if (!Array.isArray(baseMaterial) && "color" in baseMaterial) {
      color.copy((baseMaterial as THREE.MeshStandardMaterial).color);
    } else {
      color.setHex(0xffffff);
    }

    const geometry = instanced.geometry.clone();
    // Normalize to MeshStandardMaterial for better USDZ compatibility
    const material = new THREE.MeshStandardMaterial({ color: color.getHex() });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.applyMatrix4(matrix);
    group.add(mesh);
  }

  return group;
};

const replaceInstancedMeshes = (root: THREE.Object3D) => {
  const replacements: Array<{
    parent: THREE.Object3D;
    original: THREE.InstancedMesh;
    replacement: THREE.Group;
  }> = [];

  root.traverse((child) => {
    const instanced = child as THREE.InstancedMesh;
    if (instanced.isInstancedMesh && instanced.parent) {
      replacements.push({
        parent: instanced.parent,
        original: instanced,
        replacement: convertInstancedMesh(instanced),
      });
    }
  });

  replacements.forEach(({ parent, original, replacement }) => {
    parent.remove(original);
    replacement.position.copy(original.position);
    replacement.rotation.copy(original.rotation);
    replacement.scale.copy(original.scale);
    parent.add(replacement);
  });
};

export const prepareSceneForExport = (source: THREE.Group): THREE.Scene => {
  const scene = new THREE.Scene();
  const clone = source.clone(true);

  replaceInstancedMeshes(clone);

  // Scale down to ~1% so AR viewers (meters-based) don't show the model too large
  clone.scale.setScalar(0.01);

  // Make sure transforms are baked before export
  clone.updateMatrixWorld(true);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
  keyLight.position.set(5, 10, 7);
  scene.add(keyLight);
  scene.add(clone);
  return scene;
};

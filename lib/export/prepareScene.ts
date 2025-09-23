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
    // Preserve base material props where possible
    const matParams: THREE.MeshStandardMaterialParameters = {
      color: color.getHex(),
    };
    const bm = Array.isArray(baseMaterial) ? baseMaterial[0] : (baseMaterial as THREE.Material);
    const anyBm = bm as any;
    if (anyBm) {
      if (typeof anyBm.metalness === "number") matParams.metalness = anyBm.metalness;
      if (typeof anyBm.roughness === "number") matParams.roughness = anyBm.roughness;
      if (typeof anyBm.opacity === "number") matParams.opacity = anyBm.opacity;
      if (typeof anyBm.transparent === "boolean") matParams.transparent = anyBm.transparent;
      // Approximate Lambert/Toon as matte PBR
      if (anyBm.isMeshLambertMaterial || anyBm.isMeshToonMaterial) {
        matParams.metalness = matParams.metalness ?? 0.0;
        matParams.roughness = matParams.roughness ?? 0.85;
      }
      // Approximate Physical as Standard (ignore features not well-supported by USDZ)
      if (anyBm.isMeshPhysicalMaterial) {
        matParams.metalness = matParams.metalness ?? 0.0;
        matParams.roughness = matParams.roughness ?? 0.35;
      }
    }
  const material = new THREE.MeshStandardMaterial({ ...matParams, vertexColors: Boolean((geometry as any).attributes?.color) });
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

// Normalize to MeshStandardMaterial (non-instanced)
const normalizeMaterials = (root: THREE.Object3D) => {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = mesh.material as THREE.Material | THREE.Material[];
    const toStd = (m: THREE.Material) => {
      const anyM = m as any;
      const params: THREE.MeshStandardMaterialParameters = {};
      if (anyM.color) params.color = anyM.color.getHex?.() ?? anyM.color;
      if (typeof anyM.metalness === "number") params.metalness = anyM.metalness;
      if (typeof anyM.roughness === "number") params.roughness = anyM.roughness;
      if (typeof anyM.opacity === "number") params.opacity = anyM.opacity;
      if (typeof anyM.transparent === "boolean") params.transparent = anyM.transparent;
      if (anyM.isMeshLambertMaterial || anyM.isMeshToonMaterial) {
        params.metalness = params.metalness ?? 0.0;
        params.roughness = params.roughness ?? 0.85;
      }
      if (anyM.isMeshPhysicalMaterial) {
        params.metalness = params.metalness ?? 0.0;
        params.roughness = params.roughness ?? 0.35;
      }
      return new THREE.MeshStandardMaterial(params);
    };
    if (Array.isArray(base)) {
      mesh.material = base.map((m) => (m as any).isMeshStandardMaterial ? (m as any) : toStd(m));
    } else if (!(base as any).isMeshStandardMaterial) {
      mesh.material = toStd(base);
    }
  });
};

export const prepareSceneForExport = (source: THREE.Group): THREE.Scene => {
  const scene = new THREE.Scene();
  const clone = source.clone(true);

  replaceInstancedMeshes(clone);
  normalizeMaterials(clone);

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

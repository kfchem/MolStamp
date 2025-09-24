import type { Object3D } from "three";

export const exportGlb = async (object: Object3D): Promise<Blob> => {
  const { GLTFExporter } = await import(
    "three/examples/jsm/exporters/GLTFExporter.js"
  );
  const exporter = new GLTFExporter();

  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const file = new File([result], "molstamp.glb", {
            type: "model/gltf-binary",
          });
          resolve(file);
          return;
        }
        const json =
          typeof result === "string" ? result : JSON.stringify(result);
  const file = new File([json], "molstamp.gltf", {
          type: "application/json",
        });
        resolve(file);
      },
      reject,
      { binary: true, onlyVisible: true },
    );
  });
};

import type { Object3D } from "three";

export const exportUsdz = async (object: Object3D): Promise<Blob> => {
  const { USDZExporter } = await import(
    "three/examples/jsm/exporters/USDZExporter.js"
  );
  const exporter = new USDZExporter();

  // Ensure world matrices are up-to-date so exported objects are correctly placed
  object.updateMatrixWorld(true);

  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        if (ArrayBuffer.isView(result)) {
          resolve(result.buffer as ArrayBuffer);
          return;
        }
        reject(new Error("USDZ export failed"));
      },
      (error) => {
        reject(error as Error);
      },
      { quickLookCompatible: true },
    );
  });

  // Use the correct MIME type and provide a filename via File to help iOS Quick Look
  const file = new File([arrayBuffer], "molstamp.usdz", {
    type: "model/vnd.usdz+zip",
  });
  return file;
};

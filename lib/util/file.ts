import { MoleculeFormat } from "../chem/types";

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const EXTENSION_MAP: Record<string, MoleculeFormat> = {
  sdf: "sdf",
  mol: "sdf",
  xyz: "xyz",
};

export type FileValidationResult =
  | { ok: true; format: MoleculeFormat }
  | { ok: false; error: string };

export const normaliseLineEndings = (text: string): string =>
  text.replace(/\r\n?/g, "\n");

export const validateFile = (file: File): FileValidationResult => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "File is larger than 5 MB" };
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && EXTENSION_MAP[extension]) {
    return { ok: true, format: EXTENSION_MAP[extension] };
  }
  return { ok: false, error: "Unsupported file type" };
};

export const inferFormatFromContent = (
  fileName: string,
  text: string,
): MoleculeFormat | null => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension && EXTENSION_MAP[extension]) {
    return EXTENSION_MAP[extension];
  }
  const trimmed = text.trimStart();
  if (/^\d+\s*$/.test(trimmed.split(/\n+/)[0] ?? "")) {
    return "xyz";
  }
  if (
    trimmed.includes("M  END") ||
    trimmed.includes("V2000") ||
    trimmed.includes("V3000")
  ) {
    return "sdf";
  }
  return null;
};

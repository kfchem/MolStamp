"use client";

import { PropsWithChildren, useCallback, useRef, useState } from "react";
import { MoleculeFormat } from "@/lib/chem/types";
import {
  MAX_FILE_SIZE_BYTES,
  normaliseLineEndings,
  validateFile,
  inferFormatFromContent,
} from "@/lib/util/file";

export type UploadPayload = {
  text: string;
  format: MoleculeFormat;
  file: File;
};

type UploadDropzoneProps = {
  onFileLoaded: (payload: UploadPayload) => void;
  onError?: (message: string) => void;
  // panel: standalone card UI; overlay: wraps children and makes area clickable/droppable
  variant?: "panel" | "overlay";
  className?: string;
  // When overlay, do not open file picker on click (e.g., to interact with viewer)
  disableClick?: boolean;
  // Disable drag-and-drop
  disableDrop?: boolean;
} & PropsWithChildren;

const formatPrettyName: Record<MoleculeFormat, string> = {
  sdf: "SDF/MOL",
  xyz: "XYZ",
};

export const UploadDropzone = ({
  onFileLoaded,
  onError,
  variant = "panel",
  className,
  children,
  disableClick,
  disableDrop,
}: UploadDropzoneProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const emitError = useCallback(
    (message: string) => {
      if (onError) onError(message);
      // eslint-disable-next-line no-console
      console.warn(message);
    },
    [onError],
  );

  const processFile = useCallback(
    async (file: File) => {
      const validation = validateFile(file);
      if (!validation.ok) {
        emitError(validation.error);
        return;
      }

      try {
        const textRaw = await file.text();
        const text = normaliseLineEndings(textRaw);
        const inferred =
          inferFormatFromContent(file.name, text) ?? validation.format;
        if (!inferred) {
          emitError(
            "Unable to detect file format. Only SDF/MOL and XYZ are supported.",
          );
          return;
        }
        onFileLoaded({
          text,
          format: inferred,
          file,
        });
      } catch (error) {
        emitError((error as Error).message || "Failed to read file");
      }
    },
    [emitError, onFileLoaded],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const [file] = Array.from(files);
      await processFile(file);
    },
    [processFile],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (disableDrop) return;
      await handleFiles(event.dataTransfer.files);
    },
    [disableDrop, handleFiles],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disableDrop) return;
    setIsDragging(true);
  }, [disableDrop]);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disableDrop) return;
    setIsDragging(false);
  }, [disableDrop]);

  const onButtonClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      await handleFiles(event.target.files);
      if (event.target) {
        event.target.value = "";
      }
    },
    [handleFiles],
  );

  if (variant === "overlay") {
    return (
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={disableClick ? undefined : onButtonClick}
        className={`relative w-full ${className ?? ""}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (!disableClick && (e.key === "Enter" || e.key === " ")) onButtonClick();
        }}
      >
        {children}
        <div
          className={`pointer-events-none absolute inset-0 rounded-xl border-2 border-dashed transition ${
            isDragging ? "border-sky-400 bg-sky-50/70" : "border-transparent"
          }`}
        />
        <input
          ref={inputRef}
          type="file"
          accept=".sdf,.mol,.xyz"
          hidden
          onChange={onInputChange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex h-48 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
          isDragging ? "border-sky-400 bg-sky-50" : "border-slate-300 bg-white"
        }`}
      >
        <p className="text-lg font-semibold text-slate-900">
          Drop a molecule file here
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Accepted formats: {Object.values(formatPrettyName).join(", ")} • Max
          size {(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB
        </p>
        <button
          type="button"
          onClick={onButtonClick}
          className="mt-5 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600"
        >
          Browse files
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".sdf,.mol,.xyz"
        hidden
        onChange={onInputChange}
      />
    </div>
  );
};

UploadDropzone.displayName = "UploadDropzone";

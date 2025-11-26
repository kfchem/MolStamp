"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DetailedHTMLProps, HTMLAttributes, ReactElement } from "react";
type ModelViewerProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  src?: string;
  "ios-src"?: string;
  ar?: boolean | "true" | "false";
  "ar-modes"?: string;
  "camera-controls"?: boolean | "true" | "false";
  autoplay?: boolean | "true" | "false";
};
const ModelViewer = "model-viewer" as unknown as (
  props: ModelViewerProps
) => ReactElement;
import * as THREE from "three";
import { exportGlb } from "@/lib/export/exportGlb";
import { exportUsdz } from "@/lib/export/exportUsdz";
import { prepareSceneForExport } from "@/lib/export/prepareScene";

export type ArPanelProps = {
  source: THREE.Group | null;
  disabled?: boolean;
  compact?: boolean;
  showOpenAr?: boolean;
  showSizes?: boolean;
};

type ArtifactState = {
  url: string;
  size: number;
};

// Using intrinsic <model-viewer> element (typed via global JSX augmentation)

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const ArPanel = ({
  source,
  disabled,
  compact = false,
  showOpenAr = true,
  showSizes = true,
}: ArPanelProps) => {
  const [glb, setGlb] = useState<ArtifactState | null>(null);
  const [usdz, setUsdz] = useState<ArtifactState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState<"glb" | "usdz" | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const mvRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setIsMounted(true);
    // Register model-viewer element locally (no external CDN)
    (async () => {
      try {
        if (
          typeof window !== "undefined" &&
          !customElements.get("model-viewer")
        ) {
          await import("@google/model-viewer");
        }
      } catch {}
    })();
    return () => {
      setIsMounted(false);
    };
  }, []);

  useEffect(() => {
    setGlb((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setUsdz((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [source]);

  useEffect(
    () => () => {
      if (glb) URL.revokeObjectURL(glb.url);
      if (usdz) URL.revokeObjectURL(usdz.url);
    },
    [glb, usdz]
  );

  const ready = useMemo(() => Boolean(source) && !disabled, [source, disabled]);

  const buildIfNeeded = useCallback(
    async (kind: "glb" | "usdz") => {
      if (!source || disabled) return null;
      try {
        setWorking(kind);
        setStatus(null);
        const scene = prepareSceneForExport(source);
        if (kind === "glb") {
          if (glb) return glb;
          const blob = await exportGlb(scene);
          const url = URL.createObjectURL(blob);
          const art = { url, size: blob.size } as ArtifactState;
          setGlb(art);
          return art;
        } else {
          if (usdz) return usdz;
          const blob = await exportUsdz(scene);
          const url = URL.createObjectURL(blob);
          const art = { url, size: blob.size } as ArtifactState;
          setUsdz(art);
          return art;
        }
      } catch (error) {
        console.error(error);
        setStatus((error as Error).message || "Failed to prepare model");
        return null;
      } finally {
        setWorking(null);
      }
    },
    [disabled, glb, source, usdz]
  );

  const openAR = useCallback(async () => {
    if (!source || disabled) return;
    const isiOS =
      typeof navigator !== "undefined" &&
      /iPad|iPhone|iPod/.test(navigator.userAgent);
    try {
      setStatus(null);
      if (isiOS) {
        const art = await buildIfNeeded("usdz");
        const url = art?.url;
        if (!url) throw new Error("USDZ not available for AR");

        const anchor = document.createElement("a");
        anchor.setAttribute("rel", "ar");
        anchor.href = url;
        document.body.append(anchor);
        anchor.click();
        setTimeout(() => anchor.remove(), 0);
        return;
      }

      const builtGlb = glb ?? (await buildIfNeeded("glb"));
      if (!builtGlb) throw new Error("GLB not available for AR");

      const mv = mvRef.current as unknown as {
        canActivateAR?: boolean;
        activateAR?: () => void;
        setAttribute: (name: string, value: string) => void;
      } | null;
      if (!mv) throw new Error("AR viewer not ready");

      try {
        mv.setAttribute("src", builtGlb.url);
        if (usdz) mv.setAttribute("ios-src", usdz.url);
      } catch {}

      if (
        typeof mv.canActivateAR !== "undefined" &&
        mv.canActivateAR === false
      ) {
        setStatus("AR is not supported on this device.");
        return;
      }

      mv.activateAR?.();
    } catch (e) {
      console.error(e);
      setStatus((e as Error).message || "Failed to open AR");
    }
  }, [buildIfNeeded, disabled, glb, source, usdz]);

  const download = useCallback(
    async (kind: "glb" | "usdz") => {
      const art = await buildIfNeeded(kind);
      if (!art) return;
      const filename = kind === "glb" ? "molstamp.glb" : "molstamp.usdz";
      const a = document.createElement("a");
      a.href = art.url;
      a.download = filename;
      a.rel = "noopener";
      document.body.append(a);
      a.click();
      a.remove();
    },
    [buildIfNeeded]
  );

  return (
    <div
      className={`space-y-3 rounded-xl border border-slate-300 bg-white ${compact ? "p-3" : "p-4"} shadow-sm`}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2
            className={`${compact ? "text-base" : "text-lg"} font-semibold text-slate-900`}
          >
            AR Model
          </h2>
        </div>
        {showOpenAr ? (
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openAR}
            disabled={!ready || working !== null}
          >
            {working === "usdz" || working === "glb" ? "Preparing…" : "Open AR"}
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => download("glb")}
          disabled={!ready || working !== null}
        >
          Download GLB
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => download("usdz")}
          disabled={!ready || working !== null}
        >
          Download USDZ
        </button>
      </div>

      {showSizes ? (
        <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <div className="flex items-center justify-between">
            <span>GLB</span>
            <span>{glb ? formatBytes(glb.size) : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>USDZ</span>
            <span>{usdz ? formatBytes(usdz.size) : "—"}</span>
          </div>
        </div>
      ) : null}

      {isMounted ? (
        <ModelViewer
          ref={mvRef}
          key={(glb?.url ?? "") + (usdz?.url ?? "")}
          style={{ width: 0, height: 0, position: "absolute", opacity: 0 }}
          src={glb?.url ?? undefined}
          ios-src={usdz?.url ?? undefined}
          ar
          ar-modes="webxr scene-viewer quick-look"
          camera-controls
          autoplay
        />
      ) : null}
      {status ? <div className="text-sm text-amber-700">{status}</div> : null}
    </div>
  );
};

ArPanel.displayName = "ArPanel";

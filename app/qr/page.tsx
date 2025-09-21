"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { Viewer } from "@/components/Viewer";
import { OptionsPanel } from "@/components/OptionsPanel";
import { APP_NAME, TAGLINE } from "@/lib/branding";
import { decodeShareSegment } from "@/lib/share/decode";
import { exportGlb } from "@/lib/export/exportGlb";
import { exportUsdz } from "@/lib/export/exportUsdz";
import { prepareSceneForExport } from "@/lib/export/prepareScene";
import type { Molecule, StyleSettings } from "@/lib/chem/types";
import type { DetailedHTMLProps, HTMLAttributes, ReactElement } from "react";

const DEFAULT_STYLE: StyleSettings = {
  material: "standard",
  atomScale: 0.28,
  bondRadius: 0.09,
  quality: "medium",
};

const ModelViewer: any = "model-viewer" as unknown as (
  props: ModelViewerProps
) => ReactElement;

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

const ShareQrPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [molecule, setMolecule] = useState<Molecule | null>(null);
  const [style, setStyle] = useState<StyleSettings>(DEFAULT_STYLE);
  const [viewerGroup, setViewerGroup] = useState<Group | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const subtitle = useMemo(() => {
    if (loading) return "Decoding shared payload...";
    if (error) return TAGLINE;
    if (!molecule) return TAGLINE;
    const parts: string[] = [];
    if (molecule.title) parts.push(molecule.title);
    parts.push(`${molecule.atoms.length} atoms`);
    return parts.join(" | ");
  }, [error, loading, molecule]);

  // Set page title
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `${APP_NAME} — Share`;
    }
  }, []);

  // Decode from URL hash
  useEffect(() => {
    const processHash = () => {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const payload = hash.startsWith("#") ? hash.slice(1) : hash;
      if (!payload) {
        setError("Missing payload in URL hash. Expected /qr#<payload>.");
        setMolecule(null);
        setLoading(false);
        return;
      }
      try {
        const decoded = decodeShareSegment(payload);
        setMolecule(decoded.molecule);
        setStyle({ ...decoded.style });
        setError(null);
      } catch (e) {
        console.error(e);
        setError(
          "Invalid or corrupted QR payload. Please request a new QR code.",
        );
        setMolecule(null);
      } finally {
        setLoading(false);
      }
    };

    processHash();
    // react to hash changes (e.g., when user pastes a new one)
    window.addEventListener("hashchange", processHash);
    return () => window.removeEventListener("hashchange", processHash);
  }, []);

  // AR support (hidden model-viewer + exporters)
  type Artifact = { url: string; size: number };
  const [glb, setGlb] = useState<Artifact | null>(null);
  const [usdz, setUsdz] = useState<Artifact | null>(null);
  const [arStatus, setArStatus] = useState<string | null>(null);
  const mvRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      if (glb) URL.revokeObjectURL(glb.url);
      if (usdz) URL.revokeObjectURL(usdz.url);
    },
    [glb, usdz]
  );

  const buildIfNeeded = useCallback(
    async (kind: "glb" | "usdz") => {
      if (!viewerGroup) return null;
      try {
        const scene = prepareSceneForExport(viewerGroup);
        if (kind === "glb") {
          if (glb) return glb;
          const blob = await exportGlb(scene);
          const url = URL.createObjectURL(blob);
          const art = { url, size: blob.size } as Artifact;
          setGlb(art);
          return art;
        } else {
          if (usdz) return usdz;
          const blob = await exportUsdz(scene);
          const url = URL.createObjectURL(blob);
          const art = { url, size: blob.size } as Artifact;
          setUsdz(art);
          return art;
        }
      } catch (e) {
        console.error(e);
        setArStatus((e as Error).message || "Failed to prepare model");
        return null;
      }
    },
    [glb, usdz, viewerGroup]
  );

  const openAR = useCallback(async () => {
    if (!viewerGroup) return;
    const isiOS =
      typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
    try {
      setArStatus(null);
      if (isiOS) {
        const art = await buildIfNeeded("usdz");
        const url = art?.url;
        if (!url) throw new Error("USDZ not available for AR");
        const a = document.createElement("a");
        a.setAttribute("rel", "ar");
        a.href = url;
        document.body.append(a);
        a.click();
        setTimeout(() => a.remove(), 0);
        return;
      }
      if (!glb) await buildIfNeeded("glb");
      setTimeout(() => {
        (mvRef.current as any)?.activateAR?.();
      }, 0);
    } catch (e) {
      console.error(e);
      setArStatus((e as Error).message || "Failed to open AR");
    }
  }, [buildIfNeeded, glb, viewerGroup]);

  return (
    <main className="relative min-h-screen w-screen overflow-hidden bg-white">
      {/* Fullscreen viewer */}
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500">
          Decoding QR payload...
        </div>
      ) : (
        <Viewer
          molecule={molecule}
          style={style}
          onGroupReady={setViewerGroup}
          className="h-[100svh] w-screen rounded-none border-0"
        />
      )}

      {/* Options floating button (top-right) */}
      <div className="pointer-events-none fixed inset-0 z-50" style={{
        // Provide fallbacks for non-iOS or older browsers
        paddingTop: "max(0px, env(safe-area-inset-top))",
        paddingRight: "max(0px, env(safe-area-inset-right))",
        paddingBottom: "max(0px, env(safe-area-inset-bottom))",
        paddingLeft: "max(0px, env(safe-area-inset-left))",
      }}>
        <div className="pointer-events-auto fixed" style={{
           right: "max(1rem, env(safe-area-inset-right))",
           top: "max(1rem, env(safe-area-inset-top))",
         }}>
           <button
             type="button"
             aria-label="Rendering Options"
             onClick={() => setOptionsOpen(true)}
             disabled={!molecule}
             className="h-11 w-11 rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
           >
             {/* sliders icon */}
             <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
               <path d="M4 7h12m-6 0v10M10 17h10m-4 0V7" strokeLinecap="round" strokeLinejoin="round" />
             </svg>
           </button>
         </div>
 
         {/* Open AR floating button (bottom-center) */}
         <div className="pointer-events-auto fixed left-1/2 -translate-x-1/2" style={{ bottom: "calc(env(safe-area-inset-bottom) + 2.25rem)" }}>
           <button
             type="button"
             aria-label="Open AR"
             onClick={openAR}
             disabled={!molecule}
             className="h-12 w-12 rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
           >
             {/* cube/AR icon */}
             <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
               <path d="M12 3l7 4v7l-7 4-7-4V7l7-4z" strokeLinejoin="round" />
               <path d="M12 7l7 4M12 7L5 11M12 17V7" strokeLinecap="round" strokeLinejoin="round" />
             </svg>
           </button>
         </div>
 
         {/* Powered by + GitHub (bottom-right) */}
         <div className="pointer-events-none fixed select-none text-[10px] text-slate-500" style={{ right: "max(0.75rem, env(safe-area-inset-right))", bottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}>
           <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/70 px-2 py-1 shadow-sm ring-1 ring-slate-200 backdrop-blur">
             <span>Powered by MoleQuAR</span>
             <a
               href="https://github.com/kfchem/molequar"
               target="_blank"
               rel="noreferrer"
               className="text-slate-600 hover:text-sky-600"
             >
               GitHub
             </a>
           </div>
         </div>
       </div>

      {/* Options Overlay */}
      {optionsOpen ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setOptionsOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[86%] max-w-[360px] border-l border-slate-200 bg-white shadow-2xl" style={{ paddingRight: "env(safe-area-inset-right)" }}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">Rendering Options</span>
              <button
                type="button"
                onClick={() => setOptionsOpen(false)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-sky-300 hover:text-sky-600"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              <OptionsPanel value={style} onChange={setStyle} disabled={!molecule} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Hidden model-viewer for AR activation (non-iOS) */}
      <ModelViewer
        ref={mvRef as any}
        style={{ width: 0, height: 0, position: "absolute", opacity: 0 }}
        src={glb?.url ?? undefined}
        ios-src={usdz?.url ?? undefined}
        ar
        ar-modes="webxr scene-viewer quick-look"
        camera-controls
        autoplay
      />

      {arStatus ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800 shadow ring-1 ring-amber-200">
          {arStatus}
        </div>
      ) : null}
    </main>
  );
};

export default ShareQrPage;

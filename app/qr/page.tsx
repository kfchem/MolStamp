"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { Viewer } from "@/components/Viewer";
import { OptionsPanel } from "@/components/OptionsPanel";
import { APP_NAME, TAGLINE } from "@/lib/branding";
import { decodeShareSegment } from "@/lib/share/decode";
import type { Molecule, StyleSettings } from "@/lib/chem/types";
import type { DetailedHTMLProps, HTMLAttributes, ReactElement } from "react";
import { CubeIcon, AdjustmentsHorizontalIcon, XMarkIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

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
  const optionsBtnRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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
  const [arExporting, setArExporting] = useState(false);
  const [mvReady, setMvReady] = useState(false);
  const mvRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      if (glb) URL.revokeObjectURL(glb.url);
      if (usdz) URL.revokeObjectURL(usdz.url);
    },
    [glb, usdz]
  );

  const rebuildArtifacts = useCallback(async () => {
    if (!viewerGroup) return null;
    try {
      // Revoke previous blob URLs to avoid leaks
      if (glb) URL.revokeObjectURL(glb.url);
      if (usdz) URL.revokeObjectURL(usdz.url);

      // Lazy-load heavy exporters only when needed
      const [{ prepareSceneForExport }, { exportGlb }, { exportUsdz }] = await Promise.all([
        import("@/lib/export/prepareScene"),
        import("@/lib/export/exportGlb"),
        import("@/lib/export/exportUsdz"),
      ]);

      const scene = prepareSceneForExport(viewerGroup);
      const glbBlob = await exportGlb(scene);
      const glbUrl = URL.createObjectURL(glbBlob);
      const newGlb = { url: glbUrl, size: glbBlob.size } as Artifact;
      setGlb(newGlb);

      const usdzBlob = await exportUsdz(scene);
      const usdzUrl = URL.createObjectURL(usdzBlob);
      const newUsdz = { url: usdzUrl, size: usdzBlob.size } as Artifact;
      setUsdz(newUsdz);

      // Also update the hidden model-viewer element immediately
      if (mvRef.current) {
        try {
          (mvRef.current as any).setAttribute("src", glbUrl);
          (mvRef.current as any).setAttribute("ios-src", usdzUrl);
        } catch {}
      }

      return { glb: newGlb, usdz: newUsdz };
    } catch (e) {
      console.error(e);
      setArStatus((e as Error).message || "Failed to prepare model");
      return null;
    }
  }, [glb, usdz, viewerGroup]);

  const openAR = useCallback(async () => {
    if (!viewerGroup) return;
    const isiOS =
      typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
    try {
      setArStatus(null);
      setArExporting(true);
      // Defer model-viewer attachment until first AR attempt
      if (!isiOS && !mvReady) setMvReady(true);
      const built = await rebuildArtifacts();
      if (!built) throw new Error("Failed to build AR artifacts");

      if (isiOS) {
        const url = built.usdz.url;
        const a = document.createElement("a");
        a.setAttribute("rel", "ar");
        a.href = url;
        document.body.append(a);
        a.click();
        setTimeout(() => a.remove(), 0);
        return;
      }

  const mv: any = mvRef.current;
      if (!mv) throw new Error("AR viewer not ready");

      // Ensure attributes are set on the element
      mv.setAttribute("src", built.glb.url);
      mv.setAttribute("ios-src", built.usdz.url);

      // If AR isn't supported, fall back to downloading/opening the GLB
      if (typeof mv.canActivateAR !== "undefined" && mv.canActivateAR === false) {
        const a = document.createElement("a");
        a.href = built.glb.url;
        a.download = "molecule.glb";
        document.body.append(a);
        a.click();
        setTimeout(() => a.remove(), 0);
        setArStatus("AR not supported on this device. Downloaded GLB instead.");
        return;
      }

      // Try to activate AR (WebXR / Scene Viewer if available)
      mv.activateAR?.();
    } catch (e) {
      console.error(e);
      setArStatus((e as Error).message || "Failed to open AR");
    } finally {
      setArExporting(false);
    }
  }, [rebuildArtifacts, viewerGroup]);

  // Close on outside click or Escape
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!optionsOpen) return;
      const t = e.target as Node;
      if (optionsBtnRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOptionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOptionsOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [optionsOpen]);

  // Panel morphs as a rounded rectangle from the top-right corner (near the toggle)
  // no motion variants: simple sheet

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
  <div className="pointer-events-none fixed inset-0 z-[60]" style={{
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
            onClick={() => setOptionsOpen((v) => !v)}
            disabled={!molecule}
            ref={optionsBtnRef}
            className={
              `h-11 w-11 rounded-full text-slate-700 transition ` +
              (optionsOpen
                ? "bg-transparent border border-transparent shadow-none hover:text-slate-700"
                : "bg-white border border-slate-200 shadow-sm hover:border-sky-300 hover:text-sky-600") +
              " disabled:cursor-not-allowed disabled:opacity-60"
            }
          >
            {optionsOpen ? (
              <XMarkIcon className="mx-auto h-5 w-5" />
            ) : (
              <AdjustmentsHorizontalIcon className="mx-auto h-5 w-5" />
            )}
          </button>
        </div>
 
         {/* Open AR floating button (bottom-center) */}
         <div className="pointer-events-auto fixed left-1/2 -translate-x-1/2" style={{ bottom: "calc(env(safe-area-inset-bottom) + 2.25rem)" }}>
           <button
             type="button"
             aria-label={arExporting ? "Preparing AR assets" : "Open AR"}
             aria-busy={arExporting}
             onClick={openAR}
             disabled={!molecule || arExporting}
             className="h-12 w-12 rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
           >
             {arExporting ? (
               <ArrowPathIcon className="mx-auto h-5 w-5 animate-spin" />
             ) : (
               <CubeIcon className="mx-auto h-5 w-5" />
             )}
           </button>
         </div>
 
         {/* Powered by (bottom-right) – more subtle; link on MoleQuAR only */}
         <div className="pointer-events-none fixed select-none text-[10px] text-slate-400" style={{ right: "max(0.5rem, env(safe-area-inset-right))", bottom: "max(0.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))" }}>
           <div className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-white/50 px-1.5 py-0.5 shadow-sm ring-1 ring-slate-200/50 backdrop-blur-sm">
             <span className="opacity-80">Powered by</span>
             <a
               href="https://github.com/kfchem/molequar"
               target="_blank"
               rel="noreferrer"
               className="font-medium text-slate-500 underline-offset-2 hover:text-sky-600 hover:underline"
             >
               MoleQuAR
             </a>
           </div>
         </div>
       </div>

      {/* Options Overlay */}
      {/* Compact popover near top-right: place OptionsPanel as-is (no extra frame/header) */}
      <div
        ref={popoverRef}
        className={
          `fixed z-[55] w-[clamp(300px,86vw,360px)] transition-opacity duration-150 ` +
          (optionsOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
        }
        style={{
          right: "max(1rem, env(safe-area-inset-right))",
          top: "max(1rem, env(safe-area-inset-top))",
        }}
        role="dialog"
        aria-label="Rendering Options"
        aria-hidden={!optionsOpen}
      >
        {/* Place OptionsPanel as-is so its dropdowns can overflow; avoid clipping */}
        <OptionsPanel value={style} onChange={setStyle} disabled={!molecule} />
      </div>

      {/* Hidden model-viewer for AR activation (non-iOS), mount on demand */}
      {mvReady ? (
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
      ) : null}

      {arStatus ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800 shadow ring-1 ring-amber-200">
          {arStatus}
        </div>
      ) : null}
    </main>
  );
};

export default ShareQrPage;

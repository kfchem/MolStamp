"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { Viewer } from "@/components/Viewer";
import { OptionsPanel } from "@/components/OptionsPanel";
import { APP_NAME, TAGLINE, REPO_URL } from "@/lib/branding";
import { decodeShareSegment, decodeShareSegmentEncrypted } from "@/lib/share/decode";
import type { Molecule, StyleSettings } from "@/lib/chem/types";
import type { DetailedHTMLProps, HTMLAttributes, ReactElement } from "react";
import { CubeIcon, AdjustmentsHorizontalIcon, XMarkIcon, ArrowPathIcon, LockClosedIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";

const DEFAULT_STYLE: StyleSettings = {
  material: "standard",
  atomScale: 0.28,
  bondRadius: 0.09,
  quality: "medium",
};

type ModelViewerProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  'ios-src'?: string;
  ar?: boolean | 'true' | 'false';
  'ar-modes'?: string;
  'camera-controls'?: boolean | 'true' | 'false';
  autoplay?: boolean | 'true' | 'false';
};
const ModelViewer = "model-viewer" as unknown as (
  props: ModelViewerProps
) => ReactElement;

const ShareQrPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [molecule, setMolecule] = useState<Molecule | null>(null);
  const [style, setStyle] = useState<StyleSettings>(DEFAULT_STYLE);
  const [viewerGroup, setViewerGroup] = useState<Group | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsBtnRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [encPayload, setEncPayload] = useState<string | null>(null);
  const [pw, setPw] = useState<string>("");
  const [pwBusy, setPwBusy] = useState<boolean>(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwShake, setPwShake] = useState<boolean>(false);
  const supportsSubtle = typeof globalThis !== 'undefined' && (globalThis as any).crypto && (globalThis as any).crypto.subtle;

  const subtitle = useMemo(() => {
    if (loading) return "Decoding shared payload...";
    if (error) return TAGLINE;
    if (!molecule) return TAGLINE;
    const parts: string[] = [];
    if (molecule.title) parts.push(molecule.title);
    parts.push(`${molecule.atoms.length} atoms`);
    return parts.join(" | ");
  }, [error, loading, molecule]);

  const applyDocTitle = useCallback((t?: string | null) => {
    if (typeof document === "undefined") return;
    const titleText = t && t.trim().length > 0 ? `${t}` : `${APP_NAME}`;
    document.title = titleText;
  }, []);
  const applyDocTitleLater = useCallback((t?: string | null, delay = 220) => {
    if (typeof window === "undefined") return;
    const id = window.setTimeout(() => applyDocTitle(t ?? null), Math.max(0, delay));
    return () => window.clearTimeout(id);
  }, [applyDocTitle]);

  useEffect(() => {
    const cancel = applyDocTitleLater(molecule?.title ?? null, 220);
    return () => { if (typeof cancel === 'function') cancel(); };
  }, [applyDocTitleLater, molecule?.title]);

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
    // Update title with a slight delay to avoid race with hydration
    applyDocTitleLater(decoded.molecule.title ?? null, 220);
        setMolecule(decoded.molecule);
        setStyle({ ...decoded.style });
        setError(null);
      } catch (e) {
        const msg = (e as Error)?.message || "";
        if (/password required/i.test(msg)) {
          setEncPayload(payload);
          setError(null);
          setMolecule(null);
        } else {
          console.error(e);
          setError("Invalid or corrupted QR payload. Please request a new QR code.");
          setMolecule(null);
        }
      } finally {
        setLoading(false);
      }
    };

    processHash();
    window.addEventListener("hashchange", processHash);
    return () => window.removeEventListener("hashchange", processHash);
  }, [applyDocTitleLater]);

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
      if (glb) URL.revokeObjectURL(glb.url);
      if (usdz) URL.revokeObjectURL(usdz.url);

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

      if (mvRef.current) {
        try {
          mvRef.current.setAttribute("src", glbUrl);
          mvRef.current.setAttribute("ios-src", usdzUrl);
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

  const mv = mvRef.current as unknown as { canActivateAR?: boolean; activateAR?: () => void; setAttribute: (name: string, value: string) => void } | null;
      if (!mv) throw new Error("AR viewer not ready");

      mv.setAttribute("src", built.glb.url);
      mv.setAttribute("ios-src", built.usdz.url);

      if (typeof mv.canActivateAR !== "undefined" && mv.canActivateAR === false) {
        setArStatus("AR is not supported on this device.");
        return;
      }

      mv.activateAR?.();
    } catch (e) {
      console.error(e);
      setArStatus((e as Error).message || "Failed to open AR");
    } finally {
      setArExporting(false);
    }
  }, [rebuildArtifacts, viewerGroup, mvReady]);

  useEffect(() => {
    (async () => {
      try {
        if (typeof window !== 'undefined' && !customElements.get('model-viewer')) {
          await import('@google/model-viewer');
        }
      } catch {}
    })();
  }, []);

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

  const tryDecrypt = useCallback(async () => {
    if (!encPayload) return;
    const trimmed = pw.trim();
    if (trimmed.length < 4) {
      setPwErr("Enter at least 4 characters");
      setPwShake(true);
      setTimeout(() => setPwShake(false), 350);
      return;
    }
    if (!supportsSubtle) {
      setPwErr("Encryption requires Web Crypto (HTTPS). Open this page over HTTPS.");
      setPwShake(true);
      setTimeout(() => setPwShake(false), 350);
      return;
    }
    setPwBusy(true);
    setPwErr(null);
    try {
      const decoded = await decodeShareSegmentEncrypted(encPayload, trimmed);
      // Delay title to align with post-decrypt rendering
      applyDocTitleLater(decoded.molecule.title ?? null, 180);
      setMolecule(decoded.molecule);
      setStyle({ ...decoded.style });
      setError(null);
      setEncPayload(null);
    } catch (err) {
      const m = (err as Error)?.message || "";
      if (/wrong password/i.test(m)) setPwErr("Wrong password or data corrupted"); else setPwErr("Failed to decrypt");
      setPwShake(true);
      setTimeout(() => setPwShake(false), 350);
    } finally {
      setPwBusy(false);
    }
  }, [applyDocTitleLater, encPayload, pw, supportsSubtle]);

  return (
    <main className="relative min-h-screen w-screen overflow-hidden bg-white">
      <AnimatePresence>
        {encPayload ? (
          <motion.div
            className="absolute inset-0 z-[70]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="grid h-full w-full place-items-center bg-white/70 backdrop-blur">
              <motion.div
                className="w-[min(92vw,420px)] rounded-2xl bg-white/90 p-5 shadow-xl ring-1 ring-slate-200/80 backdrop-blur-md"
                initial={{ y: 18, opacity: 0, scale: 0.98 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 12, opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 text-sky-600 ring-1 ring-sky-200">
                    <LockClosedIcon className="h-4 w-4" />
                  </div>
                  <h2 className="text-base font-semibold tracking-wide text-slate-900">Encrypted</h2>
                </div>
                <p className="mt-1 text-sm text-slate-600">Enter password to view.</p>
                <motion.div
                  className="mt-3 relative"
                  animate={pwShake ? { x: [0, -6, 6, -4, 4, -2, 2, 0] } : { x: 0 }}
                  transition={{ duration: 0.35, ease: "easeInOut" }}
                >
                  <input
                    type="password"
                    className={`h-9 w-full rounded-md bg-white/95 pl-2 pr-10 text-base text-slate-800 placeholder:text-slate-400 shadow-inner ring-1 focus:outline-none ${pwErr || pwShake ? "ring-rose-300" : "ring-slate-200 focus:ring-sky-300"}`}
                    placeholder="Password"
                    value={pw}
                    onChange={(e)=>{ setPw(e.target.value); setPwErr(null); }}
                    onKeyDown={(e)=>{ if (e.key === "Enter") { e.preventDefault(); tryDecrypt(); } }}
                    disabled={pwBusy}
                    aria-invalid={Boolean(pwErr)}
                  />
                  <button
                    type="button"
                    aria-label="Decrypt"
                    onClick={tryDecrypt}
                    disabled={pwBusy || pw.trim().length < 4 || !supportsSubtle}
                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/90 text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pwBusy ? (
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <motion.span whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} className="inline-flex">
                        <ArrowRightIcon className="h-4 w-4" />
                      </motion.span>
                    )}
                  </button>
                </motion.div>
                {(!supportsSubtle && !pwErr) ? (
                  <div className="mt-2 text-xs text-amber-700">Encryption/decryption requires a secure context. Please open this page over HTTPS.</div>
                ) : null}
                {pwErr ? <div className="mt-2 text-xs text-rose-700">{pwErr}</div> : null}
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {molecule?.title ? (
        <div className="pointer-events-none fixed left-3 top-3 z-[65]">
          <div className="pointer-events-auto inline-flex max-w-[70vw] items-center gap-1 rounded-lg bg-white/70 px-2.5 py-1.5 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-md">
            <span className="truncate font-semibold tracking-wide">{molecule.title}</span>
          </div>
        </div>
      ) : null}

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

  <div className="pointer-events-none fixed inset-0 z-[60]" style={{
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
 
         <div className="pointer-events-none fixed select-none text-[10px] text-slate-400" style={{ right: "max(0.5rem, env(safe-area-inset-right))", bottom: "max(0.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))" }}>
           <div className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-white/50 px-1.5 py-0.5 shadow-sm ring-1 ring-slate-200/50 backdrop-blur-sm">
             <span className="opacity-80">Powered by</span>
             <a
               href={REPO_URL}
               target="_blank"
               rel="noreferrer"
               className="font-medium text-slate-500 underline-offset-2 hover:text-sky-600 hover:underline"
             >
               MolStamp
             </a>
           </div>
         </div>
       </div>

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
        <OptionsPanel value={style} onChange={setStyle} disabled={!molecule} />
      </div>

      {mvReady ? (
        <ModelViewer
          ref={mvRef}
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

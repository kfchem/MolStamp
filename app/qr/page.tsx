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
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [arPulse, setArPulse] = useState(false);

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
    const isiOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
    try {
      setArStatus(null);
      setArExporting(true);
      if (!isiOS && !mvReady) setMvReady(true);

      // Build / rebuild artifacts (GLB + USDZ)
      const built = await rebuildArtifacts();
      if (!built) throw new Error("Failed to build AR artifacts");

      if (isiOS) {
        // iOS Quick Look: anchor trick works with blob object URL (has extension via usdz export)
        const url = built.usdz.url;
        const a = document.createElement("a");
        a.setAttribute("rel", "ar");
        a.href = url;
        document.body.append(a);
        a.click();
        setTimeout(() => a.remove(), 0);
        return;
      }

      // Ensure <model-viewer> custom element is defined & ref attached
      try { await (customElements as any).whenDefined?.('model-viewer'); } catch {}

      const waitForMv = async () => {
        for (let i = 0; i < 15; i++) { // up to ~1.2s
          const mvEl = mvRef.current as any;
          if (mvEl) return mvEl;
          await new Promise(r => setTimeout(r, 80));
        }
        throw new Error("AR viewer not ready");
      };
      const mv: any = await waitForMv();

      // Assign sources (GLB for WebXR / Scene Viewer, USDZ retained for potential cross-platform reuse)
      try {
        mv.setAttribute("src", built.glb.url);
        mv.setAttribute("ios-src", built.usdz.url);
      } catch {}

      // Some Android devices report canActivateAR=false momentarily until model & capabilities settle.
      // We'll retry a few times before giving up, and attempt activateAR regardless as last resort.
      let can = mv.canActivateAR;
      if (can === false) {
        for (let i = 0; i < 8; i++) { // ~1.2s extra
          await new Promise(r => setTimeout(r, 150));
          can = mv.canActivateAR;
          if (can) break;
        }
      }

      // Attempt activation even if still false (some builds don't update the flag properly but still support AR)
      try {
        mv.activateAR?.();
        // If canActivateAR was definitively false after retries, provide a softer pending note instead of immediate failure.
        if (can === false) {
          setTimeout(() => {
            // If after a grace period no AR session started (heuristic: button still enabled & no status), inform user.
            if (!mv.__arSessionStarted && !arExporting) {
              setArStatus("AR launch may not be supported for local models on this Android device.");
            }
          }, 1600);
        }
      } catch (err) {
        // Differentiate potential root causes for Android Scene Viewer vs WebXR
        const msg = (err as Error)?.message || "";
        if (/blob|object url/i.test(msg)) {
          setArStatus("Android AR requires a publicly hosted model file (blob URL not accepted)." );
        } else {
          setArStatus(msg || "Failed to open AR");
        }
      }
    } catch (e) {
      console.error(e);
      setArStatus((e as Error).message || "Failed to open AR");
    } finally {
      setArExporting(false);
    }
  }, [rebuildArtifacts, viewerGroup, mvReady, arExporting]);

  // Detect AR support with a slight delay (so main content settles) and animate button in if supported
  useEffect(() => {
    if (!molecule) { setArSupported(null); return; }
    let cancelled = false;
    const detect = async () => {
      const delay = 800; // ms delay before detection & reveal
      await new Promise(r => setTimeout(r, delay));
      if (cancelled) return;
      const isiOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroidChrome = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent) && /Chrome/.test(navigator.userAgent);
      let webxr = false;
      try {
        const xr: any = (navigator as any).xr;
        if (xr?.isSessionSupported) {
          webxr = await xr.isSessionSupported('immersive-ar').catch(() => false);
        }
      } catch {}
      const supported = isiOS || isAndroidChrome || webxr;
      if (!cancelled) {
        setArSupported(supported);
        if (supported) {
          // Trigger a finite pulse sequence (handled by separate effect)
          setArPulse(true);
        }
      }
    };
    detect();
    return () => { cancelled = true; };
  }, [molecule]);

  // Automatically stop the pulse after its finite animation cycles (~2.3s total)
  useEffect(() => {
    if (!arPulse) return;
    const id = setTimeout(() => setArPulse(false), 2300);
    return () => clearTimeout(id);
  }, [arPulse]);

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

  useEffect(() => {
    // Ensure page starts at top; avoids initial offset on some iOS cases
    try { window.scrollTo(0, 0); } catch {}
  }, []);

  return (
    <main className="fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-white">
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
          className="h-[100dvh] w-screen rounded-none border-0"
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
 
         <AnimatePresence>
           {arSupported && molecule ? (
             <motion.div
               key="ar-btn-wrapper"
               className="pointer-events-none absolute inset-x-0 flex justify-center"
               style={{ bottom: "2.25rem" }}
               initial={{ opacity: 0, scale: 0.6, y: 18 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.6, y: 12 }}
               transition={{ type: "spring", stiffness: 340, damping: 36, mass: 0.6 }}
             >
               <motion.button
                 type="button"
                 aria-label={arExporting ? "Preparing AR assets" : "Open AR"}
                 aria-busy={arExporting}
                 onClick={openAR}
                 disabled={!molecule || arExporting}
                 className="pointer-events-auto relative h-12 w-12 rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                 whileTap={{ scale: 0.9 }}
               >
                 {arPulse ? (
                   <>
                     {/* Soft glow pulse (two gentle expansions) */}
                     <motion.span
                       className="pointer-events-none absolute inset-0 rounded-full bg-sky-400/25"
                       initial={{ scale: 0.9, opacity: 0.35 }}
                       animate={{ scale: [0.9, 1.25], opacity: [0.35, 0] }}
                       transition={{ duration: 1.1, ease: "easeOut", repeat: 1, repeatDelay: 0.3 }}
                     />
                     {/* Outline ripple (slight) */}
                     <motion.span
                       className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-sky-300/60"
                       initial={{ scale: 1, opacity: 0.75 }}
                       animate={{ scale: [1, 1.12], opacity: [0.75, 0] }}
                       transition={{ duration: 1.1, ease: "easeOut", repeat: 1, repeatDelay: 0.3, delay: 0.15 }}
                     />
                   </>
                 ) : null}
                 {arExporting ? (
                   <ArrowPathIcon className="mx-auto h-5 w-5 animate-spin" />
                 ) : (
                   <CubeIcon className="mx-auto h-5 w-5" />
                 )}
               </motion.button>
             </motion.div>
           ) : null}
         </AnimatePresence>
 
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

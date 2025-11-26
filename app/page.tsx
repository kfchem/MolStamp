"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { Group } from "three";
import { UploadDropzone, UploadPayload } from "@/components/UploadDropzone";
import { Viewer } from "@/components/Viewer";
import { OptionsPanel } from "@/components/OptionsPanel";
import { ArPanel } from "@/components/ArPanel";
import { QrMaker } from "@/components/QrMaker";
import {
  ArrowPathIcon,
  CodeBracketIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  APP_NAME,
  TAGLINE,
  PLUS_NAME,
  PLUS_URL,
  REPO_URL,
  BRAND_SVG,
} from "@/lib/branding";
import { parseSdf } from "@/lib/parse/parseSdf";
import { parseXyz } from "@/lib/parse/parseXyz";
import {
  encodeShareData,
  encodeShareDataEncrypted,
  buildShareUrl,
} from "@/lib/share/encode";
import type { Molecule, MoleculeFormat, StyleSettings } from "@/lib/chem/types";

const DEFAULT_STYLE: StyleSettings = {
  material: "standard",
  atomScale: 0.28,
  bondRadius: 0.1,
  quality: "high",
};

const LARGE_ATOM_THRESHOLD = 300;

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const parseMolecule = (text: string, format: MoleculeFormat): Molecule => {
  if (format === "sdf") {
    return parseSdf(text);
  }
  return parseXyz(text);
};

const HomePage = () => {
  const [molecule, setMolecule] = useState<Molecule | null>(null);
  const [format, setFormat] = useState<MoleculeFormat | null>(null);
  const [style, setStyle] = useState<StyleSettings>(DEFAULT_STYLE);
  const [viewerGroup, setViewerGroup] = useState<Group | null>(null);
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [qrResetKey, setQrResetKey] = useState<number>(0);

  const resetAll = useCallback(() => {
    setMolecule(null);
    setFormat(null);
    setStyle(DEFAULT_STYLE);
    setViewerGroup(null);
    setFileMeta(null);
    setInfo(null);
    setError(null);
    setShareState(null);
    setTitle("");
    setOrientationQ(null);
    // Reset QR options and remount QR panel to clear internal UI state
    setOmitBonds(false);
    setUseDelta(false);
    setEncrypt(false);
    setPassword("");
    setPrecisionDrop(0);
    setQrResetKey((v) => v + 1);
  }, []);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareState, setShareState] = useState<{
    encoded: string;
    byteLength: number;
    url: string;
    scaleExp: number;
  } | null>(null);
  const [omitBonds, setOmitBonds] = useState<boolean>(false);
  const [useDelta, setUseDelta] = useState<boolean>(false);
  const [title, setTitle] = useState<string>("");
  const [encrypt, setEncrypt] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  const [orientationQ, setOrientationQ] = useState<THREE.Quaternion | null>(
    null
  );
  const [precisionDrop, setPrecisionDrop] = useState<
    0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  >(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Heuristic: consider keyboard open if visualViewport height is significantly smaller than layout viewport
  useEffect(() => {
    const vv = (
      typeof window !== "undefined" ? (window as any).visualViewport : null
    ) as VisualViewport | null;
    if (!vv) return;
    const onVVChange = () => {
      const ratio = vv.height / window.innerHeight;
      setKeyboardOpen(ratio < 0.85); // threshold tweakable
    };
    vv.addEventListener("resize", onVVChange);
    vv.addEventListener("scroll", onVVChange);
    onVVChange();
    return () => {
      vv.removeEventListener("resize", onVVChange);
      vv.removeEventListener("scroll", onVVChange);
    };
  }, []);

  const onFileLoaded = useCallback((payload: UploadPayload) => {
    setError(null);
    setInfo(null);
    setShareState(null);
    setViewerGroup(null);
    setOrientationQ(null);

    try {
      const parsed = parseMolecule(payload.text, payload.format);
      setMolecule(parsed);
      setFormat(payload.format);
      setFileMeta({ name: payload.file.name, size: payload.file.size });
      setTitle("");

      if (payload.format === "xyz") {
        setOmitBonds(true);
      } else {
        setOmitBonds(false);
      }

      const large = parsed.atoms.length > LARGE_ATOM_THRESHOLD;
      setStyle({
        ...DEFAULT_STYLE,
        quality: large ? "medium" : DEFAULT_STYLE.quality,
      });
      if (large) {
        setInfo(
          `Loaded ${parsed.atoms.length} atoms - switched to Low quality for performance. Adjust if your device can handle it.`
        );
      }
    } catch (parseError) {
      console.error(parseError);
      setMolecule(null);
      setFormat(null);
      setFileMeta(null);
      setError((parseError as Error).message || "Failed to parse molecule");
    }
  }, []);

  useEffect(() => {
    if (!molecule) {
      setShareState(null);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const molForShare: Molecule = (() => {
          if (!molecule) return molecule as any;
          if (!orientationQ) return molecule;
          const inv = orientationQ.clone();
          const m = new THREE.Matrix4().makeRotationFromQuaternion(inv);
          const atoms = molecule.atoms.map((a) => {
            const v = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(m);
            return { ...a, x: v.x, y: v.y, z: v.z };
          });
          return { ...molecule, atoms };
        })();
        const useEnc = encrypt && password.trim().length >= 4;
        if (useEnc) {
          const hasCrypto =
            typeof globalThis !== "undefined" &&
            (globalThis as any).crypto &&
            (globalThis as any).crypto.subtle;
          if (!hasCrypto) {
            throw new Error(
              "Encryption requires Web Crypto (HTTPS). Disable encryption or open this page over HTTPS."
            );
          }
        }
        const { encoded, byteLength, scaleExp } = useEnc
          ? await encodeShareDataEncrypted({
              molecule: molForShare,
              style,
              omitBonds,
              precisionDrop,
              useDelta,
              title,
              password: password.trim(),
            })
          : encodeShareData({
              molecule: molForShare,
              style,
              omitBonds,
              precisionDrop,
              useDelta,
              title,
            });
        const url = buildShareUrl(encoded);
        setShareState({ encoded, byteLength, url, scaleExp });
        setError(null);
      } catch (e) {
        console.error(e);
        setError((e as Error).message || "Failed to generate QR payload");
        setShareState(null);
      }
    }, 600);
    return () => clearTimeout(id);
  }, [
    molecule,
    style,
    omitBonds,
    precisionDrop,
    useDelta,
    title,
    encrypt,
    password,
    orientationQ,
  ]);

  const headerSubtitle = useMemo(() => {
    if (!molecule || !fileMeta) {
      return TAGLINE;
    }
    const parts = [
      fileMeta.name,
      formatBytes(fileMeta.size),
      `${molecule.atoms.length} atoms`,
    ];
    if (format) {
      parts.push(format.toUpperCase());
    }
    return parts.join(" | ");
  }, [fileMeta, format, molecule]);

  const headerMeta = useMemo(() => {
    if (!molecule || !fileMeta) return null;
    const chips = [
      fileMeta.name,
      formatBytes(fileMeta.size),
      `${molecule.atoms.length} atoms`,
    ];
    if (format) chips.push(format.toUpperCase());
    return chips;
  }, [fileMeta, format, molecule]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="inline-flex h-14 w-14 items-center justify-center rounded-lg"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: BRAND_SVG }}
              />
              <h1 className="text-4xl font-black text-[#2082C5] md:text-5xl">
                {APP_NAME}
              </h1>
            </div>
            <div className="mt-3 min-h-6">
              {headerMeta ? (
                <div className="flex flex-wrap gap-2">
                  {headerMeta.map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-6 text-slate-600">
                  {headerSubtitle}{" "}
                  <span>
                    For 2D drawings, use{" "}
                    <a
                      href={PLUS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-600 hover:text-sky-700 underline underline-offset-2"
                    >
                      {PLUS_NAME}
                    </a>
                    .
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetAll}
              disabled={!molecule}
              className="inline-flex items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
          <UploadDropzone
            onFileLoaded={onFileLoaded}
            onError={setError}
            className="rounded-xl"
            disableClick={Boolean(molecule)}
            disableDrop={false}
          >
            <div className="relative w-full">
              {!molecule ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center text-center">
                  <div className="rounded-2xl border border-slate-200 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
                    <p className="text-base font-semibold text-slate-900">
                      Drop or click to load a molecule
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      SDF/MOL or XYZ 3D data — processed locally.
                    </p>
                  </div>
                </div>
              ) : null}
              <Viewer
                molecule={molecule}
                style={style}
                onGroupReady={setViewerGroup}
                showRotateControl
                onOrientationChange={(q) => setOrientationQ(q)}
                className={
                  keyboardOpen
                    ? "h-[50dvh] min-h-[340px]"
                    : "h-[50lvh] min-h-[340px]"
                }
              />
            </div>
          </UploadDropzone>
          <OptionsPanel
            value={style}
            onChange={setStyle}
            disabled={!molecule}
          />

          {info ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              <InformationCircleIcon className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
              <span>{info}</span>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-none text-rose-600" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 min-w-0">
          <ArPanel
            source={viewerGroup}
            disabled={!molecule}
            showOpenAr
            showSizes={false}
          />
          <QrMaker
            shareUrl={shareState?.url ?? null}
            encodedLength={shareState?.encoded.length ?? null}
            payloadBytes={shareState?.byteLength ?? null}
            scaleExp={shareState?.scaleExp}
            title={title}
            onChangeTitle={setTitle}
            omitBonds={omitBonds}
            onChangeOmitBonds={setOmitBonds}
            precisionDrop={precisionDrop}
            onChangePrecisionDrop={setPrecisionDrop}
            useDelta={useDelta}
            onChangeUseDelta={setUseDelta}
            encrypt={encrypt}
            onChangeEncrypt={setEncrypt}
            password={password}
            onChangePassword={setPassword}
            key={qrResetKey}
          />
        </div>
      </div>
      <footer className="mt-2 py-1">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-4 text-sm text-slate-600">
          <span className="text-slate-600">© {new Date().getFullYear()} MolStamp</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-slate-600 hover:text-sky-600"
          >
            GitHub
          </a>
          <a href={REPO_URL + "/blob/main/README.md#license"} target="_blank" rel="noreferrer" className="text-slate-600 hover:text-sky-600">License</a>
          <a href={REPO_URL + "/blob/main/README.md#privacy-and-security-notes"} target="_blank" rel="noreferrer" className="text-slate-600 hover:text-sky-600">Privacy</a>
        </div>
      </footer>
    </main>
  );
};

export default HomePage;

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Group } from "three";
import { UploadDropzone, UploadPayload } from "@/components/UploadDropzone";
import { Viewer } from "@/components/Viewer";
import { OptionsPanel } from "@/components/OptionsPanel";
import { ArPanel } from "@/components/ArPanel";
import { QrMaker } from "@/components/QrMaker";
import { APP_NAME, TAGLINE, PLUS_NAME, PLUS_URL } from "@/lib/branding";
import { parseSdf } from "@/lib/parse/parseSdf";
import { parseXyz } from "@/lib/parse/parseXyz";
import { encodeShareData, encodeShareDataEncrypted, buildShareUrl } from "@/lib/share/encode";
import type { Molecule, MoleculeFormat, StyleSettings } from "@/lib/chem/types";

const DEFAULT_STYLE: StyleSettings = {
  material: "standard",
  atomScale: 0.28,
  bondRadius: 0.10,
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
  const [coarseCoords, setCoarseCoords] = useState<boolean>(false);
  const [useDelta, setUseDelta] = useState<boolean>(false);
  const [title, setTitle] = useState<string>("");
  const [encrypt, setEncrypt] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  // Coordinate precision: number of LSBs to drop (0..8)
  const [precisionDrop, setPrecisionDrop] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8>(0);

  const onFileLoaded = useCallback((payload: UploadPayload) => {
    setError(null);
    setInfo(null);
    setShareState(null);
    setViewerGroup(null);

    try {
      const parsed = parseMolecule(payload.text, payload.format);
      setMolecule(parsed);
      setFormat(payload.format);
  setFileMeta({ name: payload.file.name, size: payload.file.size });
  // タイトルはデフォルト空欄（ユーザー任意入力）
  setTitle("");

      // 入力形式に応じて Bond data の既定を切り替え
      // XYZ: ファイルに結合情報がないため自動生成（omitBonds=true）
      // SDF: 結合データを含むためそのまま含める（omitBonds=false）
      if (payload.format === "xyz") {
        setOmitBonds(true);
      } else {
        setOmitBonds(false);
      }

      const large = parsed.atoms.length > LARGE_ATOM_THRESHOLD;
      setStyle({
        ...DEFAULT_STYLE,
        quality: large ? "low" : DEFAULT_STYLE.quality,
      });
      if (large) {
        setInfo(
          `Loaded ${parsed.atoms.length} atoms - switched to Low quality for performance. Adjust if your device can handle it.`,
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

  // アップロード済み&スタイル変更時に自動でQR用URLを生成（デバウンスで負荷軽減）
  useEffect(() => {
    if (!molecule) {
      setShareState(null);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const useEnc = encrypt && password.trim().length >= 4;
        if (useEnc) {
          const hasCrypto = typeof globalThis !== 'undefined' && (globalThis as any).crypto && (globalThis as any).crypto.subtle;
          if (!hasCrypto) {
            throw new Error("Encryption requires Web Crypto (HTTPS). Disable encryption or open this page over HTTPS.");
          }
        }
        const { encoded, byteLength, scaleExp } = useEnc
          ? await encodeShareDataEncrypted({ molecule, style, omitBonds, coarseCoords, precisionDrop, useDelta, title, password: password.trim() })
          : encodeShareData({ molecule, style, omitBonds, coarseCoords, precisionDrop, useDelta, title });
        const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fallbackOrigin = "https://m2go.kfchem.dev";
        const url = buildShareUrl(origin || fallbackOrigin, encoded);
  setShareState({ encoded, byteLength, url, scaleExp });
        setError(null);
      } catch (e) {
        console.error(e);
        setError((e as Error).message || "Failed to generate QR payload");
        setShareState(null);
      }
    }, 600);
    return () => clearTimeout(id);
  }, [molecule, style, omitBonds, coarseCoords, precisionDrop, useDelta, title, encrypt, password]);

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
            <h1 className="bg-gradient-to-r from-sky-600 to-violet-600 bg-clip-text text-4xl font-extrabold text-transparent md:text-5xl">
              {APP_NAME}
            </h1>
            <div className="mt-2 min-h-6">
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
                    For 2D drawings, use {" "}
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
              {/* Reset icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4" />
              </svg>
              Reset
            </button>
              <a
                href="https://github.com/kfchem/m2go"
                target="_blank"
                rel="noreferrer"
                aria-label="Open GitHub repository"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                {/* GitHub icon */}
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.486 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.091.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.605-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.607.069-.607 1.004.07 1.532 1.032 1.532 1.032.893 1.53 2.341 1.088 2.91.833.091-.647.35-1.088.636-1.339-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.026 2.748-1.026.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.337 4.695-4.566 4.944.359.31.679.919.679 1.852 0 1.336-.012 2.414-.012 2.742 0 .267.18.577.688.479A10.02 10.02 0 0 0 22 12.017C22 6.486 17.523 2 12 2z" />
                </svg>
              </a>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
          {/* プレビューとドロップ枠を統合 */}
          <UploadDropzone
            variant="overlay"
            onFileLoaded={onFileLoaded}
            onError={setError}
            className="rounded-xl"
            disableClick={Boolean(molecule)}
            disableDrop={false}
          >
            <Viewer molecule={molecule} style={style} onGroupReady={setViewerGroup} className="h-[50vh] min-h-[340px]" />
          </UploadDropzone>

          {/* 左カラム: オプションのみ（ARは右カラムへ） */}
          <OptionsPanel value={style} onChange={setStyle} disabled={!molecule} />

          {info ? (
            <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-none text-amber-600" fill="currentColor" aria-hidden>
                <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm0 14a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm-1-8h2v6h-2V8Z" />
              </svg>
              <span>{info}</span>
            </div>
          ) : null}
          {error ? (
            <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-none text-rose-600" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm1 13.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM11 7h2v6h-2V7Z" />
              </svg>
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        {/* 右カラム: AR → QR の順に配置 */}
          <div className="space-y-4 lg:sticky lg:top-6 min-w-0">
            <ArPanel source={viewerGroup} disabled={!molecule} showOpenAr showSizes={false} />
            <QrMaker
              shareUrl={shareState?.url ?? null}
              encodedLength={shareState?.encoded.length ?? null}
              payloadBytes={shareState?.byteLength ?? null}
              scaleExp={shareState?.scaleExp}
                title={title}
                onChangeTitle={setTitle}
              omitBonds={omitBonds}
              onChangeOmitBonds={setOmitBonds}
              coarseCoords={coarseCoords}
              onChangeCoarseCoords={setCoarseCoords}
                precisionDrop={precisionDrop}
                onChangePrecisionDrop={setPrecisionDrop}
                useDelta={useDelta}
                onChangeUseDelta={setUseDelta}
                encrypt={encrypt}
                onChangeEncrypt={setEncrypt}
                password={password}
                onChangePassword={setPassword}
            />
          </div>
      </div>
    </main>
  );
};

export default HomePage;

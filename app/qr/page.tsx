"use client";

import { useEffect, useMemo, useState } from "react";
import type { Group } from "three";
import { Viewer } from "@/components/Viewer";
import { OptionsPanel } from "@/components/OptionsPanel";
import { ArPanel } from "@/components/ArPanel";
import { APP_NAME, TAGLINE } from "@/lib/branding";
import { decodeShareSegment } from "@/lib/share/decode";
import type { Molecule, StyleSettings } from "@/lib/chem/types";

const DEFAULT_STYLE: StyleSettings = {
  material: "standard",
  atomScale: 0.28,
  bondRadius: 0.09,
  quality: "medium",
};

const ShareQrPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [molecule, setMolecule] = useState<Molecule | null>(null);
  const [style, setStyle] = useState<StyleSettings>(DEFAULT_STYLE);
  const [viewerGroup, setViewerGroup] = useState<Group | null>(null);

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

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <header className="space-y-1 text-center">
        <h1 className="text-3xl font-bold text-slate-900">{APP_NAME}</h1>
        <p className="text-slate-600">{subtitle}</p>
        <div className="mt-1 text-xs text-slate-500">
          <a href="https://github.com/kfchem/molequar" target="_blank" rel="noreferrer" className="hover:underline">
            GitHub
          </a>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-slate-500">
          Decoding QR payload...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6 min-w-0">
            <Viewer molecule={molecule} style={style} onGroupReady={setViewerGroup} />

            {/* Rendering Options をアコーディオンでデフォルト非表示 */}
            <details className="rounded-xl border border-slate-200 bg-white p-4" open={false}>
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">Rendering Options</h2>
                  <span className="text-sm text-slate-500">toggle</span>
                </div>
              </summary>
              <div className="mt-4">
                <OptionsPanel value={style} onChange={setStyle} disabled={!molecule} />
              </div>
            </details>
          </div>

          <div className="space-y-6 min-w-0">
            {/* AR はボタン一つの見た目に */}
            <ArPanel source={viewerGroup} disabled={!molecule} compact showOpenAr showSizes={false} />
          </div>
        </div>
      )}
    </main>
  );
};

export default ShareQrPage;

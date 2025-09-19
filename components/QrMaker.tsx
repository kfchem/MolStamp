"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export type QrMakerProps = {
  shareUrl: string | null;
  encodedLength: number | null;
};

export const QrMaker = ({ shareUrl, encodedLength }: QrMakerProps) => {
  const [ecc, setEcc] = useState<ErrorCorrectionLevel>("Q");
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!shareUrl) {
      setSvgMarkup(null);
      setPngUrl(null);
      return () => {
        cancelled = true;
      };
    }
    // Build SVG (シャープなDL用)
    QRCode.toString(shareUrl, {
      type: "svg",
      errorCorrectionLevel: ecc,
      margin: 1,
      color: { dark: "#1f2937", light: "#ffffff" },
    })
      .then((svg) => {
        if (!cancelled) {
          setSvgMarkup(svg);
          setError(null);
        }
      })
      .catch((qrError: Error) => {
        if (!cancelled) {
          setError(qrError.message);
          setSvgMarkup(null);
        }
      });

    // Build PNG for preview and download
    QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: ecc,
      margin: 1,
      color: { dark: "#1f2937", light: "#ffffff" },
      scale: 8,
    })
      .then((dataUrl) => {
        if (!cancelled) setPngUrl(dataUrl);
      })
      .catch((qrError: Error) => {
        if (!cancelled) setError(qrError.message);
      });

    return () => {
      cancelled = true;
    };
  }, [shareUrl, ecc]);

  const canRender = Boolean(
    shareUrl && encodedLength && encodedLength <= 4096 && !error,
  );

  const copyUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setError(null);
      return;
    } catch (e) {
      // フォールバック（HTTPや権限なし環境向け）
      try {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand failed");
        setError(null);
      } catch (fallbackErr) {
        setError((fallbackErr as Error).message || "Failed to copy URL");
      }
    }
  }, [shareUrl]);

  const downloadPng = useCallback(() => {
    if (!canRender || !pngUrl) return;
    const anchor = document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = "molequar-qr.png";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, [canRender, pngUrl]);

  const downloadSvg = useCallback(() => {
    if (!canRender || !svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "molequar-qr.svg";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [canRender, svgMarkup]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">QR Sharing</h2>
        <button
          type="button"
          onClick={copyUrl}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!shareUrl}
        >
          Copy URL
        </button>
      </div>
      <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
        {canRender && pngUrl ? (
          <img src={pngUrl} alt="QR code" className="max-h-64 w-auto" />
        ) : (
          <p className="text-sm text-slate-500">QR will appear after upload.</p>
        )}
      </div>
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Error correction</label>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={ecc}
            onChange={(e) => setEcc(e.target.value as ErrorCorrectionLevel)}
            disabled={!shareUrl}
          >
            <option value="L">L (7%)</option>
            <option value="M">M (15%)</option>
            <option value="Q">Q (25%)</option>
            <option value="H">H (30%)</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={downloadPng}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canRender || !pngUrl}
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canRender || !svgMarkup}
          >
            Download SVG
          </button>
        </div>
      </div>
    </div>
  );
};

QrMaker.displayName = "QrMaker";

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedSelect } from "./AnimatedSelect";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
type DotShape = "square" | "round" | "diamond" | "rounded";
type CenterIcon = "none" | "brand" | "upload";

export type QrMakerProps = {
  shareUrl: string | null;
  encodedLength: number | null;
  omitBonds?: boolean;
  onChangeOmitBonds?: (v: boolean) => void;
  // compressed payload byte length (deflated binary), for diagnostics
  payloadBytes?: number | null;
  coarseCoords?: boolean; // legacy boolean: equals precisionDrop=1
  onChangeCoarseCoords?: (v: boolean) => void;
  decimalDigits?: 0 | 1 | 2 | 3;
  onChangeDecimalDigits?: (v: 0 | 1 | 2 | 3) => void;
  // scale exponent e where M = 2^e (for effective step display)
  scaleExp?: number;
};

export const QrMaker = ({ shareUrl, encodedLength, omitBonds, onChangeOmitBonds, payloadBytes, coarseCoords, onChangeCoarseCoords, decimalDigits, onChangeDecimalDigits, scaleExp }: QrMakerProps) => {
  const [ecc, setEcc] = useState<ErrorCorrectionLevel>("L");
  const [dotShape, setDotShape] = useState<DotShape>("square");
  const [centerIcon, setCenterIcon] = useState<CenterIcon>("none");
  const [uploadedIconUrl, setUploadedIconUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [canEncode, setCanEncode] = useState<boolean>(false);
  const [qrTried, setQrTried] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!shareUrl) {
      setSvgMarkup(null);
      setPngUrl(null);
      setCanEncode(false);
      setQrTried(false);
      return () => {
        cancelled = true;
      };
    }
    const DARK = "#1f2937";
    const LIGHT = "#ffffff";

    const loadImage = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });

    const getSvgSize = (svg: string, fallback: number) => {
      const vb = svg.match(/viewBox\s*=\s*"[^"]*\b0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/i);
      if (vb) {
        const w = parseFloat(vb[1]);
        const h = parseFloat(vb[2]);
        if (!isNaN(w) && !isNaN(h) && w === h) return w;
      }
      const ww = svg.match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)"/i);
      const hh = svg.match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)"/i);
      if (ww && hh) {
        const w = parseFloat(ww[1]);
        const h = parseFloat(hh[1]);
        if (!isNaN(w) && !isNaN(h) && w === h) return w;
      }
      return fallback;
    };

    // Resolve center icon href to a data URL (embed) to avoid broken links in standalone SVG viewers
    const ensureIconHref = async (): Promise<string | null> => {
      if (centerIcon === "none") return null;
      if (centerIcon === "upload") return uploadedIconUrl ?? null;
      if (centerIcon === "brand") {
        try {
          const res = await fetch("/favicon.svg", { cache: "force-cache" });
          const text = await res.text();
          // Encode as data URL (UTF-8). Using percent-encoding for compatibility.
          const encoded = encodeURIComponent(text);
          return `data:image/svg+xml;charset=utf-8,${encoded}`;
        } catch {
          return null;
        }
      }
      return null;
    };

    const buildCenterIconSvg = (width: number, iconHref: string | null) => {
      if (!iconHref) return "";
      const box = width * 0.22;
      const cx = width / 2;
      const cy = width / 2;
      const B = box.toFixed(2);
      // Outline thickness relative to icon size (no blur)
      const t = Math.max(1, box * 0.06);
      const filterId = `qrIconOutline`;
      return (
        `<defs>` +
        `<filter id="${filterId}" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">` +
        `<feMorphology operator="dilate" radius="${t.toFixed(2)}" in="SourceAlpha" result="dilated"/>` +
        `<feComposite in="dilated" in2="SourceAlpha" operator="out" result="ring"/>` +
        `<feFlood flood-color="#ffffff" flood-opacity="1" result="white"/>` +
        `<feComposite in="white" in2="ring" operator="in" result="outline"/>` +
        `<feMerge>` +
        `<feMergeNode in="outline"/>` +
        `<feMergeNode in="SourceGraphic"/>` +
        `</feMerge>` +
        `</filter>` +
        `</defs>` +
        `<g transform="translate(${cx.toFixed(2)}, ${cy.toFixed(2)})">` +
        `<image href="${iconHref}" x="${(-(parseFloat(B) / 2)).toFixed(2)}" y="${(-(parseFloat(B) / 2)).toFixed(2)}" width="${B}" height="${B}" preserveAspectRatio="xMidYMid meet" filter="url(#${filterId})" />` +
        `</g>`
      );
    };

    const drawCenterIconCanvas = async (
      ctx: CanvasRenderingContext2D,
      width: number,
      iconHref: string | null
    ) => {
      if (!iconHref) return;
      const box = width * 0.22;
      const cx = width / 2;
      const cy = width / 2;
      ctx.imageSmoothingEnabled = true;
      try {
        const img = await loadImage(iconHref);
        const ratio = img.width / img.height;
        let w = box, h = box;
        if (ratio > 1) h = box / ratio; else w = box * ratio;

        // Build silhouette from icon alpha on an offscreen canvas
        const off = document.createElement("canvas");
        off.width = Math.ceil(w);
        off.height = Math.ceil(h);
        const offCtx = off.getContext("2d")!;
        offCtx.imageSmoothingEnabled = true;
        offCtx.drawImage(img, 0, 0, w, h);
        offCtx.globalCompositeOperation = "source-in";
        offCtx.fillStyle = "#ffffff";
        offCtx.fillRect(0, 0, off.width, off.height);

        // Create crisp outline (no blur) via dilate-approximation and subtract original
        const tPx = Math.ceil(Math.max(1, box * 0.06));
        const ring = document.createElement("canvas");
        ring.width = off.width + 2 * tPx;
        ring.height = off.height + 2 * tPx;
        const ringCtx = ring.getContext("2d")!;
        ringCtx.imageSmoothingEnabled = true;
        const steps = 48;
        for (let r = 1; r <= tPx; r++) {
          for (let i = 0; i < steps; i++) {
            const theta = (i / steps) * Math.PI * 2;
            const dx = Math.cos(theta) * r;
            const dy = Math.sin(theta) * r;
            ringCtx.drawImage(off, tPx + dx, tPx + dy);
          }
        }
        // Subtract the original silhouette to leave only the outer ring
        ringCtx.globalCompositeOperation = "destination-out";
        ringCtx.drawImage(off, tPx, tPx);
        ringCtx.globalCompositeOperation = "source-over";

        // Draw outline then original icon
        ctx.drawImage(ring, cx - ring.width / 2, cy - ring.height / 2);
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      } catch {}
    };

    const buildSquare = async () => {
      const svg = await QRCode.toString(shareUrl, {
        type: "svg",
        errorCorrectionLevel: ecc,
        margin: 1,
        width: 256,
        color: { dark: DARK, light: LIGHT },
      });
      const svgSize = getSvgSize(svg, 256);
      const iconHref = await ensureIconHref();
      const svgWithIcon = svg.replace(/<\/svg>\s*$/, `${buildCenterIconSvg(svgSize, iconHref)}</svg>`);

      const basePng = await QRCode.toDataURL(shareUrl, {
        errorCorrectionLevel: ecc,
        margin: 1,
        color: { dark: DARK, light: LIGHT },
        width: 1024,
      });
      const canvas = document.createElement("canvas");
      const size = 1024;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      try {
        const img = await loadImage(basePng);
        ctx.drawImage(img, 0, 0);
      } catch {}
      await drawCenterIconCanvas(ctx, size, iconHref);
      const png = canvas.toDataURL("image/png");
      return { svg: svgWithIcon, png };
    };

    const buildCustom = async (shape: Exclude<DotShape, "square">) => {
      const qr: any = (QRCode as any).create(shareUrl, { errorCorrectionLevel: ecc });
      const size: number = qr.modules.size;
      const data: boolean[] = qr.modules.data;
      const margin = 1;
      const widthSvg = 256;
      const pngWidth = 1024;
      const cell = widthSvg / (size + margin * 2);
      const cellPng = pngWidth / (size + margin * 2);

      const parts: string[] = [];
      parts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${widthSvg}" height="${widthSvg}" viewBox="0 0 ${widthSvg} ${widthSvg}" shape-rendering="geometricPrecision" preserveAspectRatio="xMidYMid meet">`
      );
      parts.push(`<rect width="100%" height="100%" fill="${LIGHT}"/>`);

      const inFinder = (x: number, y: number) =>
        (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

      const sSvg = cell * 0.9;
      const sPng = cellPng * 0.9;
      const rSvg = cell * 0.45;
      const rPng = cellPng * 0.45;
      const cornerSvg = sSvg * 0.25;
      const cornerPng = sPng * 0.25;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (inFinder(x, y)) continue;
          const idx = y * size + x;
          if (!data[idx]) continue;
          const cx = (x + margin + 0.5) * cell;
          const cy = (y + margin + 0.5) * cell;

          if (shape === "round") {
            parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rSvg.toFixed(2)}" fill="${DARK}"/>`);
          } else if (shape === "diamond") {
            const x0 = (cx - sSvg / 2).toFixed(2);
            const y0 = (cy - sSvg / 2).toFixed(2);
            parts.push(`<rect x="${x0}" y="${y0}" width="${sSvg.toFixed(2)}" height="${sSvg.toFixed(2)}" fill="${DARK}" transform="rotate(45 ${cx.toFixed(2)} ${cy.toFixed(2)})"/>`);
          } else if (shape === "rounded") {
            const x0 = (cx - sSvg / 2).toFixed(2);
            const y0 = (cy - sSvg / 2).toFixed(2);
            parts.push(`<rect x="${x0}" y="${y0}" width="${sSvg.toFixed(2)}" height="${sSvg.toFixed(2)}" rx="${cornerSvg.toFixed(2)}" ry="${cornerSvg.toFixed(2)}" fill="${DARK}"/>`);
          }
        }
      }

      const drawFinder = (gx: number, gy: number) => {
        const x = (gx + margin) * cell;
        const y = (gy + margin) * cell;
        const s7 = 7 * cell;
        const s5 = 5 * cell;
        const s3 = 3 * cell;
        parts.push(`<rect x="${x}" y="${y}" width="${s7}" height="${s7}" fill="${DARK}"/>`);
        parts.push(`<rect x="${x + cell}" y="${y + cell}" width="${s5}" height="${s5}" fill="${LIGHT}"/>`);
        parts.push(`<rect x="${x + 2 * cell}" y="${y + 2 * cell}" width="${s3}" height="${s3}" fill="${DARK}"/>`);
      };
      drawFinder(0, 0);
      drawFinder(size - 7, 0);
      drawFinder(0, size - 7);

      const iconHref = await ensureIconHref();
      parts.push(buildCenterIconSvg(widthSvg, iconHref));
      parts.push(`</svg>`);
      const svg = parts.join("");

      const canvas = document.createElement("canvas");
      canvas.width = pngWidth;
      canvas.height = pngWidth;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = LIGHT;
      ctx.fillRect(0, 0, pngWidth, pngWidth);
      ctx.fillStyle = DARK;

      const drawRoundedRect = (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        r: number
      ) => {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
        ctx.fill();
      };

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (inFinder(x, y)) continue;
          const idx = y * size + x;
          if (!data[idx]) continue;
          const cx = (x + margin + 0.5) * cellPng;
          const cy = (y + margin + 0.5) * cellPng;

          if (shape === "round") {
            ctx.beginPath();
            ctx.arc(cx, cy, rPng, 0, Math.PI * 2);
            ctx.fill();
          } else if (shape === "diamond") {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 4);
            ctx.fillRect(-sPng / 2, -sPng / 2, sPng, sPng);
            ctx.restore();
          } else if (shape === "rounded") {
            drawRoundedRect(ctx, cx - sPng / 2, cy - sPng / 2, sPng, sPng, cornerPng);
          }
        }
      }

      const drawFinderCanvas = (gx: number, gy: number) => {
        const x = (gx + margin) * cellPng;
        const y = (gy + margin) * cellPng;
        ctx.fillStyle = DARK;
        ctx.fillRect(x, y, 7 * cellPng, 7 * cellPng);
        ctx.fillStyle = LIGHT;
        ctx.fillRect(x + cellPng, y + cellPng, 5 * cellPng, 5 * cellPng);
        ctx.fillStyle = DARK;
        ctx.fillRect(x + 2 * cellPng, y + 2 * cellPng, 3 * cellPng, 3 * cellPng);
      };
      drawFinderCanvas(0, 0);
      drawFinderCanvas(size - 7, 0);
      drawFinderCanvas(0, size - 7);

      await drawCenterIconCanvas(ctx, pngWidth, iconHref);
      const png = canvas.toDataURL("image/png");
      return { svg, png };
    };

    setQrTried(true);
    (dotShape === "square" ? buildSquare() : buildCustom(dotShape))
      .then(({ svg, png }) => {
        if (!cancelled) {
          setSvgMarkup(svg);
          setPngUrl(png);
          setError(null);
          setCanEncode(true);
        }
      })
      .catch((qrError: Error) => {
        if (!cancelled) {
          const msg = qrError?.message || "Failed to render QR";
          const urlBytes = shareUrl ? new TextEncoder().encode(shareUrl).length : 0;
          const fragmentBytes = (() => {
            if (typeof encodedLength === "number" && encodedLength >= 0) return encodedLength;
            if (!shareUrl) return 0;
            const i = shareUrl.indexOf("#");
            return i >= 0 ? shareUrl.length - (i + 1) : 0;
          })();
          const baseBytes = Math.max(0, urlBytes - fragmentBytes);
          const fmt = (b: number | null | undefined) => {
            if (!b || b <= 0) return "0 KB";
            return `${(b / 1024).toFixed(1)} KB`;
          };
          const overhead = typeof payloadBytes === "number" ? Math.max(0, fragmentBytes - payloadBytes) : null;
          const parts = [
            `URL: ${fmt(urlBytes)}`,
            `Fragment: ${fmt(fragmentBytes)}`,
          ];
          if (typeof payloadBytes === "number") {
            parts.push(`Payload: ${fmt(payloadBytes)}`);
            parts.push(`Base80 overhead: ${fmt(overhead ?? 0)}`);
          }
          parts.push(`Base URL: ${fmt(baseBytes)}`);
          const detail = parts.join(" • ");
          if (/code length overflow/i.test(msg)) {
            setError(`Payload exceeds QR capacity (${detail}). Try Bond omission, reducing decimal precision (e.g., 3→2→1→0), or lowering Error correction.`);
          } else {
            setError(`${msg} (${detail})`);
          }
          setSvgMarkup(null);
          setPngUrl(null);
          setCanEncode(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shareUrl, ecc, dotShape, centerIcon, uploadedIconUrl]);

  const canRender = Boolean(shareUrl && qrTried && canEncode && !error);

  const svgPreview = useMemo(() => {
    if (!svgMarkup) return null;
    try {
      if (svgMarkup.includes("shape-rendering=")) {
        return svgMarkup.replace(
          /shape-rendering="[^"]*"/,
          'shape-rendering="geometricPrecision"'
        );
      }
      return svgMarkup.replace(
        /<svg(\s|>)/,
        '<svg shape-rendering="geometricPrecision" preserveAspectRatio="xMidYMid meet" $1'
      );
    } catch {
      return svgMarkup;
    }
  }, [svgMarkup]);

  const copyUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setError(null);
      return;
    } catch (e) {
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
  anchor.download = "m2go-qr.png";
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
  a.download = "m2go-qr.svg";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [canRender, svgMarkup]);

  const [open, setOpen] = useState<boolean>(false);
  return (
    <motion.div layout className="space-y-3 rounded-xl border border-slate-300 bg-white p-4 shadow-sm max-w-full">
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
      <motion.div layout className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-3 overflow-hidden max-w-full">
        <AnimatePresence initial={false} mode="wait">
          {canRender && (svgPreview || pngUrl) ? (
            svgPreview ? (
              <motion.div
                key="qr-svg"
                className="w-full max-w-full [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-72"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                role="img"
                aria-label="QR code"
                dangerouslySetInnerHTML={{ __html: svgPreview }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <motion.img
                key="qr-png"
                src={pngUrl!}
                alt="QR code"
                className="h-auto max-h-64 w-full max-w-full object-contain"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            )
          ) : (
            <motion.p
              key="placeholder"
              className="text-sm text-slate-500"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              QR will appear after upload.
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="grid gap-3 grid-cols-2">
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
      <motion.div layout className="rounded-lg border border-slate-200">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-t-lg bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-700"
          onClick={() => setOpen((v) => !v)}
        >
          <span>Options</span>
          <svg
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : "rotate-0"}`}
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.207l3.71-2.977a.75.75 0 1 1 .94 1.172l-4.2 3.366a.75.75 0 0 1-.94 0l-4.2-3.366a.75.75 0 0 1-.02-1.062z" />
          </svg>
        </button>
        <div className={`grid transition-all duration-300 ease-in-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className={`min-h-0 ${open ? "overflow-visible" : "overflow-hidden"}`}>
            <div className="px-3">
              <div className="py-3 space-y-4">
                {typeof omitBonds === "boolean" && onChangeOmitBonds ? (
                  <div>
                    <label className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Bond omission</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">smaller QR</span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          checked={omitBonds}
                          onChange={(e) => onChangeOmitBonds?.(e.target.checked)}
                          disabled={!shareUrl}
                        />
                      </span>
                    </label>
                  </div>
                ) : null}
                {typeof decimalDigits !== "undefined" && onChangeDecimalDigits ? (
                  <div>
                    <label className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coordinate step</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">Å (effective)</span>
                        <select
                          className="h-7 rounded border-slate-300 text-slate-700 text-xs"
                          value={decimalDigits}
                          onChange={(e) => onChangeDecimalDigits?.(Number(e.target.value) as 0 | 1 | 2 | 3)}
                          disabled={!shareUrl}
                        >
                          {(() => {
                            const e = typeof scaleExp === "number" ? scaleExp : 0;
                            // mapping: decimalDigits -> precisionDrop (0,2,5,8)
                            const drops: Record<0 | 1 | 2 | 3, number> = { 3: 0, 2: 2, 1: 5, 0: 8 } as const;
                            const label = (d: 0 | 1 | 2 | 3) => {
                              const drop = drops[d as 0 | 1 | 2 | 3] ?? 0;
                              const step = (Math.pow(2, e + drop) / 1000);
                              // chemistry-friendly short labels
                              // ~0.001 Å (High), ~0.01 Å (Med), ~0.1 Å (Low), ~0.3 Å (Very low) など
                              const fmt = step >= 0.1 ? `${step.toFixed(2)} Å` : step >= 0.01 ? `${step.toFixed(3)} Å` : `${step.toFixed(4)} Å`;
                              const tag = step < 0.01 ? "High" : step < 0.05 ? "Med" : step < 0.2 ? "Low" : "Very low";
                              return `${fmt} (${tag})`;
                            };
                            return [
                              <option key={3} value={3}>{label(3)}</option>,
                              <option key={2} value={2}>{label(2)}</option>,
                              <option key={1} value={1}>{label(1)}</option>,
                              <option key={0} value={0}>{label(0)}</option>,
                            ];
                          })()}
                        </select>
                      </span>
                    </label>
                  </div>
                ) : null}
                {typeof coarseCoords === "boolean" && onChangeCoarseCoords && typeof decimalDigits === "undefined" ? (
                  <div>
                    <label className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coarser coordinates</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">-1 bit, smaller QR</span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          checked={coarseCoords}
                          onChange={(e) => onChangeCoarseCoords?.(e.target.checked)}
                          disabled={!shareUrl}
                        />
                      </span>
                    </label>
                  </div>
                ) : null}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Error correction</label>
                  </div>
                  <AnimatedSelect<ErrorCorrectionLevel>
                    className="mt-1"
                    value={ecc}
                    onChange={(v) => setEcc(v)}
                    options={[
                      { value: "L", label: "L (7%)" },
                      { value: "M", label: "M (15%)" },
                      { value: "Q", label: "Q (25%)" },
                      { value: "H", label: "H (30%)" },
                    ]}
                    disabled={!shareUrl}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Dot shape</label>
                  </div>
                  <AnimatedSelect<DotShape>
                    className="mt-1"
                    value={dotShape}
                    onChange={(v) => setDotShape(v)}
                    options={[
                      { value: "square", label: "Square" },
                      { value: "round", label: "Round" },
                      { value: "diamond", label: "Diamond" },
                      { value: "rounded", label: "Rounded square" },
                    ]}
                    disabled={!shareUrl}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Center icon</label>
                  </div>
                  <div className="mt-1">
                    <AnimatedSelect<CenterIcon>
                      value={centerIcon}
                      onChange={(v) => {
                        // if switching away from upload, clear uploaded icon
                        if (v !== "upload" && uploadedIconUrl) {
                          setUploadedIconUrl(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }
                        setCenterIcon(v);
                        if (v === "upload") {
                          // ensure same-file re-upload triggers change
                          if (fileInputRef.current) fileInputRef.current.value = "";
                          fileInputRef.current?.click();
                        }
                      }}
                      options={[
                        { value: "none", label: "None" },
                        { value: "brand", label: "Molecular ToGo" },
                        { value: "upload", label: "Upload" },
                      ]}
                      disabled={!shareUrl}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const reader = new FileReader();
                        reader.onload = () => setUploadedIconUrl(reader.result as string);
                        reader.readAsDataURL(f);
                      }}
                    />
                    {centerIcon === "upload" && uploadedIconUrl ? (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-slate-500">Preview:</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={uploadedIconUrl} alt="icon" width={32} height={32} className="h-8 w-8 object-contain rounded" />
                        <button
                          type="button"
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-sky-300 hover:text-sky-600"
                          onClick={() => {
                            setUploadedIconUrl(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Protection</label>
                    <span className="text-[10px] rounded bg-sky-50 px-1.5 py-0.5 text-sky-600">Soon</span>
                  </div>
                  <AnimatedSelect
                    className="mt-1"
                    value={"none" as any}
                    onChange={() => {}}
                    options={[{ value: "none" as any, label: "None" }, { value: "passcode" as any, label: "Passcode" }, { value: "encrypt" as any, label: "Encrypt" }]}
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

QrMaker.displayName = "QrMaker";

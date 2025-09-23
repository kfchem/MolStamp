"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedSelect } from "./AnimatedSelect";
import { AnimatePresence, motion } from "framer-motion";
import { LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";
import QRCode from "qrcode";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
type DotShape = "square" | "round" | "diamond" | "rounded";
type CenterIcon = "none" | "brand" | "upload";

export type QrMakerProps = {
  shareUrl: string | null;
  encodedLength: number | null;
  title?: string;
  onChangeTitle?: (v: string) => void;
  omitBonds?: boolean;
  onChangeOmitBonds?: (v: boolean) => void;
  // compressed payload byte length (deflated binary), for diagnostics
  payloadBytes?: number | null;
  coarseCoords?: boolean; // legacy boolean: equals precisionDrop=1
  onChangeCoarseCoords?: (v: boolean) => void;
  // number of LSBs dropped during quantization (0..8)
  precisionDrop?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  onChangePrecisionDrop?: (v: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => void;
  // scale exponent e where M = 2^e (for effective step display)
  scaleExp?: number;
  useDelta?: boolean;
  onChangeUseDelta?: (v: boolean) => void;
  // encryption controls
  encrypt?: boolean;
  onChangeEncrypt?: (v: boolean) => void;
  password?: string;
  onChangePassword?: (v: string) => void;
};

export const QrMaker = ({ shareUrl, encodedLength, title, onChangeTitle, omitBonds, onChangeOmitBonds, payloadBytes, coarseCoords, onChangeCoarseCoords, precisionDrop, onChangePrecisionDrop, scaleExp, useDelta, onChangeUseDelta, encrypt, onChangeEncrypt, password, onChangePassword }: QrMakerProps) => {
  const [ecc, setEcc] = useState<ErrorCorrectionLevel>("L");
  const [dotShape, setDotShape] = useState<DotShape>("square");
  const [centerIcon, setCenterIcon] = useState<CenterIcon>("none");
  const [uploadedIconUrl, setUploadedIconUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // for encryption toggle invalid attempt shake
  const [encShake, setEncShake] = useState<boolean>(false);
  const sanitizeTitleLocal = useCallback((s: string) => {
    const allowed = new Set<string>([' ', '-', ...'0123456789', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'abcdefghijklmnopqrstuvwxyz']);
    let out = '';
    for (const ch of s) {
      if (allowed.has(ch)) out += ch; else if (/\s/.test(ch)) out += ' '; else out += '-';
      if (out.length >= 63) break;
    }
    out = out.replace(/\s{2,}/g, ' ').replace(/^-+/, '').replace(/-+$/, '').trim();
    return out.slice(0, 63);
  }, []);

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
            setError(`Payload exceeds QR capacity (${detail}). Try Bond omission, increase Coordinate step (approx.) (e.g., drop bits 0→2→4→6→8), enable Use delta encoding, or lower Error correction.`);
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
                {typeof onChangeTitle === "function" ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Title</label>
                    </div>
                    <input
                      type="text"
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60 placeholder:text-slate-400"
                      placeholder="Optional title"
                      title="Up to 63 chars; A–Z a–z 0–9 space -"
                      value={title ?? ""}
                      onChange={(e) => onChangeTitle?.(sanitizeTitleLocal(e.target.value))}
                      maxLength={63}
                      disabled={!shareUrl}
                    />
                  </div>
                ) : null}
                {/* Dot shape (moved up) */}
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
                {/* Center icon (moved up) */}
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

                {/* Encryption redesigned */}
                {typeof encrypt === "boolean" && onChangeEncrypt ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Simple encryption</label>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="password"
                        className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60 placeholder:text-slate-400 ${encShake ? "border-rose-500 bg-rose-50" : "border-slate-200"}`}
                        placeholder={"Password (min 4 chars)"}
                        value={password ?? ""}
                        onChange={(e) => onChangePassword?.(e.target.value)}
                        disabled={!shareUrl}
                        aria-invalid={encShake || undefined}
                      />
                      <motion.button
                        type="button"
                        role="switch"
                        aria-checked={encrypt}
                        aria-label={encrypt ? "Encrypted" : "Unencrypted"}
                        onClick={() => {
                          if (!onChangeEncrypt) return;
                          if (!encrypt) {
                            const pwd = (password ?? "").trim();
                            const isValid = pwd.length >= 4;
                            if (!isValid) {
                              setEncShake(true);
                              setTimeout(() => setEncShake(false), 1100);
                              return;
                            }
                          }
                          onChangeEncrypt(!encrypt);
                        }}
                        disabled={!shareUrl}
                        className={`relative h-[38px] w-20 rounded-md p-0.5 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${encrypt ? "bg-sky-50 border border-sky-300 hover:border-sky-400 " : "bg-white border border-slate-200 hover:border-sky-300 "}`}
                      >
                        <motion.div
                          className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[0.36rem] ${encrypt ? "bg-sky-500" : "bg-slate-500"}`}
                          animate={encShake ? { left: ["0.125rem", "0.9rem", "0.2rem", "0.75rem", "0.3rem", "0.6rem", "0.125rem"] } : { left: encrypt ? "50%" : "0.125rem" }}
                          transition={encShake ? { duration: 0.35, ease: "easeInOut" } : { type: "spring", stiffness: 300, damping: 26 }}
                        />
                        <span className="absolute top-0.5 bottom-0.5 left-0.5 z-10 grid w-[calc(50%-2px)] place-items-center">
                          <LockOpenIcon className={`${encrypt ? "text-slate-600" : "text-white"} h-4 w-4`} />
                        </span>
                        <span className="absolute top-0.5 bottom-0.5 right-0.5 z-10 grid w-[calc(50%-2px)] place-items-center">
                          <LockClosedIcon className={`${encrypt ? "text-white" : "text-slate-600"} h-4 w-4`} />
                        </span>
                        <span className="sr-only">{encrypt ? "Encrypted" : "Unencrypted"}</span>
                      </motion.button>
                    </div>
                  </div>
                ) : null}

                {/* Error correction moved before step */}
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

                {typeof precisionDrop !== "undefined" && onChangePrecisionDrop ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Coordinate step (approx.)</label>
                    </div>
                    <AnimatedSelect<string>
                      className="mt-1"
                      value={String(precisionDrop)}
                      onChange={(v) => onChangePrecisionDrop?.(Number(v) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8)}
                      disabled={!shareUrl}
                      options={(() => {
                        const e = typeof scaleExp === "number" ? scaleExp : 0;
                        const label = (drop: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => {
                          const step = Math.pow(2, e + drop) / 1000; // Å
                          const fmtNum = (v: number) => {
                            const s = v.toFixed(4);
                            return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
                          };
                          const fmt = `${fmtNum(step)} Å`;
                          const tag = step < 0.01 ? "High" : step < 0.05 ? "Med" : step < 0.2 ? "Low" : "Very low";
                          return `${fmt} (${tag})`;
                        };
                        const arr: { value: string; label: string }[] = [];
                        for (let d = 0 as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; d <= 8; d = (d + 1) as any) {
                          arr.push({ value: String(d), label: label(d) });
                        }
                        return arr;
                      })()}
                    />
                  </div>
                ) : null}
                {typeof coarseCoords === "boolean" && onChangeCoarseCoords && typeof precisionDrop === "undefined" ? (
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
                {/* Bond data (toggle) */}
                {typeof omitBonds === "boolean" && onChangeOmitBonds ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Bond data</label>
                    </div>
                    <div className="mt-1">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={omitBonds}
                        aria-label={omitBonds ? "Auto-generate bonds" : "Include bonds"}
                        onClick={() => onChangeOmitBonds?.(!omitBonds)}
                        disabled={!shareUrl}
                        className={`relative h-[38px] w-full rounded-md p-0.5 shadow-sm transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${omitBonds ? "bg-sky-50 border border-sky-300 hover:border-sky-400" : "bg-white border border-slate-200 hover:border-sky-300"}`}
                      >
                        <motion.div
                          className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[0.36rem] ${omitBonds ? "bg-sky-500" : "bg-slate-500"}`}
                          animate={{ left: omitBonds ? "50%" : "0.125rem" }}
                          transition={{ type: "spring", stiffness: 300, damping: 26 }}
                        />
                        <span className="absolute top-0.5 bottom-0.5 left-0.5 z-10 grid w-[calc(50%-2px)] place-items-center">
                          <span className={`${omitBonds ? "text-slate-600" : "text-white"} text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis`}>Include</span>
                        </span>
                        <span className="absolute top-0.5 bottom-0.5 right-0.5 z-10 grid w-[calc(50%-2px)] place-items-center">
                          <span className={`${omitBonds ? "text-white" : "text-slate-600"} text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis`}>Auto-generate</span>
                        </span>
                        <span className="sr-only">{omitBonds ? "Auto-generate bonds" : "Include bonds"}</span>
                      </button>
                    </div>
                  </div>
                ) : null}
                {/* Delta encoding (toggle) */}
                {typeof useDelta === "boolean" && onChangeUseDelta ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Atom indices</label>
                    </div>
                    <div className="mt-1">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={useDelta}
                        aria-label={useDelta ? "Optimized" : "As-is"}
                        onClick={() => onChangeUseDelta?.(!useDelta)}
                        disabled={!shareUrl}
                        className={`relative h-[38px] w-full rounded-md p-0.5 shadow-sm transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${useDelta ? "bg-sky-50 border border-sky-300 hover:border-sky-400" : "bg-white border border-slate-200 hover:border-sky-300"}`}
                      >
                        <motion.div
                          className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[0.36rem] ${useDelta ? "bg-sky-500" : "bg-slate-500"}`}
                          animate={{ left: useDelta ? "50%" : "0.125rem" }}
                          transition={{ type: "spring", stiffness: 300, damping: 26 }}
                        />
                        <span className="absolute top-0.5 bottom-0.5 left-0.5 z-10 grid w-[calc(50%-2px)] place-items-center">
                          <span className={`${useDelta ? "text-slate-600" : "text-white"} text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis`}>As-is</span>
                        </span>
                        <span className="absolute top-0.5 bottom-0.5 right-0.5 z-10 grid w-[calc(50%-2px)] place-items-center">
                          <span className={`${useDelta ? "text-white" : "text-slate-600"} text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis`}>Optimized</span>
                        </span>
                        <span className="sr-only">{useDelta ? "Optimized" : "As-is"}</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

QrMaker.displayName = "QrMaker";

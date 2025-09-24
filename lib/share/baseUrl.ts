// Detect basePath at runtime to ensure QR URLs include "/ms" on static Pages export
const detectBasePath = (): string => {
  try {
    // Prefer App Router injected icon link: "/ms/icon.svg?..." -> basePath "/ms"
    const link = typeof document !== 'undefined' ? document.querySelector('link[rel="icon"]') : null;
    const href = link?.getAttribute('href') || '';
    const m = href.match(/^\/(.+?)\/icon\.(?:svg|png)(?:\?|$)/i);
    if (m && m[1]) return `/${m[1]}`;
  } catch {}
  try {
    const path = window.location.pathname || '';
    const m2 = path.match(/^\/(.+?)(?:\/|$)/);
    // Treat "/ms" as basePath when path starts with it (export mode)
    if (m2 && m2[1] === 'ms') return '/ms';
  } catch {}
  return '';
};

// Export detected basePath for consumers that need environment-specific paths
export const DETECTED_BASE_PATH: string =
  typeof window === "undefined" ? "" : detectBasePath();

export const SHARE_BASE_URL =
  typeof window === "undefined"
    ? ""
    : (() => {
        const configured = process.env.NEXT_PUBLIC_SHARE_BASE_URL;
        const bp = DETECTED_BASE_PATH;
        if (!configured) return window.location.origin + bp;
        try {
          const u = new URL(configured);
          // If configured URL has no subpath ("/"), append detected basePath (e.g., "/ms")
          if ((u.pathname === "/" || u.pathname === "") && bp) {
            u.pathname = bp.replace(/\/$/, "");
            return u.toString().replace(/\/$/, "");
          }
          return configured.replace(/\/$/, "");
        } catch {
          // Fallback: naive append when configured looks like origin
          if (configured.endsWith("/")) return configured.replace(/\/$/, "") + bp;
          return configured + bp;
        }
      })();

// Notes:
// - In GitHub Pages export we use trailingSlash=true and basePath "/ms".
// - Hitting "/qr" redirects to "/qr/" by default on Pages (directory index).
// - To avoid that redirect in share links, consumers can prefer "/qr/index.html" when
//   DETECTED_BASE_PATH is non-empty (i.e., export environment with subpath).

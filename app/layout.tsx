import type { Metadata } from "next";
import { ReactNode } from "react";
import { APP_NAME, TAGLINE } from "@/lib/branding";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: TAGLINE,
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full bg-slate-50 overflow-x-hidden">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Favicon (SVG) - keep aligned with QR center icon */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}

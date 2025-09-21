import type { Metadata } from "next";
import Script from "next/script";
import { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "MoleQuAR",
  description: "Molecules from QR to AR.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full bg-slate-50 overflow-x-hidden">
      <body className="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden">
        {children}
        <Script
          src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"
          type="module"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}

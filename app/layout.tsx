import type { Metadata } from "next";
import { ReactNode } from "react";
import { APP_NAME, TAGLINE } from "@/lib/branding";
import "@/styles/globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SHARE_BASE_URL;

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  applicationName: APP_NAME,
  description: TAGLINE,
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  openGraph: {
    title: APP_NAME,
    description: TAGLINE,
    siteName: APP_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: TAGLINE,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full bg-slate-50 overflow-x-hidden">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}

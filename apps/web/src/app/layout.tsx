import type { Metadata, Viewport } from "next";

// Self-hosted type (bundled into the static export → the single-file runtime
// renders identically offline). Each theme picks its own pairing.
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";

import "./globals.css";
import "../styles/base.css";
import "../styles/topbar.css";
import "../styles/map.css";
import "../styles/journey.css";
import "../styles/wherenext.css";
import "../styles/overlays.css";
import "../styles/search.css";
import "../styles/glass.css";
import "../styles/manage.css";
import "../styles/auth.css";

export const metadata: Metadata = {
  title: "Odyssey",
  description: "A local-first personal travel atlas — space, time, memory and where next.",
  applicationName: "Odyssey",
  // Installable from the browser ("Add to Home Screen"): opens full screen
  // like an app, no app store needed.
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Odyssey", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the last-used theme's CSS variables before first paint, so a Night
// atlas never flashes the default Light palette while the
// settings load. applyTheme() keeps this snapshot current.
const THEME_BOOT = `(function(){try{var s=localStorage.getItem("atlas.theme.snapshot");if(!s)return;var t=JSON.parse(s),r=document.documentElement;r.dataset.theme=t.id;r.dataset.mode=t.mode;r.style.colorScheme=t.mode;for(var k in t.vars)r.style.setProperty(k,t.vars[k]);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#F7F6F1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

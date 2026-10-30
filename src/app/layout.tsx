import type { Metadata, Viewport } from "next";
import "./globals.css";
import { asset } from "@/lib/asset";

export const metadata: Metadata = {
  title: "Winter Performance Tickets | Orange County Classical Academy",
  description: "Choose reserved seats for the winter performance.",
  icons: { icon: asset("favicon.png") },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to seats</a>
        <header className="site-header">
          <div className="wrap header-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("logo.png")} alt="Orange County Classical Academy" className="logo" width={180} height={49} />
            <span className="header-title">Winter Performance Tickets</span>
          </div>
        </header>
        <div className="preview-banner" role="note">
          <div className="wrap">Preview: the seating chart and prices are placeholders. No tickets are sold yet.</div>
        </div>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="wrap">Questions about tickets? [Contact name and email]</div>
        </footer>
      </body>
    </html>
  );
}

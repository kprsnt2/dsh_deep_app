import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "All-in-One Chat",
  description:
    "Personal multi-agent chat with multi-provider model fallback and large attachment support.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom is deliberately left enabled: a chat full of tables and lab
  // reports is unusable on a phone if you cannot zoom in.
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0a0a0f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

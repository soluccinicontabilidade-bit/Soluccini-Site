import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SOLUCCINI.", template: "%s · SOLUCCINI." },
  description: "Gestão contábil, BPO financeiro e IRPF",
  icons: { icon: "/marca/simbolo.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4EFFA" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1B28" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

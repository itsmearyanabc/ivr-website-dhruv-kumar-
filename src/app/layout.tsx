import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xpack | IVR Broadcast Panel",
  description: "Create, track, and manage IVR broadcasts from a single panel.",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

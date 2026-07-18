import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xpack | IVR Broadcast Management",
  description: "A premium IVR broadcast management portal for Xpack customers and administrators.",
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

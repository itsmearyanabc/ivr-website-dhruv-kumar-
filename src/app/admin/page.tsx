import type { Metadata } from "next";
import PortalApp from "@/app/_components/PortalApp";

export const metadata: Metadata = {
  title: "Xpack Admin | Operations Console",
  description: "Restricted administrator console for Xpack broadcast operations.",
  robots: { index: false, follow: false },
};

export default function AdminPortalPage() {
  return <PortalApp portal="admin" />;
}

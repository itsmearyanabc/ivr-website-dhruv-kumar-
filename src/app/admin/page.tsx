import type { Metadata } from "next";
import PortalApp from "@/app/_components/PortalApp";

export const metadata: Metadata = {
  title: "BulkShout Admin | Operations Console",
  description: "Restricted administrator console for BulkShout broadcast operations.",
  robots: { index: false, follow: false },
};

export default function AdminPortalPage() {
  return <PortalApp portal="admin" />;
}

import type { Metadata } from "next";
import PortalApp from "@/app/_components/PortalApp";
import MetaPixel from "@/app/_components/MetaPixel";
import SiteControl from "@/app/_components/SiteControl";

/**
 * Route-level metadata, which overrides the generic defaults in layout.tsx.
 *
 * It lives here rather than in the layout because the layout also wraps /admin, which is a
 * restricted console and declares its own `robots: noindex`. Search copy belongs to the one
 * page that is actually a shopfront.
 *
 * `metadataBase` resolves the canonical below against the real domain when APP_URL is set,
 * and falls back to localhost in development so a build never emits a half-formed URL.
 */
const siteUrl = process.env.APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Bulk Voice Call Service in Delhi & India | BulkShout",
  description:
    "Bulk voice calling service in Delhi & across India. Pay only for calls that actually " +
    "connect. Instant refunds for unanswered calls. No setup fee.",
  keywords: [
    "bulk voice call service Delhi",
    "bulk voice call service India",
    "IVR broadcast service",
    "automated voice calling service",
    "voice broadcasting company Delhi NCR",
    "promotional voice call service India",
    "bulk calling service for business",
  ],
  // The landing page is the site root. The suggested descriptive slug is not given its own
  // route on purpose: two URLs serving identical copy split the ranking between them and
  // Google picks one anyway. Point the slug at "/" with a 301 at the domain or CDN if you
  // want it in circulation - it will then pass its weight to this page rather than compete
  // with it.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "BulkShout",
    title: "Bulk Voice Call Service in Delhi & India | BulkShout",
    description:
      "Reach thousands of customers with one recorded message. Pay only for the calls that " +
      "connect — unanswered numbers are refunded automatically.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bulk Voice Call Service in Delhi & India | BulkShout",
    description:
      "Pay only for the calls that connect. Unanswered numbers refunded automatically. " +
      "No setup fee.",
  },
};

export default function CustomerPortalPage() {
  return (
    <>
      <MetaPixel />
      <SiteControl />
      <PortalApp portal="customer" />
    </>
  );
}

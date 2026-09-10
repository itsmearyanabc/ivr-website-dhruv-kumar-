import type { Metadata } from "next";
import PortalApp from "@/app/_components/PortalApp";
import MetaPixel from "@/app/_components/MetaPixel";
import SiteControl from "@/app/_components/SiteControl";

/**
 * The sign-up card, on a URL of its own - the page an advertisement should point at.
 *
 * `follow` but `noindex`: the landing page is what should rank for the brand, while this is
 * the destination a campaign links to directly so a visitor lands on the form rather than
 * having to find the button.
 */
export const metadata: Metadata = {
  title: "Create your account | BulkShout",
  description: "Create a BulkShout account. No setup fee, and you pay only for calls that connect.",
  robots: { index: false, follow: true },
};

export default function SignUpPage() {
  return (
    <>
      <MetaPixel />
      <SiteControl />
      <PortalApp portal="customer" initialAuthMode="signup" />
    </>
  );
}

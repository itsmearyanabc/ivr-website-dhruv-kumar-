import type { Metadata } from "next";
import PortalApp from "@/app/_components/PortalApp";
import MetaPixel from "@/app/_components/MetaPixel";
import SiteControl from "@/app/_components/SiteControl";

/**
 * The sign-in card, on a URL of its own.
 *
 * `noindex` because it is a door, not content: there is nothing here for a search engine, and
 * an indexed login page competes with the landing page for the brand query.
 */
export const metadata: Metadata = {
  title: "Sign in | BulkShout",
  description: "Sign in to your BulkShout account to place and track voice broadcasts.",
  robots: { index: false, follow: true },
};

export default function SignInPage() {
  return (
    <>
      <MetaPixel />
      <SiteControl />
      <PortalApp portal="customer" initialAuthMode="login" />
    </>
  );
}

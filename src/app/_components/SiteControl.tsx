"use client";

/**
 * GetSiteControl widgets (pop-ups, surveys, chat prompts).
 *
 * Mounted on the customer-facing surfaces only - the landing page, the customer panel and the
 * policy pages - and deliberately not on /admin, for the same reason as the Meta Pixel: an
 * operator working the console all day should not be shown marketing pop-ups, and their
 * sessions should not count towards whatever the widget is measuring.
 *
 * The snippet ships as `//l.getsitecontrol.com/...`, which inherits the page's protocol. It is
 * pinned to https here: the site is HTTPS-only, so the relative form buys nothing, and an
 * explicit scheme cannot be downgraded.
 *
 * `lazyOnload` rather than `afterInteractive` - a pop-up has nothing to contribute until the
 * page is idle, and the page load was just halved, which is worth protecting.
 */

import Script from "next/script";

export default function SiteControl() {
  return (
    <Script
      id="getsitecontrol"
      src="https://l.getsitecontrol.com/468nded7.js"
      strategy="lazyOnload"
    />
  );
}

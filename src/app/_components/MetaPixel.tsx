/**
 * Meta (Facebook) Pixel.
 *
 * Plain tags in a server component rather than next/script, for the same reason as
 * SiteControl: next/script injects from JavaScript after load, which works but leaves nothing
 * in the HTML the server sends - so the snippet appears to be missing when anyone checks
 * "View page source". Rendered this way it is in the delivered markup, exactly as Meta
 * supply it.
 *
 * Mounted on the customer-facing surfaces only and never on /admin. Operators working the
 * console all day would otherwise be counted as traffic, polluting the very audience and
 * conversion figures the pixel exists to produce.
 */

const PIXEL_ID = "1599486971561330";

const SNIPPET = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`;

export default function MetaPixel() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SNIPPET }} />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}

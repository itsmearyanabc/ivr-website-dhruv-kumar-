/**
 * A redirect the browser resolves against the address it is actually on.
 *
 * Behind Caddy, `next start` builds `request.url` from its own listen address, so a route
 * handler sees `http://localhost:3000/...` whichever host the customer used. A redirect built
 * from that origin sends the customer to localhost. A relative Location sidesteps it: the
 * browser resolves it against bulkshout.com, www.bulkshout.com, or localhost in dev - which
 * also keeps them on the host whose cookies were just set.
 *
 * 303 so the browser always follows with GET, which suits both a GET callback and a POSTed one.
 * Cookies written through next/headers `cookies()` are merged into this response by Next.
 */
export function relativeRedirect(path: string): Response {
  // One leading slash keeps it on this site: '//host' and '/\host' are read as another domain.
  const location = /^\/(?![/\\])/.test(path) ? path : '/'
  return new Response(null, { status: 303, headers: { Location: location } })
}

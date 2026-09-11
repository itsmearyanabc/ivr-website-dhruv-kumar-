# BulkShout — IVR Broadcast Panel

The product is **BulkShout**, live at `bulkshout.com`. The repository and the npm package are
still named `xpack`, and some older docs say Xpack — same app.

Next.js 16 / React 19 portal where customers order IVR voice-broadcast (and SMS) campaigns
from a prepaid wallet, and an operator fulfils them by hand. A single Supabase project (Free
tier) holds auth, data and file storage. Hosted on a Hostinger VPS — see
[DEPLOY_VPS.md](DEPLOY_VPS.md).

**Read `HANDOVER.md` for history, not as current truth.** It dates from 2026-08-03 and predates
most of what is below. The three files in the *parent* directory (`CHANGES_SUMMARY.md`,
`DEPLOYMENT_CHECKLIST.md`, `QUICK_START.md`) and much of `README.md` describe an earlier,
pre-Supabase design — treat them as historical.

## Commands

```bash
npm run dev      # localhost:3000
npm run build
npm run lint
```

Node >= 22.14. **npm is what installs**: `package-lock.json` is authoritative and
`pnpm-lock.yaml` is stale. Preview via the `xpack-dev` config in `.claude/launch.json`.

There is no test suite. `npm run build` (which runs the TypeScript check) plus `npx eslint` on
the touched files is the whole gate. One lint error is pre-existing and not a regression:
`react-hooks/set-state-in-effect` in `CustomerPricingPanel`.

## Deployment

Hostinger VPS, Ubuntu, **1 vCPU / 3.8 GB**, shared with another app — `leylegal-web` and
`leylegal-worker` under pm2 and port 3001. Do not touch them.

- App lives at `/var/www/bulkshout`. The repository root **is** the app root (no subfolder).
- pm2 process `bulkshout`, bound to `127.0.0.1:3000`.
- Caddy fronts it: TLS is automatic, `encode zstd gzip` is on. `/etc/caddy/Caddyfile` also
  serves the other site — back it up and `caddy validate` before every reload, because a bad
  reload takes both sites down.
- Deploy: `cd /var/www/bulkshout && git pull && npm ci && npm run build && pm2 restart bulkshout --update-env`
- `NEXT_PUBLIC_*` values are compiled into the browser bundle — change one, rebuild. Server-only
  values need only the restart.
- `render.yaml` is unused since the move off Render.

## Shape of the app

Routes: `/` (landing when signed out, customer panel when signed in), `/signin`, `/signup`,
`/admin`, `/terms`, `/refund-policy`, `/privacy-policy`. Nearly all UI lives in
[PortalApp.tsx](src/app/_components/PortalApp.tsx), a ~4,450-line client component; `/signin`
and `/signup` render it with `initialAuthMode`. The panel's own views (Dashboard, My broadcasts,
Add funds…) are component state, not routes.

All server work happens in **Server Actions** under `src/app/actions/`. Two route handlers
exist only because redirect flows cannot be Server Actions: `/auth/callback` (Google OAuth code
exchange) and `/api/paytm/callback` (Paytm's return after checkout). Both redirect with
[`relativeRedirect()`](src/lib/relativeRedirect.ts) - never build a redirect from `request.url`:
behind Caddy, `next start` reports every request as `http://localhost:3000/...`, so an absolute
redirect built from it sends customers to localhost.

Customer nav: Dashboard · New broadcast · My broadcasts · Messages · Add funds · Support ·
Settings. Admin: orders queue, customer directory, notifications, activity log and staff (owner
only), categories/services, pricing, top-up verification, transactions, payment methods,
support desk, analytics.

## Core flows

**Order.** Customer picks category → service, attaches audio (file or TTS text) and a contact
list (file or pasted numbers). `createBroadcast` counts the numbers **itself** (never from the
form), re-resolves the price server-side, debits the wallet atomically via
`safe_deduct_balance`, and writes a `broadcasts` row plus a `broadcast_status_history` entry.
Status moves PLACED → IN_PROGRESS → COMPLETED / PARTIAL / CANCELLED, each transition logged.
Moving an order to a different closing status demands a fresh fulfilment report. References
are `BR-NNNN` from a Postgres sequence (`next_broadcast_reference()`). A TTS order's
`audio_key` points at a `.txt` script (`isTtsKey` in [uploads.ts](src/lib/uploads.ts)), shown
inline to the operator. `categories.requires_audio = false` lets SMS categories skip audio.

**Wallet top-up — two routes.**

- *UPI QR + UTR (manual).* The customer pays a static QR, submits the amount and 12-digit UTR,
  and the admin approves or rejects it (`approve_wallet_topup` / `reject_wallet_topup`). A UTR
  can be claimed once — a partial unique index enforces it. `verification_mode` can be MANUAL,
  DECENTRO, GENERIC_UPI or PAYTM. GENERIC_UPI has no working endpoint (BharatPe's portal API is a
  login redirect loop).
- *Per-payment Paytm QR (automatic, mode PAYTM).* Add funds swaps the static QR for
  [QrTopup](src/app/_components/customer/QrTopup.tsx): the QR carries the amount and an order
  number made up here (`tr`), and the order lives in an HMAC-signed token the browser holds -
  nothing is written until Paytm confirms, so abandoned QRs never reach the admin queue.
  `checkQrTopup` ([actions/paytmQr.ts](src/app/actions/paytmQr.ts)) asks Paytm's
  `merchant-status/getTxnStatus` by `PAYTM_MID` alone - no key, so it works for a QR-only Paytm
  for Business account. On TXN_SUCCESS it inserts the row with Paytm's BANKTXNID as `utr_number`
  (so the UTR form cannot claim the same payment again) and credits via `approve_wallet_topup`
  when auto-credit is on. A UTR sent to that lookup comes back "Invalid Order Id" (seen
  2026-09-11) because Paytm files payments by order number, so UTR claims stay manual. The UPI ID
  and payee name are data, set in Admin → Payment methods. **It must be Paytm's own QR handle,
  `paytmqr281005050101efba4uh8izkq@paytm`** - confirmed crediting automatically on 2026-09-11.
  The same account's custom handle `bulkshout@ptaxis` takes the money but Paytm files it under
  its own order number, so the lookup answers "Invalid Order Id" and nothing ever credits.
- *Paytm Payment Gateway (automatic).* `startPaytmTopup` → Paytm checkout →
  `settlePaytmOrder`, which credits **only** after `fetchOrderStatus` asks Paytm
  server-to-server. The POST to `/api/paytm/callback` and the browser's return are never
  trusted; the amount credited is Paytm's figure. It credits through `approve_wallet_topup`,
  which locks the row and refuses anything not PENDING — that is what makes repeat calls safe.
  Needs `PAYTM_ENV`, `PAYTM_MID`, `PAYTM_MERCHANT_KEY`, migration `20260910000000` (run
  2026-09-11) and migration `20260911000000` (not yet run as of 2026-09-11). The row is written
  PENDING when the checkout opens, holding the order id in `utr_number`; the second migration
  allows that on PAYTM_PG rows only. Settlement swaps in Paytm's 12-digit UPI reference when
  there is one, so the UTR form cannot claim the same payment, and if that reference is already
  claimed the row waits for the admin instead of crediting. The test pair is refused with
  `501 System Error` on every endpoint, on both `securegw-stage.paytm.in` and Paytm's newer
  `securestage.paytmpayments.com` - the account's sandbox is not provisioned, which is Paytm's
  side. The plan is to go live on the production MID and key; the card stays hidden until
  `PAYTM_*` is set on the VPS.

**Refunds.** `calculateFailedCallRefund` splits `broadcasts.charge` across delivered + failed
calls and credits back the failed share, capped at what is still refundable. The rate comes
from the order's own charge, never from the current price table, so an old order refunds at
the rate it was sold at.

**Sign-in.** Email and password, plus Google through Supabase OAuth (live since 2026-09-11;
`NEXT_PUBLIC_GOOGLE_AUTH=1` shows the button). Sign-up creates the user with
`auth.admin.createUser({ email_confirm: true })`, not `auth.signUp`, so Supabase never sends a
confirmation email - reCAPTCHA is the gate in front of it. The panel has no email of its own
(password resets go through the admin), so nothing depends on Supabase's mailer.
The `on_auth_user_created` trigger builds the `users` row from provider metadata;
`phone` and `company_name` are nullable, so Google accounts need no migration. reCAPTCHA
Enterprise uses a **checkbox** key on sign-in, sign-up and top-up, verified server-side in
[recaptcha.ts](src/lib/recaptcha.ts); `RECAPTCHA_MODE` is `monitor` or `enforce`, and enforce is
live. Checkbox tokens carry no action, so the action check runs only when one is present.

**Impersonation.** "Login as user" signs the admin into a customer account: stored password →
magic link → recovery link, in that order. The return path is an HMAC-signed
`xpack_impersonation` cookie carrying the admin's own refresh token, signed with
`SUPABASE_SERVICE_ROLE_KEY` — rotating that key ends every active impersonation.
`ADMIN_PASSWORD` is also used to sign the admin account into Supabase, so rotating it means
changing the account's password too.

## Conventions that matter

**Server Actions never throw.** Wrap the body in `guard()` from [errors.ts](src/lib/errors.ts)
and return `{ error: string }`. A thrown action loses its message in a production Next build
and reaches the operator as "An error occurred…", which is unactionable. When an early return
yields a helper's declared type, return a fresh literal (`{ error: x.error }`) — a declared
type in a union of literals breaks narrowing at the call site.

**Every export of a `'use server'` module is a public endpoint.** Helpers taking a user id,
storage key, price, token or order id as an argument therefore live in `src/lib/` and not in
`actions/` — see the header comments in [storage.ts](src/lib/storage.ts),
[pricing.ts](src/lib/pricing.ts), [recaptcha.ts](src/lib/recaptcha.ts) and
[paytm.ts](src/lib/payments/paytm.ts). Keep that split.

**Money and catalogue are resolved server-side.** The browser is shown a price so it can
render a total; the figure that moves is always `resolveServicePrice`, which also refuses a
service hidden from that customer and enforces its min/max order quantity.

**Quantity pricing.** A service's `price` covers `unit_quantity` units - "100 SMS at Rs 11" is
price 11, unit 100, so 250 numbers cost Rs 27.50. `unit_quantity` NULL means flat per-order
pricing. The math lives in [quantity.ts](src/lib/quantity.ts), pure and dependency-free so the
browser's live quote and the server's charge come from the same function - the same reason
[refunds.ts](src/lib/refunds.ts) is written that way. `countNumbers` is shared for the same
reason: the count shown is the count billed. Never import server code into that module; it is
bundled into the browser. A list that arrives as a *file* is counted server-side instead, by
[contacts.ts](src/lib/contacts.ts).

**Uploads bypass the server.** `createUploadTicket` issues a signed Supabase Storage URL for
one exact path; the browser PUTs directly, then posts the key back. `consumeUploadedKey`
re-validates prefix, ownership and real size. Bucket is `xpack_files`; per-file caps live in
[uploads.ts](src/lib/uploads.ts) — audio is `Infinity` by product decision, so the bucket's own
limit is the only ceiling.

**Schema probes.** Code deploys independently of migrations, so
[schema.ts](src/lib/supabase/schema.ts) probes for newer columns/tables and degrades rather
than failing a whole query (`password_plain`, `activity_logs`, `daily_statistics`,
`broadcasts.delivered_calls`, service quantity and sort order, staff role, announcements,
`categories.requires_audio`). Adding a column a live deployment might not have? Probe it.

**Three Supabase clients** in [server.ts](src/lib/supabase/server.ts): `createClient` (anon,
user session — use for `auth.getUser()`), `createAdminClient` (service role + cookies, for
`auth.admin.*`), `createServiceRoleClient` (service role, no cookies — for data reads that
must not depend on RLS). Admin-facing reads go through service-role server actions, not the
browser client.

**One auth round trip per request.** [session.ts](src/lib/session.ts) memoises `getAuthUser()` /
`resolveIsAdmin()` behind React's `cache()`, scoped to one server request. Start an action from
those rather than a fresh `auth.getUser()`.

**Third-party tags.** The Meta Pixel and Getsitecontrol are plain tags in server components
([MetaPixel.tsx](src/app/_components/MetaPixel.tsx),
[SiteControl.tsx](src/app/_components/SiteControl.tsx)), not `next/script` — `next/script`
leaves nothing in the server HTML and the tags look missing in view-source. They mount on the
customer-facing pages only, never on `/admin`. The privacy policy discloses both.

**Keep `xlsx` out of the client entry bundle.** Reach it through `loadXLSX()` on demand.

**`getBroadcasts` names its columns.** Not `*` — `manual_contacts` is fetched on demand by
`getBroadcastContacts`. Anything added to that list must exist on every reachable database.

**Dates.** Never build a date key with `toISOString()` — it shifts to the previous day in IST.

**Passwords are stored in plaintext** in `users.password_plain`, by product decision — the
admin directory reveals them. Google accounts have none ("Not captured").

**Pasting into the owner's terminal is lossy.** Their clipboard/chat turns `www.` into markdown
links and has masked long keys with bullets, which corrupted a Caddyfile and an API key. In
commands for them, build `www.` from a variable (`P=www; "$P.$D"`), have them type secrets by
hand, and confirm with a verdict (`grep -c`, a length check) rather than by echoing the value.

## Database

Supabase Postgres, Free tier. Migrations in `supabase/migrations/` (17, chronological); the SQL
in `database/` is a duplicate/bootstrap set. Every migration is additive, idempotent and ends
with a verification `SELECT` — keep writing them that way, since the owner pastes them into the
SQL editor by hand. RLS is on everywhere, with `public.is_admin()` (ADMIN or STAFF) as the admin
predicate. `customer_service_overrides` has RLS enabled and **no policy at all** — it is
reachable only through the service-role key.

Key tables: `users`, `broadcasts`, `broadcast_status_history`, `reports`, `transactions`,
`categories`, `services`, `customer_service_overrides`, `wallet_topup_requests`,
`payment_methods`, `topup_submission_attempts`, `support_tickets`, `support_messages`,
`activity_logs`, `daily_statistics`, `system_settings`, `announcements`, `announcement_reads`.

Balance changes go through `increment_balance` / `safe_deduct_balance` /
`approve_wallet_topup`, never a read-modify-write.

## Environment

`.env.example` is the reference; the live values are in `/var/www/bulkshout/.env` on the VPS.
Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `..._ANON_KEY`),
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_URL=https://bulkshout.com`.
Optional: `IP_HASH_SALT`; reCAPTCHA (`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `RECAPTCHA_PROJECT_ID`
= `bulkshout`, `RECAPTCHA_API_KEY`, `RECAPTCHA_MODE`); `NEXT_PUBLIC_GOOGLE_AUTH`; Paytm
(`PAYTM_ENV`, `PAYTM_MID`, `PAYTM_MERCHANT_KEY`, `PAYTM_WEBSITE`); `DECENTRO_*`; `UPI_GATEWAY_*`.
Site settings — the WhatsApp number and the default price per call — live in the
`system_settings` table, not in env.

## Loose ends

- Supabase Free tier holds 1 GB of storage — about 2,400 orders at the measured 418 KB average.
  Audio uploads are uncapped in both code and bucket; a bucket size limit should be set.
- Secrets that passed through chat on 2026-09-09/10 — the Supabase secret key, admin password,
  reCAPTCHA API key and Paytm test key — are due to be rotated.
- `apply-migration.js`, `wipe_xpack_customers.js`, empty `out.html` — one-off root scripts,
  not part of the app.

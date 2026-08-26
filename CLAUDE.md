# Xpack — IVR Broadcast Panel

Next.js 16 / React 19 portal where customers order IVR voice-broadcast campaigns from a
prepaid wallet, and an operator fulfils them by hand. Single Supabase project holds auth,
data and file storage. Deployed on Render (free/starter instance).

**Read `HANDOVER.md` first.** It is the accurate account of what works. The three files in the
*parent* directory (`CHANGES_SUMMARY.md`, `DEPLOYMENT_CHECKLIST.md`, `QUICK_START.md`) and
much of `README.md` describe an earlier, pre-Supabase design and claim features complete that
were stubs — treat them as historical.

## Commands

```bash
pnpm dev      # localhost:3000
pnpm build
pnpm lint
```

Node >= 22.14. pnpm is the package manager (`pnpm-lock.yaml` is authoritative;
`package-lock.json` is a leftover). Preview via the `xpack-dev` config in `.claude/launch.json`.

There is no test suite.

## Shape of the app

Two portals, one component. `/` renders `<PortalApp portal="customer">`, `/admin` renders
`<PortalApp portal="admin">` — both from [PortalApp.tsx](src/app/_components/PortalApp.tsx),
a 3,400-line client component holding nearly all UI. Everything below it is a plain function
in the same file; only `admin/*` and `customer/*` panels are split out.

All server work happens in **Server Actions** under `src/app/actions/`. There are no data API
routes. The two under `src/app/api/paytm/` are orphaned — nothing calls them, and no `PAYTM_*`
variable is set in `.env.example` or `render.yaml`. Payment is the manual UPI/UTR flow below.

Customer nav: Dashboard · New broadcast · My broadcasts · Add funds · Support · Settings.
Admin: orders queue, customer directory, categories/services, top-up verification, activity
log, analytics, transactions.

## Core flows

**Order.** Customer picks category → service, attaches audio (file or TTS text) and a contact
list (file or pasted numbers). `createBroadcast` re-resolves the price server-side, debits the
wallet atomically via `safe_deduct_balance`, and writes a `broadcasts` row plus a
`broadcast_status_history` entry. Status moves PLACED → IN_PROGRESS → COMPLETED / PARTIAL /
CANCELLED, each transition logged. The admin closes an order out by uploading a fulfilment
report and entering delivered/failed call counts.

**Wallet top-up.** Customer sees a static UPI QR and submits the 12-digit UTR from their
payment. It lands in a queue the admin approves or rejects (`approve_wallet_topup` /
`reject_wallet_topup` RPCs). A payment method can be switched from `MANUAL` to `DECENTRO` for
automated bank-statement lookup — see [utr.ts](src/lib/payments/utr.ts) — but that needs the
`DECENTRO_*` variables and is off by default.

**Refunds.** `calculateFailedCallRefund` splits `broadcasts.charge` across delivered + failed
calls and credits back the failed share, capped at what is still refundable. The rate comes
from the order's own charge, never from the current price table, so an old order refunds at
the rate it was sold at.

**Impersonation.** "Login as user" signs the admin into a customer account: stored password →
magic link → recovery link, in that order. The return path is an HMAC-signed
`xpack_impersonation` cookie carrying the admin's own refresh token, signed with
`SUPABASE_SERVICE_ROLE_KEY` — rotating that key ends every active impersonation.

## Conventions that matter

**Server Actions never throw.** Wrap the body in `guard()` from [errors.ts](src/lib/errors.ts)
and return `{ error: string }`. A thrown action loses its message in a production Next build
and reaches the operator as "An error occurred…", which is unactionable.

**Every export of a `'use server'` module is a public endpoint.** Helpers taking a user id,
storage key or price as an argument therefore live in `src/lib/` and not in `actions/` —
see the header comments in [storage.ts](src/lib/storage.ts) and [pricing.ts](src/lib/pricing.ts).
Keep that split.

**Money and catalogue are resolved server-side.** The browser is shown a price so it can
render a total; the figure that moves is always `resolveServicePrice`, which also refuses a
service hidden from that customer.

**Uploads bypass the server.** `createUploadTicket` issues a signed Supabase Storage URL for
one exact path; the browser PUTs directly, then posts the key back. `consumeUploadedKey`
re-validates prefix, ownership and real size — the client's numbers are a courtesy. Customer
paths embed the owner id. Bucket is `xpack_files`; per-file caps live in
[uploads.ts](src/lib/uploads.ts) and the hard ceiling is the bucket's own limit in Supabase.

**Schema probes.** Code deploys independently of migrations, so
[schema.ts](src/lib/supabase/schema.ts) probes for newer columns/tables (`password_plain`,
`activity_logs`, `daily_statistics`, `broadcasts.delivered_calls`) and degrades rather than
failing a whole query. Adding a column that a live deployment might not have? Probe it.

**Three Supabase clients** in [server.ts](src/lib/supabase/server.ts): `createClient` (anon,
user session — use for `auth.getUser()`), `createAdminClient` (service role + cookies, for
`auth.admin.*`), `createServiceRoleClient` (service role, no cookies — for data reads that
must not depend on RLS). Admin-facing reads go through service-role server actions, not the
browser client: RLS `is_admin()` resolution silently returned empty rows and produced blank
screens.

**Dates.** Never build a date key with `toISOString()` — it shifts to the previous day in IST
and mis-plotted the whole analytics chart once already.

**Passwords are stored in plaintext** in `users.password_plain`, by product decision — the
admin directory reveals them. Sign-in, signup and admin reset all keep it in step.

## Database

Supabase Postgres. Migrations in `supabase/migrations/` (7, chronological); the SQL in
`database/` is a duplicate/bootstrap set. RLS is on everywhere, with `public.is_admin()` as
the admin predicate. `customer_service_overrides` has RLS enabled and **no policy at all** —
it is reachable only through the service-role key.

Key tables: `users`, `broadcasts`, `broadcast_status_history`, `reports`, `transactions`,
`categories`, `services`, `customer_service_overrides`, `wallet_topup_requests`,
`payment_methods`, `topup_submission_attempts`, `support_tickets`, `support_messages`,
`activity_logs`, `daily_statistics`, `system_settings`.

Balance changes go through `increment_balance` / `safe_deduct_balance`, never a read-modify-write.

## Environment

`.env.example` is the reference. Required: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `..._ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`. Admin sign-in is the env pair only — not a database role.
The same values must be set in the Render dashboard; `render.yaml` marks them `sync: false`.

## Loose ends

- `src/app/api/paytm/*` — dead code, unreferenced and unconfigured.
- `apply-migration.js`, `wipe_xpack_customers.js`, `state.tmp.js`, empty `out.html` — one-off
  root scripts, not part of the app. `state.tmp.js` is untracked.
- `render.yaml` still declares a Postgres database nothing reads (kept so a blueprint apply
  will not delete it).

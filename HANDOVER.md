# Xpack — what changed, and what you need to do

Written 2026-08-03. This supersedes the older `CHANGES_SUMMARY.md`, `DEPLOYMENT_CHECKLIST.md`
and `QUICK_START.md` in the repository root, which describe features as complete that were not
wired up (see "What those docs got wrong" at the end).

---

## 1. Do this first — apply the database migration

A probe of the live Supabase project (`dehwarnjivtnyqyeurvx`) found three things missing:

| Missing | Consequence |
|---|---|
| `public.users.password_plain` | Password column in the admin customer directory always showed `—` |
| `public.activity_logs` | Activity log screen was permanently empty |
| `public.daily_statistics` | Analytics chart was permanently empty |

Everything else — broadcasts, wallet top-ups, categories/services, transactions, the balance
functions, the approve/reject RPCs — was already correct and is untouched.

**To fix:** Supabase dashboard → SQL Editor → New query → paste all of
[`database/RUN_IN_SUPABASE.sql`](database/RUN_IN_SUPABASE.sql) → Run.

It is additive and idempotent (safe to run twice, deletes nothing). The last statement prints
three rows that should all read `OK`.

The same SQL is also checked in as a normal migration at
`supabase/migrations/20260803010000_password_sync_and_activity.sql` for future `supabase db push`.

### The app works before *and* after you run it

The new code probes for these columns/tables at runtime and degrades instead of erroring, so
deploying before running the SQL will not break the customer directory. You just will not get
the passwords, activity log or chart until the SQL runs.

---

## 2. Environment variables

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are required — without them admin sign-in returns
"System configuration error", and the impersonation fallback cannot restore your session.
They are now set in the local `.env`; **confirm both are also set in the Render dashboard**
(Service → Environment). See `.env.example` for the full list.

---

## 3. The two features you called out

### Plain-text passwords for every customer

- `users.password_plain` is now the source of truth, written by the signup trigger, by the
  signup action, on every successful customer sign-in (so it stays correct if a password is
  changed elsewhere), and by the admin "Reset password" action.
- Existing accounts are backfilled from `auth.users` metadata by the migration; anything the
  backfill cannot reach is recovered from auth metadata on first read and written back.
- `listUsers()` is now paginated. It previously defaulted to 50 rows per page, so past 50
  customers the rest of the directory silently showed no password at all.
- In the UI: each row masks the password with a reveal (eye) and copy button, plus a
  **Reveal all passwords** toggle in the toolbar. Masking by default only guards against
  shoulder-surfing and screen shares — the value is one click away, as you asked.
- Rows with no password on file show "Not captured" and a **Set password** button. A banner
  above the table counts them.

### "Login as user"

The button existed but could never take its fast path — `impersonateUser` read
`password_plain` from a row it had not selected, so the value was always `undefined`. It also
required `ADMIN_PASSWORD` to get you back, and set the "you are impersonating" cookie *before*
attempting the sign-in, so a failure left the banner stuck on.

Now:

1. Tries the stored password (directory column, then auth metadata).
2. Falls back to a one-time magic link redeemed server-side.
3. Falls back to a one-time recovery link.
4. Only writes the impersonation cookie **after** a sign-in actually succeeds.
5. Captures your admin refresh token first, so **Return to admin console** restores your exact
   session without needing `ADMIN_PASSWORD` (that is now only the last-resort fallback).
6. Refuses disabled accounts, with a message telling you to enable the account first.
7. Logs both the start and the end of every impersonation to the activity log.

The banner also had a CSS class mismatch (`.impersonation-banner` in the component vs
`.impersonate-banner` in the stylesheet) so it rendered completely unstyled. Fixed, and the
layout now makes room for it.

---

## 4. Other bugs fixed

**Security / correctness**

- Disabled accounts could still sign in and keep browsing — `is_active` was only used to
  colour a badge. Now enforced at sign-in and on every session check.
- Customers with no company name could not see their own support tickets: the ticket list
  labelled them "Unknown" and then filtered the customer's view by that label.
- Broadcast list filtering was case-sensitive on email, which could hide a customer's own
  orders.

**Dead / fake features now working**

- Services → Edit category and Edit service both showed "needs to be implemented in the
  backend actions". The backend actions already existed; they are now called.
- The category enable/disable switch was `readOnly checked={true}` — decorative. Now
  functional, as is the service Enabled/Disabled badge.
- Customer Settings → "Save changes" only fired `alert("Profile changes are saved.")` and
  saved nothing. Now persists name/company/phone, and adds a real password change.
- "Forgot password?" claimed a reset link had been sent; nothing was ever sent. It now files
  a request into the activity log and says what will actually happen.
- Nothing anywhere wrote to `activity_logs`. Signups, broadcasts, status changes, top-up
  submissions/approvals/rejections, ticket activity, wallet credits, password resets and
  impersonations are all logged now.
- Order status history was fetched from `broadcast_status_history` on every load and then
  thrown away. It now renders as a timeline in the order modal for both the customer and the
  admin — every status the order passed through, when, and the reason.

**UI**

- `Icon` returned an empty `<svg>` for unknown names, so the "Login as user" button, the
  Services edit buttons and every activity-log row icon were blank. Added the missing glyphs
  and a fallback.
- Analytics chart plotted every point one day to the left: it built date keys with
  `toISOString()`, which shifts to the previous day for any timezone east of UTC (including
  IST).
- Activity log and Analytics read via the browser client, which depends on RLS resolving
  `is_admin()` and silently returned empty. Both now read through server actions.
- `lib/supabase/client.ts` only accepted `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and would
  build a client with `undefined` if only `..._ANON_KEY` was set. Now accepts either.
- Badge styles were missing for `Enabled`, `Approved`, `Pending` and `Rejected`.
- Customer directory now has search, and the "Add funds" panel refreshes the list afterwards.

**Config**

- `render.yaml` declared `DATABASE_URL` and `JWT_SECRET`, neither of which this app reads, and
  none of the Supabase or admin variables it actually needs. Corrected. It also provisions a
  Render Postgres database that nothing uses — left declared so a blueprint apply cannot
  delete it, but you can remove it from the dashboard.
- `.env.example` still described a pre-Supabase setup. Rewritten.

---

## 5. Verification checklist

Run through this after the SQL and a deploy.

**Admin → Customers**
- [ ] Password column shows a masked value for every customer, not "Not captured"
- [ ] Eye button reveals it; copy button copies it; "Reveal all passwords" toggles the column
- [ ] "Reset" sets a new password — confirm the customer can sign in with it
- [ ] "Login as user" lands on that customer's panel with the orange banner at the top
- [ ] "Return to admin console" brings you back without asking you to sign in again
- [ ] "Disable" blocks that customer's next sign-in; "Enable" restores it

**Customer → New broadcast → Admin**
- [ ] Only enabled categories/services appear in the picker
- [ ] Wallet is debited by the service price and a DEBIT transaction appears
- [ ] The order shows up under Admin → Orders → All broadcasts immediately
- [ ] Admin sets In progress → Completed with a report file; customer sees the report
- [ ] Order modal shows the full status history with timestamps and reasons, both sides
- [ ] Cancel refunds the full charge; a partial refund on Completed credits the difference

**Admin → Payments / Services / Activity log**
- [ ] Top-up: customer submits a UTR, it appears in the queue, approving credits the wallet
- [ ] The same UTR cannot be submitted twice
- [ ] Services: create, edit and delete a category and a service; toggles stick after reload
- [ ] Activity log lists the actions you just performed
- [ ] Analytics chart shows points on the correct days

---

## What those docs got wrong

`CHANGES_SUMMARY.md` claims "All buttons are functional ✅", "Activity log shows proper
timeline ✅" and "Database is secure and scalable ✅". At the time it was written the Services
edit buttons were `alert()` stubs, nothing wrote to `activity_logs`, and the migration it
describes had never been applied to the live database. It also claims Supabase auth rate
limits were removed — no such change exists in `actions/auth.ts`. Treat those three files as
historical notes, not as a description of the system.

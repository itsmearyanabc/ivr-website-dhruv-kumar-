# Deploying BulkShout to a Hostinger VPS

Written 2026-09-09, for the move off Render. `render.yaml` is left in the repo so an existing
Render blueprint is not disturbed, but a VPS does not read it — everything it declares has to
be set again here by hand.

Supabase is unchanged by any of this. The VPS runs the Next.js server only; auth, data and
file storage stay in the same Supabase project, so **there is no data migration involved in
moving hosts**.

> **This VPS already hosts other sites.** Several steps below would disturb them if run the
> way a deployment guide normally writes them — `ufw enable` on a box whose firewall is off
> can cut off whatever else is listening, `chown` on a shared web root changes ownership of
> another app's files, and port 3000 may already be taken. Section 0 surveys the box first,
> and every step after it is scoped to this app alone. Nothing here edits a config file that
> another site owns.

---

## 0. Survey the box before changing anything

```bash
# What is already listening, and on which ports?
sudo ss -tlnp

# What is nginx already serving? Do not edit or remove any of these.
ls -l /etc/nginx/sites-enabled/

# What is already under pm2, and as which user?
pm2 list

# Is the firewall on? If it says "inactive", LEAVE IT INACTIVE (see section 6).
sudo ufw status verbose
```

Two things to carry forward from that output:

- **A free port.** The runbook uses **3000**; if `ss -tlnp` shows it taken, pick another
  (3001, 3100, …) and use it consistently in sections 5 and 6.
- **Whether ufw is active.** This decides which half of section 6 applies to you.

---

## 1. What the server needs

- **Node >= 22.14** (`package.json` `engines`). Ubuntu's default `nodejs` is older — install
  from NodeSource.
- **npm** (`package-lock.json` is the authoritative lockfile; `pnpm-lock.yaml` is stale).
- **nginx** as a reverse proxy, and **certbot** for TLS.
- **pm2** or a systemd unit to keep the process up and restart it on boot.
- ~1 GB RAM is comfortable. See the note on `bodySizeLimit` in section 6 before sizing down.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
node -v   # must print v22.14 or newer
```

---

## 2. Get the code onto the box

```bash
# A directory of its own, owned by you. Note this does NOT chown /var/www itself - that
# directory is shared with the other sites on this box and its ownership must not change.
sudo mkdir -p /var/www/bulkshout
sudo chown -R "$USER":"$USER" /var/www/bulkshout

git clone https://github.com/itsmearyanabc/ivr-website-dhruv-kumar-.git /var/www/bulkshout
cd /var/www/bulkshout/xpack
```

The app is the **`xpack/` subdirectory**, not the repository root. Every command below runs
from `/var/www/bulkshout/xpack`.

---

## 3. The environment file

`.env` is gitignored and will not arrive with the clone. Create it on the server:

```bash
cp .env.example .env
nano .env
```

Required, or the app will not start correctly:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The anon/publishable key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only. Also signs the impersonation cookie — rotating it ends every active "Login as user" session |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Without these, admin sign-in returns "System configuration error" |
| `APP_URL` | **The real https:// domain.** Also feeds the canonical URL and Open Graph tags on the landing page |

Optional: `IP_HASH_SALT`, the `DECENTRO_*` set, and the `UPI_GATEWAY_*` set (see section 8).

```bash
chmod 600 .env
```

> **`NEXT_PUBLIC_*` values are baked into the client bundle at build time.** If you change
> either of them you must re-run `npm run build`, not just restart the process.

---

## 4. Supabase must be told the new domain

Supabase → Authentication → URL Configuration → add the domain to **Site URL** and
**Redirect URLs**.

Skip this and the symptom is specific and confusing: normal sign-in keeps working, but
**"Login as user" fails silently** — its magic-link and recovery-link fallbacks are refused
for an unlisted redirect host, with no visible error.

---

## 5. Build and run

```bash
npm ci
npm run build
pm2 start ./node_modules/.bin/next --name bulkshout -- start -H 127.0.0.1 -p 3000
pm2 save
```

`--name bulkshout` keeps it distinct from whatever else is under pm2, so `pm2 restart
bulkshout` can never touch another app. `pm2 save` records the **whole** current process
list, which is what you want: it preserves the other apps alongside this one.

Only run `pm2 startup` if `pm2 list` in section 0 was empty — if pm2 is already managing your
other sites, its boot hook is installed already and re-running it is unnecessary.

`-H 127.0.0.1` binds the app to loopback so only nginx can reach it; `next start` defaults to
`0.0.0.0`, which would put the unencrypted app straight on the public interface on port 3000
alongside your TLS site. Note that the hostname is a **flag only** — `next start` reads `PORT`
from the environment but has no equivalent env var for the host, so setting `HOST=` does
nothing and leaves it bound to every interface.

Useful afterwards: `pm2 logs bulkshout`, `pm2 restart bulkshout`, `pm2 monit`.

---

## 6. nginx — and the one setting that will bite you

```nginx
server {
    listen 80;
    server_name bulkshout.com www.bulkshout.com;

    # REQUIRED. nginx defaults to 1 MB, and next.config.ts allows 15 MB Server Action
    # bodies. Leave this out and fulfilment-report uploads fail at the proxy with a 413
    # before Next ever sees them — the operator just sees the button do nothing.
    client_max_body_size 20M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;   # large uploads
    }
}
```

```bash
# A new file of its own. Do not edit `default`, and do not touch any existing site file -
# nginx picks the server block by server_name, so this one only ever answers for this domain.
sudo nano /etc/nginx/sites-available/bulkshout
sudo ln -s /etc/nginx/sites-available/bulkshout /etc/nginx/sites-enabled/

# `nginx -t` validates every enabled site at once. If it fails, fix it BEFORE reloading:
# a reload with a broken config takes down the other sites too.
sudo nginx -t && sudo systemctl reload nginx

# Only this domain. Naming it explicitly stops certbot touching certificates for the others.
sudo certbot --nginx -d bulkshout.com -d www.bulkshout.com
```

`X-Forwarded-For` matters beyond tidiness: top-up submissions are rate-limited per hashed
submitter IP. Without it every customer looks like the proxy and they share one limiter.

**Firewall — read this before running anything.** The usual advice is to enable ufw, and on a
box with other services running that is how you take them offline: enabling a default-deny
firewall drops every port you have not explicitly allowed, including whatever your other
deployments listen on.

- If section 0 said ufw is **active**: nothing to do. Ports 80 and 443 are already open or
  your existing sites would not be reachable, and this app only needs those.
- If it said **inactive**: leave it inactive for now. Turning it on is a separate change to
  make deliberately, after listing every port your other services need.

Either way the app itself is bound to `127.0.0.1` in section 5, so port 3000 is not reachable
from outside regardless of the firewall.

---

## 7. Database migrations

Code deploys independently of migrations, and the app probes for newer columns and degrades
rather than erroring — so a deploy ahead of its migrations is safe, it just quietly offers
fewer features. Applied so far (verified 2026-09-09): everything through
`20260909010000_category_audio.sql`.

**Still to run:** `supabase/migrations/20260909020000_generic_upi_verification_mode.sql` —
paste into Supabase → SQL Editor → Run. Until it does, the BharatPe / Generic UPI mode is
offered in the console and then refused by the database.

---

## 8. Payment settings, after the first deploy

Admin → Payments → Payment methods:

- **UPI ID:** `BHARATPE2F0Y0E1A3Q34488@unitype`
- **Payee name:** `XPACK LIVE`
- **QR image:** upload the BharatPe QR. It is an open-amount QR — no amount is encoded — which
  is what a wallet top-up needs, since the customer types their own figure.
- **Verification mode:** leave on **Manual** until the gateway endpoint is confirmed
  (section 9).

Admin → Services → Call pricing → Site settings: set the **WhatsApp number** (digits with
country code, e.g. `919876543210`). The floating icon on the landing page stays hidden while
this is empty — which is the only reason it has never appeared.

---

## 9. The UPI gateway is not yet configured, on purpose

`UPI_GATEWAY_MERCHANT_ID` and `UPI_GATEWAY_TOKEN` are known. `UPI_GATEWAY_URL` is
deliberately blank.

The verifier POSTs `{merchant_id, token, utr}` to whatever host that variable names, so
filling in a guessed endpoint would send a live merchant token to a third party. BharatPe
publishes no merchant UTR-verification API — these credentials belong to a reseller service
sitting on top of the BharatPe account, and which one has to be confirmed before the URL is
set.

While it is blank, `isConfigured` is false and the mode cannot be selected. That is the
intended safe state, not a fault.

---

## 10. Deploying a change later

```bash
cd /var/www/bulkshout && git pull
cd xpack && npm ci && npm run build && pm2 restart bulkshout
```

There is no test suite, so `npm run build` (which runs the TypeScript check) plus
`npx eslint` is the whole gate before a restart.

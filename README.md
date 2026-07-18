# Xpack IVR Broadcast Management

The Xpack portal is a white, blue, red, and premium-green dashboard for customer IVR order management and administrator fulfilment. It implements the presentation and data-model foundation described in the supplied SRD.

## Included

- Customer dashboard with campaign metrics, searchable broadcast history, status badges, activity feed, and campaign-submission flow.
- Detailed admin command centre with live workload indicators, urgent order queue, customer/support operations, and processing pipeline.
- Responsive interface for desktop, tablet, and mobile.
- PostgreSQL 3NF schema covering users, broadcasts, reports, tickets, messages, and immutable activity logs.
- Render Blueprint, Dockerfile, and environment template for production configuration.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Deploy to Render

1. Push this `xpack` folder to a Git repository.
2. In Render, create a new Blueprint and point it at the repository. Render will read `render.yaml` and provision the web service plus PostgreSQL database.
3. Add the remaining values from `.env.example`, including a long `JWT_SECRET`, SMTP details, and an S3-compatible object store such as Cloudflare R2.
4. Apply `database/schema.sql` to the Render PostgreSQL instance before enabling customer accounts.

## Implementation note

The current project is the deployable web interface and production database foundation. The next application phase connects the screens to the API, authentication, R2 signed uploads, email verification, and admin workflow endpoints in the SRD.

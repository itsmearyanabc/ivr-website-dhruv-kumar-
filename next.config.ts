import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Every upload in this app travels through a Server Action, not an API route:
     * campaign audio and contact lists (createBroadcast), the fulfilment report
     * (updateBroadcastStatus), resubmitted files, and the UPI QR image.
     *
     * Next caps Server Action bodies at 1 MB by default and rejects anything larger
     * with a 413 *before* the action function runs - so the server-side size checks
     * never got a chance to produce their friendly message, and the thrown request
     * looked to the operator like the button simply did nothing.
     *
     * 15 MB is chosen for Render's free instance (512 MB RAM). Server Actions buffer the
     * whole body in memory before the handler sees it, so this ceiling is a memory budget,
     * not just a policy: setting it near the old advertised 25 MB per file would let one
     * upload push the instance into an OOM restart.
     *
     * createBroadcast carries audio + contacts in a single request, so the per-file caps in
     * UPLOAD_LIMITS (src/lib/uploads.ts) must keep their combined worst case under this.
     * Raise both together if you move to a paid instance with more headroom.
     */
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;

/**
 * Upload size limits, in one place.
 *
 * These are a memory budget as much as a policy. Server Actions buffer the entire request
 * body in memory before the handler runs, and this deployment targets Render's free instance
 * (512 MB RAM), so the combined worst case of a single request has to stay well under the
 * `experimental.serverActions.bodySizeLimit` set in next.config.ts (15 MB).
 *
 * The worst case is createBroadcast, which carries audio + contacts together:
 *   AUDIO (10 MB) + CONTACTS (4 MB) = 14 MB + multipart overhead.
 *
 * If you raise anything here, raise bodySizeLimit first - Next rejects an oversized body with
 * a 413 before the action can produce a readable error.
 */
export const UPLOAD_LIMITS = {
  /** Campaign audio. A spoken IVR message at normal bitrate is well under 2 MB. */
  AUDIO: 10 * 1024 * 1024,
  /** Contact list: CSV, TXT, XLSX or PDF. 100k numbers in a CSV is roughly 1.5 MB. */
  CONTACTS: 4 * 1024 * 1024,
  /** Fulfilment report the admin sends back to the customer. */
  REPORT: 10 * 1024 * 1024,
  /** Static UPI QR image shown on the top-up screen. */
  QR_IMAGE: 4 * 1024 * 1024,
} as const;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human-readable ceiling for UI copy, e.g. "10 MB". */
export function describeLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

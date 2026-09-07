/**
 * Upload limits and storage location, in one place.
 *
 * These used to be a memory budget: files were posted into a Server Action, so every byte was
 * buffered by the Next process on Render's free 512 MB instance, and Next's own Server Action
 * body limit rejected anything larger with a 413 before the handler ran.
 *
 * Uploads now go straight from the browser to Supabase Storage using a signed upload ticket
 * (see src/app/actions/uploads.ts), so Render never holds the bytes and these numbers are a
 * product decision rather than a memory constraint. The real ceiling is now the Supabase
 * bucket's own file size limit.
 *
 * IMPORTANT: Supabase enforces a per-file cap on the bucket itself. If an upload fails with
 * "Payload too large", raise it in Supabase → Storage → xpack_files → Settings, or the global
 * limit under Project Settings → Storage. Nothing here can lift that cap.
 */

/** The single bucket every uploaded asset lives in. */
export const STORAGE_BUCKET = 'xpack_files';

export type UploadKind = 'audio' | 'contacts' | 'report' | 'qr';

export const UPLOAD_LIMITS = {
  /**
   * Campaign audio - uncapped by product decision.
   *
   * Infinity rather than a very large number so every `size > limit` check in the codebase
   * simply stops firing, with no separate "unlimited" branch to keep in step. The real
   * ceiling is now entirely Supabase's: the bucket rejects anything over its own per-file
   * limit and `explainUploadFailure` in @/lib/uploadClient says so by name. Nothing here can
   * lift that - it is raised in Supabase -> Storage -> xpack_files -> Settings.
   */
  AUDIO: Infinity,
  /** Contact list: CSV, TXT, XLSX, PDF or anything else the operator can read. */
  CONTACTS: 50 * 1024 * 1024,
  /** Fulfilment report the admin sends back to the customer. Any file type. */
  REPORT: 50 * 1024 * 1024,
  /** Static UPI QR image shown on the top-up screen. */
  QR_IMAGE: 10 * 1024 * 1024,
} as const;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human-readable ceiling for UI copy, e.g. "50 MB", or "no limit" for an uncapped kind. */
export function describeLimit(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'no limit';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** True when this kind accepts a file of any size, so copy can read "Any size" not "Maximum Infinity". */
export function isUncapped(bytes: number): boolean {
  return !Number.isFinite(bytes);
}

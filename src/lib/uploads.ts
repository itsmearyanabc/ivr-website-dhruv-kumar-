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

/**
 * Whether an order's `audio_key` points at a text-to-speech script rather than a recording.
 *
 * A TTS order has no audio file. createBroadcast writes the customer's script to a small
 * .txt object at `audio/<user id>/tts-<uuid>.txt` and stores that as the audio key, so the
 * shape of the key is the only record that this order is a script to be read rather than a
 * file to be played - the broadcasts table has no column saying which it was.
 *
 * Lives here, beside the bucket the keys belong to, because both the browser (deciding
 * whether to offer a download or show the words) and the server (deciding whether to fetch
 * the object) have to agree on the answer.
 */
export function isTtsKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return /(^|\/)tts-[^/]*\.txt$/i.test(key);
}

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

/**
 * What a fulfilment report may be.
 *
 * The customer downloads this file as the record of what was delivered, so it has to open in
 * something they already have. "Any file type" let an operator attach whatever was to hand -
 * an .msg export, a screenshot, a zip - and the customer got a download they could not read
 * and no way to say so except a support ticket.
 *
 * Extensions rather than MIME types are the check that matters: browsers report
 * `application/octet-stream` for a CSV often enough that a MIME allowlist rejects real
 * reports, and the operator cannot do anything about it when it does.
 */
export const REPORT_EXTENSIONS = ['.pdf', '.csv', '.xls', '.xlsx', '.txt'] as const;

/** For the file picker's `accept`. MIME types are a courtesy; the extensions do the work. */
export const REPORT_ACCEPT = [
  ...REPORT_EXTENSIONS,
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

/** "PDF, CSV, Excel or TXT" - the same list the picker enforces, for UI copy. */
export const REPORT_TYPES_LABEL = 'PDF, CSV, Excel or TXT';

/**
 * Whether a filename is an acceptable report.
 *
 * Shared by the browser and the server on purpose: `accept` on a file input is only a filter -
 * every picker offers a way past it - so this is checked again where the object is claimed.
 */
export function isAllowedReportName(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return REPORT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

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

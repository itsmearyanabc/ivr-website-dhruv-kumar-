/**
 * Server-side storage helpers.
 *
 * These deliberately do NOT live in a `'use server'` module. Every export of such a module
 * becomes a callable endpoint reachable from any browser, and these two take a storage key
 * as an argument - exposing `discardUpload` as an action would hand the public a way to
 * delete arbitrary objects from the bucket. Keeping them here means only server code that
 * imports them can call them.
 */

import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  UPLOAD_LIMITS,
  describeLimit,
  isAllowedReportName,
  REPORT_TYPES_LABEL,
  STORAGE_BUCKET,
  type UploadKind,
} from '@/lib/uploads'

/** Where each kind of upload lives, and who is allowed to create one. */
export const KIND_CONFIG: Record<UploadKind, { prefix: string; adminOnly: boolean; limit: number }> = {
  audio: { prefix: 'audio', adminOnly: false, limit: UPLOAD_LIMITS.AUDIO },
  contacts: { prefix: 'contacts', adminOnly: false, limit: UPLOAD_LIMITS.CONTACTS },
  report: { prefix: 'reports', adminOnly: true, limit: UPLOAD_LIMITS.REPORT },
  qr: { prefix: 'payment-methods', adminOnly: true, limit: UPLOAD_LIMITS.QR_IMAGE },
}

/**
 * Validates a key handed back by the browser after a direct upload.
 *
 * Because the client supplies this string, it is treated as untrusted: the prefix must match
 * the kind, a customer upload must sit under that customer's own folder, the object has to
 * actually exist, and its real size is re-checked against the limit here - the browser's
 * pre-flight number is only a courtesy.
 */
export async function consumeUploadedKey(
  kind: UploadKind,
  key: string,
  userId: string,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const config = KIND_CONFIG[kind]
  if (!config) return { ok: false, error: 'Unknown upload type.' }

  const expectedPrefix = config.adminOnly ? `${config.prefix}/` : `${config.prefix}/${userId}/`
  if (!key.startsWith(expectedPrefix) || key.includes('..')) {
    return { ok: false, error: 'That upload does not belong to this account. Please re-select the file.' }
  }

  // Re-checked on the way back in, not only when the ticket was issued: the key is supplied by
  // the browser, and a ticket for report.csv does not stop a client posting back some other
  // key it holds.
  if (kind === 'report' && !isAllowedReportName(key)) {
    return { ok: false, error: `A report has to be a ${REPORT_TYPES_LABEL} file.` }
  }

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).info(key)

  if (error || !data) {
    return { ok: false, error: 'The uploaded file could not be found. Please attach it again.' }
  }

  const size = Number(data.size || 0)
  if (size <= 0) {
    return { ok: false, error: 'The uploaded file is empty. Please attach it again.' }
  }
  if (size > config.limit) {
    await supabase.storage.from(STORAGE_BUCKET).remove([key])
    return { ok: false, error: `That file is larger than the ${describeLimit(config.limit)} limit for this upload.` }
  }

  return { ok: true, size }
}

/** Best-effort cleanup for an object whose owning record was never created. */
export async function discardUpload(key: string | null | undefined) {
  if (!key) return
  try {
    const supabase = await createServiceRoleClient()
    await supabase.storage.from(STORAGE_BUCKET).remove([key])
  } catch (e) {
    console.error('discardUpload failed:', e)
  }
}

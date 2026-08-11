'use server'

/**
 * Signed upload tickets.
 *
 * Files used to be posted into a Server Action as multipart form data, which meant every byte
 * travelled through the Next server: Render's free instance (512 MB) had to buffer the whole
 * file in memory, and Next rejected anything over its Server Action body limit with a 413
 * before the action ever ran.
 *
 * Now the server only issues a short-lived ticket for one exact object path, and the browser
 * PUTs the bytes straight to Supabase Storage. Render never sees the file, so upload size is
 * bounded by the Supabase bucket's own limit rather than by the web instance's memory.
 *
 * Security: the caller does not choose the path. The server builds it, and for customer
 * uploads embeds the owner's id in it, so `consumeUploadedKey` can prove at submit time that
 * the key it was handed belongs to the caller and was not swapped for someone else's object.
 *
 * Only the ticket issuer belongs in this file. Every export of a `'use server'` module is a
 * public endpoint, so the validate/delete helpers live in `@/lib/storage` instead.
 */

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'
import { KIND_CONFIG } from '@/lib/storage'
import { describeLimit, STORAGE_BUCKET, type UploadKind } from '@/lib/uploads'

/** Strip anything that could change the meaning of a storage path. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/^\.+/, '')
  return cleaned.slice(-80) || 'file'
}

export type UploadTicket =
  | { error: string; path?: undefined; token?: undefined }
  | { path: string; token: string; error?: undefined }

/**
 * Issues a one-object upload token. The returned path is the only place the token can write.
 */
export async function createUploadTicket(
  kind: UploadKind,
  filename: string,
  size: number,
): Promise<UploadTicket> {
  const config = KIND_CONFIG[kind]
  if (!config) return { error: 'Unknown upload type.' }

  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Please sign in again.' }

  if (config.adminOnly && !(await checkIsAdmin())) {
    return { error: 'Admin access required for this upload.' }
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { error: 'That file appears to be empty.' }
  }
  if (size > config.limit) {
    return { error: `That file is larger than the ${describeLimit(config.limit)} limit for this upload.` }
  }

  // Customer uploads carry the owner id so ownership is provable from the key alone. Admin
  // uploads do not - they are not scoped to a customer, and the consume step re-checks admin.
  const folder = config.adminOnly ? config.prefix : `${config.prefix}/${user.id}`
  const path = `${folder}/${crypto.randomUUID()}-${safeName(filename)}`

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path)

  if (error || !data?.token) {
    console.error('createUploadTicket error:', error)
    const message = error?.message || ''
    if (/bucket not found/i.test(message)) {
      return { error: `File storage is not set up. Create the "${STORAGE_BUCKET}" bucket in Supabase → Storage.` }
    }
    return { error: 'Could not start the upload. Please try again.' }
  }

  return { path: data.path || path, token: data.token }
}

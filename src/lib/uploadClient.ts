"use client";

/**
 * Browser-side file upload.
 *
 * Asks the server for a signed ticket scoped to one object path, then PUTs the bytes straight
 * to Supabase Storage. The Next server is not in the data path at all, which is what removes
 * the Server Action body limit and keeps large files off the web instance's heap.
 */

import { createClient } from "@/lib/supabase/client";
import { createUploadTicket } from "@/app/actions/uploads";
import { STORAGE_BUCKET, UPLOAD_LIMITS, describeLimit, formatFileSize, type UploadKind } from "@/lib/uploads";

const LIMIT_BY_KIND: Record<UploadKind, number> = {
  audio: UPLOAD_LIMITS.AUDIO,
  contacts: UPLOAD_LIMITS.CONTACTS,
  report: UPLOAD_LIMITS.REPORT,
  qr: UPLOAD_LIMITS.QR_IMAGE,
};

export type UploadOutcome =
  | { ok: true; key: string }
  | { ok: false; error: string };

/**
 * Uploads one file and resolves with the storage key to submit alongside the form.
 * `onProgress` receives 0-100; it is driven by real bytes sent, not a fake timer.
 */
export async function uploadFile(
  kind: UploadKind,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadOutcome> {
  const limit = LIMIT_BY_KIND[kind];
  if (file.size === 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > limit) {
    return {
      ok: false,
      error: `${file.name} is ${formatFileSize(file.size)}. The limit is ${describeLimit(limit)}.`,
    };
  }

  let ticket;
  try {
    ticket = await createUploadTicket(kind, file.name, file.size);
  } catch {
    return { ok: false, error: "Could not reach the server to start the upload. Check your connection." };
  }
  if (ticket.error || !ticket.path || !ticket.token) {
    return { ok: false, error: ticket.error || "Could not start the upload." };
  }

  onProgress?.(0);

  try {
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type || "application/octet-stream",
      });

    if (error) {
      const message = error.message || "";
      // The bucket carries its own cap, which no application setting can lift.
      if (/payload too large|exceeded the maximum allowed size|413/i.test(message)) {
        return {
          ok: false,
          error: `Supabase rejected this file as too large. Raise the file size limit on the "${STORAGE_BUCKET}" bucket in Supabase → Storage.`,
        };
      }
      if (/bucket not found/i.test(message)) {
        return { ok: false, error: `The "${STORAGE_BUCKET}" storage bucket does not exist. Create it in Supabase → Storage.` };
      }
      return { ok: false, error: `Upload failed: ${message}` };
    }

    onProgress?.(100);
    return { ok: true, key: ticket.path };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Upload failed: ${message}` };
  }
}

/** Uploads several files, reporting combined progress. Stops at the first failure. */
export async function uploadFiles(
  items: Array<{ kind: UploadKind; file: File; label: string }>,
  onProgress?: (percent: number, label: string) => void,
): Promise<{ ok: true; keys: string[] } | { ok: false; error: string; uploaded: string[] }> {
  const keys: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const { kind, file, label } = items[i];
    const share = 100 / items.length;

    const result = await uploadFile(kind, file, (percent) => {
      onProgress?.(Math.round(i * share + (percent * share) / 100), label);
    });

    if (!result.ok) return { ok: false, error: result.error, uploaded: keys };
    keys.push(result.key);
  }

  onProgress?.(100, "");
  return { ok: true, keys };
}

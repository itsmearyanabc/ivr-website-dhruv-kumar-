"use client";

/**
 * Browser-side file upload.
 *
 * The server issues a signed URL scoped to one object path, and the browser PUTs the bytes
 * straight to Supabase Storage. The Next server is not in the data path at all, which removes
 * the Server Action body limit and keeps large files off the web instance's heap.
 *
 * Two deliberate choices here:
 *
 *  1. No Supabase browser client. It needs NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_* values
 *     are inlined into the client bundle at *build* time - so a bundle built without them
 *     throws "environment variable is required" in the browser even though the variables are
 *     set correctly on the server. The signed URL is absolute and self-authorising, so this
 *     whole class of failure disappears.
 *  2. XMLHttpRequest rather than fetch, because it is the only way to get real upload
 *     progress events. A large file on a slow line otherwise looks like a frozen button.
 */

import { createUploadTicket } from "@/app/actions/uploads";
import { UPLOAD_LIMITS, describeLimit, formatFileSize, type UploadKind } from "@/lib/uploads";

const LIMIT_BY_KIND: Record<UploadKind, number> = {
  audio: UPLOAD_LIMITS.AUDIO,
  contacts: UPLOAD_LIMITS.CONTACTS,
  report: UPLOAD_LIMITS.REPORT,
  qr: UPLOAD_LIMITS.QR_IMAGE,
};

export type UploadOutcome =
  | { ok: true; key: string }
  | { ok: false; error: string };

/** PUTs the file to a Supabase signed upload URL, reporting real byte progress. */
function putToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  return new Promise((resolve) => {
    // Supabase expects multipart with the file under an empty field name, matching what
    // storage-js sends. The browser sets the multipart boundary, so no content-type here.
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ ok: true });
      } else {
        resolve({ ok: false, status: xhr.status, body: xhr.responseText || "" });
      }
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, body: "network error" });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, body: "timeout" });

    xhr.send(form);
  });
}

function explainUploadFailure(status: number, body: string): string {
  if (status === 0) {
    return "The connection dropped during the upload. Check your network and try again.";
  }
  if (status === 413 || /payload too large|exceeded the maximum allowed size/i.test(body)) {
    return "Supabase rejected this file as too large. Raise the file size limit under Supabase → Storage → Settings.";
  }
  if (/bucket not found/i.test(body)) {
    return 'The "xpack_files" storage bucket does not exist. Create it in Supabase → Storage.';
  }
  if (status === 400 && /expired|invalid/i.test(body)) {
    return "The upload link expired before the transfer finished. Please try again.";
  }
  return `Upload failed (HTTP ${status}). ${body.slice(0, 160)}`;
}

/**
 * Uploads one file and resolves with the storage key to submit alongside the form.
 * `onProgress` receives 0-100, driven by bytes actually sent.
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
  if (ticket.error || !ticket.signedUrl || !ticket.path) {
    return { ok: false, error: ticket.error || "Could not start the upload." };
  }

  onProgress?.(0);
  const result = await putToSignedUrl(ticket.signedUrl, file, onProgress);

  if (!result.ok) {
    return { ok: false, error: explainUploadFailure(result.status, result.body) };
  }
  return { ok: true, key: ticket.path };
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

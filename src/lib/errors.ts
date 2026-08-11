/**
 * Server Action error handling.
 *
 * A Server Action that throws does not reach the browser intact: in a production build Next
 * replaces the message with "An error occurred in the Server Components render... The specific
 * message is omitted", leaving an operator with nothing to act on and nothing to report.
 *
 * So actions should never throw. `failure()` turns an exception into the same
 * `{ error: string }` shape every action already returns, logs the real cause to the server
 * console (Render's log stream) with a searchable tag, and hands the operator a short code so
 * a screenshot can be matched to a log line.
 */

/** Short, log-greppable id shown to the operator and printed next to the stack trace. */
function errorCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Rewrites the handful of infrastructure failures an operator can actually do something
 * about. Anything unrecognised keeps its real message - these actions are admin-only, and a
 * vague error costs more than the detail is worth.
 */
function explain(raw: string): string {
  if (/body exceeded|payload too large|entity too large|413/i.test(raw)) {
    return 'The file is too large for the server to accept. Compress it and try again.';
  }
  if (/bucket not found|the resource was not found/i.test(raw)) {
    return 'The file storage bucket is missing. Create the "xpack_files" bucket in Supabase → Storage.';
  }
  if (/jwt|invalid api key|invalid.*token/i.test(raw)) {
    return 'The server could not authenticate with Supabase. Check SUPABASE_SERVICE_ROLE_KEY.';
  }
  if (/fetch failed|econnrefused|enotfound|etimedout|network/i.test(raw)) {
    return 'The server could not reach Supabase. This is usually temporary — try again shortly.';
  }
  if (/row-level security|permission denied/i.test(raw)) {
    return 'The database refused this write. Check the row-level security policies for this table.';
  }
  return raw;
}

/**
 * Wrap the body of a Server Action. Returns whatever the body returns, or a
 * `{ error }` result describing what went wrong.
 */
export async function guard<T>(
  label: string,
  body: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await body();
  } catch (e) {
    const code = errorCode();
    // Full detail stays server-side, where Render's logs can be searched for the code.
    console.error(`[${label}][${code}] action failed:`, e);
    return { error: `${explain(messageOf(e))} (ref ${code})` };
  }
}

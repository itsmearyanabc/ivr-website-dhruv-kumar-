/**
 * Paytm QR top-ups, confirmed with the Merchant ID alone.
 *
 * A Paytm for Business QR account has a Merchant ID (MID) but no payment-gateway key. What it
 * does have is Paytm's merchant status lookup, which answers "was order X paid to this MID?"
 * without a key. A static QR cannot use it: Paytm files those payments under its own order
 * number, and a lookup by UTR comes back "Invalid Order Id". So each top-up gets a fresh UPI QR
 * carrying an order number made up here, and that number is what gets looked up.
 *
 * Deliberately NOT a `'use server'` module, for the same reason as ./paytm: every export of one
 * is an endpoint any browser can POST to, and these take order ids and amounts as plain
 * arguments.
 *
 *   PAYTM_MID   the Merchant ID the UPI ID settles into. Ignored while PAYTM_ENV=staging, when
 *               it holds a test MID that this production lookup would never find.
 */

import crypto from 'crypto';

const STATUS_URL = 'https://securegw.paytm.in/merchant-status/getTxnStatus';
const LOOKUP_TIMEOUT_MS = 10_000;

/** How long the QR is shown for. A payment made after that is still credited within CHECK_WINDOW_MS. */
export const QR_DISPLAY_MS = 15 * 60 * 1000;
/** How long after it was made an order can still be confirmed. */
export const CHECK_WINDOW_MS = 24 * 60 * 60 * 1000;

export function paytmQrMid(): string | null {
  if (process.env.PAYTM_ENV === 'staging') return null;
  return process.env.PAYTM_MID?.trim() || null;
}

// ---------------------------------------------------------------------------------------
// Paytm's answer
// ---------------------------------------------------------------------------------------

export type PaytmOrderLookup =
  | {
      state: 'PAID';
      /** What Paytm says arrived, in rupees. */
      amount: number;
      /** The UPI reference (RRN) - the same 12 digits the payer's app calls the UTR. */
      bankTxnId: string;
      txnId: string;
      paidAt: Date | null;
      paidAtText: string;
      refunded: boolean;
    }
  | { state: 'UNPAID'; message: string }
  | { state: 'ERROR'; message: string };

/** Paytm reports TXNDATE in IST, as "YYYY-MM-DD HH:mm:ss.S". */
function parsePaytmDate(value: unknown): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Ask Paytm about one order on this MID. Read defensively: an answer about another MID or
 * another order, or one without a readable amount, is an ERROR - never a payment.
 */
export async function lookupPaytmOrder(orderId: string): Promise<PaytmOrderLookup> {
  const mid = paytmQrMid();
  if (!mid) return { state: 'ERROR', message: 'PAYTM_MID is not set on the server.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const query = encodeURIComponent(JSON.stringify({ MID: mid, ORDERID: orderId }));
    const response = await fetch(`${STATUS_URL}?JsonData=${query}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { state: 'ERROR', message: `Paytm lookup failed with status ${response.status}.` };

    const data = await response.json();

    // The answer has to be about this account and this order, or it proves nothing.
    if (data?.MID !== mid || String(data?.ORDERID ?? '') !== orderId) {
      return { state: 'ERROR', message: 'Paytm answered about a different payment.' };
    }

    if (data.STATUS !== 'TXN_SUCCESS') {
      return {
        state: 'UNPAID',
        message: `${data.RESPMSG || data.STATUS || 'No successful payment'} (code ${data.RESPCODE || 'none'})`,
      };
    }

    const amount = Number(data.TXNAMOUNT);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { state: 'ERROR', message: 'Paytm confirmed the payment without a readable amount.' };
    }

    return {
      state: 'PAID',
      amount,
      bankTxnId: String(data.BANKTXNID ?? '').trim(),
      txnId: String(data.TXNID ?? '').trim(),
      paidAt: parsePaytmDate(data.TXNDATE),
      paidAtText: String(data.TXNDATE ?? ''),
      refunded: Number(data.REFUNDAMT) > 0,
    };
  } catch (error: unknown) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { state: 'ERROR', message: aborted ? 'Paytm lookup timed out.' : 'Paytm lookup could not be completed.' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------

/** Unique for this merchant for good: Paytm treats a reused order number as the old order. */
export function newQrOrderId(): string {
  return `BSQ${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * A UPI payment link for one order: `am` fixes the amount and `tr` carries the order number,
 * which is what Paytm files the payment under. Built by hand rather than with URLSearchParams,
 * which would write the @ in the UPI ID as %40 and spaces as + - both of which some UPI apps
 * show or reject literally.
 */
export function upiPayUri(p: { vpa: string; payee: string; amount: number; orderId: string }): string {
  const vpa = encodeURIComponent(p.vpa).replace(/%40/g, '@');
  const note = encodeURIComponent(`BulkShout wallet ${p.orderId}`);
  return `upi://pay?pa=${vpa}&pn=${encodeURIComponent(p.payee)}&am=${p.amount.toFixed(2)}&cu=INR&tr=${p.orderId}&tn=${note}`;
}

/** One customer's QR order, signed so the browser can hold it without being able to change it. */
export type QrOrder = { orderId: string; userId: string; amount: number; issuedAt: number };

function signature(encoded: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign QR orders.');
  // Prefixed so this can never verify as another feature's token signed with the same key.
  return crypto.createHmac('sha256', key).update(`qr-order:${encoded}`).digest('hex');
}

export function signQrOrder(order: QrOrder): string {
  const encoded = Buffer.from(JSON.stringify(order)).toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

/** Null for anything not signed here, or not shaped like an order. */
export function readQrOrder(token: string): QrOrder | null {
  try {
    const [encoded, sig] = String(token).split('.');
    if (!encoded || !sig) return null;

    const given = Buffer.from(sig);
    const expected = Buffer.from(signature(encoded));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

    const order = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as QrOrder;
    if (
      typeof order.orderId !== 'string' ||
      typeof order.userId !== 'string' ||
      !Number.isFinite(order.amount) ||
      !Number.isFinite(order.issuedAt)
    ) {
      return null;
    }
    return order;
  } catch {
    return null;
  }
}

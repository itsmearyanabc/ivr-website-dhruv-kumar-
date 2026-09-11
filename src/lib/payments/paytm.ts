/**
 * Paytm Payment Gateway.
 *
 * Deliberately NOT a `'use server'` module, for the same reason as @/lib/activity: every
 * export of one is an endpoint any browser can POST to, and these take an order id and an
 * amount as plain arguments. Exported as actions, a caller could ask the server to treat any
 * order as paid.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a wallet is credited only after `fetchOrderStatus`
 * has asked Paytm, server to server, what happened. The browser's return from the checkout
 * and the callback Paytm POSTs are both useful signals and neither is proof - one is a
 * redirect the customer controls, the other is a request anyone can forge. Only the answer
 * fetched from Paytm's own host over TLS decides that money moves.
 */

// @ts-expect-error -- paytmchecksum ships no type declarations
import PaytmChecksum from 'paytmchecksum';

const STAGING_HOST = 'https://securegw-stage.paytm.in';
const PRODUCTION_HOST = 'https://securegw.paytm.in';

const REQUEST_TIMEOUT_MS = 15_000;

export type PaytmConfig = {
  mid: string;
  key: string;
  host: string;
  websiteName: string;
  isProduction: boolean;
};

/** Null when Paytm is not configured, so the feature simply is not offered. */
export function getPaytmConfig(): PaytmConfig | null {
  const mid = process.env.PAYTM_MID;
  const key = process.env.PAYTM_MERCHANT_KEY;
  if (!mid || !key) return null;

  // Explicit rather than inferred from the key: guessing wrong here means either real money
  // moving against a test gateway or test payments being taken as real ones.
  const isProduction = process.env.PAYTM_ENV === 'production';

  return {
    mid,
    key,
    host: isProduction ? PRODUCTION_HOST : STAGING_HOST,
    // Paytm rejects a mismatch between this and the environment, with an unhelpful error.
    websiteName: process.env.PAYTM_WEBSITE || (isProduction ? 'DEFAULT' : 'WEBSTAGING'),
    isProduction,
  };
}

export function isPaytmConfigured(): boolean {
  return getPaytmConfig() !== null;
}

async function signedPost(url: string, body: Record<string, unknown>, key: string) {
  const payload = JSON.stringify(body);
  const signature: string = await PaytmChecksum.generateSignature(payload, key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, head: { signature } }),
      signal: controller.signal,
      cache: 'no-store',
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Paytm to open a transaction, and get back the token the checkout needs.
 *
 * The amount is passed in as a string with two decimals because Paytm compares it verbatim
 * against what it later reports; a float that renders as "100" where "100.00" was sent is a
 * mismatch it will not explain.
 */
export async function initiateTransaction(params: {
  orderId: string;
  amount: number;
  customerId: string;
  callbackUrl: string;
}): Promise<{ txnToken?: string; error?: string }> {
  const cfg = getPaytmConfig();
  if (!cfg) return { error: 'Paytm is not configured on this server.' };

  try {
    const result = await signedPost(
      `${cfg.host}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(cfg.mid)}&orderId=${encodeURIComponent(params.orderId)}`,
      {
        requestType: 'Payment',
        mid: cfg.mid,
        websiteName: cfg.websiteName,
        orderId: params.orderId,
        callbackUrl: params.callbackUrl,
        txnAmount: { value: params.amount.toFixed(2), currency: 'INR' },
        userInfo: { custId: params.customerId },
      },
      cfg.key,
    );

    const token = result?.body?.txnToken;
    if (!token) {
      const message = result?.body?.resultInfo?.resultMsg || 'Paytm did not return a transaction token.';
      console.error('[paytm] initiateTransaction refused:', JSON.stringify(result?.body?.resultInfo || result));
      return { error: message };
    }
    return { txnToken: token };
  } catch (e: unknown) {
    console.error('[paytm] initiateTransaction failed:', e instanceof Error ? e.message : e);
    return { error: 'Could not reach Paytm. Please try again in a moment.' };
  }
}

export type PaytmOrderStatus = {
  /** TXN_SUCCESS is the only one that may credit a wallet. */
  status: 'TXN_SUCCESS' | 'TXN_FAILURE' | 'PENDING' | 'UNKNOWN';
  /** What Paytm says was actually paid, in rupees. Never taken from the browser. */
  amount: number | null;
  /** Paytm's own transaction id, stored so a payment cannot be claimed twice. */
  txnId: string | null;
  /**
   * The bank's reference for the payment. For UPI it is the 12-digit RRN the payer's app calls
   * the UTR, which is what lets settlement stop the same payment being claimed via the UTR form.
   */
  bankTxnId: string | null;
  message: string;
};

/**
 * What Paytm says happened to an order. This is the only authority on whether money arrived.
 */
export async function fetchOrderStatus(orderId: string): Promise<PaytmOrderStatus> {
  const cfg = getPaytmConfig();
  if (!cfg) return { status: 'UNKNOWN', amount: null, txnId: null, bankTxnId: null, message: 'Paytm is not configured.' };

  try {
    const result = await signedPost(
      `${cfg.host}/v3/order/status`,
      { mid: cfg.mid, orderId },
      cfg.key,
    );

    const body = result?.body;
    const raw = String(body?.resultInfo?.resultStatus || '').toUpperCase();
    const amount = body?.txnAmount != null ? Number(body.txnAmount) : null;

    const status: PaytmOrderStatus['status'] =
      raw === 'TXN_SUCCESS' ? 'TXN_SUCCESS'
      : raw === 'TXN_FAILURE' ? 'TXN_FAILURE'
      : raw === 'PENDING' ? 'PENDING'
      : 'UNKNOWN';

    return {
      status,
      amount: Number.isFinite(amount) ? amount : null,
      txnId: body?.txnId ? String(body.txnId) : null,
      bankTxnId: body?.bankTxnId ? String(body.bankTxnId).trim() : null,
      message: body?.resultInfo?.resultMsg || 'No message from Paytm.',
    };
  } catch (e: unknown) {
    console.error('[paytm] fetchOrderStatus failed:', e instanceof Error ? e.message : e);
    return { status: 'UNKNOWN', amount: null, txnId: null, bankTxnId: null, message: 'Could not reach Paytm to confirm this payment.' };
  }
}

/** The checkout script for the environment in use. */
export function checkoutScriptUrl(): string | null {
  const cfg = getPaytmConfig();
  if (!cfg) return null;
  return `${cfg.host}/merchantpgpui/checkoutjs/merchants/${cfg.mid}.js`;
}

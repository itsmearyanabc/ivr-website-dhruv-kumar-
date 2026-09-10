/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

/**
 * Wallet top-ups through the Paytm Payment Gateway.
 *
 * The customer never types a UTR here. They enter an amount, pay inside Paytm's checkout, and
 * the wallet credits itself once Paytm confirms the payment - which removes every failure the
 * manual flow has: mistyped references, one customer claiming another's payment, and the
 * operator having to approve each one by hand. The UPI/UTR flow is left in place beside it.
 *
 * Money moves in exactly one place: `settlePaytmOrder`, and only after `fetchOrderStatus` has
 * asked Paytm server-to-server what happened. Nothing the browser reports is trusted - not the
 * amount, not the outcome. The browser is only ever allowed to say "look at this order again".
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/session";
import { logActivity, describeActor } from "@/lib/activity";
import { guard } from "@/lib/errors";
import {
  initiateTransaction,
  fetchOrderStatus,
  isPaytmConfigured,
  getPaytmConfig,
} from "@/lib/payments/paytm";

const METHOD_CODE = "PAYTM_PG";

/** Mirrors the manual flow's limits so one route into the wallet cannot bypass the other. */
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 100000;

export async function paytmAvailable() {
  return guard("paytmAvailable", async () => ({
    available: isPaytmConfigured(),
    mid: getPaytmConfig()?.mid || null,
    isProduction: getPaytmConfig()?.isProduction ?? false,
  }));
}

/**
 * Open a Paytm transaction and hand the browser the token its checkout needs.
 *
 * A PENDING row is written first, so an order that Paytm confirms later can always be traced
 * back to the customer who started it - even if the browser never returns.
 */
export async function startPaytmTopup(amountRupees: number) {
  return guard("startPaytmTopup", async () => {
    const user = await getAuthUser();
    if (!user) return { error: "Please sign in again." };
    if (!isPaytmConfigured()) return { error: "Card and UPI payments are not available right now." };

    const amount = Number(amountRupees);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount you want to add." };
    if (amount < MIN_AMOUNT) return { error: `The minimum top-up is ₹${MIN_AMOUNT}.` };
    if (amount > MAX_AMOUNT) return { error: `The maximum top-up is ₹${MAX_AMOUNT.toLocaleString("en-IN")}.` };

    const supabase = await createServiceRoleClient();

    // Paytm requires the order id to be unique for the merchant, forever - a reused one is
    // rejected rather than treated as a retry.
    const orderId = `BS${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

    const { error: insertError } = await supabase.from("wallet_topup_requests").insert([{
      reference_no: orderId,
      user_id: user.id,
      method_code: METHOD_CODE,
      amount,
      // The column is NOT NULL and carries the payment's reference. Paytm's own transaction id
      // replaces it the moment there is one; until then the order id stands in, which keeps the
      // partial unique index on this column doing its job.
      utr_number: orderId,
      status: "PENDING",
      verification_mode: "PAYTM",
      verification_state: "NOT_CHECKED",
    }]);
    if (insertError) {
      console.error("[paytm] could not record the pending top-up:", insertError.message);
      return { error: "Could not start the payment. Please try again." };
    }

    const appUrl = process.env.APP_URL || "";
    const { txnToken, error } = await initiateTransaction({
      orderId,
      amount,
      customerId: user.id,
      callbackUrl: `${appUrl}/api/paytm/callback`,
    });

    if (!txnToken) {
      await supabase.from("wallet_topup_requests")
        .update({ status: "REJECTED", rejection_reason: error || "Paytm did not open the transaction." })
        .eq("reference_no", orderId);
      return { error: error || "Could not start the payment. Please try again." };
    }

    return { orderId, txnToken, amount };
  });
}

/**
 * Ask Paytm what happened to an order, and credit the wallet if it succeeded.
 *
 * Safe to call repeatedly, from the callback and from the browser both: the credit itself goes
 * through approve_wallet_topup, which locks the row and refuses one already APPROVED, so a
 * duplicate call cannot pay twice.
 */
export async function settlePaytmOrder(orderId: string) {
  return guard("settlePaytmOrder", async () => {
    if (!orderId) return { error: "No payment reference." };

    const supabase = await createServiceRoleClient();
    const { data: request } = await supabase
      .from("wallet_topup_requests")
      .select("id, user_id, amount, status, reference_no")
      .eq("reference_no", orderId)
      .maybeSingle();

    if (!request) return { error: "That payment reference is not recognised." };
    if (request.status === "APPROVED") return { status: "APPROVED" as const, amount: Number(request.amount) };

    const verdict = await fetchOrderStatus(orderId);

    if (verdict.status !== "TXN_SUCCESS") {
      const failed = verdict.status === "TXN_FAILURE";
      await supabase.from("wallet_topup_requests").update({
        status: failed ? "REJECTED" : "PENDING",
        verification_state: verdict.status,
        verification_note: verdict.message,
        verified_at: new Date().toISOString(),
        ...(failed ? { rejection_reason: verdict.message } : {}),
      }).eq("id", request.id);

      return failed
        ? { status: "FAILED" as const, message: "Paytm reported that this payment did not go through. Nothing has been charged." }
        : { status: "PENDING" as const, message: "Paytm has not confirmed this payment yet. It will be credited automatically once they do." };
    }

    // Credit what Paytm says arrived, never what the customer asked to pay. They differ if
    // someone edits the amount mid-flow, and the bank's figure is the only true one.
    const paid = verdict.amount ?? Number(request.amount);

    // `amount` is set to what Paytm reports, not just recorded alongside it: the RPC below
    // credits the row's own amount column, so this is the figure that becomes money.
    await supabase.from("wallet_topup_requests").update({
      amount: paid,
      utr_number: verdict.txnId || orderId,
      verification_state: "MATCHED",
      verified_amount: paid,
      verification_note: verdict.message,
      verified_at: new Date().toISOString(),
    }).eq("id", request.id);

    // The same RPC the manual queue uses: it locks the row, refuses anything that is not
    // still PENDING, and moves the balance in one transaction - which is what makes calling
    // this twice safe. p_admin_id is null because no operator approved it; Paytm did.
    const { data: credited, error: creditError } = await supabase.rpc("approve_wallet_topup", {
      p_request_id: request.id,
      p_admin_id: null,
      p_note: `Paytm ${verdict.txnId || orderId}`,
    });

    const outcome = Array.isArray(credited) ? credited[0] : credited;

    if (creditError || !outcome?.success) {
      // A refusal because the row is no longer PENDING means another call got there first -
      // the customer has their money, and this is not an error to show them.
      const alreadyDone = !creditError && /already/i.test(String(outcome?.message || ""));
      if (alreadyDone) return { status: "APPROVED" as const, amount: paid };

      console.error("[paytm] credit failed for", orderId, creditError?.message || outcome?.message);
      return { error: "Your payment succeeded but the wallet credit failed. Contact support with this reference: " + orderId };
    }

    await logActivity({
      ...(await describeActor(request.user_id)),
      actionType: "TOPUP_AUTO_CREDITED",
      entityType: "TOPUP",
      entityId: orderId,
      description: `Paytm payment of ₹${paid.toFixed(2)} credited automatically.`,
    });

    return { status: "APPROVED" as const, amount: paid };
  });
}

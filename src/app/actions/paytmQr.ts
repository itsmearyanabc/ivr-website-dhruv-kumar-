"use server";

/**
 * Wallet top-ups by per-payment Paytm QR.
 *
 * The customer enters an amount and gets a UPI QR for exactly that amount, carrying an order
 * number made up here. After they pay, the browser keeps calling `checkQrTopup`, which asks
 * Paytm - by Merchant ID, no key - whether that order was paid. Money moves only on Paytm's
 * answer, and only for the amount Paytm says arrived.
 *
 * Nothing is written until Paytm confirms. The order lives in a signed token the browser holds,
 * so an abandoned QR leaves no row in the operator's queue. The confirmed row is keyed by the
 * order number (reference_no, unique) and by Paytm's UPI reference (utr_number, unique while
 * live), so neither a repeated check nor a later UTR claim can credit one payment twice.
 */

import { toDataURL } from "qrcode";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/session";
import { logActivity, describeActor } from "@/lib/activity";
import { guard } from "@/lib/errors";
import {
  CHECK_WINDOW_MS,
  QR_DISPLAY_MS,
  lookupPaytmOrder,
  newQrOrderId,
  paytmQrMid,
  readQrOrder,
  signQrOrder,
  upiPayUri,
} from "@/lib/payments/paytmQr";

const METHOD_CODE = "UPI_QR";
const AMOUNT_EPSILON = 0.01;

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;
type RecordedRow = { reference_no: string; user_id: string; status: string; amount: number | string };

const CONFIRMED_MESSAGE = "Paytm confirmed your payment. It will be added after a quick check by our team.";

/** Make a QR for one payment of `amountRupees` into the signed-in customer's wallet. */
export async function startQrTopup(amountRupees: number) {
  return guard("startQrTopup", async () => {
    const user = await getAuthUser();
    if (!user) return { error: "Please sign in again." };

    const supabase = await createServiceRoleClient();
    const { data: method } = await supabase
      .from("payment_methods")
      .select("is_enabled, upi_vpa, upi_payee_name, min_amount, max_amount, verification_mode")
      .eq("code", METHOD_CODE)
      .single();

    if (!method?.is_enabled || !method.upi_vpa || method.verification_mode !== "PAYTM" || !paytmQrMid()) {
      return { error: "Automatic UPI payments are not available right now. Use the UTR form below." };
    }

    const requested = Number(amountRupees);
    if (!Number.isFinite(requested) || requested <= 0) return { error: "Enter the amount you want to add." };
    // Paise are the smallest unit a UPI amount can carry; anything finer cannot be paid exactly.
    const amount = Math.round(requested * 100) / 100;
    if (Math.abs(amount - requested) > 1e-9) return { error: "Use at most two decimal places." };

    const min = Number(method.min_amount);
    const max = Number(method.max_amount);
    if (amount < min) return { error: `The minimum top-up is ₹${min.toFixed(2)}.` };
    if (amount > max) return { error: `The maximum top-up is ₹${max.toFixed(2)}.` };

    const orderId = newQrOrderId();
    const issuedAt = Date.now();
    const token = signQrOrder({ orderId, userId: user.id, amount, issuedAt });
    const uri = upiPayUri({ vpa: method.upi_vpa, payee: method.upi_payee_name || "BulkShout", amount, orderId });
    const qrDataUrl = await toDataURL(uri, { width: 560, margin: 1, errorCorrectionLevel: "M" });

    return {
      token,
      orderId,
      amount,
      vpa: String(method.upi_vpa),
      uri,
      qrDataUrl,
      expiresAt: issuedAt + QR_DISPLAY_MS,
    };
  });
}

/**
 * Ask Paytm whether the QR order in `token` has been paid, and credit the wallet if it has.
 *
 * Safe to call as often as the browser likes: a paid order is recorded once (reference_no is
 * unique) and credited through approve_wallet_topup, which refuses a row no longer PENDING.
 */
export async function checkQrTopup(token: string) {
  return guard("checkQrTopup", async () => {
    const user = await getAuthUser();
    if (!user) return { error: "Please sign in again." };

    const order = readQrOrder(token);
    if (!order || order.userId !== user.id) {
      return { error: "This payment QR is no longer valid. Make a new one." };
    }

    const supabase = await createServiceRoleClient();

    // Settled by an earlier check: answer from the record rather than asking Paytm again.
    const recorded = await findRecorded(supabase, order.orderId);
    if (recorded) return describe(recorded);

    if (Date.now() - order.issuedAt > CHECK_WINDOW_MS) return { status: "EXPIRED" as const };

    const found = await lookupPaytmOrder(order.orderId);
    if (found.state !== "PAID") return { status: "WAITING" as const };

    if (found.refunded) {
      return {
        status: "REVIEW" as const,
        message: "Paytm shows this payment as refunded, so it was not added. Contact support if that is wrong.",
      };
    }

    // Paytm's UPI reference becomes the row's UTR, which is what stops the same payment being
    // claimed again through the UTR form. Without one there is nothing to hold that line.
    const utr = found.bankTxnId;
    if (!/^\d{12}$/.test(utr)) {
      console.error("[paytm-qr] confirmed without a 12-digit UPI reference:", order.orderId);
      return {
        status: "REVIEW" as const,
        message: "Paytm confirmed your payment but did not send its UPI reference. Submit the 12-digit UTR in the form below and we will credit it.",
      };
    }

    const matched = Math.abs(found.amount - order.amount) < AMOUNT_EPSILON;

    const { data: created, error: insertError } = await supabase
      .from("wallet_topup_requests")
      .insert([{
        reference_no: order.orderId,
        user_id: user.id,
        method_code: METHOD_CODE,
        // What Paytm says arrived, not what the QR asked for: approval credits this column.
        amount: found.amount,
        utr_number: utr,
        status: "PENDING",
        verification_mode: "PAYTM",
        verification_state: matched ? "MATCHED" : "AMOUNT_MISMATCH",
        verified_amount: found.amount,
        verification_note: matched
          ? `Paytm confirmed QR order ${order.orderId}: Rs ${found.amount.toFixed(2)}.`
          : `Paytm confirmed QR order ${order.orderId} for Rs ${found.amount.toFixed(2)}, but the QR was for Rs ${order.amount.toFixed(2)}.`,
        verified_at: new Date().toISOString(),
      }])
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // Either a concurrent check recorded this order first, or this UPI reference is already
        // claimed - by this customer's own UTR submission, or by somebody else's.
        const again = await findRecorded(supabase, order.orderId);
        if (again) return describe(again);

        const { data: holder } = await supabase
          .from("wallet_topup_requests")
          .select("reference_no, user_id, status, amount")
          .eq("utr_number", utr)
          .neq("status", "REJECTED")
          .maybeSingle();
        if (holder && holder.user_id === user.id) return describe(holder);

        await logActivity({
          ...(await describeActor(user.id)),
          actionType: "PAYMENT_UTR_CONFLICT",
          entityType: "TOPUP",
          entityId: holder?.reference_no || order.orderId,
          description:
            `Paytm confirmed QR order ${order.orderId} for Rs ${found.amount.toFixed(2)}, but its UPI ` +
            `reference ${utr} is already claimed on ${holder?.reference_no || "another request"}.`,
          metadata: { utr, orderId: order.orderId, claimedBy: holder?.user_id ?? null },
        });
        return {
          status: "REVIEW" as const,
          message: `This payment is already linked to another request. Contact support with order ${order.orderId}.`,
        };
      }

      // Most likely a passing database fault: keep the browser checking, and the next call retries.
      console.error("[paytm-qr] could not record a confirmed payment:", insertError.message);
      return { status: "WAITING" as const };
    }

    const { data: method } = await supabase
      .from("payment_methods")
      .select("auto_credit_on_match")
      .eq("code", METHOD_CODE)
      .single();

    if (matched && method?.auto_credit_on_match) {
      const { data: approval, error: approvalError } = await supabase.rpc("approve_wallet_topup", {
        p_request_id: created.id,
        p_admin_id: null,
        p_note: `Auto-approved: Paytm confirmed QR order ${order.orderId}.`,
      });
      const outcome = Array.isArray(approval) ? approval[0] : approval;

      if (!approvalError && outcome?.success) {
        await logActivity({
          ...(await describeActor(user.id)),
          actionType: "TOPUP_AUTO_CREDITED",
          entityType: "TOPUP",
          entityId: order.orderId,
          description: `Paytm QR payment of ₹${found.amount.toFixed(2)} credited automatically (UPI ref ${utr}).`,
        });
        return { status: "CREDITED" as const, amount: found.amount };
      }

      // A concurrent call may have approved it first; if not, it waits in the queue as MATCHED.
      const again = await findRecorded(supabase, order.orderId);
      if (again?.status === "APPROVED") return describe(again);
      console.error("[paytm-qr] auto-credit failed, left for review:", approvalError?.message || outcome?.message);
    }

    await logActivity({
      ...(await describeActor(user.id)),
      actionType: "PAYMENT_SUBMITTED",
      entityType: "TOPUP",
      entityId: order.orderId,
      description: `Paytm confirmed QR order ${order.orderId} for Rs ${found.amount.toFixed(2)}; awaiting approval.`,
      metadata: { amount: found.amount, verificationState: matched ? "MATCHED" : "AMOUNT_MISMATCH" },
    });

    return {
      status: "REVIEW" as const,
      message: matched
        ? CONFIRMED_MESSAGE
        : `Paytm received ₹${found.amount.toFixed(2)}, not the ₹${order.amount.toFixed(2)} on the QR, so our team will check it before crediting.`,
    };
  });
}

async function findRecorded(supabase: ServiceClient, orderId: string): Promise<RecordedRow | null> {
  const { data } = await supabase
    .from("wallet_topup_requests")
    .select("reference_no, user_id, status, amount")
    .eq("reference_no", orderId)
    .maybeSingle();
  return (data as RecordedRow | null) ?? null;
}

function describe(row: RecordedRow) {
  if (row.status === "APPROVED") return { status: "CREDITED" as const, amount: Number(row.amount) };
  if (row.status === "REJECTED") {
    return {
      status: "REVIEW" as const,
      message: "This payment was declined by our team. Contact support if you think that is wrong.",
    };
  }
  return { status: "REVIEW" as const, message: CONFIRMED_MESSAGE };
}

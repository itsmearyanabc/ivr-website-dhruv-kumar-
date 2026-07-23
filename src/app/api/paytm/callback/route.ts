export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error -- paytmchecksum has no type declarations
import PaytmChecksum from "paytmchecksum";

// Since this is a webhook, we use the service role key to bypass RLS and update the user balance.

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Paytm callback: Missing Supabase configuration");
      return NextResponse.redirect(new URL(request.url).origin);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const formData = await request.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });

    const mkey = process.env.PAYTM_MERCHANT_KEY;
    if (!mkey) {
      console.error("Paytm callback: PAYTM_MERCHANT_KEY not configured");
      return NextResponse.redirect(new URL(request.url).origin);
    }
    
    let paytmChecksum = "";
    const paytmParams: Record<string, string> = {};
    
    for (const key in body) {
      if (key === "CHECKSUMHASH") {
        paytmChecksum = body[key];
      } else {
        paytmParams[key] = body[key];
      }
    }

    // FIX: Await the async verifySignature call
    const isValidChecksum = await PaytmChecksum.verifySignature(paytmParams, mkey, paytmChecksum);

    if (isValidChecksum) {
      const orderId = body.ORDERID;
      const amount = parseFloat(body.TXNAMOUNT);
      const custId = body.CUST_ID; // We injected user.id into CUST_ID

      if (body.STATUS === "TXN_SUCCESS") {
        // 1. Check if transaction already exists to avoid double credit
        const { data: existingTxn } = await supabase
          .from("transactions")
          .select("id")
          .eq("order_id", orderId)
          .single();

        if (!existingTxn) {
          // 2. Add transaction record
          const { error: txnError } = await supabase
            .from("transactions")
            .insert({
              user_id: custId,
              amount: amount,
              type: 'CREDIT',
              status: 'SUCCESS',
              order_id: orderId
            });

          if (!txnError) {
            // 3. Increment user balance atomically using RPC
            // NOTE: You must create the increment_balance RPC function in Supabase:
            // CREATE OR REPLACE FUNCTION increment_balance(uid UUID, amt DECIMAL)
            // RETURNS void AS $$ UPDATE users SET balance = balance + amt WHERE id = uid; $$ LANGUAGE sql SECURITY DEFINER;
            const { error: balanceError } = await supabase.rpc('increment_balance', {
              uid: custId,
              amt: amount
            });

            if (balanceError) {
              // Fallback to read-then-write if RPC not available yet
              console.warn("RPC increment_balance not available, falling back to read-then-write:", balanceError);
              const { data: userData } = await supabase
                .from("users")
                .select("balance")
                .eq("id", custId)
                .single();
                
              if (userData) {
                await supabase
                  .from("users")
                  .update({ balance: Number(userData.balance) + amount })
                  .eq("id", custId);
              }
            }
          }
        }
      } else if (body.STATUS === "TXN_FAILURE") {
        // FIX: Record failed transactions for audit trail
        const { data: existingTxn } = await supabase
          .from("transactions")
          .select("id")
          .eq("order_id", orderId)
          .single();

        if (!existingTxn) {
          await supabase
            .from("transactions")
            .insert({
              user_id: custId,
              amount: amount,
              type: 'CREDIT',
              status: 'FAILED',
              order_id: orderId
            });
        }
      }
    } else {
      console.error("Checksum mismatched");
    }

    // Redirect user back to dashboard or funds page
    const url = request.url;
    const origin = new URL(url).origin;
    return NextResponse.redirect(`${origin}/?funds=true`);

  } catch (error: unknown) {
    console.error("Paytm callback error:", error);
    return NextResponse.redirect(new URL(request.url).origin);
  }
}

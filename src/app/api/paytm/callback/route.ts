import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore
import PaytmChecksum from "paytmchecksum";

// Since this is a webhook, we use the service role key to bypass RLS and update the user balance.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });

    const mkey = process.env.PAYTM_MERCHANT_KEY || "YOUR_TEST_KEY";
    
    let paytmChecksum = "";
    const paytmParams: Record<string, string> = {};
    
    for (const key in body) {
      if (key === "CHECKSUMHASH") {
        paytmChecksum = body[key];
      } else {
        paytmParams[key] = body[key];
      }
    }

    const isValidChecksum = PaytmChecksum.verifySignature(paytmParams, mkey, paytmChecksum);

    if (isValidChecksum) {
      if (body.STATUS === "TXN_SUCCESS") {
        const orderId = body.ORDERID;
        const amount = parseFloat(body.TXNAMOUNT);
        const custId = body.CUST_ID; // We injected user.id into CUST_ID

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
            // 3. Increment user balance
            // Because Supabase REST doesn't have a simple increment, we read then update
            const { data: user } = await supabase
              .from("users")
              .select("balance")
              .eq("id", custId)
              .single();
              
            if (user) {
              await supabase
                .from("users")
                .update({ balance: Number(user.balance) + amount })
                .eq("id", custId);
            }
          }
        }
      }
    } else {
      console.error("Checksum mismatched");
    }

    // Redirect user back to dashboard or funds page
    // Assuming the app runs on localhost or a real domain, we need the origin
    const url = request.url;
    const origin = new URL(url).origin;
    return NextResponse.redirect(`${origin}/?funds=true`);

  } catch (error: any) {
    console.error("Paytm callback error:", error);
    return NextResponse.redirect(new URL(request.url).origin);
  }
}

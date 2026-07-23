export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
// @ts-expect-error -- paytmchecksum has no type declarations
import PaytmChecksum from "paytmchecksum";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const amount = parseFloat(String(formData.get("amount") || "0"));
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const orderId = `ORDER_${Date.now()}_${user.id.substring(0, 5)}`;
    const custId = user.id;

    // Load Paytm variables from ENV
    const mid = process.env.PAYTM_MID;
    const mkey = process.env.PAYTM_MERCHANT_KEY;
    if (!mid || !mkey) {
      return NextResponse.json({ error: "Paytm configuration missing. Set PAYTM_MID and PAYTM_MERCHANT_KEY environment variables." }, { status: 500 });
    }
    const website = process.env.PAYTM_WEBSITE || "WEBSTAGING"; // "DEFAULT" for prod
    const industryTypeId = process.env.PAYTM_INDUSTRY_TYPE_ID || "Retail";
    const channelId = process.env.PAYTM_CHANNEL_ID || "WEB";
    // We construct the absolute callback URL based on the request origin
    const callbackUrl = new URL("/api/paytm/callback", request.url).href;

    const paytmParams: Record<string, string> = {
      MID: mid,
      WEBSITE: website,
      INDUSTRY_TYPE_ID: industryTypeId,
      CHANNEL_ID: channelId,
      ORDER_ID: orderId,
      CUST_ID: custId,
      TXN_AMOUNT: amount.toString(),
      CALLBACK_URL: callbackUrl,
    };

    const checksum = await PaytmChecksum.generateSignature(paytmParams, mkey);
    
    paytmParams["CHECKSUMHASH"] = checksum;
    
    // We return the params and the action URL so the client can submit the form
    const actionUrl = process.env.PAYTM_ENVIRONMENT === "production" 
      ? "https://securegw.paytm.in/order/process" 
      : "https://securegw-stage.paytm.in/order/process";

    return NextResponse.json({ params: paytmParams, actionUrl });

  } catch (error: unknown) {
    console.error("Paytm initiate error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

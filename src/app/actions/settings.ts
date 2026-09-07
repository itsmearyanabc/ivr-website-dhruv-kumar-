"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from "@/app/actions/auth";
import { logActivity, describeActor } from "@/lib/activity";
import { getAuthUser } from "@/lib/session";

export async function getSystemSettings() {
  try {
    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from('system_settings')
      .select('*');
      
    if (error) {
      console.error("Error fetching system settings:", error);
      return { price_per_call: "0.25" };
    }
    
    const settings = data?.reduce((acc: any, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    
    return {
      price_per_call: settings?.price_per_call || "0.25"
    };
  } catch {
    return { price_per_call: "0.25" };
  }
}

export async function updatePricePerCall(priceStr: string) {
  try {
    // FIX: Admin authorization required to update pricing
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      return { error: 'Unauthorized: Admin access required to update pricing.' };
    }

    const supabase = await createServiceRoleClient();
    
    // Validate the price is a positive number
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) {
      return { error: 'Price must be a positive number.' };
    }
    
    // Update or insert
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: 'price_per_call', value: priceStr, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      
    if (error) {
      console.error("Error updating price:", error);
      return { error: error.message };
    }

    // The default per-call rate is a pricing change like any other, so it is recorded with
    // the operator's name. It was the only money setting that left no trace of who moved it.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'PRICE_PER_CALL_UPDATED',
      entityType: 'SETTING',
      entityId: 'price_per_call',
      description: `Set the default price per call to ₹${price.toFixed(2)}.`,
    });

    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "An unexpected error occurred.";
    return { error: message };
  }
}

"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from "@/app/actions/auth";

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
  } catch (e) {
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
    
    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "An unexpected error occurred.";
    return { error: message };
  }
}

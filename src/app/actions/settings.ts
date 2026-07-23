"use server";
import { createClient } from "@/lib/supabase/server";

export async function getSystemSettings() {
  try {
    const supabase = await createClient();
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
    const supabase = await createClient();
    
    // Update or insert
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: 'price_per_call', value: priceStr, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      
    if (error) {
      console.error("Error updating price:", error);
      return { error: error.message };
    }
    
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "An unexpected error occurred." };
  }
}

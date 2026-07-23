"use server";
import { createClient } from "@/lib/supabase/server";

export async function getSystemSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('system_settings')
    .select('*');
    
  if (error || !data) {
    return { price_per_call: "0.25" };
  }
  
  const settings: Record<string, any> = {};
  data.forEach(item => {
    settings[item.key] = item.value;
  });
  
  return {
    price_per_call: settings['price_per_call'] || "0.25",
  };
}

export async function updatePricePerCall(priceStr: string) {
  const supabase = await createClient();
  
  // Update or insert
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key: 'price_per_call', value: priceStr, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    
  if (error) {
    console.error("Error updating price:", error);
    return { success: false, error: error.message };
  }
  
  return { success: true };
}

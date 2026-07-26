"use server";
import { createClient } from "@/lib/supabase/server";

export async function getAllUsers() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  
  // Verify Admin
  const { data: adminCheck } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (adminCheck?.role !== "ADMIN") return [];
  
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, company_name, phone, role, is_active, balance, created_at')
    .order('created_at', { ascending: false });
    
  if (error || !data) return [];
  
  return data;
}

export async function adminAddFunds(userId: string, amount: number) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: "Unauthorized" };
  
  // Verify Admin
  const { data: adminCheck } = await supabaseAuth.from("users").select("role").eq("id", user.id).single();
  if (adminCheck?.role !== "ADMIN") return { error: "Admin access required" };

  if (amount <= 0 || isNaN(amount)) return { error: "Invalid amount" };

  const { data, error } = await supabaseAuth.rpc('increment_balance', { uid: userId, amt: amount });

  if (error) {
    return { error: "Failed to add funds." };
  }

  // Record credit transaction
  await supabaseAuth.from('transactions').insert([{
    user_id: userId,
    amount: amount,
    type: 'CREDIT',
    status: 'SUCCESS',
    order_id: `MANUAL_FUND_BY_ADMIN`
  }]);

  return { success: true };
}

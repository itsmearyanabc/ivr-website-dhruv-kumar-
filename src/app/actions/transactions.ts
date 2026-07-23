"use server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function getUserBalance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  
  const supabaseService = await createServiceRoleClient();
  const { data, error } = await supabaseService
    .from('users')
    .select('balance')
    .eq('id', user.id)
    .single();
    
  if (error || !data) return 0;
  
  return data.balance || 0;
}

export async function incrementUserBalance(amount: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  
  const supabaseService = await createServiceRoleClient();
  
  // Use atomic RPC increment to prevent race conditions
  // NOTE: Create this function in Supabase:
  // CREATE OR REPLACE FUNCTION increment_balance(uid UUID, amt DECIMAL)
  // RETURNS void AS $$ UPDATE users SET balance = balance + amt WHERE id = uid; $$ LANGUAGE sql SECURITY DEFINER;
  const { error: rpcError } = await supabaseService.rpc('increment_balance', {
    uid: user.id,
    amt: amount
  });

  if (rpcError) {
    // Fallback to read-then-write if RPC not available
    console.warn("RPC increment_balance not available, falling back to read-then-write:", rpcError);
    const current = await getUserBalance();
    const { error } = await supabaseService
      .from('users')
      .update({ balance: current + amount })
      .eq('id', user.id);
    return !error;
  }
  
  return true;
}

export async function getUserTransactions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  
  const supabaseService = await createServiceRoleClient();
  const { data, error } = await supabaseService
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
    
  if (error || !data) return [];
  
  return data;
}

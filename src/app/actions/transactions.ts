"use server";
import { createClient } from "@/lib/supabase/server";

export async function getUserBalance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  
  const { data, error } = await supabase
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
  
  const current = await getUserBalance();
  const { error } = await supabase
    .from('users')
    .update({ balance: current + amount })
    .eq('id', user.id);
    
  return !error;
}

export async function getUserTransactions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
    
  if (error || !data) return [];
  
  return data;
}

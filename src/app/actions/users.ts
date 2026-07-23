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

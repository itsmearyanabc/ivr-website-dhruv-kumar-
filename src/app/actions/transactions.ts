"use server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from '@/app/actions/auth';
import { getAuthUser } from '@/lib/session';
export async function getUserBalance() {
  const user = await getAuthUser();
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

/*
 * `incrementUserBalance(amount)` used to live here, and it was a hole in the floor.
 *
 * Every export of a `'use server'` module is an endpoint any browser can POST to. This one
 * took an amount straight from the caller, checked only that *someone* was signed in, and
 * credited that caller's own wallet with it - no admin check, no bound, no ledger row. Any
 * customer could have called it from the console and topped themselves up by any figure they
 * liked, as often as they liked.
 *
 * Nothing referenced it. Deleting it removes the endpoint outright, which is the only real
 * fix; guarding it would leave a money-moving path that nothing needs. Wallets are credited
 * in exactly two supported places, both of which authorise first and write a transaction row:
 *
 *   - `adminAddFunds`        (users.ts)  - admin-gated manual credit
 *   - `approve_wallet_topup` (RPC)       - the verified UPI top-up flow
 *
 * Refunds go through `creditWallet` in broadcasts.ts, which is server-only and not exported
 * from a 'use server' module.
 */

export async function getUserTransactions() {
  const user = await getAuthUser();
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

export async function getAllTransactions() {
  const isAdmin = await checkIsAdmin();
  if (!isAdmin) return [];
  
  const supabaseService = await createServiceRoleClient();
  const { data, error } = await supabaseService
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false });
    
  if (error || !data) return [];
  
  return data;
}

/**
 * Audit trail writer.
 *
 * Deliberately NOT a `'use server'` module, for the same reason as `@/lib/storage` and
 * `@/lib/pricing`: every export of one is an endpoint any browser can POST to, and these two
 * take the actor's identity and the description as plain arguments. Exported as actions, they
 * let any signed-in caller write whatever they liked into `activity_logs` - forging
 * "Administrator credited Rs 50,000 to ..." into the very record you would consult to find
 * out what happened. The audit trail has to be something only server code can write.
 *
 * `activity_logs` has no INSERT policy, so entries can only be created here, behind the
 * service-role key.
 *
 * Logging must never fail the operation it describes - a broadcast that was created stays
 * created even if the audit write blows up - so every call is wrapped and only ever reports
 * to the server console.
 */

import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasActivityLogTable } from '@/lib/supabase/schema'

export async function logActivity(entry: {
  userId?: string | null
  userEmail?: string | null
  userName?: string | null
  actionType: string
  entityType?: string | null
  entityId?: string | null
  description: string
  metadata?: Record<string, unknown>
}) {
  try {
    // Skip quietly if the audit migration has not been applied to this database yet.
    if (!(await hasActivityLogTable())) return

    const supabase = await createServiceRoleClient()
    await supabase.from('activity_logs').insert([
      {
        user_id: entry.userId || null,
        user_email: entry.userEmail || null,
        user_name: entry.userName || null,
        action_type: entry.actionType,
        entity_type: entry.entityType || null,
        entity_id: entry.entityId || null,
        description: entry.description,
        metadata: entry.metadata || {},
      },
    ])
  } catch (e) {
    console.error('logActivity failed:', e)
  }
}

/** Resolves the display fields for a log entry from a user id, in one round trip. */
export async function describeActor(userId: string | null | undefined) {
  if (!userId) return { userId: null, userEmail: null, userName: null }
  try {
    const supabase = await createServiceRoleClient()
    const { data } = await supabase
      .from('users')
      .select('email, full_name, company_name')
      .eq('id', userId)
      .single()
    return {
      userId,
      userEmail: data?.email || null,
      userName: data?.company_name || data?.full_name || null,
    }
  } catch {
    return { userId, userEmail: null, userName: null }
  }
}

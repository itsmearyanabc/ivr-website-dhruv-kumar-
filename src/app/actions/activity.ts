/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasActivityLogTable, hasDailyStatisticsTable } from '@/lib/supabase/schema'

/**
 * Audit trail writer. The activity_logs table has no INSERT policy, so entries can only be
 * created here, behind the service-role key.
 *
 * Logging must never be able to fail the operation it is describing - a broadcast that was
 * created successfully stays created even if the audit write blows up - so every call is
 * wrapped and only ever reports to the server console.
 */
export async function logActivity(entry: {
  userId?: string | null
  userEmail?: string | null
  userName?: string | null
  actionType: string
  entityType?: string | null
  entityId?: string | null
  description: string
  metadata?: Record<string, any>
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

/** Admin read for the Activity log screen. Runs server-side so RLS timing cannot hide rows. */
export async function getActivityLogs(filterDate?: string) {
  const { checkIsAdmin } = await import('@/app/actions/auth')
  if (!(await checkIsAdmin())) return []
  if (!(await hasActivityLogTable())) return []

  const supabase = await createServiceRoleClient()
  let query = supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (filterDate) {
    const start = new Date(`${filterDate}T00:00:00`)
    const end = new Date(`${filterDate}T23:59:59.999`)
    query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
  }

  const { data, error } = await query
  if (error) {
    console.error('getActivityLogs error:', error)
    return []
  }
  return data || []
}

/** Daily counters behind the Analytics chart, for one calendar month. */
export async function getDailyStatistics(year: number, month: number) {
  const { checkIsAdmin } = await import('@/app/actions/auth')
  if (!(await checkIsAdmin())) return []
  if (!(await hasDailyStatisticsTable())) return []

  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${year}-${pad(month + 1)}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const end = `${year}-${pad(month + 1)}-${pad(lastDay)}`

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase
    .from('daily_statistics')
    .select('*')
    .gte('stat_date', start)
    .lte('stat_date', end)
    .order('stat_date', { ascending: true })

  if (error) {
    console.error('getDailyStatistics error:', error)
    return []
  }
  return data || []
}

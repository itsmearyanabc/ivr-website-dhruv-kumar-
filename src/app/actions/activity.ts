/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasActivityLogTable, hasDailyStatisticsTable } from '@/lib/supabase/schema'

/*
 * `logActivity` and `describeActor` moved to `@/lib/activity`.
 *
 * They were exported from this `'use server'` module, which made them endpoints any browser
 * could POST to - letting a signed-in caller write arbitrary entries into the audit trail,
 * including ones attributed to an administrator. Only the two admin-gated *reads* below
 * belong in an action module; see the header of `@/lib/activity`.
 */

/**
 * India is UTC+05:30 all year - it observes no daylight saving - so the offset is a constant
 * rather than something that needs a timezone database to resolve.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/**
 * The UTC instants bracketing one Indian calendar day.
 *
 * `new Date('2026-09-04T00:00:00')` - a timestamp with no zone suffix - is parsed in whatever
 * timezone the *server* happens to run in. That is UTC on Render but IST on a developer's
 * machine, so the filter silently meant a different day in production than it did locally,
 * and neither matched the dates on screen: the log renders each row with `toLocaleString()`,
 * in the *browser's* timezone. An operator in India asking for 4 September got 05:30 on the
 * 4th through 05:29 on the 5th, missing the early morning and pulling in rows that visibly
 * read as the next day.
 *
 * Anchoring to IST explicitly makes the filter mean the day the operator meant, wherever the
 * code is running - which also makes dev and production agree. Same hazard the analytics
 * chart was fixed for; see the note about `toISOString()` in CLAUDE.md.
 *
 * Returns null for anything that is not a YYYY-MM-DD date.
 */
function istDayBounds(day: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null

  const midnightUtc = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(midnightUtc)) return null

  // Midnight IST is 18:30 UTC on the previous day; the day ends 24 hours later.
  const start = midnightUtc - IST_OFFSET_MS
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60 * 1000 - 1).toISOString(),
  }
}

/**
 * The activity log, for the super admin only.
 *
 * Staff are deliberately refused. The log is the record of what each of them did, so it is
 * the one screen the person being recorded should not be able to read - a staff member who
 * could check the trail could check what had been noticed in it.
 *
 * Enforced here rather than by hiding the nav item, because this is a `'use server'` export
 * and therefore an endpoint: a staff member's browser can POST to it directly whatever the
 * menu shows. The empty array is the same shape the screen already handles for a database
 * without the audit table, so a staff member who reached it sees an empty log rather than an
 * error telling them there is something here worth attacking.
 *
 * Runs server-side so RLS timing cannot hide rows.
 */
export async function getActivityLogs(filterDate?: string) {
  const { resolveIsSuperAdmin } = await import('@/lib/session')
  if (!(await resolveIsSuperAdmin())) return []
  if (!(await hasActivityLogTable())) return []

  const supabase = await createServiceRoleClient()
  let query = supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (filterDate) {
    const window = istDayBounds(filterDate)
    // A malformed date would otherwise reach `toISOString()` as an Invalid Date and throw,
    // and this action is a public endpoint like every other export of a 'use server' module.
    // Ignoring the filter shows more than asked for, which beats an unexplained failure.
    if (window) {
      query = query.gte('created_at', window.start).lte('created_at', window.end)
    }
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

import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Runtime schema probes.
 *
 * The application is deployed independently of the database migrations, so there is always a
 * window where the new code is live and the new columns are not. Selecting a column that does
 * not exist makes PostgREST fail the whole query, which would empty the admin customer
 * directory rather than just hiding one cell. These helpers let a query degrade instead.
 *
 * Results are cached for the lifetime of the server process and re-probed after a short TTL,
 * so running the migration takes effect without a redeploy.
 */

const PROBE_TTL_MS = 60_000

type Probe = { value: boolean; checkedAt: number }
const cache = new Map<string, Probe>()

async function probeColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.checkedAt < PROBE_TTL_MS) return cached.value

  let exists = false
  try {
    const supabase = await createServiceRoleClient()
    const { error } = await supabase.from(table).select(column).limit(1)
    // 42703 = undefined_column. PostgREST also reports it through the schema-cache message.
    exists = !error
    if (error && !/does not exist|schema cache|42703/i.test(error.message)) {
      // Some other failure (network, permissions). Assume present so we do not silently
      // downgrade a working deployment.
      exists = true
    }
  } catch {
    exists = true
  }

  cache.set(key, { value: exists, checkedAt: Date.now() })
  return exists
}

/** True once the password_sync migration has been applied to this database. */
export function hasPasswordColumn() {
  return probeColumn('users', 'password_plain')
}

async function probeTable(table: string): Promise<boolean> {
  const key = `table:${table}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.checkedAt < PROBE_TTL_MS) return cached.value

  let exists = false
  try {
    const supabase = await createServiceRoleClient()
    const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1)
    exists = !error
  } catch {
    exists = false
  }

  cache.set(key, { value: exists, checkedAt: Date.now() })
  return exists
}

/** True once activity_logs exists. Audit writes are skipped rather than throwing without it. */
export function hasActivityLogTable() {
  return probeTable('activity_logs')
}

/** True once daily_statistics exists. */
export function hasDailyStatisticsTable() {
  return probeTable('daily_statistics')
}

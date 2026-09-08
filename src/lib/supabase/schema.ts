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

/**
 * True once broadcasts carries the delivery counts a failed-call refund is derived from.
 *
 * Without this the refund still calculates and still credits correctly - the counts simply
 * are not recorded on the order. Writing a column that does not exist would fail the whole
 * update and block fulfilment entirely, which is a far worse outcome than a missing audit
 * field on a database where the migration has not run yet.
 */
export function hasDeliveryCountColumns() {
  return probeColumn('broadcasts', 'delivered_calls')
}

/**
 * True once services carry the quantity-pricing fields.
 *
 * Without it a service still saves and still sells - it just cannot be opted into per-unit
 * pricing, because writing `unit_quantity` to a table that has no such column fails the whole
 * insert and would block the operator from creating any service at all.
 */
export function hasServiceQuantityColumns() {
  return probeColumn('services', 'unit_quantity')
}

/**
 * True once services carry the operator's chosen position within their category.
 *
 * Without it the lists fall back to creation order, which is what they showed before the
 * feature existed, and the reorder control is hidden rather than offered and then failing to
 * save. Selecting a column that is not there fails the whole query, which would empty the
 * services screen rather than leaving it merely unsorted.
 */
export function hasServiceSortOrder() {
  return probeColumn('services', 'sort_order')
}

/**
 * True once `user_role` carries STAFF.
 *
 * Probed rather than assumed because inserting a role the enum does not have fails the whole
 * write: without this the staff screen would offer a form that cannot succeed, on a database
 * that is simply waiting for its migration.
 */
export async function hasStaffRole(): Promise<boolean> {
  const key = 'enum:user_role.STAFF'
  const cached = cache.get(key)
  if (cached && Date.now() - cached.checkedAt < PROBE_TTL_MS) return cached.value

  let exists = false
  try {
    const supabase = await createServiceRoleClient()
    // Selecting on the value is enough: PostgREST has to cast 'STAFF' to user_role to build
    // the filter, and fails loudly if the label does not exist. Matching no rows is fine.
    const { error } = await supabase.from('users').select('id').eq('role', 'STAFF').limit(1)
    exists = !error
  } catch {
    exists = false
  }

  cache.set(key, { value: exists, checkedAt: Date.now() })
  return exists
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

/**
 * True once the announcement tables exist.
 *
 * Without them the panel shows no messages and the badge never appears, rather than every
 * customer's dashboard failing on a query for a table that is not there yet.
 */
export function hasAnnouncementsTable() {
  return probeTable('announcements')
}

/** True once categories has the requires_audio column. */
export function hasCategoryAudioColumn() {
  return probeColumn('categories', 'requires_audio')
}

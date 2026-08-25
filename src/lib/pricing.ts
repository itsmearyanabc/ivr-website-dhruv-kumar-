/**
 * Per-customer service pricing.
 *
 * A service carries one global price. `customer_service_overrides` holds the exceptions:
 * a different price for one customer, or that service hidden from them entirely. Absence of
 * a row is the normal case and means "same as everyone else", so these helpers are written
 * to be correct and cheap when the override table is empty.
 *
 * Like `@/lib/storage`, this deliberately does NOT live in a `'use server'` module. Every
 * export of such a module becomes an endpoint callable from any browser, and
 * `resolveServicePrice` takes a user id as an argument - exposing it would let one customer
 * ask what another is being charged.
 */

import { createServiceRoleClient } from '@/lib/supabase/server'

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>

/** What a single customer's exception row says about one service. */
export type ServiceOverride = {
  /** Custom price, or null to fall back to the service's own price. */
  price: number | null
  /** True when the service is hidden from this customer's catalogue. */
  isHidden: boolean
}

/**
 * Every override belonging to one customer, keyed by service id.
 *
 * One query for the whole catalogue rather than one per service: a customer picking a
 * service is on the critical path of placing an order, and this runs against a free-tier
 * database where each round trip is worth avoiding.
 */
export async function loadCustomerOverrides(
  supabase: ServiceClient,
  userId: string | null | undefined,
): Promise<Map<string, ServiceOverride>> {
  const overrides = new Map<string, ServiceOverride>()
  if (!userId) return overrides

  const { data, error } = await supabase
    .from('customer_service_overrides')
    .select('service_id, price, is_hidden')
    .eq('user_id', userId)

  if (error) {
    // A missing table means the migration has not run here yet. Falling back to base pricing
    // is the safe direction: everybody sees the standard catalogue at the standard price,
    // rather than the order screen failing outright.
    console.error('loadCustomerOverrides failed, using base prices:', error.message)
    return overrides
  }

  for (const row of data || []) {
    overrides.set(row.service_id, {
      price: row.price === null || row.price === undefined ? null : Number(row.price),
      isHidden: Boolean(row.is_hidden),
    })
  }

  return overrides
}

/** The price one customer pays for a service, given their overrides. */
export function priceFor(
  service: { id: string; price: number | string },
  overrides: Map<string, ServiceOverride>,
): number {
  const override = overrides.get(service.id)
  if (override && override.price !== null) return override.price
  return Number(service.price || 0)
}

/** Whether a service should appear in one customer's catalogue at all. */
export function isVisibleTo(
  service: { id: string; is_active?: boolean },
  overrides: Map<string, ServiceOverride>,
): boolean {
  if (service.is_active === false) return false
  return !overrides.get(service.id)?.isHidden
}

/**
 * Authoritative price for one customer ordering one service, read fresh from the database.
 *
 * This is what an order is charged. It is never taken from the browser: the client is shown
 * a price so it can render a total, but the figure that moves money is resolved here, from
 * the service row and that customer's override. A hidden service is refused outright - it is
 * not in their catalogue, so an order naming it was either stale or forged.
 */
export async function resolveServicePrice(
  supabase: ServiceClient,
  userId: string,
  serviceId: string,
): Promise<{ ok: true; price: number } | { ok: false; error: string }> {
  const { data: service, error } = await supabase
    .from('services')
    .select('id, price, is_active')
    .eq('id', serviceId)
    .single()

  if (error || !service) {
    return { ok: false, error: 'That service is no longer available. Please pick another one.' }
  }
  if (service.is_active === false) {
    return { ok: false, error: 'That service has been discontinued. Please pick another one.' }
  }

  const overrides = await loadCustomerOverrides(supabase, userId)

  if (!isVisibleTo(service, overrides)) {
    return { ok: false, error: 'That service is not available on your account. Please pick another one.' }
  }

  const price = priceFor(service, overrides)
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: 'That service is not priced correctly. Please contact support.' }
  }

  return { ok: true, price }
}

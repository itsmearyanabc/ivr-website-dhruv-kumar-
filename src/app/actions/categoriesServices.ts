"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from "@/app/actions/auth";
import { loadCustomerOverrides, priceFor, isVisibleTo } from "@/lib/pricing";
import { logActivity, describeActor } from "@/lib/activity";
import { getAuthUser } from "@/lib/session";
import { hasServiceQuantityColumns, hasServiceSortOrder } from "@/lib/supabase/schema";

export interface Category {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  services?: Service[];
}

export interface Service {
  id: string;
  category_id: string;
  name: string;
  /** What `unit_quantity` units cost. For a flat-priced service, the whole order. */
  price: number;
  /**
   * Units the price covers - 100 for "100 SMS at Rs 11". Null means the service is not
   * quantity priced and bills `price` per order however many numbers it carries, which is how
   * every service behaved before quantity pricing existed.
   */
  unit_quantity?: number | null;
  /** Smallest order accepted, once quantity priced. */
  min_quantity?: number | null;
  /** Largest order accepted, once quantity priced. Null = unbounded. */
  max_quantity?: number | null;
  description?: string;
  is_active: boolean;
  created_at: string;
}

/** The quantity fields as they arrive from the admin form, before validation. */
export interface ServiceQuantityInput {
  unit_quantity?: number | null;
  min_quantity?: number | null;
  max_quantity?: number | null;
}

/** Shown when per-unit pricing is asked for on a database the migration has not reached. */
const SORT_MIGRATION_REQUIRED =
  "Service ordering is not available on this database yet. Run the migration " +
  "supabase/migrations/20260907000000_service_sort_order.sql in the Supabase SQL editor, " +
  "then try again.";

/**
 * A category's services in the order an operator arranged them.
 *
 * Sorted here rather than in the query because the services arrive as an embedded resource,
 * and because `sort_order` may not exist on this database yet - a missing column reads as
 * undefined and falls through to creation order, which is exactly what these lists showed
 * before the feature existed.
 *
 * A service that has never been placed by hand sorts *after* every one that has, not before:
 * a newly created service belongs at the bottom of the list the operator arranged, not
 * jumped to the top of it.
 */
function inDisplayOrder<T extends { sort_order?: number | null; created_at?: string }>(
  services: T[] | null | undefined,
): T[] {
  return [...(services || [])].sort((a, b) => {
    const aPlaced = a.sort_order !== null && a.sort_order !== undefined;
    const bPlaced = b.sort_order !== null && b.sort_order !== undefined;
    if (aPlaced && bPlaced && a.sort_order !== b.sort_order) {
      return (a.sort_order as number) - (b.sort_order as number);
    }
    if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

const MIGRATION_REQUIRED =
  "Per-unit pricing is not available on this database yet. Run the migration " +
  "supabase/migrations/20260826000000_service_quantity_pricing.sql in the Supabase SQL editor, " +
  "then try again. You can save this service as a flat price in the meantime.";

/** null for "not set", 'invalid' for something that was set but is not a usable quantity. */
function toPositiveInt(value: number | null | undefined): number | null | 'invalid' {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 'invalid';
  return n;
}

/**
 * Validates the quantity fields and reduces them to what should be written.
 *
 * Leaving `unit_quantity` empty is how an operator says "bill a flat price per order", so it
 * is not an error - it clears the bounds too, because a minimum order size means nothing for
 * a service that charges the same either way and would only mislead whoever reads the row
 * next.
 */
function normaliseQuantity(
  input: ServiceQuantityInput | undefined,
): { ok: true; values: Required<ServiceQuantityInput> } | { ok: false; error: string } {
  const unit = toPositiveInt(input?.unit_quantity);
  if (unit === 'invalid') {
    return { ok: false, error: "Units included must be a whole number greater than zero." };
  }
  if (unit === null) {
    return { ok: true, values: { unit_quantity: null, min_quantity: null, max_quantity: null } };
  }

  const min = toPositiveInt(input?.min_quantity);
  if (min === 'invalid') {
    return { ok: false, error: "Minimum order quantity must be a whole number greater than zero." };
  }
  const max = toPositiveInt(input?.max_quantity);
  if (max === 'invalid') {
    return { ok: false, error: "Maximum order quantity must be a whole number greater than zero." };
  }
  if (min !== null && max !== null && max < min) {
    return {
      ok: false,
      error: "Maximum order quantity (" + max + ") cannot be below the minimum (" + min + ").",
    };
  }

  return { ok: true, values: { unit_quantity: unit, min_quantity: min, max_quantity: max } };
}

/**
 * Fetch all active categories and their nested services for customer broadcast creation.
 *
 * The catalogue is rendered per customer: a service hidden for them is dropped, and a
 * service priced for them carries that price instead of the global one. A category left with
 * no visible services disappears too, rather than showing as an empty group.
 *
 * The price returned here is for display. The charge is resolved again server-side when the
 * order is placed (see `resolveServicePrice`), so a stale or edited client cannot buy at a
 * price it made up.
 */
export async function getCategoriesWithServices() {
  try {
    const supabase = await createServiceRoleClient();

    // Signed out (or a failure to resolve the session) simply means no overrides apply, and
    // the standard catalogue is returned. This read stays available either way.
    let userId: string | null = null;
    try {
      const supabaseAuth = await createClient();
      const { data: { user } } = await supabaseAuth.auth.getUser();
      userId = user?.id || null;
    } catch {
      userId = null;
    }

    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select(`
        *,
        services (*)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (catError) {
      console.error("Error fetching categories:", catError);
      return { error: "Failed to load categories" };
    }

    const overrides = await loadCustomerOverrides(supabase, userId);

    // The customer sees the order the operator arranged on the admin screen, sorted by the
    // same function the admin list uses - a position dragged on one screen meaning something
    // different on the other would be very hard to reason about. Ordered before the
    // per-customer filter, so hiding one service does not disturb the rest.
    const formatted = (categories || [])
      .map((cat: any) => ({
        ...cat,
        services: inDisplayOrder<any>(cat.services)
          .filter((s: any) => isVisibleTo(s, overrides))
          .map((s: any) => ({ ...s, price: priceFor(s, overrides) }))
      }))
      .filter((cat: any) => cat.services.length > 0);

    return { data: formatted as Category[] };
  } catch (err: any) {
    console.error("getCategoriesWithServices exception:", err);
    return { error: err.message || "An error occurred" };
  }
}

/**
 * Fetch all categories and services for Admin management
 */
export async function getAllCategoriesAndServices() {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      return { error: "Unauthorized" };
    }

    const supabase = await createServiceRoleClient();

    const { data: categories, error } = await supabase
      .from('categories')
      .select(`
        *,
        services (*)
      `)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Error fetching all categories:", error);
      return { error: "Failed to load categories" };
    }

    const ordered = (categories || []).map((cat: any) => ({
      ...cat,
      services: inDisplayOrder<any>(cat.services),
    }));

    return { data: ordered as Category[] };
  } catch (err: any) {
    console.error("getAllCategoriesAndServices exception:", err);
    return { error: err.message || "An error occurred" };
  }
}

/**
 * Admin action: reorder the services inside one category.
 *
 * Takes the full list of that category's service ids in their new order and numbers them from
 * one. The whole list rather than a moved id and a target index: the browser already holds the
 * arrangement the operator is looking at, and sending it entire means the stored order always
 * matches the screen, with no way for the two to drift if a save is missed or two tabs are
 * open.
 *
 * Ids are checked against the category before anything is written. Without that, a caller
 * could post another category's service - or another account's - and have its position
 * rewritten; every export of a `'use server'` module is a public endpoint.
 */
export async function reorderServices(categoryId: string, orderedIds: string[]) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!categoryId) return { error: "Which category is being reordered was not provided." };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return { error: "No services were provided to reorder." };
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      return { error: "The same service appears twice in that order." };
    }

    if (!(await hasServiceSortOrder())) {
      return { error: SORT_MIGRATION_REQUIRED };
    }

    const supabase = await createServiceRoleClient();

    // Every id has to belong to this category, and the list has to be the whole category -
    // a partial list would leave the services missing from it holding stale positions and
    // interleaving unpredictably with the ones just moved.
    const { data: existing, error: readErr } = await supabase
      .from('services')
      .select('id')
      .eq('category_id', categoryId);

    if (readErr) {
      console.error("reorderServices read failed:", readErr);
      return { error: "Could not load this category's services. Nothing was changed." };
    }

    const known = new Set((existing || []).map((row: any) => row.id));
    if (orderedIds.some(id => !known.has(id))) {
      return { error: "That order refers to a service which is not in this category. Reload and try again." };
    }
    if (orderedIds.length !== known.size) {
      return { error: "This category has changed since the page loaded. Reload and arrange it again." };
    }

    // One statement per row: PostgREST has no bulk update, and an upsert would have to carry
    // every NOT NULL column to satisfy its insert path. Issued together rather than in
    // sequence - a category holds a handful of services, and this runs on an operator's click.
    const results = await Promise.all(
      orderedIds.map((id, index) =>
        supabase.from('services').update({ sort_order: index + 1 }).eq('id', id)
      )
    );

    const failed = results.find(r => r.error);
    if (failed?.error) {
      console.error("reorderServices write failed:", failed.error);
      return { error: "The new order could not be saved. Reload to see the current arrangement." };
    }

    const { data: { user: actor } } = await (await createClient()).auth.getUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'SERVICES_REORDERED',
      entityType: 'CATEGORY',
      entityId: categoryId,
      description: `Reordered the ${orderedIds.length} service${orderedIds.length === 1 ? '' : 's'} in a category.`,
      metadata: { categoryId, orderedIds },
    });

    return { data: { ordered: orderedIds.length } };
  } catch (err: any) {
    console.error("reorderServices exception:", err);
    return { error: err.message || "The new order could not be saved." };
  }
}

/**
 * Admin action: Create Category with custom name and description
 */
export async function createCategory(name: string, description?: string) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!name || name.trim() === '') {
      return { error: "Category name is required" };
    }

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from('categories')
      .insert([{
        name: name.trim(),
        description: description?.trim() || null,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      console.error("Create Category Error:", error);
      return { error: error.message || "Failed to create category" };
    }

    // Recorded so the log can answer who did this, which is the whole point of staff
    // accounts: the catalogue is the part of the panel that changes what customers are
    // charged, and it was the one area that wrote no audit entry at all.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'CATEGORY_CREATED',
      entityType: 'CATEGORY',
      entityId: data?.id || null,
      description: `Created the category "${name.trim()}".`,
    });
    return { data };
  } catch (err: any) {
    return { error: err.message || "Failed to create category" };
  }
}

/**
 * Admin action: Update Category
 */
export async function updateCategory(id: string, name: string, description?: string, is_active: boolean = true) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!name || name.trim() === '') {
      return { error: "Category name is required" };
    }

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from('categories')
      .update({
        name: name.trim(),
        description: description?.trim() || null,
        is_active
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error("Update Category Error:", error);
      return { error: error.message || "Failed to update category" };
    }

    // Recorded so the log can answer who did this, which is the whole point of staff
    // accounts: the catalogue is the part of the panel that changes what customers are
    // charged, and it was the one area that wrote no audit entry at all.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'CATEGORY_UPDATED',
      entityType: 'CATEGORY',
      entityId: id || null,
      description: `Updated the category "${name.trim()}".`,
    });
    return { data };
  } catch (err: any) {
    return { error: err.message || "Failed to update category" };
  }
}

/**
 * Admin action: Delete Category
 */
export async function deleteCategory(id: string) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    const supabase = await createServiceRoleClient();

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) {
      console.error("Delete Category Error:", error);
      return { error: error.message || "Failed to delete category" };
    }

    // Recorded so the log can answer who did this, which is the whole point of staff
    // accounts: the catalogue is the part of the panel that changes what customers are
    // charged, and it was the one area that wrote no audit entry at all.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'CATEGORY_DELETED',
      entityType: 'CATEGORY',
      entityId: id || null,
      description: `Deleted a category.`,
    });
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to delete category" };
  }
}

/**
 * Admin action: Create Service under a Category with custom name & price
 */
export async function createService(
  categoryId: string,
  name: string,
  price: number,
  description?: string,
  quantity?: ServiceQuantityInput,
) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!categoryId || !name || name.trim() === '' || isNaN(price) || price < 0) {
      return { error: "Category, service name, and valid price are required" };
    }

    const normalised = normaliseQuantity(quantity);
    if (!normalised.ok) return { error: normalised.error };

    const supabase = await createServiceRoleClient();

    // The quantity columns arrive with a migration that may not have run on this database yet.
    // Writing one that does not exist fails the whole insert, so a service can still be
    // created without them - but only when none were asked for. Dropping values the operator
    // actually typed and then reporting success is the worse failure: the service saves, the
    // panel says it saved, and the customer screen goes on charging a flat price.
    const columnsReady = await hasServiceQuantityColumns();
    if (!columnsReady && normalised.values.unit_quantity !== null) {
      return { error: MIGRATION_REQUIRED };
    }
    const quantityFields = columnsReady ? normalised.values : {};

    const { data, error } = await supabase
      .from('services')
      .insert([{
        category_id: categoryId,
        name: name.trim(),
        price: Number(price),
        description: description?.trim() || null,
        is_active: true,
        ...quantityFields,
      }])
      .select()
      .single();

    if (error) {
      console.error("Create Service Error:", error);
      return { error: error.message || "Failed to create service" };
    }

    // Recorded so the log can answer who did this, which is the whole point of staff
    // accounts: the catalogue is the part of the panel that changes what customers are
    // charged, and it was the one area that wrote no audit entry at all.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'SERVICE_CREATED',
      entityType: 'SERVICE',
      entityId: data?.id || null,
      description: `Created the service "${name.trim()}" at ₹${Number(price).toFixed(2)}.`,
    });
    return { data };
  } catch (err: any) {
    return { error: err.message || "Failed to create service" };
  }
}

/**
 * Admin action: Update Service
 */
export async function updateService(
  id: string,
  name: string,
  price: number,
  description?: string,
  is_active: boolean = true,
  quantity?: ServiceQuantityInput,
) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!name || name.trim() === '' || isNaN(price) || price < 0) {
      return { error: "Service name and valid price are required" };
    }

    const normalised = normaliseQuantity(quantity);
    if (!normalised.ok) return { error: normalised.error };

    const supabase = await createServiceRoleClient();

    // `quantity` being undefined means the caller is not managing these fields at all (the
    // enable/disable toggle, for one), so they are left untouched rather than cleared.
    const managingQuantity = quantity !== undefined;
    const columnsReady = managingQuantity ? await hasServiceQuantityColumns() : false;
    if (managingQuantity && !columnsReady && normalised.values.unit_quantity !== null) {
      return { error: MIGRATION_REQUIRED };
    }
    const quantityFields = managingQuantity && columnsReady ? normalised.values : {};

    const { data, error } = await supabase
      .from('services')
      .update({
        name: name.trim(),
        price: Number(price),
        description: description?.trim() || null,
        is_active,
        ...quantityFields,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error("Update Service Error:", error);
      return { error: error.message || "Failed to update service" };
    }

    // Recorded so the log can answer who did this, which is the whole point of staff
    // accounts: the catalogue is the part of the panel that changes what customers are
    // charged, and it was the one area that wrote no audit entry at all.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'SERVICE_UPDATED',
      entityType: 'SERVICE',
      entityId: id || null,
      description: `Updated the service "${name.trim()}" at ₹${Number(price).toFixed(2)}.`,
    });
    return { data };
  } catch (err: any) {
    return { error: err.message || "Failed to update service" };
  }
}

/**
 * Admin action: Delete Service
 */
export async function deleteService(id: string) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    const supabase = await createServiceRoleClient();

    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', id);

    if (error) {
      console.error("Delete Service Error:", error);
      return { error: error.message || "Failed to delete service" };
    }

    // Recorded so the log can answer who did this, which is the whole point of staff
    // accounts: the catalogue is the part of the panel that changes what customers are
    // charged, and it was the one area that wrote no audit entry at all.
    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'SERVICE_DELETED',
      entityType: 'SERVICE',
      entityId: id || null,
      description: `Deleted a service.`,
    });
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to delete service" };
  }
}

// =========================================================================================
// Per-customer pricing and visibility (admin)
// =========================================================================================

export interface CustomerServiceRow {
  service_id: string;
  service_name: string;
  category_id: string;
  category_name: string;
  /** The global price everyone else pays - for `unit_quantity` units, not per order. */
  base_price: number;
  /**
   * Units the price covers, so the admin panel can say "per 100" rather than leaving an
   * operator to guess whether Rs 11 buys one number or a hundred. Null for a flat-priced
   * service, where the price is simply the price of an order.
   */
  unit_quantity: number | null;
  /** Custom price for this customer, or null when they pay the base price. */
  override_price: number | null;
  /** True when this service is hidden from this customer's catalogue. */
  is_hidden: boolean;
  /** False when the service is switched off globally - hidden from everyone regardless. */
  service_active: boolean;
}

/**
 * The full catalogue as it applies to one customer, for the admin pricing screen.
 *
 * Returns every service - including ones with no override - so the screen can show what the
 * customer currently sees and what they would see, side by side, without the admin having to
 * cross-reference the global catalogue.
 */
export async function getCustomerPricing(userId: string) {
  try {
    if (!(await checkIsAdmin())) return { error: "Unauthorized" };
    if (!userId) return { error: "No customer selected." };

    const supabase = await createServiceRoleClient();

    const { data: categories, error } = await supabase
      .from('categories')
      .select(`
        id,
        name,
        is_active,
        services ( * )
      `)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("getCustomerPricing error:", error);
      return { error: "Failed to load the service catalogue." };
    }

    const overrides = await loadCustomerOverrides(supabase, userId);

    const rows: CustomerServiceRow[] = [];
    for (const category of (categories || []) as any[]) {
      const services = inDisplayOrder<any>(category.services);

      for (const service of services) {
        const override = overrides.get(service.id);
        rows.push({
          service_id: service.id,
          service_name: service.name,
          category_id: category.id,
          category_name: category.name,
          base_price: Number(service.price || 0),
          unit_quantity: service.unit_quantity ? Number(service.unit_quantity) : null,
          override_price: override?.price ?? null,
          is_hidden: Boolean(override?.isHidden),
          service_active: service.is_active !== false && category.is_active !== false,
        });
      }
    }

    return { data: rows };
  } catch (err: any) {
    console.error("getCustomerPricing exception:", err);
    return { error: err.message || "An error occurred" };
  }
}

/**
 * Sets - or clears - one customer's exception for one service.
 *
 * `price: null` means "charge them the base price"; `isHidden: false` means "show it". When
 * both land on the default the row is deleted rather than stored, so the override table only
 * ever holds real exceptions and a customer with no special treatment has no rows at all.
 */
export async function setCustomerPricing(
  userId: string,
  serviceId: string,
  price: number | null,
  isHidden: boolean
) {
  try {
    if (!(await checkIsAdmin())) return { error: "Unauthorized" };
    if (!userId || !serviceId) return { error: "Pick a customer and a service first." };

    if (price !== null) {
      if (!Number.isFinite(price) || price < 0) {
        return { error: "A custom price must be zero or more." };
      }
      // Two decimal places is what the column stores; rounding here keeps what the admin
      // sees after saving identical to what they typed.
      price = Math.round((price + Number.EPSILON) * 100) / 100;
    }

    const supabase = await createServiceRoleClient();

    const { data: service } = await supabase
      .from('services')
      .select('id')
      .eq('id', serviceId)
      .single();
    if (!service) return { error: "That service no longer exists." };

    const { data: customer } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .single();
    if (!customer) return { error: "That customer no longer exists." };

    // Nothing special about this customer any more - drop the row instead of keeping a
    // no-op one around.
    if (price === null && !isHidden) {
      const { error } = await supabase
        .from('customer_service_overrides')
        .delete()
        .eq('user_id', userId)
        .eq('service_id', serviceId);

      if (error) {
        console.error("setCustomerPricing delete error:", error);
        return { error: "Failed to clear the custom pricing." };
      }
      return { success: true, cleared: true };
    }

    const supabaseAuth = await createClient();
    const { data: { user: actor } } = await supabaseAuth.auth.getUser();

    const { error } = await supabase
      .from('customer_service_overrides')
      .upsert(
        {
          user_id: userId,
          service_id: serviceId,
          price,
          is_hidden: isHidden,
          updated_at: new Date().toISOString(),
          updated_by: actor?.id || null,
        },
        { onConflict: 'user_id,service_id' }
      );

    if (error) {
      console.error("setCustomerPricing upsert error:", error);
      if (/relation .* does not exist|schema cache/i.test(error.message)) {
        return { error: 'Per-customer pricing is not set up on this database yet. Run the latest migration in Supabase.' };
      }
      return { error: "Failed to save the custom pricing." };
    }

    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: 'CUSTOMER_PRICING_UPDATED',
      entityType: 'USER',
      entityId: userId,
      description: isHidden
        ? `Hid a service from ${customer.email}'s catalogue.`
        : `Set a custom price of Rs ${Number(price).toFixed(2)} for ${customer.email}.`,
      metadata: { serviceId, price, isHidden },
    });

    return { success: true };
  } catch (err: any) {
    console.error("setCustomerPricing exception:", err);
    return { error: err.message || "An error occurred" };
  }
}

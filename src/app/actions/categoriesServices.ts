"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from "@/app/actions/auth";
import { loadCustomerOverrides, priceFor, isVisibleTo } from "@/lib/pricing";
import { logActivity, describeActor } from "@/app/actions/activity";

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
  price: number;
  min_quantity?: number;
  max_quantity?: number;
  description?: string;
  is_active: boolean;
  created_at: string;
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

    // Filter active services and sort
    const formatted = (categories || [])
      .map((cat: any) => ({
        ...cat,
        services: (cat.services || [])
          .filter((s: any) => isVisibleTo(s, overrides))
          .map((s: any) => ({ ...s, price: priceFor(s, overrides) }))
          .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
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

    return { data: categories as Category[] };
  } catch (err: any) {
    console.error("getAllCategoriesAndServices exception:", err);
    return { error: err.message || "An error occurred" };
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

    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to delete category" };
  }
}

/**
 * Admin action: Create Service under a Category with custom name & price
 */
export async function createService(categoryId: string, name: string, price: number, description?: string) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!categoryId || !name || name.trim() === '' || isNaN(price) || price < 0) {
      return { error: "Category, service name, and valid price are required" };
    }

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from('services')
      .insert([{
        category_id: categoryId,
        name: name.trim(),
        price: Number(price),
        description: description?.trim() || null,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      console.error("Create Service Error:", error);
      return { error: error.message || "Failed to create service" };
    }

    return { data };
  } catch (err: any) {
    return { error: err.message || "Failed to create service" };
  }
}

/**
 * Admin action: Update Service
 */
export async function updateService(id: string, name: string, price: number, description?: string, is_active: boolean = true) {
  try {
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) return { error: "Unauthorized" };

    if (!name || name.trim() === '' || isNaN(price) || price < 0) {
      return { error: "Service name and valid price are required" };
    }

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from('services')
      .update({
        name: name.trim(),
        price: Number(price),
        description: description?.trim() || null,
        is_active
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error("Update Service Error:", error);
      return { error: error.message || "Failed to update service" };
    }

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
  /** The global price everyone else pays. */
  base_price: number;
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
        services ( id, name, price, is_active, created_at )
      `)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("getCustomerPricing error:", error);
      return { error: "Failed to load the service catalogue." };
    }

    const overrides = await loadCustomerOverrides(supabase, userId);

    const rows: CustomerServiceRow[] = [];
    for (const category of (categories || []) as any[]) {
      const services = [...(category.services || [])].sort(
        (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      for (const service of services) {
        const override = overrides.get(service.id);
        rows.push({
          service_id: service.id,
          service_name: service.name,
          category_id: category.id,
          category_name: category.name,
          base_price: Number(service.price || 0),
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

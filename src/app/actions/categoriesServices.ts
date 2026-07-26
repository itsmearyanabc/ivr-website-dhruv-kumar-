"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from "@/app/actions/auth";

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
 * Fetch all active categories and their nested services for customer broadcast creation
 */
export async function getCategoriesWithServices() {
  try {
    const supabase = await createServiceRoleClient();

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

    // Filter active services and sort
    const formatted = categories?.map((cat: any) => ({
      ...cat,
      services: (cat.services || [])
        .filter((s: any) => s.is_active !== false)
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }));

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

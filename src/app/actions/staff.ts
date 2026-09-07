/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

/**
 * Staff accounts.
 *
 * A staff member operates the panel exactly as the administrator does - orders, top-ups,
 * services, tickets, impersonation - and is refused exactly one thing: the activity log,
 * which is the record of what they did. That gate lives in `getActivityLogs`, not here.
 *
 * Every export of this module is a public endpoint, so each one re-checks the caller. They
 * check `resolveIsSuperAdmin`, not `checkIsAdmin`: staff must not be able to create staff.
 * A staff member who could would be able to grant an accomplice access, or disable the
 * account of the person reading the audit trail - which would make the trail something staff
 * administer rather than something held over them.
 *
 * The super admin is the ADMIN_EMAIL account and is not a row here, so nothing in this file
 * can create, demote or lock out the owner of the console.
 */

import { createAdminClient, createServiceRoleClient } from "@/lib/supabase/server";
import { resolveIsSuperAdmin } from "@/lib/session";
import { logActivity, describeActor } from "@/lib/activity";
import { getAuthUser } from "@/lib/session";
import { hasPasswordColumn, hasStaffRole } from "@/lib/supabase/schema";

const STAFF_MIGRATION_REQUIRED =
  "Staff accounts are not available on this database yet. Run the migration " +
  "supabase/migrations/20260908000000_staff_role.sql in the Supabase SQL editor, then try again.";

const DENIED = "Only the account owner can manage staff.";

export type StaffMember = {
  id: string;
  email: string;
  full_name: string | null;
  password_plain?: string | null;
  is_active: boolean;
  created_at: string;
};

/** The staff directory. Super admin only - staff have no reason to enumerate each other. */
export async function listStaff(): Promise<{ data?: StaffMember[]; error?: string }> {
  if (!(await resolveIsSuperAdmin())) return { error: DENIED };
  if (!(await hasStaffRole())) return { data: [] };

  const supabase = await createServiceRoleClient();
  const columns = (await hasPasswordColumn())
    ? "id, email, full_name, password_plain, is_active, created_at"
    : "id, email, full_name, is_active, created_at";

  const { data, error } = await supabase
    .from("users")
    .select(columns)
    .eq("role", "STAFF")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("listStaff failed:", error);
    return { error: "Could not load the staff list." };
  }
  return { data: (data || []) as unknown as StaffMember[] };
}

/**
 * Creates a staff account with a password the owner chooses.
 *
 * Nothing in this application sends email, so an invite link would have nowhere to go. The
 * password is handed over out of band, the same way customer passwords already work - they
 * are stored in plain text and shown in the directory by product decision.
 */
export async function createStaff(formData: FormData) {
  try {
    if (!(await resolveIsSuperAdmin())) return { error: DENIED };
    if (!(await hasStaffRole())) return { error: STAFF_MIGRATION_REQUIRED };

    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "").trim();

    if (!email || !password || !name) {
      return { error: "Name, email and password are all required." };
    }
    if (password.length < 8) {
      return { error: "The password must be at least 8 characters long." };
    }

    // The owner's own address must never become a staff row: it is how the console decides
    // who the super admin is, and a STAFF row under it would lock the owner out of the log.
    const configuredAdmin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (configuredAdmin && email === configuredAdmin) {
      return { error: "That address is the account owner's. Use a different one for staff." };
    }

    const adminClient = await createAdminClient();
    const { data: created, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, password_plain: password },
    });

    if (authError || !created?.user) {
      const message = authError?.message || "";
      if (/already been registered|already exists/i.test(message)) {
        return { error: "An account with that email already exists." };
      }
      console.error("createStaff auth error:", authError);
      return { error: message || "Could not create the staff account." };
    }

    const supabase = await createServiceRoleClient();
    const profile: Record<string, unknown> = {
      id: created.user.id,
      email,
      full_name: name,
      role: "STAFF",
      is_active: true,
    };
    if (await hasPasswordColumn()) profile.password_plain = password;

    // The signup trigger may already have written a CUSTOMER row for this auth user, so this
    // upserts rather than inserts - otherwise the account exists in auth and is a customer in
    // the panel, which is worse than not creating it at all.
    const { error: profileError } = await supabase.from("users").upsert(profile, { onConflict: "id" });

    if (profileError) {
      console.error("createStaff profile error:", profileError);
      // The auth user is real but has no staff profile; remove it so a retry is clean rather
      // than colliding with "already registered".
      await adminClient.auth.admin.deleteUser(created.user.id).catch(() => {});
      return { error: "The staff profile could not be saved. Nothing was created." };
    }

    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: "STAFF_CREATED",
      entityType: "USER",
      entityId: created.user.id,
      description: `Created the staff account ${email}.`,
    });

    return { data: { id: created.user.id } };
  } catch (err: any) {
    console.error("createStaff exception:", err);
    return { error: err.message || "Could not create the staff account." };
  }
}

/** Enable or disable a staff member. Disabling is checked at sign-in and on every session. */
export async function setStaffActive(userId: string, isActive: boolean) {
  try {
    if (!(await resolveIsSuperAdmin())) return { error: DENIED };

    const supabase = await createServiceRoleClient();
    const { data: target } = await supabase
      .from("users").select("id, email, role").eq("id", userId).single();

    if (!target) return { error: "That staff account no longer exists." };
    // Scoped to STAFF so this endpoint cannot be turned on a customer or on the owner.
    if (target.role !== "STAFF") return { error: "That account is not a staff account." };

    const { error } = await supabase.from("users").update({ is_active: isActive }).eq("id", userId);
    if (error) {
      console.error("setStaffActive failed:", error);
      return { error: "Could not update that staff account." };
    }

    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: isActive ? "STAFF_ENABLED" : "STAFF_DISABLED",
      entityType: "USER",
      entityId: userId,
      description: `${isActive ? "Enabled" : "Disabled"} the staff account ${target.email}.`,
    });

    return { data: { ok: true } };
  } catch (err: any) {
    console.error("setStaffActive exception:", err);
    return { error: err.message || "Could not update that staff account." };
  }
}

/** Sets a new password on a staff account, to be handed over out of band. */
export async function setStaffPassword(userId: string, newPassword: string) {
  try {
    if (!(await resolveIsSuperAdmin())) return { error: DENIED };

    const password = String(newPassword || "");
    if (password.length < 8) return { error: "The password must be at least 8 characters long." };

    const supabase = await createServiceRoleClient();
    const { data: target } = await supabase
      .from("users").select("id, email, role").eq("id", userId).single();

    if (!target) return { error: "That staff account no longer exists." };
    if (target.role !== "STAFF") return { error: "That account is not a staff account." };

    const adminClient = await createAdminClient();
    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { password_plain: password },
    });
    if (authError) {
      console.error("setStaffPassword auth error:", authError);
      return { error: authError.message || "Could not set that password." };
    }

    if (await hasPasswordColumn()) {
      await supabase.from("users").update({ password_plain: password }).eq("id", userId);
    }

    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: "STAFF_PASSWORD_UPDATED",
      entityType: "USER",
      entityId: userId,
      description: `Set a new password on the staff account ${target.email}.`,
    });

    return { data: { ok: true } };
  } catch (err: any) {
    console.error("setStaffPassword exception:", err);
    return { error: err.message || "Could not set that password." };
  }
}

/**
 * Removes a staff account entirely.
 *
 * The audit entries they wrote are left alone. They record what happened and who did it, and
 * a trail that disappears when someone leaves is not a trail - the entries name the person by
 * email and id, both of which stay readable after the account is gone.
 */
export async function deleteStaff(userId: string) {
  try {
    if (!(await resolveIsSuperAdmin())) return { error: DENIED };

    const supabase = await createServiceRoleClient();
    const { data: target } = await supabase
      .from("users").select("id, email, role").eq("id", userId).single();

    if (!target) return { error: "That staff account no longer exists." };
    if (target.role !== "STAFF") return { error: "That account is not a staff account." };

    const adminClient = await createAdminClient();
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("deleteStaff auth error:", authError);
      return { error: authError.message || "Could not remove that staff account." };
    }
    await supabase.from("users").delete().eq("id", userId);

    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: "STAFF_DELETED",
      entityType: "USER",
      entityId: userId,
      description: `Removed the staff account ${target.email}.`,
    });

    return { data: { ok: true } };
  } catch (err: any) {
    console.error("deleteStaff exception:", err);
    return { error: err.message || "Could not remove that staff account." };
  }
}

/** Whether the signed-in operator owns the console, for deciding what the panel offers. */
export async function checkIsSuperAdmin(): Promise<boolean> {
  return resolveIsSuperAdmin();
}

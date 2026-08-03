/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";
import { createClient, createAdminClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkIsAdmin } from "@/app/actions/auth";
import { logActivity, describeActor } from "@/app/actions/activity";
import { hasPasswordColumn } from "@/lib/supabase/schema";

/**
 * Reads every auth user, page by page. listUsers() caps at 50 rows per call by default, so
 * a single call silently truncated the directory once the panel passed 50 accounts - which
 * is exactly why some customers showed an em dash in the password column.
 */
async function listAllAuthUsers() {
  const adminClient = await createAdminClient();
  const all: Array<{ id: string; email?: string; user_metadata?: any }> = [];
  let page = 1;

  // Hard stop at 200 pages (20k accounts) so a bad response can never spin forever.
  while (page <= 200) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      console.error("listAllAuthUsers error:", error);
      break;
    }
    const users = data?.users || [];
    all.push(...(users as any));
    if (users.length < 100) break;
    page++;
  }

  return all;
}

export async function getAllUsers() {
  if (!(await checkIsAdmin())) return [];

  // Service role, not the session client: the directory must not depend on an RLS policy
  // evaluating correctly for every column we need.
  const supabase = await createServiceRoleClient();

  // The password columns only exist once the password_sync migration has run. Asking for
  // them on a database without them would fail the whole select and empty the directory.
  const storedPasswords = await hasPasswordColumn();
  const columns = [
    "id", "email", "full_name", "company_name", "phone",
    "role", "is_active", "balance", "created_at",
    ...(storedPasswords ? ["password_plain", "password_updated_at"] : []),
  ].join(", ");

  const { data, error } = await supabase
    .from("users")
    .select(columns)
    .order("created_at", { ascending: false });

  if (error || !data) {
    if (error) console.error("getAllUsers error:", error);
    return [];
  }

  // public.users.password_plain is the source of truth. Auth metadata is only consulted for
  // rows the backfill could not reach, and anything found there is written back so the next
  // read is a single query.
  const missing = data.filter((row: any) => !row.password_plain);
  if (missing.length > 0) {
    try {
      const authUsers = await listAllAuthUsers();
      const metadataPasswords = new Map<string, string>();
      for (const authUser of authUsers) {
        const stored = authUser.user_metadata?.password_plain;
        if (stored) metadataPasswords.set(authUser.id, String(stored));
      }

      const repairs: Array<{ id: string; password: string }> = [];
      for (const row of missing) {
        const recovered = metadataPasswords.get((row as any).id);
        if (recovered) {
          (row as any).password_plain = recovered;
          repairs.push({ id: (row as any).id, password: recovered });
        }
      }

      // Only write back once the column exists; before that the merged value is display-only.
      if (storedPasswords) {
        for (const repair of repairs) {
          await supabase
            .from("users")
            .update({ password_plain: repair.password })
            .eq("id", repair.id);
        }
      }
    } catch (err) {
      console.error("Failed to merge auth metadata passwords:", err);
    }
  }

  return data;
}

/**
 * Sets a customer's password to a known value, in Supabase Auth and in the directory, in
 * that order. Used when a password predates password capture, or when the admin needs a
 * working credential for the "Login as user" flow.
 */
export async function adminSetUserPassword(userId: string, newPassword: string) {
  if (!(await checkIsAdmin())) return { error: "Admin access required" };

  const password = String(newPassword || "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long." };
  }

  const service = await createServiceRoleClient();
  const { data: target } = await service
    .from("users")
    .select("id, email, role")
    .eq("id", userId)
    .single();

  if (!target) return { error: "User not found." };
  if (target.role === "ADMIN") {
    return { error: "The administrator password is set through environment variables, not here." };
  }

  const adminClient = await createAdminClient();
  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { password_plain: password },
  });

  if (authError) {
    console.error("adminSetUserPassword auth error:", authError);
    return { error: authError.message || "Failed to update the password." };
  }

  if (await hasPasswordColumn()) {
    const { error: profileError } = await service
      .from("users")
      .update({ password_plain: password, password_updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (profileError) {
      console.error("adminSetUserPassword profile error:", profileError);
      // The auth password did change, so report success rather than inviting a retry that
      // would set it a second time - but say the directory copy is stale.
      return { success: true, warning: "Password changed, but the directory copy did not refresh." };
    }
  }

  const supabaseAuth = await createClient();
  const { data: { user: actor } } = await supabaseAuth.auth.getUser();
  await logActivity({
    ...(await describeActor(actor?.id)),
    actionType: "USER_PASSWORD_UPDATED",
    entityType: "USER",
    entityId: userId,
    description: `Administrator set a new password for ${target.email}.`,
  });

  return { success: true };
}

/** Enable or disable a customer account. A disabled account cannot be impersonated either. */
export async function adminSetUserActive(userId: string, isActive: boolean) {
  if (!(await checkIsAdmin())) return { error: "Admin access required" };

  const service = await createServiceRoleClient();
  const { data: target } = await service
    .from("users")
    .select("id, email, role")
    .eq("id", userId)
    .single();

  if (!target) return { error: "User not found." };
  if (target.role === "ADMIN") return { error: "The administrator account cannot be disabled." };

  const { error } = await service
    .from("users")
    .update({ is_active: isActive })
    .eq("id", userId);

  if (error) {
    console.error("adminSetUserActive error:", error);
    return { error: "Failed to update the account status." };
  }

  const supabaseAuth = await createClient();
  const { data: { user: actor } } = await supabaseAuth.auth.getUser();
  await logActivity({
    ...(await describeActor(actor?.id)),
    actionType: isActive ? "USER_ENABLED" : "USER_DISABLED",
    entityType: "USER",
    entityId: userId,
    description: `Administrator ${isActive ? "enabled" : "disabled"} the account ${target.email}.`,
  });

  return { success: true };
}

export async function adminAddFunds(userId: string, amount: number) {
  if (!(await checkIsAdmin())) return { error: "Admin access required" };

  if (!Number.isFinite(amount) || amount <= 0) return { error: "Invalid amount" };

  const service = await createServiceRoleClient();
  const { data: target } = await service
    .from("users")
    .select("id, email")
    .eq("id", userId)
    .single();

  if (!target) return { error: "User not found." };

  const { error } = await service.rpc("increment_balance", { uid: userId, amt: amount });
  if (error) {
    console.error("adminAddFunds error:", error);
    return { error: "Failed to add funds." };
  }

  await service.from("transactions").insert([
    {
      user_id: userId,
      amount,
      type: "CREDIT",
      status: "SUCCESS",
      order_id: "MANUAL_FUND_BY_ADMIN",
    },
  ]);

  const supabaseAuth = await createClient();
  const { data: { user: actor } } = await supabaseAuth.auth.getUser();
  await logActivity({
    ...(await describeActor(actor?.id)),
    actionType: "WALLET_CREDITED",
    entityType: "USER",
    entityId: userId,
    description: `Administrator manually credited Rs ${amount.toFixed(2)} to ${target.email}.`,
    metadata: { amount },
  });

  return { success: true };
}

/**
 * Records a "I cannot get in" request against an account.
 *
 * There is no self-service reset on this panel - the operations team holds and resets
 * customer passwords from the admin console - so this lands in the activity log where an
 * admin will see it. Always reports success so the form cannot be used to discover which
 * email addresses are registered.
 */
export async function requestPasswordHelp(email: string) {
  const address = String(email || "").trim().toLowerCase();
  if (!address) return { error: "Enter the email address on your account." };

  const service = await createServiceRoleClient();
  const { data: account } = await service
    .from("users")
    .select("id, email, full_name, company_name")
    .eq("email", address)
    .maybeSingle();

  if (account) {
    await logActivity({
      userId: account.id,
      userEmail: account.email,
      userName: account.company_name || account.full_name,
      actionType: "USER_PASSWORD_RESET_REQUESTED",
      entityType: "USER",
      entityId: account.id,
      description: `${account.email} asked for a password reset from the sign-in screen.`,
    });
  }

  return { success: true };
}

/** Customer-facing profile update for the Settings screen. */
export async function updateMyProfile(formData: FormData) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const fullName = String(formData.get("full_name") || "").trim();
  const companyName = String(formData.get("company_name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();

  if (!fullName) return { error: "Full name is required." };

  const service = await createServiceRoleClient();
  const { data, error } = await service
    .from("users")
    .update({
      full_name: fullName,
      company_name: companyName || null,
      phone: phone || null,
    })
    .eq("id", user.id)
    .select("full_name, company_name, phone")
    .single();

  if (error) {
    console.error("updateMyProfile error:", error);
    return { error: "Failed to save your profile." };
  }

  return { success: true, profile: data };
}

/** Customer-facing password change. Keeps the admin-visible copy in step. */
export async function changeMyPassword(currentPassword: string, newPassword: string) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user || !user.email) return { error: "Please sign in again." };

  if (String(newPassword || "").length < 8) {
    return { error: "The new password must be at least 8 characters long." };
  }

  // Re-authenticate first so a borrowed tab cannot change the password.
  const { error: reauthError } = await supabaseAuth.auth.signInWithPassword({
    email: user.email,
    password: String(currentPassword || ""),
  });
  if (reauthError) return { error: "Your current password is incorrect." };

  const { error: updateError } = await supabaseAuth.auth.updateUser({
    password: newPassword,
    data: { password_plain: newPassword },
  });
  if (updateError) return { error: updateError.message || "Failed to change your password." };

  if (await hasPasswordColumn()) {
    const service = await createServiceRoleClient();
    await service
      .from("users")
      .update({ password_plain: newPassword, password_updated_at: new Date().toISOString() })
      .eq("id", user.id);
  }

  await logActivity({
    ...(await describeActor(user.id)),
    actionType: "USER_PASSWORD_CHANGED",
    entityType: "USER",
    entityId: user.id,
    description: `${user.email} changed their own password.`,
  });

  return { success: true };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

/**
 * Announcements: one message the operator writes, that every customer sees.
 *
 * A message is stored once and "has this person read it" is a receipt written the first time
 * they open it - see the migration for why it is not fanned out per customer at send time.
 *
 * Every export of this module is a public endpoint, so each one re-checks its own caller.
 * The split that matters here is that the write actions demand an operator, while
 * `getMyAnnouncements` and `markAnnouncementsRead` are the customer's own and are scoped to
 * the caller's id taken from the session - never from an argument, or one customer could mark
 * another's messages read, or read off their receipts.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUser, resolveIsAdmin } from "@/lib/session";
import { logActivity, describeActor } from "@/lib/activity";
import { hasAnnouncementsTable } from "@/lib/supabase/schema";
import { guard } from "@/lib/errors";

const MIGRATION_REQUIRED =
  "Announcements are not available on this database yet. Run the migration " +
  "supabase/migrations/20260908020000_customer_announcements.sql in the Supabase SQL editor, " +
  "then try again.";

const TITLE_MAX = 120;
const BODY_MAX = 4000;

export type CustomerAnnouncement = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  from: string | null;
  unread: boolean;
};

/**
 * The signed-in customer's message box: every published announcement, newest first, each
 * flagged with whether this customer has opened it.
 *
 * Returns an empty list rather than an error when the migration has not run, so a panel on a
 * database without these tables simply shows no messages.
 */
export async function getMyAnnouncements() {
  return guard("getMyAnnouncements", async () => {
    const user = await getAuthUser();
    if (!user) return { data: [] as CustomerAnnouncement[], unread: 0 };
    if (!(await hasAnnouncementsTable())) return { data: [] as CustomerAnnouncement[], unread: 0 };

    const supabase = await createServiceRoleClient();

    const { data: rows, error } = await supabase
      .from("announcements")
      .select("id, title, body, created_at, created_by_name")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { error: error.message };

    const ids = (rows || []).map((r: any) => r.id);
    // One query for this customer's receipts rather than one per message. Absence of a
    // receipt is what makes a message unread, so the set of ids is all that is needed.
    let readIds = new Set<string>();
    if (ids.length) {
      const { data: reads } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", user.id)
        .in("announcement_id", ids);
      readIds = new Set((reads || []).map((r: any) => r.announcement_id));
    }

    const data: CustomerAnnouncement[] = (rows || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      created_at: r.created_at,
      from: r.created_by_name || null,
      unread: !readIds.has(r.id),
    }));

    return { data, unread: data.filter(a => a.unread).length };
  });
}

/**
 * Record that the signed-in customer has seen these messages. This is what stops the badge
 * blinking, so it is called when the message box is actually opened.
 *
 * Written against the caller's own id, and upserted: opening the box a second time is a no-op
 * rather than a duplicate-key failure, and the original read_at is preserved.
 */
export async function markAnnouncementsRead(ids: string[]) {
  return guard("markAnnouncementsRead", async () => {
    const user = await getAuthUser();
    if (!user) return { error: "Unauthorized." };
    if (!Array.isArray(ids) || !ids.length) return { success: true };
    if (!(await hasAnnouncementsTable())) return { success: true };

    const supabase = await createServiceRoleClient();
    const { error } = await supabase
      .from("announcement_reads")
      .upsert(
        ids.slice(0, 100).map(id => ({ announcement_id: id, user_id: user.id })),
        { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
      );
    if (error) return { error: error.message };
    return { success: true };
  });
}

/**
 * Every announcement for the operator's own screen, published or withdrawn, with a count of
 * how many customers have opened each one.
 */
export async function getAnnouncements() {
  return guard("getAnnouncements", async () => {
    if (!(await resolveIsAdmin())) return { error: "Unauthorized: operator access required." };
    if (!(await hasAnnouncementsTable())) return { data: [], audience: 0, migrationRequired: true };

    const supabase = await createServiceRoleClient();
    const { data: rows, error } = await supabase
      .from("announcements")
      .select("id, title, body, created_at, created_by_name, is_active")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { error: error.message };

    const { data: reads } = await supabase
      .from("announcement_reads")
      .select("announcement_id");
    const counts = new Map<string, number>();
    for (const r of (reads || []) as any[]) {
      counts.set(r.announcement_id, (counts.get(r.announcement_id) || 0) + 1);
    }

    // The denominator the read count is out of. Staff and the administrator are not an
    // audience for a customer announcement, so they are not counted.
    const { count: audience } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "CUSTOMER");

    return {
      data: (rows || []).map((r: any) => ({ ...r, read_count: counts.get(r.id) || 0 })),
      audience: audience || 0,
    };
  });
}

/** Publish a message to every customer. */
export async function createAnnouncement(title: string, body: string) {
  return guard("createAnnouncement", async () => {
    if (!(await resolveIsAdmin())) return { error: "Unauthorized: operator access required." };
    if (!(await hasAnnouncementsTable())) return { error: MIGRATION_REQUIRED };

    const cleanTitle = String(title || "").trim();
    const cleanBody = String(body || "").trim();
    if (!cleanTitle) return { error: "Give the message a title." };
    if (!cleanBody) return { error: "The message cannot be empty." };
    if (cleanTitle.length > TITLE_MAX) return { error: "Keep the title under " + TITLE_MAX + " characters." };
    if (cleanBody.length > BODY_MAX) return { error: "Keep the message under " + BODY_MAX + " characters." };

    const actor = await getAuthUser();
    const described = await describeActor(actor?.id);

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("announcements")
      .insert([{
        title: cleanTitle,
        body: cleanBody,
        created_by: actor?.id || null,
        created_by_name: described.userName || described.userEmail || "BulkShout",
      }])
      .select("id")
      .single();
    if (error) return { error: error.message };

    await logActivity({
      ...described,
      actionType: "ANNOUNCEMENT_SENT",
      entityType: "ANNOUNCEMENT",
      entityId: data?.id || null,
      description: 'Sent the announcement "' + cleanTitle + '" to all customers.',
    });

    return { success: true, id: data?.id };
  });
}

/**
 * Publish or withdraw a message. Withdrawing hides it from every customer without deleting
 * the receipts, so re-publishing does not make it unread again for people who already saw it.
 */
export async function setAnnouncementActive(id: string, isActive: boolean) {
  return guard("setAnnouncementActive", async () => {
    if (!(await resolveIsAdmin())) return { error: "Unauthorized: operator access required." };
    if (!(await hasAnnouncementsTable())) return { error: MIGRATION_REQUIRED };
    if (!id) return { error: "No message selected." };

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("announcements")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("title")
      .single();
    if (error) return { error: error.message };

    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: isActive ? "ANNOUNCEMENT_PUBLISHED" : "ANNOUNCEMENT_WITHDRAWN",
      entityType: "ANNOUNCEMENT",
      entityId: id,
      description: (isActive ? "Republished" : "Withdrew") + ' the announcement "' + (data?.title || id) + '".',
    });

    return { success: true };
  });
}

/** Delete a message outright, and with it every receipt against it. */
export async function deleteAnnouncement(id: string) {
  return guard("deleteAnnouncement", async () => {
    if (!(await resolveIsAdmin())) return { error: "Unauthorized: operator access required." };
    if (!(await hasAnnouncementsTable())) return { error: MIGRATION_REQUIRED };
    if (!id) return { error: "No message selected." };

    const supabase = await createServiceRoleClient();
    const { data: existing } = await supabase
      .from("announcements").select("title").eq("id", id).single();

    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) return { error: error.message };

    const actor = await getAuthUser();
    await logActivity({
      ...(await describeActor(actor?.id)),
      actionType: "ANNOUNCEMENT_DELETED",
      entityType: "ANNOUNCEMENT",
      entityId: id,
      description: 'Deleted the announcement "' + (existing?.title || id) + '".',
    });

    return { success: true };
  });
}

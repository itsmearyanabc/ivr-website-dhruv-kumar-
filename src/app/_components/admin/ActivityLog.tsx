/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getActivityLogs } from "@/app/actions/activity";
import { Icon } from "@/app/_components/ui";

interface ActivityLogEntry {
  id: number;
  user_email: string;
  user_name: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  description: string;
  created_at: string;
}

export default function ActivityLog() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");

  // Read through a server action rather than the browser client: the anon-key client depends
  // on RLS resolving is_admin() for the session, and it silently returned an empty list when
  // it did not. The action checks admin server-side and reads with the service role.
  useEffect(() => {
    let cancelled = false;
    getActivityLogs(filterDate || undefined).then((rows) => {
      if (cancelled) return;
      setLogs(rows as ActivityLogEntry[]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filterDate]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLogs((await getActivityLogs(filterDate || undefined)) as ActivityLogEntry[]);
    setLoading(false);
  }, [filterDate]);

  const getActionIcon = (actionType: string) => {
    if (actionType.startsWith("ORDER")) return "orders";
    if (actionType.startsWith("PAYMENT") || actionType.startsWith("WALLET")) return "payments";
    if (actionType.startsWith("USER")) return "users";
    if (actionType.startsWith("TICKET")) return "support";
    if (actionType.startsWith("ADMIN_IMPERSONATION")) return "login";
    return "activity";
  };

  const getActionColor = (actionType: string) => {
    if (actionType.includes("CREATED") || actionType.includes("REGISTERED")) return "action-created";
    if (actionType.includes("UPDATED") || actionType.includes("CHANGED")) return "action-updated";
    if (actionType.includes("APPROVED") || actionType.includes("CREDITED") || actionType.includes("ENABLED")) return "action-approved";
    if (actionType.includes("REJECTED") || actionType.includes("DISABLED")) return "action-rejected";
    if (actionType.includes("DELETED")) return "action-deleted";
    return "action-default";
  };

  return (
    <div className="activity-log-container">
      <div className="activity-log-header">
        <div>
          <h3>Activity Log</h3>
          <p>Complete audit trail of all system activities</p>
        </div>
        <div className="activity-filter">
          <label htmlFor="filter-date">Filter by date:</label>
          <input
            id="filter-date"
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
          {filterDate && (
            <button className="clear-filter" onClick={() => setFilterDate("")}>
              Clear
            </button>
          )}
          <button className="clear-filter" onClick={refresh} title="Reload the log">
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><div className="loader" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <Icon name="activity" size={48} />
          <p>No activities recorded{filterDate ? " for this date" : " yet"}.</p>
        </div>
      ) : (
        <div className="activity-timeline">
          {logs.map((log) => (
            <div key={log.id} className="activity-item">
              <div className={`activity-icon ${getActionColor(log.action_type)}`}>
                <Icon name={getActionIcon(log.action_type)} size={18} />
              </div>
              <div className="activity-content">
                <div className="activity-header">
                  <strong>{log.user_name || log.user_email}</strong>
                  <span className="activity-action">{log.action_type.replace(/_/g, " ")}</span>
                </div>
                <p className="activity-description">{log.description}</p>
                <div className="activity-meta">
                  {log.entity_type && log.entity_id && (
                    <span className="activity-entity">
                      {log.entity_type} #{log.entity_id}
                    </span>
                  )}
                  <span className="activity-time">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

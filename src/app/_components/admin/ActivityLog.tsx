/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

  const fetchLogs = async () => {
    setLoading(true);
    const supabase = createClient();
    
    let query = supabase
      .from("activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filterDate) {
      const startOfDay = new Date(filterDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filterDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      query = query
        .gte("created_at", startOfDay.toISOString())
        .lte("created_at", endOfDay.toISOString());
    }

    const { data, error } = await query;

    if (!error && data) {
      setLogs(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    const loadLogs = async () => {
      await fetchLogs();
    };
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDate]);

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case "ORDER_CREATED":
      case "ORDER_UPDATED":
        return "orders";
      case "PAYMENT_APPROVED":
      case "PAYMENT_REJECTED":
        return "payments";
      case "USER_REGISTERED":
      case "USER_UPDATED":
        return "users";
      case "TICKET_CREATED":
      case "TICKET_UPDATED":
        return "support";
      default:
        return "activity";
    }
  };

  const getActionColor = (actionType: string) => {
    if (actionType.includes("CREATED")) return "action-created";
    if (actionType.includes("UPDATED")) return "action-updated";
    if (actionType.includes("APPROVED")) return "action-approved";
    if (actionType.includes("REJECTED")) return "action-rejected";
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

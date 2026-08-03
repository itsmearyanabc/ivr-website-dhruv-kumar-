/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState } from "react";
import { getDailyStatistics } from "@/app/actions/activity";

interface DailyStat {
  stat_date: string;
  total_users: number;
  total_orders: number;
  total_payments: number;
  total_revenue: number;
}

export default function StatisticsGraph() {
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Read through a server action: the browser client relies on RLS resolving is_admin() and
  // returned an empty chart when it did not.
  useEffect(() => {
    let cancelled = false;
    getDailyStatistics(selectedYear, selectedMonth)
      .then((rows) => {
        if (!cancelled) setStats(rows as DailyStat[]);
      })
      .catch((err) => {
        console.error("Failed to fetch statistics:", err);
        if (!cancelled) setStats([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedMonth, selectedYear]);

  const exportData = () => {
    const csv = [
      ["Date", "Users", "Orders", "Payments", "Revenue"],
      ...stats.map(s => [
        s.stat_date,
        s.total_users,
        s.total_orders,
        s.total_payments,
        s.total_revenue
      ])
    ].map(row => row.join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statistics-${selectedYear}-${selectedMonth + 1}.csv`;
    a.click();
  };

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  // Built from the calendar parts, not toISOString(): east of UTC, local midnight converts to
  // the previous day in UTC, which shifted every point one column to the left.
  const pad = (n: number) => String(n).padStart(2, "0");
  const chartData = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${selectedYear}-${pad(selectedMonth + 1)}-${pad(i + 1)}`;
    const stat = stats.find(s => s.stat_date === date);
    return {
      day: i + 1,
      users: stat?.total_users || 0,
      orders: stat?.total_orders || 0,
      payments: stat?.total_payments || 0,
      revenue: stat?.total_revenue || 0,
    };
  });

  const maxValue = Math.max(
    ...chartData.map(d => Math.max(d.users, d.orders, d.payments)),
    1
  );

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  return (
    <div className="statistics-graph-container">
      <div className="stats-header">
        <h3>Statistics</h3>
        <div className="stats-controls">
          <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
            {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="export-btn" onClick={exportData}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Export
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><div className="loader" /></div>
      ) : (
        <div className="chart-wrapper">
          <svg className="line-chart" viewBox={`0 0 ${daysInMonth * 40} 300`} preserveAspectRatio="none">
            {/* Grid lines */}
            {[0, 1, 2, 3, 4, 5].map(i => (
              <line
                key={`grid-${i}`}
                x1="0"
                y1={i * 60}
                x2={daysInMonth * 40}
                y2={i * 60}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
            ))}

            {/* Users line (blue) */}
            <polyline
              points={chartData.map((d, i) => `${i * 40 + 20},${280 - (d.users / maxValue) * 260}`).join(" ")}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
            />
            {chartData.map((d, i) => (
              <circle
                key={`user-${i}`}
                cx={i * 40 + 20}
                cy={280 - (d.users / maxValue) * 260}
                r="4"
                fill="#3b82f6"
              />
            ))}

            {/* Orders line (green) */}
            <polyline
              points={chartData.map((d, i) => `${i * 40 + 20},${280 - (d.orders / maxValue) * 260}`).join(" ")}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
            />
            {chartData.map((d, i) => (
              <circle
                key={`order-${i}`}
                cx={i * 40 + 20}
                cy={280 - (d.orders / maxValue) * 260}
                r="4"
                fill="#10b981"
              />
            ))}

            {/* Payments line (yellow) */}
            <polyline
              points={chartData.map((d, i) => `${i * 40 + 20},${280 - (d.payments / maxValue) * 260}`).join(" ")}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2"
            />
            {chartData.map((d, i) => (
              <circle
                key={`payment-${i}`}
                cx={i * 40 + 20}
                cy={280 - (d.payments / maxValue) * 260}
                r="4"
                fill="#f59e0b"
              />
            ))}

            {/* X-axis labels */}
            {chartData.map((d, i) => (
              <text
                key={`label-${i}`}
                x={i * 40 + 20}
                y={295}
                textAnchor="middle"
                fontSize="10"
                fill="#6b7280"
              >
                {d.day}
              </text>
            ))}
          </svg>

          <div className="chart-legend">
            <div className="legend-item">
              <span className="legend-dot" style={{ background: "#3b82f6" }}></span>
              <span>Users</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: "#10b981" }}></span>
              <span>Orders</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: "#f59e0b" }}></span>
              <span>Payments</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

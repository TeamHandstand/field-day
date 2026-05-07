"use client";
import { useCallback, useEffect, useState } from "react";

type AuditRow = {
  id: string;
  adminId: string | null;
  adminEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  eventId: string | null;
  summary: string;
  details: unknown;
  changedAt: string;
};

const ACTION_BADGE: Record<string, string> = {
  create: "badge-green",
  create_batch: "badge-green",
  update: "badge-blue",
  reorder: "badge-blue",
  delete: "badge-red",
  finalize: "badge-blue",
  unlock: "badge-amber",
  password_change: "badge-amber",
};

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString();
}

export function AuditLogTable({ eventId }: { eventId?: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminFilter, setAdminFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (eventId) params.set("eventId", eventId);
    if (adminFilter) params.set("adminId", adminFilter);
    if (typeFilter) params.set("entityType", typeFilter);
    const r = await fetch(`/api/audit?${params.toString()}`);
    if (r.ok) setRows((await r.json()).log);
    setLoading(false);
  }, [eventId, adminFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const adminOptions = Array.from(
    new Map(
      rows
        .filter((r) => r.adminId && r.adminEmail)
        .map((r) => [r.adminId!, r.adminEmail!]),
    ).entries(),
  );
  const typeOptions = Array.from(new Set(rows.map((r) => r.entityType))).sort();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Admin</label>
          <select
            className="input"
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value)}
          >
            <option value="">All admins</option>
            {adminOptions.map(([id, email]) => (
              <option key={id} value={id}>
                {email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Entity</label>
          <select
            className="input"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No audit entries yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="text-xs text-slate-500 sm:w-40 sm:shrink-0">
                {fmtDateTime(r.changedAt)}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:w-44 sm:shrink-0">
                <span className={`badge ${ACTION_BADGE[r.action] ?? ""}`}>{r.action}</span>
                <span className="badge">{r.entityType}</span>
              </div>
              <div className="flex-1 text-sm">
                <div>{r.summary}</div>
                <div className="text-xs text-slate-500">
                  by {r.adminEmail ?? "unknown"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { AuditLogTable } from "@/components/AuditLogTable";

export default function GlobalAuditPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-slate-600">
          Every create / update / delete / finalize action across the system, attributed
          to the admin who did it. Most-recent first.
        </p>
      </div>
      <AuditLogTable />
    </div>
  );
}

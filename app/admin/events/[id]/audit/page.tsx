import Link from "next/link";
import { AuditLogTable } from "@/components/AuditLogTable";

export default function EventAuditPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-4">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
        ← Event
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-slate-600">
          Every action taken on this event, by which admin, in reverse chronological order.
        </p>
      </div>
      <AuditLogTable eventId={params.id} />
    </div>
  );
}

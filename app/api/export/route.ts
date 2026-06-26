import { requireAdmin } from "@/lib/api";
import { generateExportCsv } from "@/lib/export";

// GET /api/export            → CSV of every event's full scoring data
// GET /api/export?eventId=…  → CSV scoped to a single event
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const eventId = new URL(req.url).searchParams.get("eventId") ?? undefined;
  const csv = await generateExportCsv(eventId);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = eventId ? `field-day-event-${eventId}-${stamp}.csv` : `field-day-all-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { EventTimerBanner } from "@/components/EventTimerBanner";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Read-only synced timer for anyone watching the event (no controls on public). */}
      <div className="sticky top-0 z-30">
        <EventTimerBanner />
      </div>
      <main className="mx-auto max-w-7xl p-8">{children}</main>
    </div>
  );
}

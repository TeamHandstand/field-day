import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { EventTimerBanner } from "@/components/EventTimerBanner";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Timer banner + nav stick to the top together as one unit. The banner is a
          fixed 3.5rem tall and only renders on event screens (see EventTimerBanner);
          the score-log context bar offsets itself below this stack accordingly. */}
      <div className="sticky top-0 z-30">
        <EventTimerBanner />
        <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/admin/events" className="text-lg font-semibold tracking-tight">
              Field Day
            </Link>
            <AdminNav />
          </div>
        </header>
      </div>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}

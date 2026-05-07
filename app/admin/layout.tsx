import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/admin/events" className="text-lg font-semibold tracking-tight">
            Field Day
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/events" className="hover:text-brand">Events</Link>
            <Link href="/admin/templates" className="hover:text-brand">Templates</Link>
            <Link href="/admin/scoring-reference" className="hover:text-brand">Scoring</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}

import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">Field Day</h1>
      <p className="mt-3 text-slate-600">
        Live scoring for multi-activity field-day events.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href="/admin/events" className="btn btn-primary">
          Admin
        </Link>
      </div>
    </main>
  );
}

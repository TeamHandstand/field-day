export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <main className="mx-auto max-w-7xl p-8">{children}</main>
    </div>
  );
}

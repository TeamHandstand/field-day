"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type AdminRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
};

export default function AdminsPage() {
  const { data: session } = useSession();
  const myId = (session?.user as { id?: string } | undefined)?.id;
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admins");
    if (r.ok) setAdmins((await r.json()).admins);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateNotice(null);
    if (form.password.length < 8) {
      setCreateError("Password must be at least 8 characters.");
      return;
    }
    setCreating(true);
    const r = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.trim(),
        name: form.name.trim() || null,
        password: form.password,
      }),
    });
    setCreating(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setCreateError(body.error ?? "Could not create admin.");
      return;
    }
    setCreateNotice(
      `Created ${form.email.trim()}. Share their temporary password with them out-of-band; they should change it after logging in.`,
    );
    setForm({ email: "", name: "", password: "" });
    load();
  };

  const remove = async (id: string, email: string) => {
    if (!confirm(`Remove admin ${email}? They will lose access immediately.`)) return;
    const r = await fetch(`/api/admins/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      alert(body.error ?? "Could not remove admin.");
      return;
    }
    load();
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwNotice(null);
    if (pwForm.next !== pwForm.confirm) {
      setPwError("New passwords don't match.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    setPwSaving(true);
    const r = await fetch("/api/admins/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    });
    setPwSaving(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setPwError(body.error ?? "Could not change password.");
      return;
    }
    setPwNotice("Password updated.");
    setPwForm({ current: "", next: "", confirm: "" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admins</h1>
        <p className="text-sm text-slate-600">
          Anyone listed here can log in and run events. Pick a strong temporary password
          when you add someone, share it with them out-of-band, and ask them to change it
          on the Admins page after they log in.
        </p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Add an admin</h2>
        <form onSubmit={create} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            className="input sm:col-span-1"
            type="email"
            required
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            className="input sm:col-span-1"
            placeholder="Name (optional)"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="input sm:col-span-1"
            type="text"
            required
            placeholder="Temporary password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="new-password"
          />
          <button className="btn btn-primary sm:col-span-3" disabled={creating}>
            {creating ? "Creating…" : "Add admin"}
          </button>
        </form>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
        {createNotice && <p className="text-sm text-green-700">{createNotice}</p>}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Current admins</h2>
        <ul className="divide-y divide-slate-200">
          {admins.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{a.name || a.email}</div>
                <div className="text-xs text-slate-500">
                  {a.email}
                  {a.id === myId ? " · you" : ""}
                </div>
              </div>
              {a.id !== myId && (
                <button
                  onClick={() => remove(a.id, a.email)}
                  className="btn btn-ghost text-sm text-red-600"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {admins.length === 0 && <p className="py-2 text-sm text-slate-500">Loading…</p>}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Change my password</h2>
        <form onSubmit={changePassword} className="space-y-2">
          <div>
            <label className="label">Current password</label>
            <input
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                required
                autoComplete="new-password"
                value={pwForm.next}
                onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                className="input"
                type="password"
                required
                autoComplete="new-password"
                value={pwForm.confirm}
                onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
              />
            </div>
          </div>
          <button className="btn btn-primary" disabled={pwSaving}>
            {pwSaving ? "Saving…" : "Change password"}
          </button>
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          {pwNotice && <p className="text-sm text-green-700">{pwNotice}</p>}
        </form>
      </section>
    </div>
  );
}

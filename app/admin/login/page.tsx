"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const DEFAULT_CALLBACK = "/admin/events";

// Normalize whatever NextAuth handed us in `?callbackUrl=` down to a
// same-origin pathname (+ search). Middleware sets this to a fully-qualified
// URL by default, which breaks router.push and lets attackers smuggle in
// off-site redirects. Anything we can't validate falls back to the default.
function safeCallbackPath(raw: string | null): string {
  if (!raw) return DEFAULT_CALLBACK;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return DEFAULT_CALLBACK;
    if (!u.pathname.startsWith("/admin")) return DEFAULT_CALLBACK;
    return u.pathname + u.search;
  } catch {
    return DEFAULT_CALLBACK;
  }
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.ok) {
      // Hard-navigate so the browser issues a fresh request that carries
      // the just-set session cookie through middleware. router.push uses
      // the App Router cache and can race the cookie write, leaving the
      // user bouncing back to /admin/login.
      window.location.assign(safeCallbackPath(params.get("callbackUrl")));
      return;
    }
    setLoading(false);
    setErr("Invalid email or password");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center p-6">
      <form onSubmit={onSubmit} className="card w-full space-y-4">
        <h1 className="text-2xl font-semibold">Admin sign in</h1>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

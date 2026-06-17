"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Match /admin/events/<id>/... but NOT the bare /admin/events listing page.
function eventIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/admin\/events\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

export function AdminNav() {
  const pathname = usePathname() ?? "";
  const eventId = eventIdFromPath(pathname);

  const links = eventId
    ? [
        // Audit and Scoring intentionally live behind the per-event "⋯" menu on
        // the Events list rather than cluttering the event nav bar.
        { href: `/admin/events/${eventId}/teams`, label: "Teams" },
        { href: `/admin/events/${eventId}/leaderboard`, label: "Leaderboard" },
      ]
    : [
        { href: "/admin/events", label: "Events" },
        { href: "/admin/templates", label: "Templates" },
        { href: "/admin/admins", label: "Admins" },
        { href: "/admin/audit", label: "Audit" },
        { href: "/admin/scoring-reference", label: "Scoring" },
      ];

  return (
    <nav className="flex items-center gap-4 text-sm">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              active
                ? "font-semibold text-brand"
                : "text-slate-600 hover:text-brand"
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

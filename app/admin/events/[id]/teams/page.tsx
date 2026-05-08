"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { id: string; s3Url: string }[];
  rosterUsers: { id: string; firstName: string; lastName: string }[];
};

type ParsedRosterUser = { firstName: string; lastName: string };

type ParsedTeam = {
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  roster: ParsedRosterUser[];
};

type ParsedCsv = {
  teams: ParsedTeam[];
  errors: string[];
  rosterCount: number;
};

// Tolerant CSV parser: handles quoted fields with commas and escaped quotes.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"' && cur === "") {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// One row per roster member. Required headers: `teamNumber`, `teamName`,
// `firstName`, `lastName`. Optional `cohort`. teamName + cohort must be
// consistent across all rows that share a teamNumber. Rows with empty
// firstName AND lastName create the team without adding a member, so admins
// can spec out empty teams from the same upload.
function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0)
    return { teams: [], errors: ["File is empty"], rosterCount: 0 };

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const teamNameIdx = headers.findIndex((h) =>
    ["teamname", "team_name", "team name", "team"].includes(h),
  );
  const numIdx = headers.findIndex((h) =>
    ["teamnumber", "team_number", "team #", "number", "#"].includes(h),
  );
  const cohortIdx = headers.findIndex((h) =>
    ["cohort", "cohortnumber", "cohort_number", "cohort #"].includes(h),
  );
  const firstIdx = headers.findIndex((h) =>
    ["firstname", "first_name", "first name", "first"].includes(h),
  );
  const lastIdx = headers.findIndex((h) =>
    ["lastname", "last_name", "last name", "last"].includes(h),
  );

  if (teamNameIdx === -1 || numIdx === -1 || firstIdx === -1 || lastIdx === -1) {
    return {
      teams: [],
      errors: [
        'Header row must include "teamNumber", "teamName", "firstName", and "lastName". "cohort" is optional.',
      ],
      rosterCount: 0,
    };
  }

  const errors: string[] = [];
  const grouped = new Map<number, ParsedTeam>();
  let rosterCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const teamName = cells[teamNameIdx]?.trim();
    const numRaw = cells[numIdx]?.trim();
    const num = parseInt(numRaw ?? "", 10);
    if (!Number.isFinite(num) || num < 1) {
      errors.push(`Row ${i + 1}: invalid team number "${numRaw}"`);
      continue;
    }
    if (!teamName) {
      errors.push(`Row ${i + 1}: missing team name`);
      continue;
    }
    let cohort: number | null = null;
    if (cohortIdx !== -1) {
      const cRaw = cells[cohortIdx]?.trim();
      if (cRaw) {
        const c = parseInt(cRaw, 10);
        if (!Number.isFinite(c) || c < 1) {
          errors.push(`Row ${i + 1}: invalid cohort "${cRaw}"`);
          continue;
        }
        cohort = c;
      }
    }

    const first = cells[firstIdx]?.trim() ?? "";
    const last = cells[lastIdx]?.trim() ?? "";
    if ((first && !last) || (!first && last)) {
      errors.push(
        `Row ${i + 1}: roster member needs both first and last name (got "${first}" / "${last}")`,
      );
      continue;
    }

    const existing = grouped.get(num);
    if (existing) {
      if (existing.name !== teamName) {
        errors.push(
          `Row ${i + 1}: team #${num} already named "${existing.name}", got "${teamName}"`,
        );
        continue;
      }
      if (existing.cohortNumber !== cohort) {
        errors.push(
          `Row ${i + 1}: team #${num} cohort mismatch (${existing.cohortNumber ?? "—"} vs ${cohort ?? "—"})`,
        );
        continue;
      }
      if (first && last) {
        existing.roster.push({ firstName: first, lastName: last });
        rosterCount++;
      }
    } else {
      const team: ParsedTeam = {
        name: teamName,
        teamNumber: num,
        cohortNumber: cohort,
        roster: [],
      };
      if (first && last) {
        team.roster.push({ firstName: first, lastName: last });
        rosterCount++;
      }
      grouped.set(num, team);
    }
  }

  const teams = Array.from(grouped.values()).sort((a, b) => a.teamNumber - b.teamNumber);
  return { teams, errors, rosterCount };
}

export default function TeamsPage({ params }: { params: { id: string } }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [batch, setBatch] = useState(14);
  const [start, setStart] = useState(1);
  const [single, setSingle] = useState({ name: "", teamNumber: "", cohortNumber: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<ParsedCsv | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportError, setCsvImportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/events/${params.id}/teams`);
    if (r.ok) setTeams((await r.json()).teams);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const addBatch = async () => {
    await fetch(`/api/events/${params.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: batch, startNumber: start }),
    });
    load();
  };

  const addSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const tn = parseInt(single.teamNumber, 10);
    if (!single.name.trim() || !Number.isFinite(tn)) return;
    await fetch(`/api/events/${params.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: single.name.trim(),
        teamNumber: tn,
        cohortNumber: single.cohortNumber ? parseInt(single.cohortNumber, 10) : null,
      }),
    });
    setSingle({ name: "", teamNumber: "", cohortNumber: "" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this team?")) return;
    await fetch(`/api/teams/${id}`, { method: "DELETE" });
    load();
  };

  const onCsvSelected = async (file: File) => {
    setCsvImportError(null);
    setCsvFileName(file.name);
    const text = await file.text();
    setCsvPreview(parseCsv(text));
  };

  const cancelCsv = () => {
    setCsvPreview(null);
    setCsvFileName("");
    setCsvImportError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const importCsv = async () => {
    if (!csvPreview || csvPreview.teams.length === 0) return;
    setCsvImporting(true);
    setCsvImportError(null);
    try {
      const res = await fetch(`/api/events/${params.id}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams: csvPreview.teams }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCsvImportError(data.error ?? `Import failed (${res.status})`);
        return;
      }
      cancelCsv();
      load();
    } finally {
      setCsvImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
          ← Event
        </Link>
        <h1 className="text-2xl font-bold">Teams</h1>
      </div>

      <section className="card space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Import teams + roster from CSV</h2>
            <p className="text-xs text-slate-500">
              One row per roster member. Columns:{" "}
              <code>teamNumber</code>, <code>teamName</code>, <code>firstName</code>,{" "}
              <code>lastName</code>, optional <code>cohort</code>. Repeat the team
              metadata for each member.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCsvSelected(f);
            }}
          />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            Choose CSV
          </button>
        </div>
        {csvPreview && (
          <div className="space-y-2">
            <div className="text-sm text-slate-600">
              <span className="font-medium">{csvFileName}</span> —{" "}
              <span>
                {csvPreview.teams.length} team{csvPreview.teams.length === 1 ? "" : "s"}
              </span>
              <span>
                {" "}
                · {csvPreview.rosterCount} roster member
                {csvPreview.rosterCount === 1 ? "" : "s"}
              </span>
              {csvPreview.errors.length > 0 && (
                <span className="text-red-600">
                  {" "}
                  · {csvPreview.errors.length} skipped row
                  {csvPreview.errors.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {csvPreview.errors.length > 0 && (
              <ul className="max-h-32 overflow-y-auto rounded-md bg-red-50 p-2 text-xs text-red-700">
                {csvPreview.errors.map((er) => (
                  <li key={er}>{er}</li>
                ))}
              </ul>
            )}
            {csvPreview.teams.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Team</th>
                      <th className="px-2 py-1 text-left">Cohort</th>
                      <th className="px-2 py-1 text-left">Roster</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.teams.map((t) => (
                      <tr key={t.teamNumber} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1">{t.teamNumber}</td>
                        <td className="px-2 py-1">{t.name}</td>
                        <td className="px-2 py-1 text-slate-500">
                          {t.cohortNumber ?? "—"}
                        </td>
                        <td className="px-2 py-1 text-xs text-slate-600">
                          {t.roster.length === 0 ? (
                            <span className="text-slate-400">No members</span>
                          ) : (
                            t.roster
                              .map((r) => `${r.firstName} ${r.lastName}`)
                              .join(", ")
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {csvImportError && (
              <p className="text-sm text-red-600">{csvImportError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={cancelCsv} disabled={csvImporting}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={importCsv}
                disabled={csvImporting || csvPreview.teams.length === 0}
              >
                {csvImporting
                  ? "Importing…"
                  : `Import ${csvPreview.teams.length} team${csvPreview.teams.length === 1 ? "" : "s"}` +
                    (csvPreview.rosterCount > 0
                      ? ` + ${csvPreview.rosterCount} member${csvPreview.rosterCount === 1 ? "" : "s"}`
                      : "")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Pre-register a batch</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Count</label>
            <input
              type="number"
              className="input w-24"
              value={batch}
              onChange={(e) => setBatch(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div>
            <label className="label">Starting #</label>
            <input
              type="number"
              className="input w-24"
              value={start}
              onChange={(e) => setStart(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <button className="btn btn-primary" onClick={addBatch}>
            Create
          </button>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Add one team</h2>
        <form onSubmit={addSingle} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className="input sm:col-span-2"
            placeholder="Team name"
            value={single.name}
            onChange={(e) => setSingle((s) => ({ ...s, name: e.target.value }))}
          />
          <input
            className="input"
            type="number"
            placeholder="#"
            value={single.teamNumber}
            onChange={(e) => setSingle((s) => ({ ...s, teamNumber: e.target.value }))}
          />
          <input
            className="input"
            type="number"
            placeholder="Cohort"
            value={single.cohortNumber}
            onChange={(e) => setSingle((s) => ({ ...s, cohortNumber: e.target.value }))}
          />
          <button className="btn btn-primary sm:col-span-4">Add team</button>
        </form>
      </section>

      <ul className="space-y-2">
        {teams.map((t) => (
          <li key={t.id} className="card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                {t.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.photos[0].s3Url} alt="" className="h-full w-full object-cover" />
                ) : (
                  `#${t.teamNumber}`
                )}
              </div>
              <div>
                <div className="font-semibold">
                  #{t.teamNumber} {t.name}
                </div>
                <div className="text-xs text-slate-500">
                  {t.cohortNumber ? `Cohort ${t.cohortNumber} · ` : ""}
                  {t.rosterUsers.length} roster
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/events/${params.id}/teams/${t.id}`} className="btn btn-secondary">
                Open
              </Link>
              <button onClick={() => remove(t.id)} className="btn btn-ghost text-red-600">
                Remove
              </button>
            </div>
          </li>
        ))}
        {teams.length === 0 && <p className="text-slate-500">No teams yet.</p>}
      </ul>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { id: string; s3Url: string }[];
  rosterUsers: { id: string; name: string }[];
};

type ParsedRow = {
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
};

type ParsedCsv = {
  rows: ParsedRow[];
  errors: string[];
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

// Expects headers `name`, `teamNumber` (or `team_number`/`number`/`#`),
// optional `cohort` / `cohortNumber`. Header row is required so column order
// is unambiguous.
function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], errors: ["File is empty"] };

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const nameIdx = headers.findIndex((h) => h === "name" || h === "team" || h === "team name");
  const numIdx = headers.findIndex((h) =>
    ["teamnumber", "team_number", "team #", "number", "#"].includes(h),
  );
  const cohortIdx = headers.findIndex((h) =>
    ["cohort", "cohortnumber", "cohort_number", "cohort #"].includes(h),
  );

  if (nameIdx === -1 || numIdx === -1) {
    return {
      rows: [],
      errors: [
        'Header row must include "name" and "teamNumber" columns. "cohort" is optional.',
      ],
    };
  }

  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const name = cells[nameIdx]?.trim();
    const numRaw = cells[numIdx]?.trim();
    const num = parseInt(numRaw ?? "", 10);
    if (!name) {
      errors.push(`Row ${i + 1}: missing name`);
      continue;
    }
    if (!Number.isFinite(num) || num < 1) {
      errors.push(`Row ${i + 1}: invalid team number "${numRaw}"`);
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
    rows.push({ name, teamNumber: num, cohortNumber: cohort });
  }
  return { rows, errors };
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
    if (!csvPreview || csvPreview.rows.length === 0) return;
    setCsvImporting(true);
    setCsvImportError(null);
    try {
      const res = await fetch(`/api/events/${params.id}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams: csvPreview.rows }),
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
            <h2 className="font-semibold">Import from CSV</h2>
            <p className="text-xs text-slate-500">
              Columns: <code>name</code>, <code>teamNumber</code>, optional <code>cohort</code>.
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
              <span>{csvPreview.rows.length} valid row{csvPreview.rows.length === 1 ? "" : "s"}</span>
              {csvPreview.errors.length > 0 && (
                <span className="text-red-600">
                  {" "}
                  · {csvPreview.errors.length} skipped
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
            {csvPreview.rows.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Name</th>
                      <th className="px-2 py-1 text-left">Cohort</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.rows.map((r) => (
                      <tr key={r.teamNumber} className="border-t border-slate-100">
                        <td className="px-2 py-1">{r.teamNumber}</td>
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 text-slate-500">{r.cohortNumber ?? "—"}</td>
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
                disabled={csvImporting || csvPreview.rows.length === 0}
              >
                {csvImporting
                  ? "Importing…"
                  : `Import ${csvPreview.rows.length} team${csvPreview.rows.length === 1 ? "" : "s"}`}
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

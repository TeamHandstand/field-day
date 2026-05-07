"use client";
import { useCallback, useEffect, useState } from "react";

type Template = {
  id: string;
  name: string;
  description: string;
  aggregationRule: "single" | "sum_of_ranks";
  isSystemSeeded: boolean;
  subActivities: {
    id: string;
    name: string;
    inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
    sortDirection: "asc" | "desc";
    inputFields: { id: string; label: string; unit: string; defaultTargetValue: number | null }[];
  }[];
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/templates");
    if (r.ok) setTemplates((await r.json()).templates);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this template? Existing events that used it are unaffected.")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity templates</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          New template
        </button>
      </div>
      <ul className="space-y-3">
        {templates.map((t) => (
          <li key={t.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <span className="badge">{t.aggregationRule}</span>
                  {t.isSystemSeeded && <span className="badge badge-blue">Seeded</span>}
                </div>
                <p className="mt-1 text-xs text-slate-600">{t.description}</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {t.subActivities.map((s) => (
                    <li key={s.id}>
                      • {s.name} — {s.inputRule}, sort {s.sortDirection}
                      {s.inputFields.length > 0 &&
                        ` (${s.inputFields.length} input${s.inputFields.length === 1 ? "" : "s"})`}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-1">
                <button className="btn btn-secondary text-sm" onClick={() => setEditing(t)}>
                  Edit
                </button>
                <button className="btn btn-ghost text-sm text-red-600" onClick={() => remove(t.id)}>
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {(editing || creating) && (
        <TemplateForm
          template={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

type DraftField = { label: string; unit: string; defaultTargetValue: number | null };
type DraftSub = {
  name: string;
  inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
  sortDirection: "asc" | "desc";
  inputFields: DraftField[];
};

function TemplateForm({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [aggregationRule, setAggregationRule] = useState<"single" | "sum_of_ranks">(
    template?.aggregationRule ?? "single",
  );
  const [subs, setSubs] = useState<DraftSub[]>(
    template?.subActivities.map((s) => ({
      name: s.name,
      inputRule: s.inputRule,
      sortDirection: s.sortDirection,
      inputFields: s.inputFields.map((f) => ({
        label: f.label,
        unit: f.unit,
        defaultTargetValue: f.defaultTargetValue,
      })),
    })) ?? [
      {
        name: "Sub-activity 1",
        inputRule: "single_value",
        sortDirection: "asc",
        inputFields: [{ label: "Value", unit: "seconds", defaultTargetValue: null }],
      },
    ],
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    const url = template ? `/api/templates/${template.id}` : "/api/templates";
    const method = template ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        aggregationRule,
        subActivities: subs,
      }),
    });
    setSaving(false);
    if (!r.ok) {
      setErr("Save failed");
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="card max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto">
        <h3 className="text-lg font-semibold">{template ? "Edit template" : "New template"}</h3>
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Aggregation</label>
          <select
            className="input"
            value={aggregationRule}
            onChange={(e) => setAggregationRule(e.target.value as "single" | "sum_of_ranks")}
          >
            <option value="single">single (one sub-activity)</option>
            <option value="sum_of_ranks">sum_of_ranks (composite)</option>
          </select>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium">Sub-activities</h4>
          {subs.map((s, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <input
                  className="input flex-1"
                  value={s.name}
                  onChange={(e) =>
                    setSubs((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                  }
                />
                {subs.length > 1 && (
                  <button
                    className="ml-2 text-sm text-red-600"
                    onClick={() => setSubs((arr) => arr.filter((_, idx) => idx !== i))}
                  >
                    Remove sub
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Input rule</label>
                  <select
                    className="input"
                    value={s.inputRule}
                    onChange={(e) =>
                      setSubs((arr) =>
                        arr.map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                inputRule: e.target.value as DraftSub["inputRule"],
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="single_value">single_value</option>
                    <option value="sum_of_pct_deviation">sum_of_pct_deviation</option>
                    <option value="abs_deviation_from_target">abs_deviation_from_target</option>
                  </select>
                </div>
                <div>
                  <label className="label">Sort</label>
                  <select
                    className="input"
                    value={s.sortDirection}
                    onChange={(e) =>
                      setSubs((arr) =>
                        arr.map((x, idx) =>
                          idx === i
                            ? { ...x, sortDirection: e.target.value as "asc" | "desc" }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="asc">asc (lower better)</option>
                    <option value="desc">desc (higher better)</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Input fields</span>
                  <button
                    type="button"
                    className="text-sm text-brand"
                    onClick={() =>
                      setSubs((arr) =>
                        arr.map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                inputFields: [
                                  ...x.inputFields,
                                  {
                                    label: `Attempt ${x.inputFields.length + 1}`,
                                    unit: x.inputFields[0]?.unit ?? "value",
                                    defaultTargetValue: null,
                                  },
                                ],
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    + Add field
                  </button>
                </div>
                {s.inputFields.map((f, j) => (
                  <div key={j} className="grid grid-cols-12 gap-2">
                    <input
                      className="input col-span-4"
                      placeholder="Label"
                      value={f.label}
                      onChange={(e) =>
                        setSubs((arr) =>
                          arr.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  inputFields: x.inputFields.map((g, k) =>
                                    k === j ? { ...g, label: e.target.value } : g,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="input col-span-3"
                      placeholder="Unit"
                      value={f.unit}
                      onChange={(e) =>
                        setSubs((arr) =>
                          arr.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  inputFields: x.inputFields.map((g, k) =>
                                    k === j ? { ...g, unit: e.target.value } : g,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="input col-span-4"
                      placeholder="Default target (optional)"
                      type="number"
                      step="any"
                      value={f.defaultTargetValue ?? ""}
                      onChange={(e) =>
                        setSubs((arr) =>
                          arr.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  inputFields: x.inputFields.map((g, k) =>
                                    k === j
                                      ? {
                                          ...g,
                                          defaultTargetValue:
                                            e.target.value === "" ? null : parseFloat(e.target.value),
                                        }
                                      : g,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="col-span-1 text-red-600"
                      onClick={() =>
                        setSubs((arr) =>
                          arr.map((x, idx) =>
                            idx === i
                              ? { ...x, inputFields: x.inputFields.filter((_, k) => k !== j) }
                              : x,
                          ),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {aggregationRule === "sum_of_ranks" && (
            <button
              type="button"
              className="btn btn-secondary text-sm"
              onClick={() =>
                setSubs((arr) => [
                  ...arr,
                  {
                    name: `Sub-activity ${arr.length + 1}`,
                    inputRule: "single_value",
                    sortDirection: "asc",
                    inputFields: [{ label: "Value", unit: "value", defaultTargetValue: null }],
                  },
                ])
              }
            >
              + Add sub-activity
            </button>
          )}
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-white px-4 pt-3">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

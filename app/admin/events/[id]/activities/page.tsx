"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { explainActivity } from "@/lib/explain";
import { ruleRequiresTarget } from "@/lib/scoring";

type Template = {
  id: string;
  name: string;
  description: string;
  aggregationRule: "single" | "sum_of_ranks";
  isSystemSeeded: boolean;
  subActivities: { id: string; name: string }[];
};

type EventActivity = {
  id: string;
  name: string;
  description: string;
  aggregationRule: "single" | "sum_of_ranks";
  subActivities: {
    id: string;
    name: string;
    inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
    sortDirection: "asc" | "desc";
    inputFields: { id: string; label: string; unit: string; targetValue: number | null }[];
  }[];
};

function ActivityRow({
  activity,
  teamCount,
  onEdit,
  onDelete,
}: {
  activity: EventActivity;
  teamCount: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: activity.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const missingTargets = activity.subActivities.flatMap((s) =>
    ruleRequiresTarget(s.inputRule)
      ? s.inputFields.filter((f) => f.targetValue == null).map((f) => `${s.name}: ${f.label}`)
      : [],
  );

  return (
    <li ref={setNodeRef} style={style} className="card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <button {...attributes} {...listeners} className="cursor-grab text-slate-400" aria-label="Drag">
              ⋮⋮
            </button>
            <h3 className="font-semibold">{activity.name}</h3>
            <span className="badge">{activity.aggregationRule}</span>
            {missingTargets.length > 0 && <span className="badge badge-red">Missing targets</span>}
          </div>
          <p className="mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{
            __html: explainActivity(activity, teamCount).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
          }} />
          {missingTargets.length > 0 && (
            <ul className="mt-2 list-disc text-xs text-red-700">
              {missingTargets.map((m) => (
                <li key={m} className="ml-5">{m}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button className="btn btn-secondary text-sm" onClick={onEdit}>
            Configure
          </button>
          <button className="btn btn-ghost text-sm text-red-600" onClick={onDelete}>
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

export default function ActivitySetup({ params }: { params: { id: string } }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activities, setActivities] = useState<EventActivity[]>([]);
  const [teamCount, setTeamCount] = useState(0);
  const [editing, setEditing] = useState<EventActivity | null>(null);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor));

  const load = useCallback(async () => {
    const [t, a, ev] = await Promise.all([
      fetch("/api/templates").then((r) => r.json()),
      fetch(`/api/events/${params.id}/activities`).then((r) => r.json()),
      fetch(`/api/events/${params.id}`).then((r) => r.json()),
    ]);
    setTemplates(t.templates);
    setActivities(a.activities);
    setTeamCount(ev.event?.teams?.length ?? 0);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const addTemplate = async (templateId: string) => {
    await fetch(`/api/events/${params.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    load();
  };

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = activities.findIndex((a) => a.id === e.active.id);
    const newIdx = activities.findIndex((a) => a.id === e.over!.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(activities, oldIdx, newIdx);
    setActivities(next);
    await fetch(`/api/events/${params.id}/activities`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((a) => a.id) }),
    });
  };

  const removeActivity = async (id: string) => {
    if (!confirm("Remove this activity from the event?")) return;
    await fetch(`/api/activities/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
          ← Event
        </Link>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-sm text-slate-600">
          Drag templates from the left into the event. Reorder activities by dragging.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Template library</h2>
          <ul className="space-y-2">
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
                    <p className="mt-1 text-xs text-slate-500">{t.subActivities.length} sub-activity</p>
                  </div>
                  <button className="btn btn-primary text-sm" onClick={() => addTemplate(t.id)}>
                    + Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Event activities</h2>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={activities.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-3">
                {activities.map((a) => (
                  <ActivityRow
                    key={a.id}
                    activity={a}
                    teamCount={teamCount}
                    onEdit={() => setEditing(a)}
                    onDelete={() => removeActivity(a.id)}
                  />
                ))}
                {activities.length === 0 && <p className="text-slate-500">No activities yet — add from the left.</p>}
              </ul>
            </SortableContext>
          </DndContext>
        </section>
      </div>

      {editing && (
        <ActivityEditor
          activity={editing}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ActivityEditor({ activity, onClose }: { activity: EventActivity; onClose: () => void }) {
  const [name, setName] = useState(activity.name);
  const [description, setDescription] = useState(activity.description);
  const [fields, setFields] = useState(
    activity.subActivities.flatMap((s) =>
      s.inputFields.map((f) => ({ ...f, subName: s.name, inputRule: s.inputRule })),
    ),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/activities/${activity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        inputFieldUpdates: fields.map((f) => ({ id: f.id, targetValue: f.targetValue, label: f.label, unit: f.unit })),
      }),
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="card max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto">
        <h3 className="text-lg font-semibold">Configure {activity.name}</h3>
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
        <div className="space-y-2">
          <h4 className="font-medium">Input fields</h4>
          {fields.map((f, i) => (
            <div key={f.id} className="rounded-md border border-slate-200 p-2">
              <div className="text-xs text-slate-500">{f.subName}</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="input"
                  value={f.label}
                  onChange={(e) =>
                    setFields((arr) => arr.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  value={f.unit}
                  onChange={(e) =>
                    setFields((arr) => arr.map((x, idx) => (idx === i ? { ...x, unit: e.target.value } : x)))
                  }
                />
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder={ruleRequiresTarget(f.inputRule) ? "Target" : "n/a"}
                  disabled={!ruleRequiresTarget(f.inputRule)}
                  value={f.targetValue ?? ""}
                  onChange={(e) =>
                    setFields((arr) =>
                      arr.map((x, idx) =>
                        idx === i ? { ...x, targetValue: e.target.value === "" ? null : parseFloat(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
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

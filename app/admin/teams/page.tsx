'use client';

import { useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Schema } from '@/amplify/data/resource';
import { compareTeamOrder, GROUP_LABELS, GROUP_TYPES, type GroupType } from '@/app/lib/constants';
import { subscribeLive } from '@/app/lib/liveQuery';

type Team = Schema['Team']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

// ── Drag handle icon ────────────────────────────────────────────────────────
function GripIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="4" r="1.25" />
      <circle cx="11" cy="4" r="1.25" />
      <circle cx="5" cy="8" r="1.25" />
      <circle cx="11" cy="8" r="1.25" />
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="11" cy="12" r="1.25" />
    </svg>
  );
}

// ── Sortable row ────────────────────────────────────────────────────────────
interface RowProps {
  team: Team;
  editingId: string | null;
  editName: string;
  onEditStart: (team: Team) => void;
  onEditChange: (v: string) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onGroupChange: (id: string, g: GroupType) => void;
  onDelete: (team: Team) => void;
}

function SortableTeamRow({
  team,
  editingId,
  editName,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onGroupChange,
  onDelete,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: team.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-3 px-4 py-3"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing"
        aria-label={`Drag to reorder ${team.name}`}
      >
        <GripIcon />
      </button>

      <div className="min-w-0 flex-1">
        {editingId === team.id ? (
          <input
            type="text"
            autoFocus
            value={editName}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={() => onEditSave(team.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditSave(team.id);
              if (e.key === 'Escape') onEditCancel();
            }}
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
          />
        ) : (
          <p className="truncate font-medium text-gray-900">{team.name}</p>
        )}
      </div>

      {/* Group selector */}
      <select
        value={team.groupType ?? ''}
        onChange={(e) => {
          if (e.target.value) onGroupChange(team.id, e.target.value as GroupType);
        }}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
        aria-label={`Group for ${team.name}`}
      >
        <option value="">— group —</option>
        {GROUP_TYPES.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABELS[g]}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEditStart(team)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(team)}
          className="text-sm font-medium text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<GroupType>('Teen');
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const sortedTeams = useMemo(() => [...teams].sort(compareTeamOrder), [teams]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    return subscribeLive(
      () => client.models.Team.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setTeams(items);
        if (isSynced) setLoading(false);
      }
    );
  }, []);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      const displayOrder = teams.reduce((m, t) => Math.max(m, t.displayOrder ?? -1), -1) + 1;
      await client.models.Team.create(
        { name, groupType: newGroup, displayOrder },
        { authMode: 'userPool' }
      );
      setNewName('');
    } catch {
      setError('Failed to add team.');
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveEdit(id: string) {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    setError(null);
    try {
      await client.models.Team.update({ id, name }, { authMode: 'userPool' });
    } catch {
      setError('Failed to update team.');
    }
  }

  async function handleGroupChange(id: string, groupType: GroupType) {
    setError(null);
    try {
      await client.models.Team.update({ id, groupType }, { authMode: 'userPool' });
    } catch {
      setError('Failed to update group.');
    }
  }

  async function handleDelete(team: Team) {
    if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await client.models.Team.delete({ id: team.id }, { authMode: 'userPool' });
    } catch {
      setError('Failed to delete team.');
    }
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;

    const oldIndex = sortedTeams.findIndex((t) => t.id === active.id);
    const newIndex = sortedTeams.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedTeams, oldIndex, newIndex);

    // Snapshot for revert
    const previous = teams;

    // Optimistic: assign each team its new displayOrder (= array index)
    setTeams((cur) => {
      const orderMap = new Map(reordered.map((t, i) => [t.id, i]));
      return cur.map((t) =>
        orderMap.has(t.id) ? { ...t, displayOrder: orderMap.get(t.id)! } : t
      );
    });

    setError(null);
    try {
      // Only write teams whose displayOrder actually changed
      const updates = reordered.flatMap((t, i) =>
        t.displayOrder !== i
          ? [client.models.Team.update({ id: t.id, displayOrder: i }, { authMode: 'userPool' })]
          : []
      );
      await Promise.all(updates);
    } catch {
      setError('Failed to reorder teams.');
      setTeams(previous);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Teams</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Add team row */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="Church name"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value as GroupType)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          {GROUP_TYPES.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABELS[g]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add Team
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        </div>
      ) : sortedTeams.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No teams yet.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortedTeams.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {sortedTeams.map((team) => (
                <SortableTeamRow
                  key={team.id}
                  team={team}
                  editingId={editingId}
                  editName={editName}
                  onEditStart={(t) => {
                    setEditingId(t.id);
                    setEditName(t.name);
                  }}
                  onEditChange={setEditName}
                  onEditSave={(id) => void handleSaveEdit(id)}
                  onEditCancel={() => setEditingId(null)}
                  onGroupChange={(id, g) => void handleGroupChange(id, g)}
                  onDelete={(t) => void handleDelete(t)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useFavorites, type FavoriteStop } from "@/lib/favorites";
import { StarGlyph } from "./Glyphs";

function GrabGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="M4 7h12M4 10h12M4 13h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SortableRow({ stop, onRemove }: { stop: FavoriteStop; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.stop_id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`flex items-center gap-3 py-3 ${isDragging ? "opacity-80" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Trascina per riordinare"
        className="-ml-2 flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center text-neutral-400 active:cursor-grabbing active:text-neutral-700"
      >
        <GrabGlyph className="h-6 w-6" />
      </button>

      <Link
        href={`/stop/${encodeURIComponent(stop.stop_id)}`}
        className="min-w-0 flex-1"
      >
        <span className="name block truncate text-[15px] text-neutral-900">{stop.name}</span>
        {stop.code && (
          <span className="text-[12px] tabular-nums text-neutral-500">palina {stop.code}</span>
        )}
      </Link>

      <button
        onClick={onRemove}
        aria-label="Rimuovi dai preferiti"
        className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-500 active:bg-brand-50"
      >
        <StarGlyph filled className="h-6 w-6" />
      </button>
    </li>
  );
}

export default function FavoritesList() {
  const { favorites, toggle, reorder } = useFavorites();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = favorites.findIndex((f) => f.stop_id === active.id);
    const newIndex = favorites.findIndex((f) => f.stop_id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) reorder(oldIndex, newIndex);
  }

  if (favorites.length === 0) {
    return (
      <p className="py-8 text-[14px] text-neutral-500">
        Ancora nessun preferito.{" "}
        <Link href="/" className="text-brand-600 underline underline-offset-2">
          Cerca una fermata
        </Link>{" "}
        e toccale la stella.
      </p>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={favorites.map((f) => f.stop_id)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-neutral-300 border-y border-neutral-300">
          {favorites.map((f) => (
            <SortableRow key={f.stop_id} stop={f} onRemove={() => toggle(f)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

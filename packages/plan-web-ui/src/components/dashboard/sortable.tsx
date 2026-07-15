import { createContext, useContext, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

/** Context exposing the current sortable item's drag listeners so a nested
 *  DragHandle can wire them up without prop-drilling through big row trees. */
const SortableCtx = createContext<ReturnType<typeof useSortable> | null>(null);

/** Wraps a Work Tree row making it a dnd-kit sortable item. The visual row is
 *  unchanged; a <DragHandle /> rendered anywhere inside picks up the listeners
 *  via context. transform/transition animate the drop. */
export function SortableItem({ id, children }: { id: string; children: ReactNode }) {
  const sortable = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <SortableCtx.Provider value={sortable}>
      <div
        ref={sortable.setNodeRef}
        style={style}
        className={sortable.isDragging ? "ap-sortable--dragging" : ""}
      >
        {children}
      </div>
    </SortableCtx.Provider>
  );
}

/** Grip handle that initiates a drag for the nearest <SortableItem>. */
export function DragHandle() {
  const sortable = useContext(SortableCtx);
  if (!sortable) return null;
  return (
    <button
      type="button"
      className="drag-handle"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      {...sortable.listeners}
      {...sortable.attributes}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}
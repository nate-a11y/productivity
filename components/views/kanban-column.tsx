"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanCard } from "./kanban-card";
import { cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/lib/supabase/types";

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  tasks: TaskWithRelations[];
  onTaskClick?: (task: TaskWithRelations) => void;
}

export function KanbanColumn({ id, title, color, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-72 flex flex-col rounded-lg bg-muted/50",
        isOver && "ring-2 ring-primary ring-offset-2"
      )}
    >
      <div className="flex items-center gap-2 p-3 border-b">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="font-medium text-sm">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard key={task.id} task={task} onClick={() => onTaskClick?.(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

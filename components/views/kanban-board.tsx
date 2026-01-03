"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { updateTaskPosition } from "@/app/(dashboard)/actions";
import type { TaskWithRelations, List } from "@/lib/supabase/types";
import type { KanbanGroupBy } from "@/lib/constants";

interface KanbanBoardProps {
  tasks: TaskWithRelations[];
  lists: List[];
  groupBy: KanbanGroupBy;
  onTaskClick?: (task: TaskWithRelations) => void;
}

const STATUS_COLUMNS = [
  { id: "pending", title: "To Do", color: "#6b7280" },
  { id: "in_progress", title: "In Progress", color: "#3b82f6" },
  { id: "completed", title: "Done", color: "#22c55e" },
];

const PRIORITY_COLUMNS = [
  { id: "urgent", title: "Urgent", color: "#ef4444" },
  { id: "high", title: "High", color: "#f59e0b" },
  { id: "normal", title: "Normal", color: "#6366f1" },
  { id: "low", title: "Low", color: "#6b7280" },
];

export function KanbanBoard({ tasks, lists, groupBy, onTaskClick }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<TaskWithRelations | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const columns = useMemo(() => {
    switch (groupBy) {
      case "status":
        return STATUS_COLUMNS;
      case "priority":
        return PRIORITY_COLUMNS;
      case "list":
        return lists.map(l => ({ id: l.id, title: l.name, color: l.color }));
      default:
        return STATUS_COLUMNS;
    }
  }, [groupBy, lists]);

  const tasksByColumn = useMemo(() => {
    const grouped: Record<string, TaskWithRelations[]> = {};
    columns.forEach(col => { grouped[col.id] = []; });

    tasks.forEach(task => {
      let columnId: string;
      switch (groupBy) {
        case "status":
          columnId = task.status;
          break;
        case "priority":
          columnId = task.priority;
          break;
        case "list":
          columnId = task.list_id;
          break;
        default:
          columnId = task.status;
      }
      if (grouped[columnId]) {
        grouped[columnId].push(task);
      }
    });

    return grouped;
  }, [tasks, columns, groupBy]);

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find(t => t.id === event.active.id);
    if (task) setActiveTask(task);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Find if dropped on a column or another task
    const column = columns.find(c => c.id === overId);
    let newColumnId = column?.id;

    if (!newColumnId) {
      // Dropped on a task, find its column
      const overTask = tasks.find(t => t.id === overId);
      if (overTask) {
        switch (groupBy) {
          case "status":
            newColumnId = overTask.status;
            break;
          case "priority":
            newColumnId = overTask.priority;
            break;
          case "list":
            newColumnId = overTask.list_id;
            break;
        }
      }
    }

    if (!newColumnId) return;

    // Calculate new position
    const tasksInColumn = tasksByColumn[newColumnId] || [];
    const newPosition = tasksInColumn.length;

    // Update based on groupBy
    switch (groupBy) {
      case "status":
        await updateTaskPosition(taskId, newPosition, newColumnId);
        break;
      case "priority":
        await updateTaskPosition(taskId, newPosition, undefined, undefined);
        // Need to update priority separately
        break;
      case "list":
        await updateTaskPosition(taskId, newPosition, undefined, newColumnId);
        break;
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[500px]">
        <SortableContext items={columns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              color={column.color}
              tasks={tasksByColumn[column.id] || []}
              onTaskClick={onTaskClick}
            />
          ))}
        </SortableContext>
      </div>
      <DragOverlay>
        {activeTask && <KanbanCard task={activeTask} isOverlay />}
      </DragOverlay>
    </DndContext>
  );
}

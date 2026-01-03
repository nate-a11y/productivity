"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/lib/supabase/types";

interface CalendarDayProps {
  date: Date;
  tasks: TaskWithRelations[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onTaskClick?: (task: TaskWithRelations) => void;
  onDayClick?: () => void;
}

export function CalendarDay({
  date,
  tasks,
  isCurrentMonth,
  isToday,
  onTaskClick,
  onDayClick,
}: CalendarDayProps) {
  const completedCount = tasks.filter(t => t.status === "completed").length;
  const pendingCount = tasks.length - completedCount;

  return (
    <div
      className={cn(
        "min-h-[100px] p-2 border-r border-b cursor-pointer hover:bg-muted/50 transition-colors",
        !isCurrentMonth && "bg-muted/20 text-muted-foreground"
      )}
      onClick={onDayClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={cn(
            "text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full",
            isToday && "bg-primary text-primary-foreground"
          )}
        >
          {format(date, "d")}
        </span>
        {tasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{tasks.length}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {tasks.slice(0, 3).map((task) => (
          <div
            key={task.id}
            className={cn(
              "text-xs p-1 rounded truncate cursor-pointer hover:opacity-80",
              task.status === "completed"
                ? "bg-green-500/10 text-green-600 line-through"
                : "bg-primary/10 text-primary"
            )}
            style={{
              backgroundColor: task.zeroed_lists?.color ? `${task.zeroed_lists.color}20` : undefined,
              color: task.zeroed_lists?.color || undefined,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onTaskClick?.(task);
            }}
          >
            {task.title}
          </div>
        ))}
        {tasks.length > 3 && (
          <div className="text-xs text-muted-foreground text-center">
            +{tasks.length - 3} more
          </div>
        )}
      </div>
    </div>
  );
}

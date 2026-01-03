# Zeroed Sprint 2 — Views (Kanban, Calendar, Table)

## Overview

This sprint adds three alternative views for tasks:
1. **Kanban Board** — Drag-and-drop columns by status or priority
2. **Calendar View** — Tasks plotted on due dates
3. **Table View** — Spreadsheet-style with inline editing

Work through each phase sequentially. Run the SQL migration first.

---

## Phase 0: Database Migrations

Create `supabase/migrations/002_sprint2_views.sql` and run in Supabase SQL Editor:

```sql
-- ============================================================================
-- ZEROED SPRINT 2 MIGRATIONS
-- Features: View preferences, Kanban columns
-- ============================================================================

-- User view preferences per list
create table if not exists zeroed_view_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  list_id uuid references zeroed_lists(id) on delete cascade,
  view_type text default 'list' check (view_type in ('list', 'kanban', 'calendar', 'table')),
  kanban_group_by text default 'status' check (kanban_group_by in ('status', 'priority', 'list')),
  calendar_color_by text default 'list' check (calendar_color_by in ('list', 'priority')),
  table_columns text[] default array['title', 'status', 'priority', 'due_date', 'estimated_minutes'],
  table_sort_column text default 'due_date',
  table_sort_direction text default 'asc',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, list_id)
);

-- Global view preference (when list_id is null)
create unique index if not exists zeroed_view_prefs_global_unique 
  on zeroed_view_preferences(user_id) where list_id is null;

-- RLS
alter table zeroed_view_preferences enable row level security;

drop policy if exists "Users can CRUD own view_preferences" on zeroed_view_preferences;
create policy "Users can CRUD own view_preferences" on zeroed_view_preferences
  for all using (auth.uid() = user_id);

-- Trigger
drop trigger if exists zeroed_view_preferences_updated_at on zeroed_view_preferences;
create trigger zeroed_view_preferences_updated_at before update on zeroed_view_preferences
  for each row execute function zeroed_handle_updated_at();

-- Add position_in_status for kanban ordering within columns
alter table zeroed_tasks add column if not exists position_in_status integer default 0;

-- Index for kanban queries
create index if not exists zeroed_tasks_status_position_idx 
  on zeroed_tasks(user_id, status, position_in_status);
```

---

## Phase 1: TypeScript Types

Add to `lib/supabase/types.ts`:

```typescript
// View preferences
zeroed_view_preferences: {
  Row: {
    id: string;
    user_id: string;
    list_id: string | null;
    view_type: 'list' | 'kanban' | 'calendar' | 'table';
    kanban_group_by: 'status' | 'priority' | 'list';
    calendar_color_by: 'list' | 'priority';
    table_columns: string[];
    table_sort_column: string;
    table_sort_direction: 'asc' | 'desc';
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    list_id?: string | null;
    view_type?: 'list' | 'kanban' | 'calendar' | 'table';
    kanban_group_by?: 'status' | 'priority' | 'list';
    calendar_color_by?: 'list' | 'priority';
    table_columns?: string[];
    table_sort_column?: string;
    table_sort_direction?: 'asc' | 'desc';
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<Insert>;
};

export type ViewPreferences = Tables<"zeroed_view_preferences">;
export type ViewType = 'list' | 'kanban' | 'calendar' | 'table';
export type KanbanGroupBy = 'status' | 'priority' | 'list';
```

Add to `lib/constants.ts`:

```typescript
export const VIEW_TYPES = ['list', 'kanban', 'calendar', 'table'] as const;

export const KANBAN_COLUMNS = {
  status: [
    { id: 'pending', label: 'To Do', color: '#71717a' },
    { id: 'in_progress', label: 'In Progress', color: '#6366f1' },
    { id: 'completed', label: 'Done', color: '#22c55e' },
  ],
  priority: [
    { id: 'urgent', label: 'Urgent', color: '#ef4444' },
    { id: 'high', label: 'High', color: '#f59e0b' },
    { id: 'normal', label: 'Normal', color: '#6366f1' },
    { id: 'low', label: 'Low', color: '#71717a' },
  ],
} as const;

export const TABLE_COLUMN_OPTIONS = [
  { id: 'title', label: 'Title', width: 300 },
  { id: 'status', label: 'Status', width: 120 },
  { id: 'priority', label: 'Priority', width: 100 },
  { id: 'due_date', label: 'Due Date', width: 120 },
  { id: 'estimated_minutes', label: 'Estimate', width: 100 },
  { id: 'actual_minutes', label: 'Actual', width: 100 },
  { id: 'list', label: 'List', width: 120 },
  { id: 'tags', label: 'Tags', width: 150 },
  { id: 'created_at', label: 'Created', width: 120 },
] as const;
```

---

## Phase 2: View Switcher & Preferences

### 2.1 Server Actions

Add to `app/(dashboard)/actions.ts`:

```typescript
// ============================================================================
// VIEW PREFERENCE ACTIONS
// ============================================================================

export async function getViewPreferences(listId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const query = supabase
    .from("zeroed_view_preferences")
    .select("*")
    .eq("user_id", user.id);

  if (listId) {
    query.eq("list_id", listId);
  } else {
    query.is("list_id", null);
  }

  const { data } = await query.single();
  return data;
}

export async function updateViewPreferences(
  listId: string | null,
  updates: Partial<ViewPreferences>
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("zeroed_view_preferences")
    .upsert({
      user_id: user.id,
      list_id: listId,
      ...updates,
    }, {
      onConflict: listId ? 'user_id,list_id' : 'user_id',
    });

  if (error) return { error: error.message };

  revalidatePath("/");
  return { success: true };
}

export async function updateTaskPosition(
  taskId: string,
  newStatus?: string,
  newPriority?: string,
  newPositionInStatus?: number
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const updates: Record<string, unknown> = {};
  if (newStatus) updates.status = newStatus;
  if (newPriority) updates.priority = newPriority;
  if (newPositionInStatus !== undefined) updates.position_in_status = newPositionInStatus;

  const { error } = await supabase
    .from("zeroed_tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/");
  return { success: true };
}

export async function bulkUpdateTasks(
  taskIds: string[],
  updates: Partial<Task>
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("zeroed_tasks")
    .update(updates)
    .in("id", taskIds)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/");
  return { success: true };
}
```

### 2.2 View Switcher Component

Create `components/views/view-switcher.tsx`:

```typescript
"use client";

import { List, Kanban, Calendar, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateViewPreferences } from "@/app/(dashboard)/actions";
import type { ViewType } from "@/lib/supabase/types";

interface ViewSwitcherProps {
  currentView: ViewType;
  listId?: string;
  onViewChange?: (view: ViewType) => void;
}

const views = [
  { id: 'list' as ViewType, label: 'List', icon: List },
  { id: 'kanban' as ViewType, label: 'Kanban', icon: Kanban },
  { id: 'calendar' as ViewType, label: 'Calendar', icon: Calendar },
  { id: 'table' as ViewType, label: 'Table', icon: Table2 },
];

export function ViewSwitcher({ currentView, listId, onViewChange }: ViewSwitcherProps) {
  async function handleViewChange(view: ViewType) {
    onViewChange?.(view);
    await updateViewPreferences(listId || null, { view_type: view });
  }

  return (
    <div className="flex items-center border rounded-lg p-1 bg-muted/50">
      {views.map((view) => (
        <Tooltip key={view.id}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 w-8 p-0",
                currentView === view.id && "bg-background shadow-sm"
              )}
              onClick={() => handleViewChange(view.id)}
            >
              <view.icon className="h-4 w-4" />
              <span className="sr-only">{view.label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{view.label} view</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
```

---

## Phase 3: Kanban Board

### 3.1 Install DnD Library

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### 3.2 Kanban Components

Create `components/views/kanban/kanban-board.tsx`:

```typescript
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
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { toast } from "sonner";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { updateTaskPosition } from "@/app/(dashboard)/actions";
import { KANBAN_COLUMNS } from "@/lib/constants";
import type { Task, KanbanGroupBy } from "@/lib/supabase/types";

interface KanbanBoardProps {
  tasks: Task[];
  groupBy: KanbanGroupBy;
  onTaskClick?: (task: Task) => void;
}

export function KanbanBoard({ tasks, groupBy, onTaskClick }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const columns = KANBAN_COLUMNS[groupBy === 'list' ? 'status' : groupBy];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const tasksByColumn = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    columns.forEach(col => {
      grouped[col.id] = [];
    });
    
    tasks.forEach(task => {
      const key = groupBy === 'status' ? task.status : task.priority;
      if (grouped[key]) {
        grouped[key].push(task);
      }
    });

    // Sort by position within each column
    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => a.position_in_status - b.position_in_status);
    });

    return grouped;
  }, [tasks, columns, groupBy]);

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find(t => t.id === event.active.id);
    setActiveTask(task || null);
  }

  function handleDragOver(event: DragOverEvent) {
    // Handle drag over different columns
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeTask = tasks.find(t => t.id === active.id);
    if (!activeTask) return;

    // Determine the target column
    let targetColumn = over.id as string;
    
    // If dropped on a task, get that task's column
    const overTask = tasks.find(t => t.id === over.id);
    if (overTask) {
      targetColumn = groupBy === 'status' ? overTask.status : overTask.priority;
    }

    // Check if column changed
    const currentColumn = groupBy === 'status' ? activeTask.status : activeTask.priority;
    
    if (currentColumn !== targetColumn || overTask) {
      const updates: { newStatus?: string; newPriority?: string; newPositionInStatus?: number } = {};
      
      if (groupBy === 'status') {
        updates.newStatus = targetColumn;
      } else {
        updates.newPriority = targetColumn;
      }

      // Calculate new position
      const tasksInColumn = tasksByColumn[targetColumn];
      if (overTask) {
        const overIndex = tasksInColumn.findIndex(t => t.id === over.id);
        updates.newPositionInStatus = overIndex;
      } else {
        updates.newPositionInStatus = tasksInColumn.length;
      }

      const result = await updateTaskPosition(
        activeTask.id,
        updates.newStatus,
        updates.newPriority,
        updates.newPositionInStatus
      );

      if (result.error) {
        toast.error(result.error);
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 h-full overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.label}
            color={column.color}
            count={tasksByColumn[column.id]?.length || 0}
          >
            <SortableContext
              items={tasksByColumn[column.id]?.map(t => t.id) || []}
              strategy={verticalListSortingStrategy}
            >
              {tasksByColumn[column.id]?.map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  onClick={() => onTaskClick?.(task)}
                />
              ))}
            </SortableContext>
          </KanbanColumn>
        ))}
      </div>

      <DragOverlay>
        {activeTask && <KanbanCard task={activeTask} isDragging />}
      </DragOverlay>
    </DndContext>
  );
}
```

Create `components/views/kanban/kanban-column.tsx`:

```typescript
"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  count: number;
  children: React.ReactNode;
}

export function KanbanColumn({ id, title, color, count, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-72 min-w-[288px] bg-muted/30 rounded-lg",
        isOver && "ring-2 ring-primary"
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 p-3 border-b">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h3 className="font-medium text-sm">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>

      {/* Cards container */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px]">
        {children}
      </div>
    </div>
  );
}
```

Create `components/views/kanban/kanban-card.tsx`:

```typescript
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, Calendar, GripVertical } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/tags/tag-badge";
import { PRIORITY_COLORS } from "@/lib/constants";
import type { Task, Tag } from "@/lib/supabase/types";

interface KanbanCardProps {
  task: Task & { tags?: Tag[]; zeroed_lists?: { name: string; color: string } };
  onClick?: () => void;
  isDragging?: boolean;
}

export function KanbanCard({ task, onClick, isDragging }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS];

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer hover:border-primary/50 transition-colors",
        (isDragging || isSortableDragging) && "opacity-50 rotate-2 shadow-lg"
      )}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <button
            {...attributes}
            {...listeners}
            className="mt-1 cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>

          <div className="flex-1 min-w-0">
            <p className={cn(
              "font-medium text-sm line-clamp-2",
              task.status === 'completed' && "line-through text-muted-foreground"
            )}>
              {task.title}
            </p>

            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
              {task.due_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(task.due_date), "MMM d")}
                </span>
              )}
              {task.estimated_minutes > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {task.estimated_minutes}m
                </span>
              )}
              {task.priority !== 'normal' && (
                <Badge variant="outline" className={cn("text-xs h-5", priorityColor)}>
                  {task.priority}
                </Badge>
              )}
            </div>

            {/* Tags */}
            {task.tags && task.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {task.tags.slice(0, 3).map(tag => (
                  <TagBadge key={tag.id} tag={tag} size="sm" />
                ))}
                {task.tags.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{task.tags.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* List indicator */}
            {task.zeroed_lists && (
              <div className="flex items-center gap-1 mt-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: task.zeroed_lists.color }}
                />
                <span className="text-xs text-muted-foreground">
                  {task.zeroed_lists.name}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Phase 4: Calendar View

### 4.1 Install Date Library (already have date-fns)

### 4.2 Calendar Components

Create `components/views/calendar/calendar-view.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CalendarDay } from "./calendar-day";
import type { Task } from "@/lib/supabase/types";

interface CalendarViewProps {
  tasks: Task[];
  onDateClick?: (date: Date) => void;
  onTaskClick?: (task: Task) => void;
}

export function CalendarView({ tasks, onDateClick, onTaskClick }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach(task => {
      if (task.due_date) {
        const dateKey = task.due_date;
        if (!map[dateKey]) map[dateKey] = [];
        map[dateKey].push(task);
      }
    });
    return map;
  }, [tasks]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentMonth(new Date())}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-t-lg overflow-hidden">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div
            key={day}
            className="bg-muted px-2 py-2 text-center text-sm font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-border flex-1 rounded-b-lg overflow-hidden">
        {days.map((day) => {
          const dateKey = format(day, "yyyy-MM-dd");
          const dayTasks = tasksByDate[dateKey] || [];

          return (
            <CalendarDay
              key={dateKey}
              date={day}
              tasks={dayTasks}
              isCurrentMonth={isSameMonth(day, currentMonth)}
              isToday={isToday(day)}
              onClick={() => onDateClick?.(day)}
              onTaskClick={onTaskClick}
            />
          );
        })}
      </div>
    </div>
  );
}
```

Create `components/views/calendar/calendar-day.tsx`:

```typescript
"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/supabase/types";

interface CalendarDayProps {
  date: Date;
  tasks: Task[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onClick?: () => void;
  onTaskClick?: (task: Task) => void;
}

export function CalendarDay({
  date,
  tasks,
  isCurrentMonth,
  isToday,
  onClick,
  onTaskClick,
}: CalendarDayProps) {
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const pendingTasks = tasks.filter(t => t.status !== 'completed');

  return (
    <div
      className={cn(
        "min-h-[100px] bg-card p-1 cursor-pointer hover:bg-muted/50 transition-colors",
        !isCurrentMonth && "bg-muted/20 text-muted-foreground"
      )}
      onClick={onClick}
    >
      {/* Date number */}
      <div className="flex items-center justify-between mb-1">
        <span
          className={cn(
            "text-sm w-7 h-7 flex items-center justify-center rounded-full",
            isToday && "bg-primary text-primary-foreground font-semibold"
          )}
        >
          {format(date, "d")}
        </span>
        {completedCount > 0 && (
          <span className="text-xs text-muted-foreground">
            ✓{completedCount}
          </span>
        )}
      </div>

      {/* Tasks */}
      <div className="space-y-1">
        {pendingTasks.slice(0, 3).map(task => (
          <button
            key={task.id}
            onClick={(e) => {
              e.stopPropagation();
              onTaskClick?.(task);
            }}
            className={cn(
              "w-full text-left text-xs px-1.5 py-0.5 rounded truncate",
              "hover:ring-1 hover:ring-primary transition-all",
              task.priority === 'urgent' && "bg-destructive/20 text-destructive",
              task.priority === 'high' && "bg-warning/20 text-warning",
              task.priority === 'normal' && "bg-primary/20 text-primary",
              task.priority === 'low' && "bg-muted text-muted-foreground"
            )}
          >
            {task.title}
          </button>
        ))}
        {pendingTasks.length > 3 && (
          <span className="text-xs text-muted-foreground px-1">
            +{pendingTasks.length - 3} more
          </span>
        )}
      </div>
    </div>
  );
}
```

---

## Phase 5: Table View

Create `components/views/table/table-view.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/tags/tag-badge";
import { updateTask, deleteTask, completeTask } from "@/app/(dashboard)/actions";
import { toast } from "sonner";
import { TABLE_COLUMN_OPTIONS, TASK_STATUSES, TASK_PRIORITIES, PRIORITY_COLORS } from "@/lib/constants";
import type { Task, Tag } from "@/lib/supabase/types";

interface TableViewProps {
  tasks: (Task & { tags?: Tag[]; zeroed_lists?: { name: string; color: string } })[];
  columns?: string[];
  onTaskClick?: (task: Task) => void;
}

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
} | null;

export function TableView({ tasks, columns = ['title', 'status', 'priority', 'due_date', 'estimated_minutes'], onTaskClick }: TableViewProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'due_date', direction: 'asc' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ taskId: string; column: string } | null>(null);

  const sortedTasks = useMemo(() => {
    if (!sortConfig) return tasks;

    return [...tasks].sort((a, b) => {
      const aVal = a[sortConfig.key as keyof Task];
      const bVal = b[sortConfig.key as keyof Task];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [tasks, sortConfig]);

  function handleSort(key: string) {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map(t => t.id)));
    }
  }

  function toggleSelect(taskId: string) {
    const newSet = new Set(selectedIds);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setSelectedIds(newSet);
  }

  async function handleInlineEdit(taskId: string, field: string, value: unknown) {
    const result = await updateTask(taskId, { [field]: value });
    if (result.error) {
      toast.error(result.error);
    }
    setEditingCell(null);
  }

  function getSortIcon(key: string) {
    if (sortConfig?.key !== key) {
      return <ArrowUpDown className="h-4 w-4" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="h-4 w-4" /> 
      : <ArrowDown className="h-4 w-4" />;
  }

  function renderCell(task: Task & { tags?: Tag[]; zeroed_lists?: { name: string; color: string } }, column: string) {
    const isEditing = editingCell?.taskId === task.id && editingCell?.column === column;

    switch (column) {
      case 'title':
        return isEditing ? (
          <Input
            defaultValue={task.title}
            autoFocus
            onBlur={(e) => handleInlineEdit(task.id, 'title', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInlineEdit(task.id, 'title', e.currentTarget.value);
              if (e.key === 'Escape') setEditingCell(null);
            }}
            className="h-8"
          />
        ) : (
          <button
            onClick={() => onTaskClick?.(task)}
            onDoubleClick={() => setEditingCell({ taskId: task.id, column: 'title' })}
            className={cn(
              "text-left font-medium hover:text-primary transition-colors",
              task.status === 'completed' && "line-through text-muted-foreground"
            )}
          >
            {task.title}
          </button>
        );

      case 'status':
        return (
          <Select
            value={task.status}
            onValueChange={(value) => handleInlineEdit(task.id, 'status', value)}
          >
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map(status => (
                <SelectItem key={status} value={status} className="capitalize">
                  {status.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'priority':
        return (
          <Select
            value={task.priority}
            onValueChange={(value) => handleInlineEdit(task.id, 'priority', value)}
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map(priority => (
                <SelectItem key={priority} value={priority} className="capitalize">
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'due_date':
        return isEditing ? (
          <Input
            type="date"
            defaultValue={task.due_date || ''}
            autoFocus
            onBlur={(e) => handleInlineEdit(task.id, 'due_date', e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInlineEdit(task.id, 'due_date', e.currentTarget.value || null);
              if (e.key === 'Escape') setEditingCell(null);
            }}
            className="h-8 w-36"
          />
        ) : (
          <button
            onDoubleClick={() => setEditingCell({ taskId: task.id, column: 'due_date' })}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {task.due_date ? format(new Date(task.due_date), "MMM d, yyyy") : "—"}
          </button>
        );

      case 'estimated_minutes':
        return isEditing ? (
          <Input
            type="number"
            defaultValue={task.estimated_minutes}
            autoFocus
            onBlur={(e) => handleInlineEdit(task.id, 'estimated_minutes', parseInt(e.target.value) || 0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInlineEdit(task.id, 'estimated_minutes', parseInt(e.currentTarget.value) || 0);
              if (e.key === 'Escape') setEditingCell(null);
            }}
            className="h-8 w-20"
          />
        ) : (
          <button
            onDoubleClick={() => setEditingCell({ taskId: task.id, column: 'estimated_minutes' })}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {task.estimated_minutes}m
          </button>
        );

      case 'actual_minutes':
        return (
          <span className="text-sm text-muted-foreground">
            {task.actual_minutes}m
          </span>
        );

      case 'list':
        return task.zeroed_lists ? (
          <div className="flex items-center gap-1">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: task.zeroed_lists.color }}
            />
            <span className="text-sm">{task.zeroed_lists.name}</span>
          </div>
        ) : null;

      case 'tags':
        return (
          <div className="flex flex-wrap gap-1">
            {task.tags?.slice(0, 2).map(tag => (
              <TagBadge key={tag.id} tag={tag} size="sm" />
            ))}
            {(task.tags?.length || 0) > 2 && (
              <span className="text-xs text-muted-foreground">+{task.tags!.length - 2}</span>
            )}
          </div>
        );

      case 'created_at':
        return (
          <span className="text-sm text-muted-foreground">
            {format(new Date(task.created_at), "MMM d")}
          </span>
        );

      default:
        return null;
    }
  }

  const columnConfig = TABLE_COLUMN_OPTIONS.filter(c => columns.includes(c.id));

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={selectedIds.size === tasks.length && tasks.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </th>
              {columnConfig.map(col => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left text-sm font-medium text-muted-foreground"
                  style={{ width: col.width }}
                >
                  <button
                    onClick={() => handleSort(col.id)}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {col.label}
                    {getSortIcon(col.id)}
                  </button>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedTasks.map(task => (
              <tr
                key={task.id}
                className={cn(
                  "hover:bg-muted/30 transition-colors",
                  selectedIds.has(task.id) && "bg-primary/5"
                )}
              >
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selectedIds.has(task.id)}
                    onCheckedChange={() => toggleSelect(task.id)}
                  />
                </td>
                {columnConfig.map(col => (
                  <td key={col.id} className="px-3 py-2">
                    {renderCell(task, col.id)}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => completeTask(task.id)}>
                        <Check className="mr-2 h-4 w-4" />
                        {task.status === 'completed' ? 'Mark incomplete' : 'Mark complete'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => deleteTask(task.id)}
                        className="text-destructive"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {tasks.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            No tasks to display
          </div>
        )}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="border-t bg-muted/50 px-4 py-2 flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <Button variant="outline" size="sm">
            Set status
          </Button>
          <Button variant="outline" size="sm">
            Set priority
          </Button>
          <Button variant="outline" size="sm">
            Move to list
          </Button>
          <Button variant="destructive" size="sm">
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
```

---

## Phase 6: Integration

### 6.1 Create Main View Container

Create `components/views/task-views.tsx`:

```typescript
"use client";

import { useState } from "react";
import { ViewSwitcher } from "./view-switcher";
import { KanbanBoard } from "./kanban/kanban-board";
import { CalendarView } from "./calendar/calendar-view";
import { TableView } from "./table/table-view";
import { TaskList } from "@/components/tasks/task-list";
import type { Task, Tag, ViewType, KanbanGroupBy, List } from "@/lib/supabase/types";

interface TaskViewsProps {
  tasks: (Task & { tags?: Tag[]; zeroed_lists?: { name: string; color: string } })[];
  lists: Pick<List, "id" | "name">[];
  defaultListId?: string;
  initialView?: ViewType;
  listId?: string;
}

export function TaskViews({
  tasks,
  lists,
  defaultListId,
  initialView = "list",
  listId,
}: TaskViewsProps) {
  const [currentView, setCurrentView] = useState<ViewType>(initialView);
  const [kanbanGroupBy] = useState<KanbanGroupBy>("status");

  return (
    <div className="flex flex-col h-full">
      {/* View switcher in top right */}
      <div className="flex justify-end mb-4">
        <ViewSwitcher
          currentView={currentView}
          listId={listId}
          onViewChange={setCurrentView}
        />
      </div>

      {/* View content */}
      <div className="flex-1 min-h-0">
        {currentView === "list" && (
          <TaskList
            tasks={tasks}
            lists={lists}
            defaultListId={defaultListId}
          />
        )}

        {currentView === "kanban" && (
          <KanbanBoard
            tasks={tasks}
            groupBy={kanbanGroupBy}
          />
        )}

        {currentView === "calendar" && (
          <CalendarView tasks={tasks} />
        )}

        {currentView === "table" && (
          <TableView tasks={tasks} />
        )}
      </div>
    </div>
  );
}
```

### 6.2 Update List Page

Update `app/(dashboard)/lists/[listId]/page.tsx` to use TaskViews component.

### 6.3 Update Today Page

Update `app/(dashboard)/today/page.tsx` to use TaskViews component.

---

## Testing Checklist

### Kanban
- [ ] Columns render correctly
- [ ] Tasks appear in correct columns
- [ ] Drag task to different column → status/priority updates
- [ ] Reorder within column works
- [ ] Card shows all task info (tags, due date, etc.)

### Calendar
- [ ] Month navigation works
- [ ] Today button works
- [ ] Tasks appear on correct dates
- [ ] Click date to add task
- [ ] Click task to view/edit
- [ ] Tasks color-coded by priority

### Table
- [ ] All columns render
- [ ] Sort by clicking column header
- [ ] Inline edit title (double-click)
- [ ] Inline edit due date
- [ ] Status/priority dropdowns work
- [ ] Multi-select tasks
- [ ] Bulk actions work

### View Switching
- [ ] View preference persists
- [ ] View syncs per-list
- [ ] Keyboard shortcut to switch views (optional)

---

## Files Summary

**New Files:**
- `supabase/migrations/002_sprint2_views.sql`
- `components/views/view-switcher.tsx`
- `components/views/task-views.tsx`
- `components/views/kanban/kanban-board.tsx`
- `components/views/kanban/kanban-column.tsx`
- `components/views/kanban/kanban-card.tsx`
- `components/views/calendar/calendar-view.tsx`
- `components/views/calendar/calendar-day.tsx`
- `components/views/table/table-view.tsx`

**Modified Files:**
- `lib/supabase/types.ts`
- `lib/constants.ts`
- `app/(dashboard)/actions.ts`
- `app/(dashboard)/lists/[listId]/page.tsx`
- `app/(dashboard)/today/page.tsx`

**New Dependencies:**
- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

---

**Ready to implement. Views make the app feel 10x more powerful.** 🎯

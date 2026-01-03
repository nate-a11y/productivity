# Zeroed Sprint 3 — Goals, Habits & Gamification

## Overview

This sprint adds motivation and tracking features:
1. **Goals** — Set targets for tasks completed, focus time, etc.
2. **Habits** — Daily recurring behaviors separate from tasks
3. **Gamification** — Points, levels, achievements, streaks

---

## Phase 0: Database Migrations

Create `supabase/migrations/003_sprint3_gamification.sql`:

```sql
-- ============================================================================
-- ZEROED SPRINT 3 MIGRATIONS
-- Features: Goals, Habits, Gamification
-- ============================================================================

-- ============================================================================
-- GOALS
-- ============================================================================

create table if not exists zeroed_goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  description text,
  target_type text not null check (target_type in (
    'tasks_completed',
    'focus_minutes', 
    'focus_sessions',
    'streak_days',
    'custom'
  )),
  target_value integer not null,
  current_value integer default 0,
  period text not null check (period in ('daily', 'weekly', 'monthly', 'yearly', 'total')),
  start_date date not null default current_date,
  end_date date,
  status text default 'active' check (status in ('active', 'completed', 'failed', 'paused')),
  completed_at timestamptz,
  color text default '#6366f1',
  icon text default 'target',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table zeroed_goals enable row level security;

drop policy if exists "Users can CRUD own goals" on zeroed_goals;
create policy "Users can CRUD own goals" on zeroed_goals
  for all using (auth.uid() = user_id);

-- Indexes
create index if not exists zeroed_goals_user_status_idx on zeroed_goals(user_id, status);
create index if not exists zeroed_goals_period_idx on zeroed_goals(user_id, period, start_date);

-- Trigger
drop trigger if exists zeroed_goals_updated_at on zeroed_goals;
create trigger zeroed_goals_updated_at before update on zeroed_goals
  for each row execute function zeroed_handle_updated_at();

-- ============================================================================
-- HABITS
-- ============================================================================

create table if not exists zeroed_habits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  icon text default 'circle-check',
  color text default '#6366f1',
  frequency text not null default 'daily' check (frequency in ('daily', 'weekdays', 'weekends', 'custom')),
  frequency_days integer[] default array[0,1,2,3,4,5,6], -- 0=Sun, 6=Sat
  reminder_time time,
  target_per_day integer default 1, -- For habits you can do multiple times
  streak_current integer default 0,
  streak_best integer default 0,
  total_completions integer default 0,
  is_archived boolean default false,
  position integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists zeroed_habit_logs (
  id uuid primary key default uuid_generate_v4(),
  habit_id uuid references zeroed_habits(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null default current_date,
  completed_count integer default 1,
  notes text,
  created_at timestamptz default now(),
  unique(habit_id, date)
);

-- RLS
alter table zeroed_habits enable row level security;
alter table zeroed_habit_logs enable row level security;

drop policy if exists "Users can CRUD own habits" on zeroed_habits;
create policy "Users can CRUD own habits" on zeroed_habits
  for all using (auth.uid() = user_id);

drop policy if exists "Users can CRUD own habit_logs" on zeroed_habit_logs;
create policy "Users can CRUD own habit_logs" on zeroed_habit_logs
  for all using (auth.uid() = user_id);

-- Indexes
create index if not exists zeroed_habits_user_idx on zeroed_habits(user_id, is_archived);
create index if not exists zeroed_habit_logs_habit_date_idx on zeroed_habit_logs(habit_id, date);
create index if not exists zeroed_habit_logs_user_date_idx on zeroed_habit_logs(user_id, date);

-- Trigger
drop trigger if exists zeroed_habits_updated_at on zeroed_habits;
create trigger zeroed_habits_updated_at before update on zeroed_habits
  for each row execute function zeroed_handle_updated_at();

-- ============================================================================
-- GAMIFICATION
-- ============================================================================

-- Add gamification fields to user preferences
alter table zeroed_user_preferences add column if not exists points integer default 0;
alter table zeroed_user_preferences add column if not exists level integer default 1;
alter table zeroed_user_preferences add column if not exists xp_to_next_level integer default 100;
alter table zeroed_user_preferences add column if not exists gamification_enabled boolean default true;

-- Achievements table
create table if not exists zeroed_achievements (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  achievement_type text not null,
  achievement_tier integer default 1, -- For tiered achievements (bronze, silver, gold)
  earned_at timestamptz default now(),
  unique(user_id, achievement_type, achievement_tier)
);

-- Points history for tracking
create table if not exists zeroed_points_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  points integer not null,
  reason text not null, -- 'task_completed', 'focus_session', 'streak_bonus', 'achievement', etc.
  reference_id uuid, -- Optional: task_id, session_id, etc.
  created_at timestamptz default now()
);

-- RLS
alter table zeroed_achievements enable row level security;
alter table zeroed_points_history enable row level security;

drop policy if exists "Users can CRUD own achievements" on zeroed_achievements;
create policy "Users can CRUD own achievements" on zeroed_achievements
  for all using (auth.uid() = user_id);

drop policy if exists "Users can CRUD own points_history" on zeroed_points_history;
create policy "Users can CRUD own points_history" on zeroed_points_history
  for all using (auth.uid() = user_id);

-- Indexes
create index if not exists zeroed_achievements_user_idx on zeroed_achievements(user_id);
create index if not exists zeroed_points_history_user_idx on zeroed_points_history(user_id, created_at);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to add points and check for level up
create or replace function zeroed_add_points(
  p_user_id uuid,
  p_points integer,
  p_reason text,
  p_reference_id uuid default null
)
returns json as $$
declare
  v_current_points integer;
  v_current_level integer;
  v_xp_needed integer;
  v_leveled_up boolean := false;
  v_new_level integer;
begin
  -- Get current stats
  select points, level, xp_to_next_level
  into v_current_points, v_current_level, v_xp_needed
  from zeroed_user_preferences
  where user_id = p_user_id;

  -- Add points
  v_current_points := coalesce(v_current_points, 0) + p_points;
  
  -- Check for level up (XP needed increases by 50% each level)
  v_new_level := coalesce(v_current_level, 1);
  v_xp_needed := coalesce(v_xp_needed, 100);
  
  while v_current_points >= v_xp_needed loop
    v_current_points := v_current_points - v_xp_needed;
    v_new_level := v_new_level + 1;
    v_xp_needed := floor(v_xp_needed * 1.5);
    v_leveled_up := true;
  end loop;

  -- Update user preferences
  update zeroed_user_preferences
  set 
    points = v_current_points,
    level = v_new_level,
    xp_to_next_level = v_xp_needed,
    updated_at = now()
  where user_id = p_user_id;

  -- Log points
  insert into zeroed_points_history (user_id, points, reason, reference_id)
  values (p_user_id, p_points, p_reason, p_reference_id);

  return json_build_object(
    'points', v_current_points,
    'level', v_new_level,
    'xp_to_next_level', v_xp_needed,
    'leveled_up', v_leveled_up,
    'points_earned', p_points
  );
end;
$$ language plpgsql security definer;

-- Function to update habit streak
create or replace function zeroed_update_habit_streak(p_habit_id uuid)
returns void as $$
declare
  v_user_id uuid;
  v_current_streak integer := 0;
  v_check_date date := current_date;
  v_frequency_days integer[];
  v_has_log boolean;
begin
  -- Get habit info
  select user_id, frequency_days into v_user_id, v_frequency_days
  from zeroed_habits where id = p_habit_id;

  -- Count consecutive days
  loop
    -- Check if this day should be tracked
    if extract(dow from v_check_date)::integer = any(v_frequency_days) then
      -- Check if completed
      select exists(
        select 1 from zeroed_habit_logs 
        where habit_id = p_habit_id and date = v_check_date
      ) into v_has_log;

      if v_has_log then
        v_current_streak := v_current_streak + 1;
        v_check_date := v_check_date - interval '1 day';
      else
        exit;
      end if;
    else
      -- Skip non-tracking days
      v_check_date := v_check_date - interval '1 day';
    end if;

    -- Safety limit
    if v_check_date < current_date - interval '365 days' then
      exit;
    end if;
  end loop;

  -- Update streak
  update zeroed_habits
  set 
    streak_current = v_current_streak,
    streak_best = greatest(streak_best, v_current_streak),
    updated_at = now()
  where id = p_habit_id;
end;
$$ language plpgsql security definer;

-- Function to check and award achievements
create or replace function zeroed_check_achievements(p_user_id uuid)
returns json[] as $$
declare
  v_new_achievements json[] := array[]::json[];
  v_tasks_completed integer;
  v_focus_sessions integer;
  v_focus_minutes integer;
  v_streak integer;
begin
  -- Get stats
  select 
    coalesce(sum(tasks_completed), 0),
    coalesce(sum(sessions_completed), 0),
    coalesce(sum(focus_minutes), 0)
  into v_tasks_completed, v_focus_sessions, v_focus_minutes
  from zeroed_daily_stats
  where user_id = p_user_id;

  -- Check "Task Master" achievements
  if v_tasks_completed >= 1 then
    insert into zeroed_achievements (user_id, achievement_type, achievement_tier)
    values (p_user_id, 'task_master', 1)
    on conflict do nothing;
    if found then
      v_new_achievements := array_append(v_new_achievements, 
        json_build_object('type', 'task_master', 'tier', 1, 'name', 'First Blood'));
    end if;
  end if;

  if v_tasks_completed >= 100 then
    insert into zeroed_achievements (user_id, achievement_type, achievement_tier)
    values (p_user_id, 'task_master', 2)
    on conflict do nothing;
    if found then
      v_new_achievements := array_append(v_new_achievements,
        json_build_object('type', 'task_master', 'tier', 2, 'name', 'Centurion'));
    end if;
  end if;

  if v_tasks_completed >= 1000 then
    insert into zeroed_achievements (user_id, achievement_type, achievement_tier)
    values (p_user_id, 'task_master', 3)
    on conflict do nothing;
    if found then
      v_new_achievements := array_append(v_new_achievements,
        json_build_object('type', 'task_master', 'tier', 3, 'name', 'Task Titan'));
    end if;
  end if;

  -- Check "Focus" achievements
  if v_focus_sessions >= 1 then
    insert into zeroed_achievements (user_id, achievement_type, achievement_tier)
    values (p_user_id, 'focus_master', 1)
    on conflict do nothing;
  end if;

  if v_focus_sessions >= 50 then
    insert into zeroed_achievements (user_id, achievement_type, achievement_tier)
    values (p_user_id, 'focus_master', 2)
    on conflict do nothing;
  end if;

  if v_focus_minutes >= 1000 then
    insert into zeroed_achievements (user_id, achievement_type, achievement_tier)
    values (p_user_id, 'focus_master', 3)
    on conflict do nothing;
  end if;

  return v_new_achievements;
end;
$$ language plpgsql security definer;
```

---

## Phase 1: TypeScript Types

Add to `lib/supabase/types.ts`:

```typescript
// Goals
zeroed_goals: {
  Row: {
    id: string;
    user_id: string;
    title: string;
    description: string | null;
    target_type: 'tasks_completed' | 'focus_minutes' | 'focus_sessions' | 'streak_days' | 'custom';
    target_value: number;
    current_value: number;
    period: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'total';
    start_date: string;
    end_date: string | null;
    status: 'active' | 'completed' | 'failed' | 'paused';
    completed_at: string | null;
    color: string;
    icon: string;
    created_at: string;
    updated_at: string;
  };
  Insert: Omit<Row, 'id' | 'created_at' | 'updated_at' | 'current_value' | 'completed_at'> & {
    id?: string;
    current_value?: number;
    completed_at?: string | null;
  };
  Update: Partial<Insert>;
};

// Habits
zeroed_habits: {
  Row: {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    frequency: 'daily' | 'weekdays' | 'weekends' | 'custom';
    frequency_days: number[];
    reminder_time: string | null;
    target_per_day: number;
    streak_current: number;
    streak_best: number;
    total_completions: number;
    is_archived: boolean;
    position: number;
    created_at: string;
    updated_at: string;
  };
  Insert: Omit<Row, 'id' | 'created_at' | 'updated_at' | 'streak_current' | 'streak_best' | 'total_completions'>;
  Update: Partial<Insert>;
};

zeroed_habit_logs: {
  Row: {
    id: string;
    habit_id: string;
    user_id: string;
    date: string;
    completed_count: number;
    notes: string | null;
    created_at: string;
  };
  Insert: Omit<Row, 'id' | 'created_at'>;
  Update: Partial<Insert>;
};

// Achievements
zeroed_achievements: {
  Row: {
    id: string;
    user_id: string;
    achievement_type: string;
    achievement_tier: number;
    earned_at: string;
  };
  Insert: Omit<Row, 'id' | 'earned_at'>;
  Update: Partial<Insert>;
};

// Points history
zeroed_points_history: {
  Row: {
    id: string;
    user_id: string;
    points: number;
    reason: string;
    reference_id: string | null;
    created_at: string;
  };
  Insert: Omit<Row, 'id' | 'created_at'>;
  Update: Partial<Insert>;
};

export type Goal = Tables<"zeroed_goals">;
export type Habit = Tables<"zeroed_habits">;
export type HabitLog = Tables<"zeroed_habit_logs">;
export type Achievement = Tables<"zeroed_achievements">;
export type PointsHistory = Tables<"zeroed_points_history">;
```

Add to `lib/constants.ts`:

```typescript
// Points awarded for actions
export const POINTS = {
  TASK_COMPLETED: 10,
  FOCUS_SESSION: 25,
  FOCUS_SESSION_LONG: 40, // 45+ minutes
  HABIT_COMPLETED: 15,
  GOAL_ACHIEVED: 100,
  STREAK_BONUS_MULTIPLIER: 5, // points × streak days (capped at 50)
  DAILY_GOAL_HIT: 50,
} as const;

// Achievement definitions
export const ACHIEVEMENTS = {
  task_master: {
    name: 'Task Master',
    icon: 'check-circle',
    tiers: [
      { tier: 1, name: 'First Blood', description: 'Complete your first task', requirement: 1 },
      { tier: 2, name: 'Centurion', description: 'Complete 100 tasks', requirement: 100 },
      { tier: 3, name: 'Task Titan', description: 'Complete 1,000 tasks', requirement: 1000 },
    ],
  },
  focus_master: {
    name: 'Focus Master',
    icon: 'target',
    tiers: [
      { tier: 1, name: 'Focused', description: 'Complete your first focus session', requirement: 1 },
      { tier: 2, name: 'Deep Worker', description: 'Complete 50 focus sessions', requirement: 50 },
      { tier: 3, name: 'Zen Master', description: 'Accumulate 1,000 focus minutes', requirement: 1000 },
    ],
  },
  streak_master: {
    name: 'Streak Master',
    icon: 'flame',
    tiers: [
      { tier: 1, name: 'Consistent', description: '7-day streak', requirement: 7 },
      { tier: 2, name: 'Dedicated', description: '30-day streak', requirement: 30 },
      { tier: 3, name: 'Unstoppable', description: '100-day streak', requirement: 100 },
    ],
  },
  early_bird: {
    name: 'Early Bird',
    icon: 'sunrise',
    tiers: [
      { tier: 1, name: 'Morning Person', description: 'Complete a task before 7 AM', requirement: 1 },
    ],
  },
  night_owl: {
    name: 'Night Owl',
    icon: 'moon',
    tiers: [
      { tier: 1, name: 'Midnight Oil', description: 'Complete a task after 11 PM', requirement: 1 },
    ],
  },
  estimation_ace: {
    name: 'Estimation Ace',
    icon: 'clock',
    tiers: [
      { tier: 1, name: 'Time Keeper', description: '90%+ estimation accuracy (10+ tasks)', requirement: 90 },
    ],
  },
} as const;

// Level XP requirements (increases 50% each level)
export function getXPForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

export function getLevelFromXP(totalXP: number): { level: number; currentXP: number; xpToNext: number } {
  let level = 1;
  let remaining = totalXP;
  let xpNeeded = 100;

  while (remaining >= xpNeeded) {
    remaining -= xpNeeded;
    level++;
    xpNeeded = Math.floor(xpNeeded * 1.5);
  }

  return { level, currentXP: remaining, xpToNext: xpNeeded };
}
```

---

## Phase 2: Goals Implementation

### 2.1 Server Actions

Add to `app/(dashboard)/actions.ts`:

```typescript
// ============================================================================
// GOAL ACTIONS
// ============================================================================

export async function createGoal(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { data, error } = await supabase
    .from("zeroed_goals")
    .insert({
      user_id: user.id,
      title: formData.get("title") as string,
      description: formData.get("description") as string || null,
      target_type: formData.get("targetType") as Goal["target_type"],
      target_value: parseInt(formData.get("targetValue") as string),
      period: formData.get("period") as Goal["period"],
      start_date: formData.get("startDate") as string || format(new Date(), "yyyy-MM-dd"),
      end_date: formData.get("endDate") as string || null,
      color: formData.get("color") as string || "#6366f1",
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/goals");
  return { success: true, goal: data };
}

export async function updateGoal(goalId: string, updates: Partial<Goal>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("zeroed_goals")
    .update(updates)
    .eq("id", goalId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/goals");
  return { success: true };
}

export async function deleteGoal(goalId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("zeroed_goals")
    .delete()
    .eq("id", goalId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/goals");
  return { success: true };
}

export async function refreshGoalProgress(goalId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  // Get goal
  const { data: goal } = await supabase
    .from("zeroed_goals")
    .select("*")
    .eq("id", goalId)
    .single();

  if (!goal) return { error: "Goal not found" };

  // Calculate current value based on target type and period
  let currentValue = 0;
  const periodStart = getPeriodStart(goal.period, goal.start_date);
  const periodEnd = getPeriodEnd(goal.period, goal.start_date, goal.end_date);

  const { data: stats } = await supabase
    .from("zeroed_daily_stats")
    .select("*")
    .eq("user_id", user.id)
    .gte("date", periodStart)
    .lte("date", periodEnd);

  switch (goal.target_type) {
    case "tasks_completed":
      currentValue = stats?.reduce((sum, s) => sum + (s.tasks_completed || 0), 0) || 0;
      break;
    case "focus_minutes":
      currentValue = stats?.reduce((sum, s) => sum + (s.focus_minutes || 0), 0) || 0;
      break;
    case "focus_sessions":
      currentValue = stats?.reduce((sum, s) => sum + (s.sessions_completed || 0), 0) || 0;
      break;
  }

  // Update goal
  const isCompleted = currentValue >= goal.target_value;
  const { error } = await supabase
    .from("zeroed_goals")
    .update({
      current_value: currentValue,
      status: isCompleted ? "completed" : goal.status,
      completed_at: isCompleted && !goal.completed_at ? new Date().toISOString() : goal.completed_at,
    })
    .eq("id", goalId);

  if (error) return { error: error.message };

  // Award points if just completed
  if (isCompleted && goal.status !== "completed") {
    await supabase.rpc("zeroed_add_points", {
      p_user_id: user.id,
      p_points: POINTS.GOAL_ACHIEVED,
      p_reason: "goal_completed",
      p_reference_id: goalId,
    });
  }

  revalidatePath("/goals");
  return { success: true, currentValue, isCompleted };
}

function getPeriodStart(period: string, startDate: string): string {
  const now = new Date();
  switch (period) {
    case "daily":
      return format(now, "yyyy-MM-dd");
    case "weekly":
      return format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
    case "monthly":
      return format(startOfMonth(now), "yyyy-MM-dd");
    case "yearly":
      return format(startOfYear(now), "yyyy-MM-dd");
    default:
      return startDate;
  }
}

function getPeriodEnd(period: string, startDate: string, endDate: string | null): string {
  const now = new Date();
  if (endDate) return endDate;
  
  switch (period) {
    case "daily":
      return format(now, "yyyy-MM-dd");
    case "weekly":
      return format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
    case "monthly":
      return format(endOfMonth(now), "yyyy-MM-dd");
    case "yearly":
      return format(endOfYear(now), "yyyy-MM-dd");
    default:
      return format(now, "yyyy-MM-dd");
  }
}
```

### 2.2 Goals Page

Create `app/(dashboard)/goals/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/dashboard/header";
import { GoalList } from "@/components/goals/goal-list";
import { GoalForm } from "@/components/goals/goal-form";

export default async function GoalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: goals } = await supabase
    .from("zeroed_goals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const activeGoals = goals?.filter(g => g.status === "active") || [];
  const completedGoals = goals?.filter(g => g.status === "completed") || [];

  return (
    <div className="flex flex-col h-full">
      <Header title="Goals" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <GoalForm />
        
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Active Goals</h2>
          <GoalList goals={activeGoals} />
        </div>

        {completedGoals.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-muted-foreground">Completed</h2>
            <GoalList goals={completedGoals} />
          </div>
        )}
      </div>
    </div>
  );
}
```

### 2.3 Goal Components

Create `components/goals/goal-card.tsx`:

```typescript
"use client";

import { Target, Flame, Clock, CheckCircle2, MoreHorizontal, Trash2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateGoal, deleteGoal } from "@/app/(dashboard)/actions";
import { toast } from "sonner";
import type { Goal } from "@/lib/supabase/types";

interface GoalCardProps {
  goal: Goal;
}

export function GoalCard({ goal }: GoalCardProps) {
  const progress = Math.min((goal.current_value / goal.target_value) * 100, 100);
  const isCompleted = goal.status === "completed";

  const targetTypeLabels: Record<string, string> = {
    tasks_completed: "tasks",
    focus_minutes: "minutes focused",
    focus_sessions: "focus sessions",
    streak_days: "day streak",
    custom: "",
  };

  async function handlePause() {
    const result = await updateGoal(goal.id, {
      status: goal.status === "paused" ? "active" : "paused",
    });
    if (result.error) toast.error(result.error);
  }

  async function handleDelete() {
    const result = await deleteGoal(goal.id);
    if (result.error) toast.error(result.error);
    else toast.success("Goal deleted");
  }

  return (
    <Card className={cn(isCompleted && "opacity-60")}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${goal.color}20` }}
          >
            <Target className="h-4 w-4" style={{ color: goal.color }} />
          </div>
          <div>
            <CardTitle className="text-base">{goal.title}</CardTitle>
            <p className="text-xs text-muted-foreground capitalize">
              {goal.period} goal
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isCompleted && (
              <DropdownMenuItem onClick={handlePause}>
                {goal.status === "paused" ? (
                  <><Play className="mr-2 h-4 w-4" /> Resume</>
                ) : (
                  <><Pause className="mr-2 h-4 w-4" /> Pause</>
                )}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {goal.description && (
          <p className="text-sm text-muted-foreground mb-3">{goal.description}</p>
        )}

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {goal.current_value} / {goal.target_value} {targetTypeLabels[goal.target_type]}
            </span>
            <span className="font-medium">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {isCompleted && (
          <div className="flex items-center gap-2 mt-3 text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Completed!</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Create `components/goals/goal-list.tsx` and `components/goals/goal-form.tsx` similarly.

---

## Phase 3: Habits Implementation

### 3.1 Server Actions

```typescript
// ============================================================================
// HABIT ACTIONS
// ============================================================================

export async function createHabit(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const frequency = formData.get("frequency") as string;
  let frequencyDays: number[] = [0, 1, 2, 3, 4, 5, 6];
  
  if (frequency === "weekdays") {
    frequencyDays = [1, 2, 3, 4, 5];
  } else if (frequency === "weekends") {
    frequencyDays = [0, 6];
  } else if (frequency === "custom") {
    frequencyDays = formData.getAll("frequencyDays").map(d => parseInt(d as string));
  }

  const { data, error } = await supabase
    .from("zeroed_habits")
    .insert({
      user_id: user.id,
      name: formData.get("name") as string,
      description: formData.get("description") as string || null,
      icon: formData.get("icon") as string || "circle-check",
      color: formData.get("color") as string || "#6366f1",
      frequency,
      frequency_days: frequencyDays,
      target_per_day: parseInt(formData.get("targetPerDay") as string) || 1,
      reminder_time: formData.get("reminderTime") as string || null,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/habits");
  return { success: true, habit: data };
}

export async function logHabit(habitId: string, date?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const logDate = date || format(new Date(), "yyyy-MM-dd");

  // Check if already logged today
  const { data: existing } = await supabase
    .from("zeroed_habit_logs")
    .select("*")
    .eq("habit_id", habitId)
    .eq("date", logDate)
    .single();

  if (existing) {
    // Increment count
    const { error } = await supabase
      .from("zeroed_habit_logs")
      .update({ completed_count: existing.completed_count + 1 })
      .eq("id", existing.id);

    if (error) return { error: error.message };
  } else {
    // Create new log
    const { error } = await supabase
      .from("zeroed_habit_logs")
      .insert({
        habit_id: habitId,
        user_id: user.id,
        date: logDate,
        completed_count: 1,
      });

    if (error) return { error: error.message };
  }

  // Update streak
  await supabase.rpc("zeroed_update_habit_streak", { p_habit_id: habitId });

  // Update total completions
  await supabase
    .from("zeroed_habits")
    .update({ total_completions: supabase.sql`total_completions + 1` })
    .eq("id", habitId);

  // Award points
  await supabase.rpc("zeroed_add_points", {
    p_user_id: user.id,
    p_points: POINTS.HABIT_COMPLETED,
    p_reason: "habit_completed",
    p_reference_id: habitId,
  });

  revalidatePath("/habits");
  return { success: true };
}

export async function unlogHabit(habitId: string, date?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const logDate = date || format(new Date(), "yyyy-MM-dd");

  const { data: existing } = await supabase
    .from("zeroed_habit_logs")
    .select("*")
    .eq("habit_id", habitId)
    .eq("date", logDate)
    .single();

  if (!existing) return { success: true };

  if (existing.completed_count > 1) {
    await supabase
      .from("zeroed_habit_logs")
      .update({ completed_count: existing.completed_count - 1 })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("zeroed_habit_logs")
      .delete()
      .eq("id", existing.id);
  }

  await supabase.rpc("zeroed_update_habit_streak", { p_habit_id: habitId });

  revalidatePath("/habits");
  return { success: true };
}

export async function getHabitsWithLogs(startDate: string, endDate: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: habits } = await supabase
    .from("zeroed_habits")
    .select(`
      *,
      zeroed_habit_logs(date, completed_count)
    `)
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .gte("zeroed_habit_logs.date", startDate)
    .lte("zeroed_habit_logs.date", endDate)
    .order("position", { ascending: true });

  return habits || [];
}
```

### 3.2 Habits Page

Create `app/(dashboard)/habits/page.tsx` with a weekly view showing all habits and their completion status for each day.

### 3.3 Habit Components

Create:
- `components/habits/habit-tracker.tsx` — Weekly grid showing habits × days
- `components/habits/habit-row.tsx` — Single habit with daily checkboxes
- `components/habits/habit-form.tsx` — Create/edit habit
- `components/habits/streak-badge.tsx` — Shows current streak with 🔥

---

## Phase 4: Gamification Implementation

### 4.1 Update Points on Actions

Modify existing actions to award points:

```typescript
// In completeTask:
if (newStatus === "completed") {
  // ... existing code ...
  
  // Award points
  await supabase.rpc("zeroed_add_points", {
    p_user_id: user.id,
    p_points: POINTS.TASK_COMPLETED,
    p_reason: "task_completed",
    p_reference_id: taskId,
  });

  // Check achievements
  await supabase.rpc("zeroed_check_achievements", { p_user_id: user.id });
}

// In completeFocusSession:
const points = actualMinutes >= 45 ? POINTS.FOCUS_SESSION_LONG : POINTS.FOCUS_SESSION;
await supabase.rpc("zeroed_add_points", {
  p_user_id: user.id,
  p_points: points,
  p_reason: "focus_session",
  p_reference_id: sessionId,
});
```

### 4.2 Gamification Components

Create `components/gamification/level-progress.tsx`:

```typescript
"use client";

import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface LevelProgressProps {
  level: number;
  currentXP: number;
  xpToNext: number;
  className?: string;
}

export function LevelProgress({ level, currentXP, xpToNext, className }: LevelProgressProps) {
  const progress = (currentXP / xpToNext) * 100;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/20">
        <span className="text-sm font-bold text-primary">{level}</span>
      </div>
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Level {level}</span>
          <span className="text-muted-foreground">{currentXP} / {xpToNext} XP</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>
    </div>
  );
}
```

Create `components/gamification/achievement-badge.tsx`:

```typescript
"use client";

import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import { ACHIEVEMENTS } from "@/lib/constants";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AchievementBadgeProps {
  type: keyof typeof ACHIEVEMENTS;
  tier: number;
  earned?: boolean;
  earnedAt?: string;
  size?: "sm" | "default" | "lg";
}

export function AchievementBadge({ 
  type, 
  tier, 
  earned = false, 
  earnedAt,
  size = "default" 
}: AchievementBadgeProps) {
  const achievement = ACHIEVEMENTS[type];
  const tierInfo = achievement.tiers.find(t => t.tier === tier);
  
  if (!tierInfo) return null;

  const IconComponent = Icons[achievement.icon as keyof typeof Icons] || Icons.Award;

  const sizeClasses = {
    sm: "h-8 w-8",
    default: "h-12 w-12",
    lg: "h-16 w-16",
  };

  const iconSizes = {
    sm: "h-4 w-4",
    default: "h-6 w-6",
    lg: "h-8 w-8",
  };

  const tierColors = {
    1: "from-amber-600 to-amber-800", // Bronze
    2: "from-gray-300 to-gray-500",   // Silver
    3: "from-yellow-400 to-yellow-600", // Gold
  };

  return (
    <Tooltip>
      <TooltipTrigger>
        <motion.div
          initial={earned ? { scale: 0 } : {}}
          animate={earned ? { scale: 1 } : {}}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className={cn(
            "relative rounded-full flex items-center justify-center",
            sizeClasses[size],
            earned 
              ? `bg-gradient-to-br ${tierColors[tier as keyof typeof tierColors]}` 
              : "bg-muted"
          )}
        >
          {earned ? (
            <IconComponent className={cn(iconSizes[size], "text-white")} />
          ) : (
            <Lock className={cn(iconSizes[size], "text-muted-foreground")} />
          )}
        </motion.div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-center">
          <p className="font-semibold">{tierInfo.name}</p>
          <p className="text-xs text-muted-foreground">{tierInfo.description}</p>
          {earned && earnedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Earned {new Date(earnedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
```

Create `components/gamification/level-up-modal.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Sparkles, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface LevelUpModalProps {
  newLevel: number;
  onClose: () => void;
}

export function LevelUpModal({ newLevel, onClose }: LevelUpModalProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // Trigger confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  }, []);

  function handleClose() {
    setOpen(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md text-center">
        <DialogHeader>
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="mx-auto mb-4"
          >
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
              <Star className="h-10 w-10 text-white fill-white" />
            </div>
          </motion.div>
          <DialogTitle className="text-2xl">Level Up!</DialogTitle>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-4"
        >
          <p className="text-4xl font-bold text-primary">Level {newLevel}</p>
          <p className="text-muted-foreground">
            You're making amazing progress! Keep up the great work.
          </p>
          <Button onClick={handleClose} className="mt-4">
            <Sparkles className="mr-2 h-4 w-4" />
            Continue
          </Button>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
```

### 4.3 Achievements Page

Create `app/(dashboard)/achievements/page.tsx` showing all achievements grouped by type, with earned ones highlighted.

### 4.4 Add to Dashboard Sidebar

Add navigation items for:
- Goals (`/goals`)
- Habits (`/habits`)
- Achievements (could be in profile or separate page)

Show level + XP in sidebar footer.

---

## Phase 5: Integration

### 5.1 Update Today Page

Add widgets for:
- Daily goal progress
- Today's habits
- Current streak
- Level/XP progress

### 5.2 Update Stats Page

Add sections for:
- Achievement showcase
- Streak history
- Points earned this week
- Level progress

### 5.3 Toast Notifications

Show toasts for:
- Points earned
- Achievement unlocked
- Level up (trigger modal)
- Streak milestone

---

## Testing Checklist

### Goals
- [ ] Create goal with different periods
- [ ] Progress auto-updates from stats
- [ ] Goal completes when target reached
- [ ] Points awarded on completion
- [ ] Pause/resume goal
- [ ] Delete goal

### Habits
- [ ] Create habit with different frequencies
- [ ] Log habit completion
- [ ] Streak calculates correctly
- [ ] Points awarded per completion
- [ ] Undo habit log
- [ ] Weekly view shows correct data

### Gamification
- [ ] Points awarded for tasks
- [ ] Points awarded for focus sessions
- [ ] Level up works correctly
- [ ] Achievements unlock at thresholds
- [ ] Level up modal shows
- [ ] Achievement toast shows

---

## Files Summary

**New Files:**
- `supabase/migrations/003_sprint3_gamification.sql`
- `app/(dashboard)/goals/page.tsx`
- `app/(dashboard)/habits/page.tsx`
- `app/(dashboard)/achievements/page.tsx`
- `components/goals/goal-card.tsx`
- `components/goals/goal-list.tsx`
- `components/goals/goal-form.tsx`
- `components/habits/habit-tracker.tsx`
- `components/habits/habit-row.tsx`
- `components/habits/habit-form.tsx`
- `components/habits/streak-badge.tsx`
- `components/gamification/level-progress.tsx`
- `components/gamification/achievement-badge.tsx`
- `components/gamification/level-up-modal.tsx`
- `components/gamification/points-toast.tsx`

**Modified Files:**
- `lib/supabase/types.ts`
- `lib/constants.ts`
- `app/(dashboard)/actions.ts`
- `components/dashboard/sidebar.tsx`
- `app/(dashboard)/today/page.tsx`
- `app/(dashboard)/stats/page.tsx`

**New Dependencies:**
- `canvas-confetti` (for celebrations)

---

**Ready to implement. Make productivity fun!** 🎮

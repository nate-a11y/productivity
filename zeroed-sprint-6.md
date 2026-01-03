# Zeroed Sprint 6 — Advanced Analytics, Reporting & Polish

## Overview

The final sprint focuses on insights and polish:
1. **Advanced Analytics** — Deep productivity insights and trends
2. **Custom Reports** — Generate and export productivity reports
3. **Time Tracking** — Manual time entries, timesheet view
4. **Settings & Customization** — Theme, preferences, data export
5. **Onboarding** — New user experience
6. **Performance & Polish** — Optimizations, animations, final touches

---

## Phase 0: Database Migrations

```sql
-- ============================================================================
-- ZEROED SPRINT 6 MIGRATIONS
-- ============================================================================

-- Time entries for manual time tracking
create table if not exists zeroed_time_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references zeroed_tasks(id) on delete set null,
  description text,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_minutes integer,
  is_manual boolean default false,
  created_at timestamptz default now()
);

alter table zeroed_time_entries enable row level security;
create policy "Users can CRUD own time_entries" on zeroed_time_entries
  for all using (auth.uid() = user_id);

create index zeroed_time_entries_user_date_idx 
  on zeroed_time_entries(user_id, start_time);

-- Saved reports
create table if not exists zeroed_saved_reports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  report_type text not null, -- 'productivity', 'time', 'goals', 'custom'
  config jsonb not null,
  schedule text, -- 'daily', 'weekly', 'monthly', null
  last_generated_at timestamptz,
  created_at timestamptz default now()
);

alter table zeroed_saved_reports enable row level security;
create policy "Users can CRUD own reports" on zeroed_saved_reports
  for all using (auth.uid() = user_id);

-- Enhanced user preferences
alter table zeroed_user_preferences add column if not exists 
  onboarding_completed boolean default false;
alter table zeroed_user_preferences add column if not exists 
  onboarding_step integer default 0;
alter table zeroed_user_preferences add column if not exists 
  keyboard_shortcuts_enabled boolean default true;
alter table zeroed_user_preferences add column if not exists 
  animations_enabled boolean default true;
alter table zeroed_user_preferences add column if not exists 
  compact_mode boolean default false;
alter table zeroed_user_preferences add column if not exists 
  start_of_week integer default 1; -- 0=Sun, 1=Mon
alter table zeroed_user_preferences add column if not exists 
  daily_goal_tasks integer default 5;
alter table zeroed_user_preferences add column if not exists 
  daily_goal_focus_minutes integer default 120;

-- Weekly aggregated stats for faster queries
create table if not exists zeroed_weekly_stats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  week_start date not null,
  tasks_completed integer default 0,
  tasks_created integer default 0,
  focus_minutes integer default 0,
  sessions_completed integer default 0,
  most_productive_day text,
  created_at timestamptz default now(),
  unique(user_id, week_start)
);

alter table zeroed_weekly_stats enable row level security;
create policy "Users can read own weekly_stats" on zeroed_weekly_stats
  for select using (auth.uid() = user_id);
```

---

## Phase 1: Advanced Analytics

### 1.1 Analytics Types

Add to `lib/supabase/types.ts`:

```typescript
export interface ProductivityMetrics {
  tasksCompleted: number;
  tasksCreated: number;
  completionRate: number;
  focusMinutes: number;
  sessionsCompleted: number;
  avgTaskDuration: number;
  estimationAccuracy: number;
  currentStreak: number;
  longestStreak: number;
  tasksCompletedTrend: number; // vs previous period
  focusMinutesTrend: number;
}

export interface DailyBreakdown {
  date: string;
  tasksCompleted: number;
  focusMinutes: number;
  sessionsCompleted: number;
}

export interface HourlyDistribution {
  hour: number;
  tasksCompleted: number;
  focusMinutes: number;
}

export interface CategoryBreakdown {
  listId: string;
  listName: string;
  color: string;
  tasksCompleted: number;
  focusMinutes: number;
  percentage: number;
}
```

### 1.2 Analytics Server Actions

```typescript
// ============================================================================
// ANALYTICS ACTIONS
// ============================================================================

export async function getProductivityMetrics(
  startDate: string,
  endDate: string
): Promise<ProductivityMetrics> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Current period
  const { data: currentStats } = await supabase
    .from("zeroed_daily_stats")
    .select("*")
    .eq("user_id", user.id)
    .gte("date", startDate)
    .lte("date", endDate);

  // Previous period for trends
  const daysDiff = differenceInDays(new Date(endDate), new Date(startDate));
  const prevStart = format(subDays(new Date(startDate), daysDiff), "yyyy-MM-dd");
  const prevEnd = format(subDays(new Date(startDate), 1), "yyyy-MM-dd");

  const { data: prevStats } = await supabase
    .from("zeroed_daily_stats")
    .select("*")
    .eq("user_id", user.id)
    .gte("date", prevStart)
    .lte("date", prevEnd);

  const current = {
    tasksCompleted: currentStats?.reduce((s, d) => s + (d.tasks_completed || 0), 0) || 0,
    tasksCreated: currentStats?.reduce((s, d) => s + (d.tasks_created || 0), 0) || 0,
    focusMinutes: currentStats?.reduce((s, d) => s + (d.focus_minutes || 0), 0) || 0,
    sessions: currentStats?.reduce((s, d) => s + (d.sessions_completed || 0), 0) || 0,
  };

  const prev = {
    tasksCompleted: prevStats?.reduce((s, d) => s + (d.tasks_completed || 0), 0) || 0,
    focusMinutes: prevStats?.reduce((s, d) => s + (d.focus_minutes || 0), 0) || 0,
  };

  // Estimation accuracy
  const { data: completedTasks } = await supabase
    .from("zeroed_tasks")
    .select("estimated_minutes, actual_minutes")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .gt("actual_minutes", 0)
    .gte("completed_at", startDate);

  let estimationAccuracy = 0;
  if (completedTasks?.length) {
    const accuracies = completedTasks.map(t => 
      Math.min(t.estimated_minutes, t.actual_minutes) / 
      Math.max(t.estimated_minutes, t.actual_minutes)
    );
    estimationAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  }

  const { data: prefs } = await supabase
    .from("zeroed_user_preferences")
    .select("streak_current, streak_best")
    .eq("user_id", user.id)
    .single();

  return {
    tasksCompleted: current.tasksCompleted,
    tasksCreated: current.tasksCreated,
    completionRate: current.tasksCreated > 0 ? current.tasksCompleted / current.tasksCreated : 0,
    focusMinutes: current.focusMinutes,
    sessionsCompleted: current.sessions,
    avgTaskDuration: current.tasksCompleted > 0 ? current.focusMinutes / current.tasksCompleted : 0,
    estimationAccuracy,
    currentStreak: prefs?.streak_current || 0,
    longestStreak: prefs?.streak_best || 0,
    tasksCompletedTrend: prev.tasksCompleted > 0 
      ? (current.tasksCompleted - prev.tasksCompleted) / prev.tasksCompleted : 0,
    focusMinutesTrend: prev.focusMinutes > 0 
      ? (current.focusMinutes - prev.focusMinutes) / prev.focusMinutes : 0,
  };
}

export async function getDailyBreakdown(startDate: string, endDate: string): Promise<DailyBreakdown[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("zeroed_daily_stats")
    .select("date, tasks_completed, focus_minutes, sessions_completed")
    .eq("user_id", user.id)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date");

  return data?.map(d => ({
    date: d.date,
    tasksCompleted: d.tasks_completed || 0,
    focusMinutes: d.focus_minutes || 0,
    sessionsCompleted: d.sessions_completed || 0,
  })) || [];
}

export async function getHourlyDistribution(startDate: string, endDate: string): Promise<HourlyDistribution[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: tasks } = await supabase
    .from("zeroed_tasks")
    .select("completed_at, actual_minutes")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .gte("completed_at", startDate)
    .lte("completed_at", endDate);

  const hourly: Record<number, { tasks: number; minutes: number }> = {};
  for (let h = 0; h < 24; h++) hourly[h] = { tasks: 0, minutes: 0 };

  tasks?.forEach(t => {
    const hour = new Date(t.completed_at).getHours();
    hourly[hour].tasks++;
    hourly[hour].minutes += t.actual_minutes || 0;
  });

  return Object.entries(hourly).map(([hour, data]) => ({
    hour: parseInt(hour),
    tasksCompleted: data.tasks,
    focusMinutes: data.minutes,
  }));
}
```

### 1.3 Metrics Overview Component

Create `components/analytics/metrics-overview.tsx`:

```typescript
"use client";

import { TrendingUp, TrendingDown, Target, Clock, Zap, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProductivityMetrics } from "@/lib/supabase/types";

export function MetricsOverview({ metrics }: { metrics: ProductivityMetrics }) {
  const cards = [
    {
      title: "Tasks Completed",
      value: metrics.tasksCompleted,
      trend: metrics.tasksCompletedTrend,
      icon: Target,
      format: (v: number) => v.toString(),
    },
    {
      title: "Focus Time",
      value: metrics.focusMinutes,
      trend: metrics.focusMinutesTrend,
      icon: Clock,
      format: (v: number) => `${Math.floor(v / 60)}h ${v % 60}m`,
    },
    {
      title: "Completion Rate",
      value: metrics.completionRate,
      icon: Zap,
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    {
      title: "Current Streak",
      value: metrics.currentStreak,
      icon: Flame,
      format: (v: number) => `${v} days`,
      highlight: metrics.currentStreak >= 7,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className={cn("h-4 w-4 text-muted-foreground", card.highlight && "text-orange-500")} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.format(card.value)}</div>
            {card.trend !== undefined && (
              <p className={cn("text-xs flex items-center gap-1",
                card.trend > 0 ? "text-green-500" : card.trend < 0 ? "text-red-500" : "text-muted-foreground")}>
                {card.trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(Math.round(card.trend * 100))}% vs previous
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

### 1.4 Productivity Chart

Create `components/analytics/productivity-chart.tsx`:

```typescript
"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProductivityChart({ data }: { data: DailyBreakdown[] }) {
  const chartData = data.map(d => ({
    ...d,
    date: format(new Date(d.date), "MMM d"),
    focusHours: Math.round(d.focusMinutes / 60 * 10) / 10,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Productivity Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFocus" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
              <Legend />
              <Area type="monotone" dataKey="tasksCompleted" name="Tasks" stroke="#6366f1" fill="url(#colorTasks)" />
              <Area type="monotone" dataKey="focusHours" name="Focus (hrs)" stroke="#10b981" fill="url(#colorFocus)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 1.5 Hourly Heatmap

Create `components/analytics/hourly-heatmap.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function HourlyHeatmap({ data }: { data: HourlyDistribution[] }) {
  const maxTasks = Math.max(...data.map(d => d.tasksCompleted), 1);

  function getIntensity(value: number): string {
    const ratio = value / maxTasks;
    if (ratio === 0) return "bg-muted";
    if (ratio < 0.25) return "bg-primary/20";
    if (ratio < 0.5) return "bg-primary/40";
    if (ratio < 0.75) return "bg-primary/60";
    return "bg-primary";
  }

  function formatHour(hour: number): string {
    if (hour === 0) return "12am";
    if (hour === 12) return "12pm";
    return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Most Productive Hours</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-12 gap-1">
          {data.map((hour) => (
            <Tooltip key={hour.hour}>
              <TooltipTrigger asChild>
                <div className={cn("aspect-square rounded-sm cursor-pointer", getIntensity(hour.tasksCompleted))} />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{formatHour(hour.hour)}</p>
                <p className="text-xs text-muted-foreground">{hour.tasksCompleted} tasks • {hour.focusMinutes}m</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Phase 2: Report Generation

### 2.1 Report Generator

Create `lib/reports/generator.ts`:

```typescript
import { format } from "date-fns";

export interface ReportData {
  title: string;
  dateRange: { start: string; end: string };
  metrics: ProductivityMetrics;
  dailyData: DailyBreakdown[];
  generatedAt: string;
}

export function generateMarkdownReport(data: ReportData): string {
  const { metrics, dailyData, dateRange } = data;

  return `# Productivity Report

**Period:** ${format(new Date(dateRange.start), "MMM d")} - ${format(new Date(dateRange.end), "MMM d, yyyy")}

## Summary

| Metric | Value |
|--------|-------|
| Tasks Completed | ${metrics.tasksCompleted} |
| Focus Time | ${Math.floor(metrics.focusMinutes / 60)}h ${metrics.focusMinutes % 60}m |
| Completion Rate | ${Math.round(metrics.completionRate * 100)}% |
| Current Streak | ${metrics.currentStreak} days |

## Daily Breakdown

| Date | Tasks | Focus Time |
|------|-------|------------|
${dailyData.map(d => `| ${format(new Date(d.date), "MMM d")} | ${d.tasksCompleted} | ${d.focusMinutes}m |`).join("\n")}

*Generated by Zeroed*
`;
}

export function generateCSVReport(data: ReportData): string {
  const headers = ["Date", "Tasks Completed", "Focus Minutes", "Sessions"];
  const rows = data.dailyData.map(d => [d.date, d.tasksCompleted, d.focusMinutes, d.sessionsCompleted]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}
```

### 2.2 Export Dialog

Create `components/analytics/export-dialog.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Download, FileText, FileSpreadsheet, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { exportReport } from "@/app/(dashboard)/actions";
import { toast } from "sonner";

export function ExportDialog({ startDate, endDate }: { startDate: string; endDate: string }) {
  const [format, setFormat] = useState<"markdown" | "csv" | "json">("markdown");
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport() {
    setIsExporting(true);
    const result = await exportReport(format, startDate, endDate);
    
    if (result.error) {
      toast.error(result.error);
    } else if (result.content) {
      const blob = new Blob([result.content], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename!;
      a.click();
      toast.success("Report downloaded!");
    }
    setIsExporting(false);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline"><Download className="h-4 w-4 mr-2" />Export</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Export Report</DialogTitle></DialogHeader>
        <RadioGroup value={format} onValueChange={(v) => setFormat(v as any)}>
          {[
            { value: "markdown", label: "Markdown", icon: FileText },
            { value: "csv", label: "CSV", icon: FileSpreadsheet },
            { value: "json", label: "JSON", icon: FileJson },
          ].map((f) => (
            <div key={f.value} className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted">
              <RadioGroupItem value={f.value} id={f.value} />
              <Label htmlFor={f.value} className="flex items-center gap-2 cursor-pointer">
                <f.icon className="h-4 w-4" />{f.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <Button onClick={handleExport} disabled={isExporting} className="w-full">
          {isExporting ? "Generating..." : "Download Report"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Phase 3: Time Tracking

### 3.1 Time Entry Actions

```typescript
export async function createTimeEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;
  const duration = endTime 
    ? differenceInMinutes(new Date(endTime), new Date(startTime))
    : parseInt(formData.get("durationMinutes") as string);

  const { data, error } = await supabase.from("zeroed_time_entries").insert({
    user_id: user.id,
    task_id: formData.get("taskId") as string || null,
    description: formData.get("description") as string || null,
    start_time: startTime,
    end_time: endTime || null,
    duration_minutes: duration,
    is_manual: true,
  }).select().single();

  if (error) return { error: error.message };
  revalidatePath("/time");
  return { success: true, entry: data };
}

export async function getTimeEntries(startDate: string, endDate: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("zeroed_time_entries")
    .select("*, zeroed_tasks(title)")
    .eq("user_id", user.id)
    .gte("start_time", startDate)
    .lte("start_time", endDate)
    .order("start_time", { ascending: false });

  return data || [];
}
```

### 3.2 Timesheet Component

Create `components/time/timesheet.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Timesheet({ entries, onAddEntry }: { entries: any[]; onAddEntry: (date: Date) => void }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const entriesByDay = useMemo(() => {
    const byDay: Record<string, any[]> = {};
    days.forEach(d => byDay[format(d, "yyyy-MM-dd")] = []);
    entries.forEach(e => {
      const key = format(new Date(e.start_time), "yyyy-MM-dd");
      if (byDay[key]) byDay[key].push(e);
    });
    return byDay;
  }, [entries, days]);

  const weekTotal = Object.values(entriesByDay).flat().reduce((sum, e) => sum + e.duration_minutes, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Timesheet</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[140px] text-center">
            {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d")}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const dayEntries = entriesByDay[dateKey] || [];
            const total = dayEntries.reduce((s, e) => s + e.duration_minutes, 0);
            const isToday = isSameDay(day, new Date());

            return (
              <div key={dateKey} className={cn("border rounded-lg p-2 min-h-[120px]", isToday && "border-primary")}>
                <div className="flex items-center justify-between mb-2">
                  <span className={cn("text-sm font-medium", isToday && "text-primary")}>{format(day, "EEE d")}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onAddEntry(day)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="space-y-1">
                  {dayEntries.slice(0, 3).map((entry) => (
                    <div key={entry.id} className="text-xs p-1 rounded bg-primary/10 truncate">
                      {entry.zeroed_tasks?.title || entry.description || "Untitled"}
                      <span className="text-muted-foreground ml-1">{entry.duration_minutes}m</span>
                    </div>
                  ))}
                  {dayEntries.length > 3 && <span className="text-xs text-muted-foreground">+{dayEntries.length - 3} more</span>}
                </div>
                {total > 0 && (
                  <div className="mt-auto pt-2 border-t text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />{Math.floor(total / 60)}h {total % 60}m
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-4 pt-4 border-t">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Week Total</p>
            <p className="text-2xl font-bold">{Math.floor(weekTotal / 60)}h {weekTotal % 60}m</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Phase 4: Settings

### 4.1 Settings Page

Create `app/(dashboard)/settings/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/dashboard/header";
import { GeneralSettings } from "@/components/settings/general-settings";
import { DataSettings } from "@/components/settings/data-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: prefs } = await supabase
    .from("zeroed_user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" />
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>
          <TabsContent value="general"><GeneralSettings preferences={prefs} /></TabsContent>
          <TabsContent value="data"><DataSettings userId={user.id} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

### 4.2 Data Export/Delete

Create `components/settings/data-settings.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Download, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { exportAllData, deleteAllData } from "@/app/(dashboard)/actions";
import { toast } from "sonner";

export function DataSettings({ userId }: { userId: string }) {
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport() {
    setIsExporting(true);
    const result = await exportAllData();
    if (result.error) {
      toast.error(result.error);
    } else if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `zeroed-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      toast.success("Data exported!");
    }
    setIsExporting(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
          <CardDescription>Download all your data as JSON</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />{isExporting ? "Exporting..." : "Export All Data"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive"><Trash2 className="h-4 w-4 mr-2" />Delete All Data</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />Delete All Data?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all tasks, lists, and statistics. Cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteAllData()} className="bg-destructive">
                  Delete Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## Phase 5: Onboarding

Create `components/onboarding/onboarding-flow.tsx`:

```typescript
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Sparkles, Target, Clock, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { completeOnboarding } from "@/app/(dashboard)/actions";

const steps = [
  { id: "welcome", title: "Welcome to Zeroed", icon: Sparkles },
  { id: "goals", title: "Set Your Daily Goals", icon: Target },
  { id: "focus", title: "Focus Duration", icon: Clock },
  { id: "first-task", title: "Create Your First Task", icon: ListTodo },
];

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [prefs, setPrefs] = useState({ dailyGoal: 5, focusDuration: 25, firstTask: "" });

  async function handleComplete() {
    await completeOnboarding({ daily_goal_tasks: prefs.dailyGoal, default_focus_duration: prefs.focusDuration }, prefs.firstTask);
    onComplete();
  }

  function next() {
    if (currentStep === steps.length - 1) handleComplete();
    else setCurrentStep(prev => prev + 1);
  }

  const step = steps[currentStep];
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        <Progress value={((currentStep + 1) / steps.length) * 100} className="mb-8" />
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Icon className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-8">{step.title}</h1>

            {currentStep === 1 && (
              <div className="flex gap-2 justify-center">
                {[3, 5, 7, 10].map(n => (
                  <Button key={n} variant={prefs.dailyGoal === n ? "default" : "outline"} onClick={() => setPrefs({ ...prefs, dailyGoal: n })}>{n}</Button>
                ))}
              </div>
            )}
            {currentStep === 2 && (
              <div className="flex gap-2 justify-center">
                {[15, 25, 45, 60].map(m => (
                  <Button key={m} variant={prefs.focusDuration === m ? "default" : "outline"} onClick={() => setPrefs({ ...prefs, focusDuration: m })}>{m}m</Button>
                ))}
              </div>
            )}
            {currentStep === 3 && (
              <Input placeholder="e.g., Review project proposal" value={prefs.firstTask} onChange={(e) => setPrefs({ ...prefs, firstTask: e.target.value })} />
            )}

            <Button onClick={next} className="mt-8 w-full" size="lg">
              {currentStep === steps.length - 1 ? <><Check className="mr-2 h-4 w-4" />Get Started</> : <>Continue<ChevronRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
```

---

## Phase 6: Polish

### 6.1 Loading Skeletons

Create `components/ui/skeleton-card.tsx`:

```typescript
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonCard() {
  return (
    <Card>
      <CardHeader><Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-1/2" /></CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </CardContent>
    </Card>
  );
}

export function SkeletonTaskList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
```

### 6.2 Animation Variants

Create `lib/animations.ts`:

```typescript
export const fadeIn = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
export const slideUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 } };
export const scaleIn = { initial: { opacity: 0, scale: 0.95 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.95 } };
export const staggerContainer = { animate: { transition: { staggerChildren: 0.05 } } };
export const listItem = { initial: { opacity: 0, x: -10 }, animate: { opacity: 1, x: 0 } };
```

### 6.3 Error Boundary

Create `components/error-boundary.tsx`:

```typescript
"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">An error occurred. Please try again.</p>
          {error.message && <pre className="mt-2 text-xs bg-muted p-2 rounded">{error.message}</pre>}
        </CardContent>
        <CardFooter>
          <Button onClick={reset}><RefreshCw className="h-4 w-4 mr-2" />Try Again</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
```

---

## Testing Checklist

### Analytics
- [ ] Metrics calculate correctly
- [ ] Charts render properly
- [ ] Trends vs previous period
- [ ] Hourly heatmap works

### Reports
- [ ] Export Markdown
- [ ] Export CSV
- [ ] Export JSON

### Time Tracking
- [ ] Create entries
- [ ] Link to tasks
- [ ] Timesheet view
- [ ] Week totals

### Settings
- [ ] Save preferences
- [ ] Export all data
- [ ] Delete all data

### Onboarding
- [ ] Steps progress
- [ ] Preferences saved
- [ ] First task created

### Polish
- [ ] Loading states
- [ ] Animations smooth
- [ ] Error boundaries

---

## Dependencies

```bash
npm install recharts
```

---

## Final Deployment Checklist

- [ ] Environment variables set
- [ ] Database migrations run
- [ ] PWA assets generated
- [ ] Performance tested
- [ ] Mobile responsive
- [ ] Accessibility checked

---

**Sprint 6 complete. Zeroed is ready to ship! 🚀**

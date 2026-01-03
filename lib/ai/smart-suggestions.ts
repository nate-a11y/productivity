import { createClient } from "@/lib/supabase/server";
import { format, getDay, subDays, startOfDay, endOfDay } from "date-fns";

export interface Suggestion {
  id: string;
  type: "time" | "task" | "habit" | "insight";
  title: string;
  description: string;
  action?: {
    type: "schedule" | "create_task" | "start_focus" | "complete_habit";
    payload: Record<string, unknown>;
  };
  confidence: number; // 0-1
}

interface TaskPattern {
  dayOfWeek: number;
  hour: number;
  taskType: string;
  count: number;
}

interface CompletionStats {
  avgCompletionHour: number;
  mostProductiveDay: number;
  avgTasksPerDay: number;
  streakDays: number;
}

// Generate personalized suggestions based on user behavior
export async function generateSuggestions(userId: string): Promise<Suggestion[]> {
  const supabase = await createClient();
  const suggestions: Suggestion[] = [];
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = getDay(now);

  // Get user's completed tasks from last 30 days
  const thirtyDaysAgo = subDays(now, 30);
  const { data: completedTasks } = await supabase
    .from("zeroed_tasks")
    .select("title, completed_at, due_date, due_time, estimated_minutes, list_id, zeroed_lists(name)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("completed_at", thirtyDaysAgo.toISOString())
    .order("completed_at", { ascending: false })
    .limit(200);

  // Get pending tasks
  const { data: pendingTasks } = await supabase
    .from("zeroed_tasks")
    .select("id, title, due_date, due_time, priority, estimated_minutes")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_date", { ascending: true })
    .limit(50);

  // Get today's date first (needed for habits query)
  const today = format(now, "yyyy-MM-dd");

  // Get habits with today's completions
  const { data: habits } = await supabase
    .from("zeroed_habits")
    .select("id, name, frequency")
    .eq("user_id", userId)
    .eq("is_archived", false);

  // Get today's habit completions
  const { data: todayHabitLogs } = await supabase
    .from("zeroed_habit_logs")
    .select("habit_id")
    .eq("user_id", userId)
    .eq("date", today);

  const completedHabitIds = new Set((todayHabitLogs || []).map((l) => l.habit_id));

  // Get today's stats
  const { data: todayStats } = await supabase
    .from("zeroed_daily_stats")
    .select("tasks_completed, focus_minutes")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  // Analyze patterns
  const patterns = analyzePatterns(completedTasks || []);
  const stats = calculateStats(completedTasks || []);

  // 1. Time-based suggestions
  if (currentHour >= 9 && currentHour <= 11 && stats.avgCompletionHour >= 9 && stats.avgCompletionHour <= 12) {
    suggestions.push({
      id: "morning-peak",
      type: "insight",
      title: "Your peak productivity time",
      description: "You complete most tasks in the morning. Consider tackling your hardest task now.",
      confidence: 0.85,
    });
  }

  if (currentHour >= 14 && currentHour <= 15) {
    suggestions.push({
      id: "afternoon-focus",
      type: "time",
      title: "Post-lunch focus session",
      description: "A 25-minute focus session can help beat the afternoon slump.",
      action: {
        type: "start_focus",
        payload: { minutes: 25 },
      },
      confidence: 0.7,
    });
  }

  // 2. Day-based suggestions
  const dayPatterns = patterns.filter((p) => p.dayOfWeek === currentDay);
  if (dayPatterns.length > 0) {
    const topPattern = dayPatterns.sort((a, b) => b.count - a.count)[0];
    if (topPattern.count >= 3) {
      suggestions.push({
        id: `day-pattern-${currentDay}`,
        type: "insight",
        title: `${getDayName(currentDay)} pattern detected`,
        description: `You often work on "${topPattern.taskType}" tasks on ${getDayName(currentDay)}s.`,
        confidence: Math.min(topPattern.count / 10, 0.9),
      });
    }
  }

  // 3. Pending task suggestions
  const overdueTasks = (pendingTasks || []).filter(
    (t) => t.due_date && new Date(t.due_date) < startOfDay(now)
  );
  if (overdueTasks.length > 0) {
    suggestions.push({
      id: "overdue-tasks",
      type: "task",
      title: `${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? "s" : ""}`,
      description: "Consider rescheduling or completing these today.",
      confidence: 0.95,
    });
  }

  const highPriorityToday = (pendingTasks || []).filter(
    (t) => t.due_date === today && (t.priority === "high" || t.priority === "urgent")
  );
  if (highPriorityToday.length > 0 && (todayStats?.tasks_completed || 0) === 0) {
    suggestions.push({
      id: "high-priority-today",
      type: "task",
      title: "High priority tasks today",
      description: `You have ${highPriorityToday.length} important task${highPriorityToday.length !== 1 ? "s" : ""} due today.`,
      confidence: 0.9,
    });
  }

  // 4. Habit suggestions
  const incompleteHabits = (habits || []).filter(
    (habit) => !completedHabitIds.has(habit.id)
  );

  if (incompleteHabits.length > 0 && currentHour >= 17) {
    suggestions.push({
      id: "evening-habits",
      type: "habit",
      title: "Don't forget your habits",
      description: `${incompleteHabits.length} habit${incompleteHabits.length !== 1 ? "s" : ""} still incomplete today.`,
      confidence: 0.8,
    });
  }

  // 5. Productivity insights
  if (stats.streakDays >= 3) {
    suggestions.push({
      id: "streak",
      type: "insight",
      title: `${stats.streakDays}-day streak!`,
      description: "You've been completing tasks consistently. Keep it up!",
      confidence: 0.95,
    });
  }

  if (stats.avgTasksPerDay > 0 && (todayStats?.tasks_completed || 0) >= stats.avgTasksPerDay) {
    suggestions.push({
      id: "above-average",
      type: "insight",
      title: "Above average day",
      description: `You've completed ${todayStats?.tasks_completed} tasks today, above your ${stats.avgTasksPerDay.toFixed(1)} daily average.`,
      confidence: 0.85,
    });
  }

  // 6. Focus suggestions
  if ((todayStats?.focus_minutes || 0) === 0 && currentHour >= 10 && currentHour <= 16) {
    suggestions.push({
      id: "no-focus-today",
      type: "time",
      title: "No focus sessions today",
      description: "Start a 25-minute Pomodoro to boost productivity.",
      action: {
        type: "start_focus",
        payload: { minutes: 25 },
      },
      confidence: 0.75,
    });
  }

  // Sort by confidence and limit
  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function analyzePatterns(tasks: { title: string; completed_at: string | null }[]): TaskPattern[] {
  const patterns: Map<string, TaskPattern> = new Map();

  for (const task of tasks) {
    if (!task.completed_at) continue;

    const completedDate = new Date(task.completed_at);
    const dayOfWeek = getDay(completedDate);
    const hour = completedDate.getHours();
    const taskType = categorizeTask(task.title);

    const key = `${dayOfWeek}-${hour}-${taskType}`;
    const existing = patterns.get(key);

    if (existing) {
      existing.count++;
    } else {
      patterns.set(key, {
        dayOfWeek,
        hour,
        taskType,
        count: 1,
      });
    }
  }

  return Array.from(patterns.values());
}

function categorizeTask(title: string): string {
  const lower = title.toLowerCase();

  if (lower.includes("meet") || lower.includes("call") || lower.includes("sync")) {
    return "meetings";
  }
  if (lower.includes("email") || lower.includes("reply") || lower.includes("respond")) {
    return "communication";
  }
  if (lower.includes("review") || lower.includes("check") || lower.includes("read")) {
    return "review";
  }
  if (lower.includes("write") || lower.includes("draft") || lower.includes("create")) {
    return "creative";
  }
  if (lower.includes("fix") || lower.includes("bug") || lower.includes("debug")) {
    return "debugging";
  }
  if (lower.includes("plan") || lower.includes("prepare") || lower.includes("organize")) {
    return "planning";
  }

  return "general";
}

function calculateStats(tasks: { completed_at: string | null }[]): CompletionStats {
  const hours: number[] = [];
  const days: Map<string, number> = new Map();
  const dayOfWeekCounts: number[] = [0, 0, 0, 0, 0, 0, 0];

  for (const task of tasks) {
    if (!task.completed_at) continue;

    const date = new Date(task.completed_at);
    hours.push(date.getHours());

    const dayKey = format(date, "yyyy-MM-dd");
    days.set(dayKey, (days.get(dayKey) || 0) + 1);

    dayOfWeekCounts[getDay(date)]++;
  }

  // Calculate streak
  let streakDays = 0;
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const checkDate = format(subDays(today, i), "yyyy-MM-dd");
    if (days.has(checkDate)) {
      streakDays++;
    } else if (i > 0) {
      break;
    }
  }

  // Most productive day
  const mostProductiveDay = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));

  return {
    avgCompletionHour: hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : 12,
    mostProductiveDay,
    avgTasksPerDay: days.size > 0 ? tasks.length / days.size : 0,
    streakDays,
  };
}

function getDayName(day: number): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[day];
}

# Zeroed Sprint 4 — AI Features & Power User

## Overview

This sprint adds intelligence and power user features:
1. **Natural Language Input** — Parse "Call mom tomorrow 3pm" into structured task
2. **Smart Time Estimation** — Learn from user's history to suggest estimates
3. **AI Daily Planning** — Auto-prioritize and suggest today's focus
4. **Task Breakdown** — AI generates subtasks for complex tasks
5. **Enhanced Keyboard Shortcuts** — Full keyboard-driven workflow
6. **Bulk Actions** — Multi-select and batch operations
7. **Quick Capture** — Global quick-add from anywhere

---

## Phase 0: Setup AI Infrastructure

### Environment Variables

```env
# Add to .env.local
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Install Dependencies

```bash
npm install @anthropic-ai/sdk
```

### Create AI Client

Create `lib/ai/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { anthropic };
```

---

## Phase 1: Natural Language Task Input

### 1.1 AI Parser Function

Create `lib/ai/parse-task.ts`:

```typescript
import { anthropic } from "./client";
import { format, addDays, nextMonday, nextTuesday, nextWednesday, nextThursday, nextFriday, nextSaturday, nextSunday } from "date-fns";

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  estimatedMinutes: number;
  listName: string | null; // If user mentions a list
  tags: string[]; // Extracted tags
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a task parser. Given natural language input, extract structured task data.

Today's date is ${format(new Date(), "yyyy-MM-dd")} (${format(new Date(), "EEEE")}).

Return a JSON object with these fields:
- title: The main task (clean, concise)
- dueDate: ISO date string (YYYY-MM-DD) or null
- dueTime: 24-hour time (HH:MM) or null
- priority: "low", "normal", "high", or "urgent"
- estimatedMinutes: Reasonable estimate (default 25)
- listName: If they mention a list/project name, extract it
- tags: Array of relevant tags/categories mentioned
- notes: Any additional context

Date parsing rules:
- "today" = ${format(new Date(), "yyyy-MM-dd")}
- "tomorrow" = ${format(addDays(new Date(), 1), "yyyy-MM-dd")}
- "next week" = ${format(nextMonday(new Date()), "yyyy-MM-dd")}
- Day names = next occurrence of that day
- Relative dates like "in 3 days" = calculate from today

Priority signals:
- "urgent", "asap", "critical", "!!!" = urgent
- "important", "high priority", "!" = high
- "low priority", "whenever", "someday" = low
- Default = normal

Time estimate signals:
- "quick", "5 min", "small" = 10-15 minutes
- "big", "long", "complex" = 60-120 minutes
- Default = 25 minutes

Return ONLY valid JSON, no explanation.`;

export async function parseTaskInput(input: string): Promise<ParsedTask> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Parse this task: "${input}"`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    // Parse JSON from response
    const parsed = JSON.parse(content.text);
    
    return {
      title: parsed.title || input,
      dueDate: parsed.dueDate || null,
      dueTime: parsed.dueTime || null,
      priority: parsed.priority || "normal",
      estimatedMinutes: parsed.estimatedMinutes || 25,
      listName: parsed.listName || null,
      tags: parsed.tags || [],
      notes: parsed.notes || null,
    };
  } catch (error) {
    console.error("Failed to parse task:", error);
    // Fallback: return basic task
    return {
      title: input,
      dueDate: null,
      dueTime: null,
      priority: "normal",
      estimatedMinutes: 25,
      listName: null,
      tags: [],
      notes: null,
    };
  }
}
```

### 1.2 Server Action

Add to `app/(dashboard)/actions.ts`:

```typescript
import { parseTaskInput } from "@/lib/ai/parse-task";

export async function createTaskFromNaturalLanguage(input: string, defaultListId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  // Parse the natural language input
  const parsed = await parseTaskInput(input);

  // Find or use default list
  let listId = defaultListId;
  if (parsed.listName) {
    const { data: matchingList } = await supabase
      .from("zeroed_lists")
      .select("id")
      .eq("user_id", user.id)
      .ilike("name", `%${parsed.listName}%`)
      .limit(1)
      .single();

    if (matchingList) {
      listId = matchingList.id;
    }
  }

  // Create the task
  const { data: task, error } = await supabase
    .from("zeroed_tasks")
    .insert({
      user_id: user.id,
      list_id: listId,
      title: parsed.title,
      notes: parsed.notes,
      due_date: parsed.dueDate,
      due_time: parsed.dueTime,
      priority: parsed.priority,
      estimated_minutes: parsed.estimatedMinutes,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  // Add tags if any
  if (parsed.tags.length > 0) {
    for (const tagName of parsed.tags) {
      // Create tag if doesn't exist
      const { data: existingTag } = await supabase
        .from("zeroed_tags")
        .select("id")
        .eq("user_id", user.id)
        .ilike("name", tagName)
        .single();

      let tagId: string;
      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag } = await supabase
          .from("zeroed_tags")
          .insert({ user_id: user.id, name: tagName })
          .select()
          .single();
        if (newTag) tagId = newTag.id;
        else continue;
      }

      // Link tag to task
      await supabase
        .from("zeroed_task_tags")
        .insert({ task_id: task.id, tag_id: tagId });
    }
  }

  revalidatePath("/");
  return { success: true, task, parsed };
}
```

### 1.3 Smart Input Component

Create `components/tasks/smart-task-input.tsx`:

```typescript
"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createTaskFromNaturalLanguage } from "@/app/(dashboard)/actions";
import { toast } from "sonner";
import type { ParsedTask } from "@/lib/ai/parse-task";

interface SmartTaskInputProps {
  defaultListId: string;
  onTaskCreated?: () => void;
  placeholder?: string;
}

export function SmartTaskInput({ 
  defaultListId, 
  onTaskCreated,
  placeholder = "Add a task... (try: 'Call mom tomorrow 3pm high priority')"
}: SmartTaskInputProps) {
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview] = useState<ParsedTask | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Debounced preview parsing
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (input.length > 10) {
      debounceRef.current = setTimeout(async () => {
        // Could add a lightweight preview parsing here
        // For now, just show the input is being processed
      }, 500);
    } else {
      setPreview(null);
      setShowPreview(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [input]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);

    const result = await createTaskFromNaturalLanguage(input, defaultListId);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Task created", {
        description: result.parsed?.title,
      });
      setInput("");
      setPreview(null);
      setShowPreview(false);
      onTaskCreated?.();
    }

    setIsProcessing(false);
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            className="pl-10 pr-20 h-12"
            disabled={isProcessing}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : input.trim() && (
              <Button type="submit" size="sm" className="h-8">
                Add
              </Button>
            )}
          </div>
        </div>
      </form>

      {/* AI Preview Card */}
      <AnimatePresence>
        {showPreview && preview && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card className="absolute top-full left-0 right-0 mt-2 z-50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <p className="font-medium">{preview.title}</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {preview.dueDate && (
                        <Badge variant="outline">
                          📅 {format(new Date(preview.dueDate), "MMM d")}
                          {preview.dueTime && ` at ${preview.dueTime}`}
                        </Badge>
                      )}
                      <Badge variant="outline" className="capitalize">
                        {preview.priority}
                      </Badge>
                      <Badge variant="outline">
                        ⏱️ {preview.estimatedMinutes}m
                      </Badge>
                      {preview.tags.map(tag => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setShowPreview(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleSubmit}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

---

## Phase 2: Smart Time Estimation

### 2.1 Estimation AI Function

Create `lib/ai/estimate-time.ts`:

```typescript
import { anthropic } from "./client";
import { createClient } from "@/lib/supabase/server";

export interface EstimationContext {
  taskTitle: string;
  similarTasks: Array<{
    title: string;
    estimatedMinutes: number;
    actualMinutes: number;
  }>;
  userPattern: {
    averageAccuracy: number; // 1.0 = perfect, >1 = underestimates, <1 = overestimates
    typicalTaskLength: number;
  };
}

export async function suggestTimeEstimate(
  taskTitle: string,
  userId: string
): Promise<{ estimate: number; reasoning: string; confidence: number }> {
  const supabase = await createClient();

  // Get similar completed tasks
  const { data: similarTasks } = await supabase
    .from("zeroed_tasks")
    .select("title, estimated_minutes, actual_minutes")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gt("actual_minutes", 0)
    .order("created_at", { ascending: false })
    .limit(50);

  // Calculate user's estimation pattern
  let totalEstimated = 0;
  let totalActual = 0;
  similarTasks?.forEach(t => {
    totalEstimated += t.estimated_minutes;
    totalActual += t.actual_minutes;
  });

  const averageAccuracy = totalEstimated > 0 ? totalActual / totalEstimated : 1;
  const typicalTaskLength = similarTasks?.length 
    ? totalActual / similarTasks.length 
    : 25;

  // Find specifically similar tasks (simple keyword matching)
  const keywords = taskTitle.toLowerCase().split(/\s+/);
  const relevantTasks = similarTasks?.filter(t => 
    keywords.some(kw => t.title.toLowerCase().includes(kw))
  ).slice(0, 5) || [];

  const prompt = `Given this task and context, suggest a time estimate in minutes.

Task: "${taskTitle}"

User's estimation pattern:
- They typically ${averageAccuracy > 1.1 ? "underestimate" : averageAccuracy < 0.9 ? "overestimate" : "estimate accurately"}
- Accuracy ratio: ${averageAccuracy.toFixed(2)} (actual/estimated)
- Average task takes them: ${Math.round(typicalTaskLength)} minutes

${relevantTasks.length > 0 ? `Similar completed tasks:
${relevantTasks.map(t => `- "${t.title}": estimated ${t.estimated_minutes}m, actual ${t.actual_minutes}m`).join("\n")}` : "No similar tasks found."}

Return JSON with:
- estimate: number (minutes, realistic for this user)
- reasoning: string (brief explanation)
- confidence: number (0-1, how confident in this estimate)

Account for the user's historical accuracy. If they underestimate, suggest higher.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response");

    const result = JSON.parse(content.text);
    return {
      estimate: Math.round(result.estimate) || 25,
      reasoning: result.reasoning || "Based on similar tasks",
      confidence: result.confidence || 0.5,
    };
  } catch (error) {
    console.error("Estimation failed:", error);
    return {
      estimate: Math.round(typicalTaskLength),
      reasoning: "Based on your average task length",
      confidence: 0.3,
    };
  }
}
```

### 2.2 Server Action

```typescript
export async function getTimeEstimateSuggestion(taskTitle: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const suggestion = await suggestTimeEstimate(taskTitle, user.id);
  return { success: true, ...suggestion };
}
```

### 2.3 UI Integration

Add a "✨ Suggest" button next to the time estimate field that calls the AI and shows the reasoning in a tooltip.

---

## Phase 3: AI Daily Planning

### 3.1 Planning AI Function

Create `lib/ai/daily-planner.ts`:

```typescript
import { anthropic } from "./client";
import { format } from "date-fns";
import type { Task } from "@/lib/supabase/types";

export interface DailyPlan {
  prioritizedTasks: Array<{
    taskId: string;
    reason: string;
    suggestedTime?: string; // "morning", "afternoon", "evening"
  }>;
  suggestions: string[];
  focusAdvice: string;
  estimatedTotalTime: number;
}

export async function generateDailyPlan(
  tasks: Task[],
  userStats: {
    averageFocusTime: number;
    peakProductivityTime?: string;
    completionRate: number;
  }
): Promise<DailyPlan> {
  const today = format(new Date(), "EEEE, MMMM d");
  
  const taskList = tasks.map(t => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    dueDate: t.due_date,
    estimatedMinutes: t.estimated_minutes,
    isOverdue: t.due_date && new Date(t.due_date) < new Date(),
  }));

  const prompt = `You are a productivity coach. Create a daily plan for ${today}.

Available tasks:
${JSON.stringify(taskList, null, 2)}

User context:
- Average daily focus time: ${userStats.averageFocusTime} minutes
- Task completion rate: ${Math.round(userStats.completionRate * 100)}%
${userStats.peakProductivityTime ? `- Most productive time: ${userStats.peakProductivityTime}` : ""}

Create a realistic daily plan. Consider:
1. Prioritize overdue tasks and high-priority items
2. Don't overload - suggest what's actually achievable
3. Leave buffer time between tasks
4. Group similar tasks together

Return JSON:
{
  "prioritizedTasks": [
    { "taskId": "...", "reason": "Brief reason", "suggestedTime": "morning|afternoon|evening" }
  ],
  "suggestions": ["1-2 specific productivity tips for today"],
  "focusAdvice": "Brief motivational/practical advice",
  "estimatedTotalTime": number (minutes)
}

Only include tasks from the provided list. Be concise.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response");

    return JSON.parse(content.text);
  } catch (error) {
    console.error("Daily planning failed:", error);
    // Fallback: simple priority-based ordering
    return {
      prioritizedTasks: tasks
        .sort((a, b) => {
          const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        })
        .slice(0, 5)
        .map(t => ({
          taskId: t.id,
          reason: `${t.priority} priority`,
          suggestedTime: "morning",
        })),
      suggestions: ["Focus on your highest-priority tasks first"],
      focusAdvice: "Start with a quick win to build momentum",
      estimatedTotalTime: tasks.slice(0, 5).reduce((sum, t) => sum + t.estimated_minutes, 0),
    };
  }
}
```

### 3.2 Daily Plan Component

Create `components/ai/daily-plan.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Sparkles, Sun, Cloud, Moon, RefreshCw, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DailyPlan } from "@/lib/ai/daily-planner";
import type { Task } from "@/lib/supabase/types";

interface DailyPlanViewProps {
  plan: DailyPlan;
  tasks: Task[];
  onRefresh: () => Promise<void>;
  onStartTask: (taskId: string) => void;
}

const timeIcons = {
  morning: Sun,
  afternoon: Cloud,
  evening: Moon,
};

export function DailyPlanView({ plan, tasks, onRefresh, onStartTask }: DailyPlanViewProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  }

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle>Today's Plan</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Focus advice */}
        <div className="bg-primary/10 rounded-lg p-3">
          <p className="text-sm text-primary">{plan.focusAdvice}</p>
        </div>

        {/* Prioritized tasks */}
        <div className="space-y-2">
          {plan.prioritizedTasks.map((item, index) => {
            const task = taskMap.get(item.taskId);
            if (!task) return null;

            const TimeIcon = timeIcons[item.suggestedTime as keyof typeof timeIcons] || Sun;

            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 group"
              >
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">{item.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <TimeIcon className="h-3 w-3" />
                    {item.suggestedTime}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => onStartTask(task.id)}
                  >
                    Start
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t">
          <span>{plan.prioritizedTasks.length} tasks planned</span>
          <span>~{Math.round(plan.estimatedTotalTime / 60)}h {plan.estimatedTotalTime % 60}m total</span>
        </div>

        {/* Tips */}
        {plan.suggestions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Tips</p>
            {plan.suggestions.map((tip, i) => (
              <p key={i} className="text-xs text-muted-foreground">• {tip}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

---

## Phase 4: AI Task Breakdown

### 4.1 Breakdown Function

Create `lib/ai/break-down-task.ts`:

```typescript
import { anthropic } from "./client";

export interface SubtaskSuggestion {
  title: string;
  estimatedMinutes: number;
  order: number;
}

export async function breakDownTask(
  taskTitle: string,
  taskNotes?: string
): Promise<SubtaskSuggestion[]> {
  const prompt = `Break down this task into smaller, actionable subtasks.

Task: "${taskTitle}"
${taskNotes ? `Notes: ${taskNotes}` : ""}

Rules:
- Create 3-7 specific, actionable subtasks
- Each subtask should be completable in one sitting
- Order them logically
- Estimate realistic times

Return JSON array:
[
  { "title": "Subtask name", "estimatedMinutes": 15, "order": 1 },
  ...
]

Be specific and actionable. No vague steps like "Research" - instead "Read 3 articles about X".`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response");

    return JSON.parse(content.text);
  } catch (error) {
    console.error("Task breakdown failed:", error);
    return [];
  }
}
```

### 4.2 Server Action

```typescript
export async function generateSubtasks(taskId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  // Get task
  const { data: task } = await supabase
    .from("zeroed_tasks")
    .select("title, notes, list_id")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .single();

  if (!task) return { error: "Task not found" };

  // Generate subtasks
  const suggestions = await breakDownTask(task.title, task.notes || undefined);

  if (suggestions.length === 0) {
    return { error: "Could not generate subtasks" };
  }

  return { success: true, suggestions, taskId };
}

export async function applySubtaskSuggestions(
  parentTaskId: string,
  suggestions: SubtaskSuggestion[]
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  // Get parent task
  const { data: parent } = await supabase
    .from("zeroed_tasks")
    .select("list_id")
    .eq("id", parentTaskId)
    .eq("user_id", user.id)
    .single();

  if (!parent) return { error: "Task not found" };

  // Create subtasks
  const subtasks = suggestions.map((s, index) => ({
    user_id: user.id,
    list_id: parent.list_id,
    parent_id: parentTaskId,
    is_subtask: true,
    title: s.title,
    estimated_minutes: s.estimatedMinutes,
    position: index,
  }));

  const { error } = await supabase
    .from("zeroed_tasks")
    .insert(subtasks);

  if (error) return { error: error.message };

  revalidatePath("/");
  return { success: true };
}
```

### 4.3 Breakdown UI

Create `components/ai/task-breakdown-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Sparkles, Loader2, Check, X, GripVertical } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateSubtasks, applySubtaskSuggestions } from "@/app/(dashboard)/actions";
import { toast } from "sonner";
import type { SubtaskSuggestion } from "@/lib/ai/break-down-task";

interface TaskBreakdownModalProps {
  taskId: string;
  taskTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskBreakdownModal({
  taskId,
  taskTitle,
  open,
  onOpenChange,
}: TaskBreakdownModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SubtaskSuggestion[]>([]);
  const [isApplying, setIsApplying] = useState(false);

  async function handleGenerate() {
    setIsLoading(true);
    const result = await generateSubtasks(taskId);
    
    if (result.error) {
      toast.error(result.error);
    } else if (result.suggestions) {
      setSuggestions(result.suggestions);
    }
    setIsLoading(false);
  }

  async function handleApply() {
    setIsApplying(true);
    const result = await applySubtaskSuggestions(taskId, suggestions);
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`Created ${suggestions.length} subtasks`);
      onOpenChange(false);
    }
    setIsApplying(false);
  }

  function updateSuggestion(index: number, updates: Partial<SubtaskSuggestion>) {
    setSuggestions(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }

  function removeSuggestion(index: number) {
    setSuggestions(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Break Down Task
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Task: <span className="font-medium text-foreground">{taskTitle}</span>
          </p>

          {suggestions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                AI will analyze your task and suggest subtasks
              </p>
              <Button onClick={handleGenerate} disabled={isLoading}>
                {isLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Generate Subtasks</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map((suggestion, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={suggestion.title}
                    onChange={(e) => updateSuggestion(index, { title: e.target.value })}
                    className="flex-1 h-8"
                  />
                  <Input
                    type="number"
                    value={suggestion.estimatedMinutes}
                    onChange={(e) => updateSuggestion(index, { 
                      estimatedMinutes: parseInt(e.target.value) || 15 
                    })}
                    className="w-16 h-8"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeSuggestion(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestions([])}>
              Regenerate
            </Button>
            <Button onClick={handleApply} disabled={isApplying}>
              {isApplying ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</>
              ) : (
                <><Check className="mr-2 h-4 w-4" /> Create {suggestions.length} Subtasks</>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

---

## Phase 5: Enhanced Keyboard Shortcuts

### 5.1 Keyboard Manager

Create `lib/hooks/use-keyboard-shortcuts.ts`:

```typescript
"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  category: string;
}

const shortcuts: ShortcutConfig[] = [
  // Navigation
  { key: "k", meta: true, action: () => {}, description: "Command menu", category: "Navigation" },
  { key: "1", meta: true, action: () => {}, description: "Go to Today", category: "Navigation" },
  { key: "2", meta: true, action: () => {}, description: "Go to Lists", category: "Navigation" },
  { key: "3", meta: true, action: () => {}, description: "Go to Focus", category: "Navigation" },
  { key: "4", meta: true, action: () => {}, description: "Go to Stats", category: "Navigation" },
  
  // Actions
  { key: "n", meta: true, action: () => {}, description: "New task", category: "Actions" },
  { key: "f", meta: true, shift: true, action: () => {}, description: "Start focus", category: "Actions" },
  { key: "/", action: () => {}, description: "Search", category: "Actions" },
  
  // Task actions (when task selected)
  { key: "e", action: () => {}, description: "Edit task", category: "Task" },
  { key: "d", action: () => {}, description: "Toggle done", category: "Task" },
  { key: "p", action: () => {}, description: "Set priority", category: "Task" },
  { key: "t", action: () => {}, description: "Add tag", category: "Task" },
  { key: "l", action: () => {}, description: "Move to list", category: "Task" },
  { key: "Delete", action: () => {}, description: "Delete task", category: "Task" },
  { key: "Backspace", action: () => {}, description: "Delete task", category: "Task" },
  
  // List navigation
  { key: "j", action: () => {}, description: "Next task", category: "Navigation" },
  { key: "k", action: () => {}, description: "Previous task", category: "Navigation" },
  { key: "ArrowDown", action: () => {}, description: "Next task", category: "Navigation" },
  { key: "ArrowUp", action: () => {}, description: "Previous task", category: "Navigation" },
  
  // Focus mode
  { key: " ", action: () => {}, description: "Pause/Resume timer", category: "Focus" },
  { key: "Escape", action: () => {}, description: "Stop timer / Close modal", category: "Focus" },
  
  // Help
  { key: "?", action: () => {}, description: "Show shortcuts", category: "Help" },
];

export function useKeyboardShortcuts(
  customActions: Partial<Record<string, () => void>> = {}
) {
  const router = useRouter();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement).isContentEditable
    ) {
      return;
    }

    const shortcut = shortcuts.find(s => {
      const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();
      const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
      const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
      const altMatch = s.alt ? e.altKey : !e.altKey;
      
      return keyMatch && metaMatch && shiftMatch && altMatch;
    });

    if (shortcut) {
      e.preventDefault();
      
      // Check for custom action override
      const actionKey = `${shortcut.meta ? "meta+" : ""}${shortcut.shift ? "shift+" : ""}${shortcut.key}`;
      if (customActions[actionKey]) {
        customActions[actionKey]();
      } else {
        // Default actions
        switch (shortcut.description) {
          case "Go to Today":
            router.push("/today");
            break;
          case "Go to Lists":
            router.push("/lists");
            break;
          case "Go to Focus":
            router.push("/focus");
            break;
          case "Go to Stats":
            router.push("/stats");
            break;
        }
      }
    }
  }, [router, customActions]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { shortcuts };
}

export function getShortcutsByCategory() {
  const categories: Record<string, ShortcutConfig[]> = {};
  shortcuts.forEach(s => {
    if (!categories[s.category]) categories[s.category] = [];
    categories[s.category].push(s);
  });
  return categories;
}
```

### 5.2 Shortcuts Help Modal

Create `components/ui/shortcuts-modal.tsx`:

```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getShortcutsByCategory } from "@/lib/hooks/use-keyboard-shortcuts";

interface ShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsModal({ open, onOpenChange }: ShortcutsModalProps) {
  const categories = getShortcutsByCategory();

  function formatKey(shortcut: any) {
    const parts = [];
    if (shortcut.meta) parts.push("⌘");
    if (shortcut.shift) parts.push("⇧");
    if (shortcut.alt) parts.push("⌥");
    parts.push(shortcut.key === " " ? "Space" : shortcut.key);
    return parts.join(" ");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {Object.entries(categories).map(([category, shortcuts]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                {category}
              </h3>
              <div className="space-y-1">
                {shortcuts.map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                      {formatKey(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Phase 6: Bulk Actions

### 6.1 Selection State

Create `lib/hooks/use-task-selection.ts`:

```typescript
"use client";

import { create } from "zustand";

interface SelectionState {
  selectedIds: Set<string>;
  selectTask: (id: string) => void;
  deselectTask: (id: string) => void;
  toggleTask: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}

export const useTaskSelection = create<SelectionState>((set, get) => ({
  selectedIds: new Set(),
  
  selectTask: (id) => set(state => ({
    selectedIds: new Set([...state.selectedIds, id])
  })),
  
  deselectTask: (id) => set(state => {
    const newSet = new Set(state.selectedIds);
    newSet.delete(id);
    return { selectedIds: newSet };
  }),
  
  toggleTask: (id) => {
    const { selectedIds, selectTask, deselectTask } = get();
    if (selectedIds.has(id)) {
      deselectTask(id);
    } else {
      selectTask(id);
    }
  },
  
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  
  clearSelection: () => set({ selectedIds: new Set() }),
  
  isSelected: (id) => get().selectedIds.has(id),
}));
```

### 6.2 Bulk Actions Bar

Create `components/tasks/bulk-actions-bar.tsx`:

```typescript
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, FolderOutput, Flag, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTaskSelection } from "@/lib/hooks/use-task-selection";
import { bulkUpdateTasks, bulkDeleteTasks } from "@/app/(dashboard)/actions";
import { toast } from "sonner";
import { TASK_PRIORITIES } from "@/lib/constants";
import type { List } from "@/lib/supabase/types";

interface BulkActionsBarProps {
  lists: Pick<List, "id" | "name">[];
}

export function BulkActionsBar({ lists }: BulkActionsBarProps) {
  const { selectedIds, clearSelection } = useTaskSelection();
  const [isLoading, setIsLoading] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  async function handleBulkUpdate(updates: Record<string, unknown>) {
    setIsLoading(true);
    const result = await bulkUpdateTasks(Array.from(selectedIds), updates);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`Updated ${count} tasks`);
      clearSelection();
    }
    setIsLoading(false);
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${count} tasks? This cannot be undone.`)) return;
    
    setIsLoading(true);
    const result = await bulkDeleteTasks(Array.from(selectedIds));
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`Deleted ${count} tasks`);
      clearSelection();
    }
    setIsLoading(false);
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="flex items-center gap-2 bg-card border shadow-lg rounded-full px-4 py-2">
          <span className="text-sm font-medium">{count} selected</span>
          
          <div className="h-4 w-px bg-border mx-2" />

          {/* Move to list */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={isLoading}>
                <FolderOutput className="h-4 w-4 mr-1" />
                Move
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {lists.map(list => (
                <DropdownMenuItem
                  key={list.id}
                  onClick={() => handleBulkUpdate({ list_id: list.id })}
                >
                  {list.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Set priority */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={isLoading}>
                <Flag className="h-4 w-4 mr-1" />
                Priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {TASK_PRIORITIES.map(priority => (
                <DropdownMenuItem
                  key={priority}
                  onClick={() => handleBulkUpdate({ priority })}
                  className="capitalize"
                >
                  {priority}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Delete */}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleBulkDelete}
            disabled={isLoading}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>

          <div className="h-4 w-px bg-border mx-2" />

          {/* Clear selection */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={clearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

---

## Phase 7: Quick Capture

### 7.1 Quick Capture Modal

Create `components/tasks/quick-capture.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { SmartTaskInput } from "./smart-task-input";

interface QuickCaptureProps {
  defaultListId: string;
}

export function QuickCapture({ defaultListId }: QuickCaptureProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl + N to open quick capture
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl p-0 gap-0">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-semibold">Quick Capture</span>
            <kbd className="ml-auto px-2 py-1 bg-muted rounded text-xs">esc to close</kbd>
          </div>
          <SmartTaskInput
            defaultListId={defaultListId}
            onTaskCreated={() => setOpen(false)}
            placeholder="What do you need to do? (AI will parse dates, priorities...)"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Testing Checklist

### Natural Language Input
- [ ] "Call mom tomorrow" → Sets due date
- [ ] "High priority review PR" → Sets priority
- [ ] "Meeting prep in 30min" → Sets estimate
- [ ] "Add to Work list" → Assigns to list
- [ ] "#urgent" or "tag:urgent" → Creates/adds tag

### Time Estimation
- [ ] Suggests based on similar tasks
- [ ] Accounts for user's accuracy pattern
- [ ] Shows reasoning
- [ ] Can accept or override

### Daily Planning
- [ ] Generates sensible plan
- [ ] Prioritizes overdue tasks
- [ ] Respects user's available time
- [ ] Refresh regenerates plan

### Task Breakdown
- [ ] Generates 3-7 subtasks
- [ ] Subtasks are actionable
- [ ] Can edit before applying
- [ ] Creates actual subtasks

### Keyboard Shortcuts
- [ ] All shortcuts work
- [ ] Don't trigger in inputs
- [ ] Help modal shows all
- [ ] Cmd+1-4 navigation works

### Bulk Actions
- [ ] Multi-select with Shift+click
- [ ] Select all with Cmd+A
- [ ] Move to list
- [ ] Set priority
- [ ] Bulk delete

### Quick Capture
- [ ] Cmd+N opens modal
- [ ] AI parsing works
- [ ] Escape closes
- [ ] Creates task correctly

---

## Files Summary

**New Files:**
- `lib/ai/client.ts`
- `lib/ai/parse-task.ts`
- `lib/ai/estimate-time.ts`
- `lib/ai/daily-planner.ts`
- `lib/ai/break-down-task.ts`
- `components/tasks/smart-task-input.tsx`
- `components/ai/daily-plan.tsx`
- `components/ai/task-breakdown-modal.tsx`
- `components/ui/shortcuts-modal.tsx`
- `components/tasks/bulk-actions-bar.tsx`
- `components/tasks/quick-capture.tsx`
- `lib/hooks/use-keyboard-shortcuts.ts`
- `lib/hooks/use-task-selection.ts`

**Modified Files:**
- `app/(dashboard)/actions.ts`
- `app/(dashboard)/today/page.tsx`
- `components/tasks/task-form.tsx`
- `components/tasks/task-item.tsx`
- `app/layout.tsx` (add QuickCapture)

**New Dependencies:**
- `@anthropic-ai/sdk`

**Environment Variables:**
- `ANTHROPIC_API_KEY`

---

**Ready to implement. AI makes Zeroed smarter!** 🧠

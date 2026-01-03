# Zeroed Sprint 5 — PWA, Offline, Mobile & Templates

## Overview

This sprint focuses on mobile experience and reusability:
1. **Progressive Web App** — Installable, app-like experience
2. **Offline Support** — Work without internet, sync when back
3. **Push Notifications** — Reminders and updates
4. **Mobile Optimizations** — Touch gestures, responsive layouts
5. **Task Templates** — Save and reuse common task structures
6. **Project Templates** — Pre-built list + task combinations

---

## Phase 0: PWA Setup

### 0.1 Install Dependencies

```bash
npm install next-pwa workbox-webpack-plugin
npm install -D @types/serviceworker
```

### 0.2 Next.js Config

Update `next.config.js`:

```javascript
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "supabase-cache",
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60 * 60 * 24, // 24 hours
        },
      },
    },
    {
      urlPattern: /\/_next\/static\/.*/,
      handler: "CacheFirst",
      options: {
        cacheName: "static-cache",
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
        },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... existing config
};

module.exports = withPWA(nextConfig);
```

### 0.3 Web App Manifest

Create `public/manifest.json`:

```json
{
  "name": "Zeroed",
  "short_name": "Zeroed",
  "description": "Zero your tasks. Focus on what matters.",
  "start_url": "/today",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#6366f1",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-72.png",
      "sizes": "72x72",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "shortcuts": [
    {
      "name": "Add Task",
      "short_name": "Add",
      "url": "/today?action=new",
      "icons": [{ "src": "/icons/add-task.png", "sizes": "96x96" }]
    },
    {
      "name": "Start Focus",
      "short_name": "Focus",
      "url": "/focus",
      "icons": [{ "src": "/icons/focus.png", "sizes": "96x96" }]
    }
  ],
  "categories": ["productivity", "utilities"]
}
```

### 0.4 Add Meta Tags

Update `app/layout.tsx`:

```typescript
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Zeroed",
  description: "Zero your tasks. Focus on what matters.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zeroed",
  },
};
```

---

## Phase 1: Offline Support

### 1.1 Offline Store with IndexedDB

Install: `npm install idb`

Create `lib/offline/store.ts`:

```typescript
import { openDB, DBSchema, IDBPDatabase } from "idb";

interface ZeroedDB extends DBSchema {
  tasks: {
    key: string;
    value: { id: string; data: any; updatedAt: number };
    indexes: { "by-updated": number };
  };
  lists: {
    key: string;
    value: { id: string; data: any; updatedAt: number };
  };
  pendingActions: {
    key: string;
    value: {
      id: string;
      action: "create" | "update" | "delete";
      table: string;
      recordId?: string;
      payload: any;
      createdAt: number;
    };
    indexes: { "by-created": number };
  };
}

let db: IDBPDatabase<ZeroedDB> | null = null;

export async function getDB() {
  if (db) return db;

  db = await openDB<ZeroedDB>("zeroed-offline", 1, {
    upgrade(db) {
      const tasksStore = db.createObjectStore("tasks", { keyPath: "id" });
      tasksStore.createIndex("by-updated", "updatedAt");
      db.createObjectStore("lists", { keyPath: "id" });
      const actionsStore = db.createObjectStore("pendingActions", { keyPath: "id" });
      actionsStore.createIndex("by-created", "createdAt");
    },
  });

  return db;
}

export async function cacheTasks(tasks: any[]) {
  const db = await getDB();
  const tx = db.transaction("tasks", "readwrite");
  for (const task of tasks) {
    await tx.store.put({ id: task.id, data: task, updatedAt: Date.now() });
  }
  await tx.done;
}

export async function getCachedTasks() {
  const db = await getDB();
  const records = await db.getAll("tasks");
  return records.map(r => r.data);
}

export async function queueAction(
  action: "create" | "update" | "delete",
  table: string,
  payload: any,
  recordId?: string
) {
  const db = await getDB();
  await db.add("pendingActions", {
    id: crypto.randomUUID(),
    action,
    table,
    recordId,
    payload,
    createdAt: Date.now(),
  });
}

export async function getPendingActions() {
  const db = await getDB();
  return db.getAllFromIndex("pendingActions", "by-created");
}

export async function clearPendingAction(id: string) {
  const db = await getDB();
  await db.delete("pendingActions", id);
}
```

### 1.2 Sync Manager

Create `lib/offline/sync.ts`:

```typescript
import { createClient } from "@/lib/supabase/client";
import { getPendingActions, clearPendingAction, cacheTasks } from "./store";

export async function syncPendingActions() {
  const supabase = createClient();
  const pendingActions = await getPendingActions();

  for (const action of pendingActions) {
    try {
      switch (action.action) {
        case "create":
          await supabase.from(action.table).insert(action.payload);
          break;
        case "update":
          await supabase.from(action.table).update(action.payload).eq("id", action.recordId);
          break;
        case "delete":
          await supabase.from(action.table).delete().eq("id", action.recordId);
          break;
      }
      await clearPendingAction(action.id);
    } catch (error) {
      console.error("Sync failed:", action.id, error);
    }
  }
}

export async function syncFromServer(userId: string) {
  const supabase = createClient();
  const { data: tasks } = await supabase
    .from("zeroed_tasks")
    .select("*, zeroed_lists(name, color)")
    .eq("user_id", userId);
  
  if (tasks) await cacheTasks(tasks);
}

export async function fullSync(userId: string) {
  await syncPendingActions();
  await syncFromServer(userId);
}
```

### 1.3 Offline-Aware Hook

Create `lib/hooks/use-offline-tasks.ts`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCachedTasks, cacheTasks, queueAction } from "@/lib/offline/store";
import { syncPendingActions } from "@/lib/offline/sync";

export function useOfflineTasks(userId: string) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const loadTasks = useCallback(async () => {
    if (navigator.onLine) {
      const supabase = createClient();
      const { data } = await supabase
        .from("zeroed_tasks")
        .select("*, zeroed_lists(name, color)")
        .eq("user_id", userId);
      if (data) {
        setTasks(data);
        await cacheTasks(data);
      }
    } else {
      const cached = await getCachedTasks();
      setTasks(cached);
    }
  }, [userId]);

  const createTask = useCallback(async (taskData: any) => {
    const tempId = crypto.randomUUID();
    const newTask = { id: tempId, user_id: userId, ...taskData };
    
    setTasks(prev => [newTask, ...prev]);

    if (navigator.onLine) {
      const supabase = createClient();
      const { data } = await supabase.from("zeroed_tasks").insert(taskData).select().single();
      if (data) setTasks(prev => prev.map(t => t.id === tempId ? data : t));
    } else {
      await queueAction("create", "zeroed_tasks", taskData);
      setPendingCount(prev => prev + 1);
    }
  }, [userId]);

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); syncPendingActions().then(loadTasks); };
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadTasks]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  return { tasks, isOnline, pendingCount, createTask, refresh: loadTasks };
}
```

### 1.4 Offline Indicator

Create `components/ui/offline-indicator.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { WifiOff, Cloud } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function OfflineIndicator({ pendingCount = 0 }: { pendingCount?: number }) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ y: -50 }}
          animate={{ y: 0 }}
          exit={{ y: -50 }}
          className="fixed top-0 left-0 right-0 z-50 bg-warning text-warning-foreground px-4 py-2 flex items-center justify-center gap-2"
        >
          <WifiOff className="h-4 w-4" />
          <span className="text-sm font-medium">
            Offline mode • {pendingCount} changes pending
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

---

## Phase 2: Push Notifications

### 2.1 Service Worker

Create `public/sw-push.js`:

```javascript
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  self.registration.showNotification(data.title || "Zeroed", {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    data: data.data || {},
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/today"));
});
```

### 2.2 Notification Manager

Create `lib/notifications/manager.ts`:

```typescript
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export function sendLocalNotification(title: string, options: NotificationOptions = {}) {
  if (Notification.permission === "granted") {
    new Notification(title, { icon: "/icons/icon-192.png", ...options });
  }
}
```

---

## Phase 3: Mobile Optimizations

### 3.1 Swipe Actions Hook

Create `lib/hooks/use-swipe-actions.ts`:

```typescript
"use client";

import { useRef, useState } from "react";

export function useSwipeActions({ onSwipeLeft, onSwipeRight, threshold = 100 }: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
}) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);

  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.touches[0].clientX;
      setIsDragging(true);
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!isDragging) return;
      setOffset((e.touches[0].clientX - startX.current) * 0.5);
    },
    onTouchEnd: () => {
      setIsDragging(false);
      if (offset > threshold && onSwipeRight) onSwipeRight();
      else if (offset < -threshold && onSwipeLeft) onSwipeLeft();
      setOffset(0);
    },
  };

  return { offset, isDragging, handlers };
}
```

### 3.2 Swipeable Task

Create `components/tasks/swipeable-task.tsx`:

```typescript
"use client";

import { Check, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useSwipeActions } from "@/lib/hooks/use-swipe-actions";
import { TaskItem } from "./task-item";
import { completeTask, deleteTask } from "@/app/(dashboard)/actions";

export function SwipeableTask({ task, lists }: { task: any; lists: any[] }) {
  const { offset, isDragging, handlers } = useSwipeActions({
    onSwipeRight: () => completeTask(task.id),
    onSwipeLeft: () => confirm("Delete?") && deleteTask(task.id),
    threshold: 80,
  });

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 flex items-center px-4 bg-green-500 text-white"
        style={{ width: Math.max(0, offset), opacity: offset > 0 ? 1 : 0 }}>
        <Check className="h-5 w-5" />
      </div>
      <div className="absolute inset-y-0 right-0 flex items-center px-4 bg-destructive text-white"
        style={{ width: Math.max(0, -offset), opacity: offset < 0 ? 1 : 0 }}>
        <Trash2 className="h-5 w-5" />
      </div>
      <motion.div {...handlers} animate={{ x: isDragging ? offset : 0 }} className="bg-card">
        <TaskItem task={task} lists={lists} />
      </motion.div>
    </div>
  );
}
```

### 3.3 Bottom Navigation

Create `components/mobile/bottom-nav.tsx`:

```typescript
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, List, Target, BarChart3, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/today", label: "Today", icon: Home },
  { href: "/lists", label: "Lists", icon: List },
  { href: "/focus", label: "Focus", icon: Target },
  { href: "/stats", label: "Stats", icon: BarChart3 },
];

export function BottomNav({ onAddClick }: { onAddClick: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t md:hidden pb-safe">
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.slice(0, 2).map((item) => (
          <Link key={item.href} href={item.href}
            className={cn("flex flex-col items-center gap-1 px-4 py-2",
              pathname.startsWith(item.href) ? "text-primary" : "text-muted-foreground")}>
            <item.icon className="h-5 w-5" />
            <span className="text-xs">{item.label}</span>
          </Link>
        ))}
        <Button size="icon" className="h-14 w-14 rounded-full shadow-lg -mt-6" onClick={onAddClick}>
          <Plus className="h-6 w-6" />
        </Button>
        {navItems.slice(2).map((item) => (
          <Link key={item.href} href={item.href}
            className={cn("flex flex-col items-center gap-1 px-4 py-2",
              pathname.startsWith(item.href) ? "text-primary" : "text-muted-foreground")}>
            <item.icon className="h-5 w-5" />
            <span className="text-xs">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

---

## Phase 4: Task Templates

### 4.1 Database Schema

```sql
create table if not exists zeroed_task_templates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  icon text default 'file-text',
  is_public boolean default false,
  use_count integer default 0,
  task_data jsonb not null,
  subtasks jsonb,
  tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table zeroed_task_templates enable row level security;

create policy "Users can CRUD own templates" on zeroed_task_templates
  for all using (auth.uid() = user_id or is_public = true);
```

### 4.2 Server Actions

```typescript
export async function createTaskFromTemplate(templateId: string, listId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: template } = await supabase
    .from("zeroed_task_templates").select("*").eq("id", templateId).single();
  if (!template) return { error: "Template not found" };

  const { data: task, error } = await supabase
    .from("zeroed_tasks")
    .insert({ user_id: user.id, list_id: listId, ...template.task_data })
    .select().single();
  if (error) return { error: error.message };

  // Create subtasks
  if (template.subtasks?.length) {
    const subtasks = template.subtasks.map((st: any, i: number) => ({
      user_id: user.id, list_id: listId, parent_id: task.id, is_subtask: true,
      title: st.title, estimated_minutes: st.estimated_minutes, position: i,
    }));
    await supabase.from("zeroed_tasks").insert(subtasks);
  }

  await supabase.from("zeroed_task_templates")
    .update({ use_count: template.use_count + 1 }).eq("id", templateId);

  revalidatePath("/");
  return { success: true, task };
}

export async function saveTaskAsTemplate(taskId: string, name: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: task } = await supabase
    .from("zeroed_tasks")
    .select("*, subtasks:zeroed_tasks!parent_id(title, estimated_minutes)")
    .eq("id", taskId).eq("user_id", user.id).single();
  if (!task) return { error: "Task not found" };

  const { data: template, error } = await supabase
    .from("zeroed_task_templates")
    .insert({
      user_id: user.id, name,
      task_data: { title: task.title, notes: task.notes, priority: task.priority, estimated_minutes: task.estimated_minutes },
      subtasks: task.subtasks?.map((st: any) => ({ title: st.title, estimated_minutes: st.estimated_minutes })),
    })
    .select().single();

  if (error) return { error: error.message };
  return { success: true, template };
}
```

---

## Phase 5: Project Templates

### 5.1 Database Schema

```sql
create table if not exists zeroed_project_templates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text,
  icon text default 'folder',
  color text default '#6366f1',
  category text,
  is_public boolean default false,
  use_count integer default 0,
  list_data jsonb not null,
  tasks jsonb not null,
  created_at timestamptz default now()
);

alter table zeroed_project_templates enable row level security;

create policy "Users can CRUD project templates" on zeroed_project_templates
  for all using (auth.uid() = user_id or is_public = true);

-- Seed public templates
insert into zeroed_project_templates (user_id, name, description, icon, category, is_public, list_data, tasks) values
(null, 'Weekly Review', 'End-of-week reflection', 'calendar', 'productivity', true,
  '{"name": "Weekly Review", "color": "#6366f1"}',
  '[{"title": "Review completed tasks", "estimated_minutes": 15},
    {"title": "Plan next week", "estimated_minutes": 15}]'),
(null, 'Blog Post', 'Complete blog workflow', 'pen-tool', 'content', true,
  '{"name": "Blog Post", "color": "#10b981"}',
  '[{"title": "Research topic", "estimated_minutes": 30},
    {"title": "Write draft", "estimated_minutes": 60},
    {"title": "Edit and publish", "estimated_minutes": 30}]');
```

### 5.2 Server Actions

```typescript
export async function createProjectFromTemplate(templateId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: template } = await supabase
    .from("zeroed_project_templates").select("*").eq("id", templateId).single();
  if (!template) return { error: "Template not found" };

  const { data: list, error: listError } = await supabase
    .from("zeroed_lists")
    .insert({ user_id: user.id, ...template.list_data })
    .select().single();
  if (listError) return { error: listError.message };

  for (let i = 0; i < template.tasks.length; i++) {
    const t = template.tasks[i];
    await supabase.from("zeroed_tasks").insert({
      user_id: user.id, list_id: list.id, title: t.title,
      estimated_minutes: t.estimated_minutes || 25, priority: t.priority || "normal", position: i,
    });
  }

  await supabase.from("zeroed_project_templates")
    .update({ use_count: template.use_count + 1 }).eq("id", templateId);

  revalidatePath("/lists");
  return { success: true, list };
}
```

---

## Testing Checklist

### PWA
- [ ] Installable on mobile & desktop
- [ ] Icons and splash screen
- [ ] App shortcuts work

### Offline
- [ ] Tasks load from cache offline
- [ ] Create/edit tasks offline
- [ ] Sync when back online
- [ ] Pending indicator shows

### Notifications
- [ ] Permission request works
- [ ] Local notifications fire

### Mobile
- [ ] Swipe gestures work
- [ ] Bottom nav functional
- [ ] Safe areas respected

### Templates
- [ ] Create from template
- [ ] Save task as template
- [ ] Project templates gallery
- [ ] Public templates visible

---

## Dependencies

```bash
npm install next-pwa workbox-webpack-plugin idb
```

---

**Ready to implement. Make Zeroed work anywhere!** 📱

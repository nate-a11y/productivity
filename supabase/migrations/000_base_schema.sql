-- ============================================================================
-- ZEROED BASE SCHEMA
-- Core tables required before sprint migrations
-- ============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================================
-- LISTS
-- ============================================================================

create table if not exists zeroed_lists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  color text default '#6366f1',
  icon text default 'list',
  position integer default 0,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- TASKS
-- ============================================================================

create table if not exists zeroed_tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  list_id uuid references zeroed_lists(id) on delete cascade not null,
  title text not null,
  notes text,
  estimated_minutes integer default 25,
  actual_minutes integer default 0,
  status text default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  priority text default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  due_time time,
  position integer default 0,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- FOCUS SESSIONS
-- ============================================================================

create table if not exists zeroed_focus_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references zeroed_tasks(id) on delete set null,
  duration_minutes integer not null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  completed boolean default false,
  session_type text default 'focus' check (session_type in ('focus', 'short_break', 'long_break')),
  created_at timestamptz default now()
);

-- ============================================================================
-- USER PREFERENCES
-- ============================================================================

create table if not exists zeroed_user_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  theme text default 'dark' check (theme in ('dark', 'light', 'system')),
  default_focus_minutes integer default 25,
  short_break_minutes integer default 5,
  long_break_minutes integer default 15,
  sessions_before_long_break integer default 4,
  sound_enabled boolean default true,
  notifications_enabled boolean default false,
  streak_current integer default 0,
  streak_best integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- DAILY STATS
-- ============================================================================

create table if not exists zeroed_daily_stats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  tasks_completed integer default 0,
  tasks_created integer default 0,
  focus_minutes integer default 0,
  sessions_completed integer default 0,
  estimated_minutes integer default 0,
  actual_minutes integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)
);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

alter table zeroed_lists enable row level security;
alter table zeroed_tasks enable row level security;
alter table zeroed_focus_sessions enable row level security;
alter table zeroed_user_preferences enable row level security;
alter table zeroed_daily_stats enable row level security;

-- Users can only access their own data
drop policy if exists "Users can CRUD own lists" on zeroed_lists;
create policy "Users can CRUD own lists" on zeroed_lists
  for all using (auth.uid() = user_id);

drop policy if exists "Users can CRUD own tasks" on zeroed_tasks;
create policy "Users can CRUD own tasks" on zeroed_tasks
  for all using (auth.uid() = user_id);

drop policy if exists "Users can CRUD own focus sessions" on zeroed_focus_sessions;
create policy "Users can CRUD own focus sessions" on zeroed_focus_sessions
  for all using (auth.uid() = user_id);

drop policy if exists "Users can CRUD own preferences" on zeroed_user_preferences;
create policy "Users can CRUD own preferences" on zeroed_user_preferences
  for all using (auth.uid() = user_id);

drop policy if exists "Users can CRUD own daily stats" on zeroed_daily_stats;
create policy "Users can CRUD own daily stats" on zeroed_daily_stats
  for all using (auth.uid() = user_id);

-- ============================================================================
-- INDEXES
-- ============================================================================

create index if not exists zeroed_tasks_user_id_idx on zeroed_tasks(user_id);
create index if not exists zeroed_tasks_list_id_idx on zeroed_tasks(list_id);
create index if not exists zeroed_tasks_status_idx on zeroed_tasks(status);
create index if not exists zeroed_tasks_due_date_idx on zeroed_tasks(due_date);
create index if not exists zeroed_focus_sessions_user_id_idx on zeroed_focus_sessions(user_id);
create index if not exists zeroed_daily_stats_user_date_idx on zeroed_daily_stats(user_id, date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at trigger function
create or replace function zeroed_handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply updated_at triggers
drop trigger if exists zeroed_lists_updated_at on zeroed_lists;
create trigger zeroed_lists_updated_at before update on zeroed_lists
  for each row execute function zeroed_handle_updated_at();

drop trigger if exists zeroed_tasks_updated_at on zeroed_tasks;
create trigger zeroed_tasks_updated_at before update on zeroed_tasks
  for each row execute function zeroed_handle_updated_at();

drop trigger if exists zeroed_user_preferences_updated_at on zeroed_user_preferences;
create trigger zeroed_user_preferences_updated_at before update on zeroed_user_preferences
  for each row execute function zeroed_handle_updated_at();

drop trigger if exists zeroed_daily_stats_updated_at on zeroed_daily_stats;
create trigger zeroed_daily_stats_updated_at before update on zeroed_daily_stats
  for each row execute function zeroed_handle_updated_at();

-- ============================================================================
-- HELPER: Auto-create user preferences on signup
-- ============================================================================

create or replace function zeroed_handle_new_user()
returns trigger as $$
begin
  insert into public.zeroed_user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger on auth.users (requires superuser/service role)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function zeroed_handle_new_user();

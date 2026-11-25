-- AnimeStream Supabase Schema
-- Run this entire script once inside your Supabase SQL Editor.
-- Also go to: Authentication -> Providers -> Email -> turn OFF "Confirm email" for instant registration.

create extension if not exists pgcrypto;

-- 1. Public user profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  banner_url text,
  frame text,
  bio text default '',
  name_style jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists name_style jsonb;

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles enable row level security;

drop policy if exists "Public profiles are readable" on public.profiles;
create policy "Public profiles are readable"
  on public.profiles for select using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- 2. Cloud user sync (history, watchlist, custom lists, reading, watched progress, prefs)
create table if not exists public.user_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  history jsonb not null default '[]'::jsonb,
  watchlist jsonb not null default '[]'::jsonb,
  custom_lists jsonb not null default '[]'::jsonb,
  reading jsonb not null default '[]'::jsonb,
  watched_eps jsonb not null default '{}'::jsonb,
  watched_movies jsonb not null default '{}'::jsonb,
  prefs jsonb not null default '{}'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_sync add column if not exists watched_eps jsonb not null default '{}'::jsonb;
alter table public.user_sync add column if not exists watched_movies jsonb not null default '{}'::jsonb;
alter table public.user_sync add column if not exists prefs jsonb not null default '{}'::jsonb;

alter table public.user_sync enable row level security;

drop policy if exists "Users can view own sync" on public.user_sync;
create policy "Users can view own sync"
  on public.user_sync for select using (auth.uid() = user_id or true);

drop policy if exists "Users can upsert own sync" on public.user_sync;
create policy "Users can upsert own sync"
  on public.user_sync for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own sync" on public.user_sync;
create policy "Users can update own sync"
  on public.user_sync for update using (auth.uid() = user_id);

-- 3. Community posts
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  username text not null default 'Otaku',
  avatar_url text,
  frame text,
  title text not null,
  content text not null,
  category text not null default 'General',
  anime_title text,
  anime_id text,
  anime_image text,
  likes integer not null default 0,
  pinned boolean not null default false,
  edited boolean not null default false
);

alter table public.community_posts enable row level security;

drop policy if exists "Community posts are readable" on public.community_posts;
create policy "Community posts are readable"
  on public.community_posts for select using (true);

drop policy if exists "Authenticated users can create posts" on public.community_posts;
create policy "Authenticated users can create posts"
  on public.community_posts for insert with check (auth.uid() = user_id);

drop policy if exists "Authors can update own posts" on public.community_posts;
create policy "Authors can update own posts"
  on public.community_posts for update using (auth.uid() = user_id);

drop policy if exists "Authors can delete own posts" on public.community_posts;
create policy "Authors can delete own posts"
  on public.community_posts for delete using (auth.uid() = user_id);

create or replace function public.like_community_post(target_post_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  new_likes integer;
begin
  update public.community_posts
  set likes = likes + 1
  where id = target_post_id
  returning likes into new_likes;
  return coalesce(new_likes, 0);
end;
$$;

-- 4. Direct messages
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.direct_messages enable row level security;

drop policy if exists "Users can view own DMs" on public.direct_messages;
create policy "Users can view own DMs"
  on public.direct_messages for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Users can send DMs" on public.direct_messages;
create policy "Users can send DMs"
  on public.direct_messages for insert with check (auth.uid() = sender_id);

drop policy if exists "Users can update own DMs" on public.direct_messages;
create policy "Users can update own DMs"
  on public.direct_messages for update using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Users can delete own DMs" on public.direct_messages;
create policy "Users can delete own DMs"
  on public.direct_messages for delete using (auth.uid() = sender_id);

-- 5. Watch rooms
create table if not exists public.watch_rooms (
  id text primary key,
  host_id text not null,
  host_username text,
  host_display_name text,
  host_avatar text,
  anime_id integer not null,
  anime_title text not null,
  episode integer not null default 1,
  server text not null default 'flixcloud',
  audio text not null default 'sub',
  host_only_control boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.watch_rooms enable row level security;

drop policy if exists "Watch rooms public read/write for members" on public.watch_rooms;
create policy "Watch rooms public read/write for members"
  on public.watch_rooms for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 6. Audio/voice call signaling sessions
create table if not exists public.call_sessions (
  call_id text primary key,
  caller_id uuid references auth.users(id) on delete cascade,
  callee_id uuid references auth.users(id) on delete cascade,
  status text not null default 'ringing',
  offer jsonb,
  answer jsonb,
  caller_candidates jsonb not null default '[]'::jsonb,
  callee_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.call_sessions enable row level security;

drop policy if exists "Participants can manage call sessions" on public.call_sessions;
create policy "Participants can manage call sessions"
  on public.call_sessions for all
  using (auth.uid() = caller_id or auth.uid() = callee_id)
  with check (auth.uid() = caller_id or auth.uid() = callee_id);

create or replace function public.append_call_candidate(p_call_id text, p_is_caller boolean, p_candidate jsonb)
returns void
language plpgsql
security definer
as $$
begin
  if p_is_caller then
    update public.call_sessions
    set caller_candidates = coalesce(caller_candidates, '[]'::jsonb) || jsonb_build_array(p_candidate),
        updated_at = now()
    where call_id = p_call_id;
  else
    update public.call_sessions
    set callee_candidates = coalesce(callee_candidates, '[]'::jsonb) || jsonb_build_array(p_candidate),
        updated_at = now()
    where call_id = p_call_id;
  end if;
end;
$$;

-- 7. Stream reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  anime_id text,
  anime_title text not null,
  episode text not null,
  server text,
  audio_type text,
  issue_type text not null,
  details text,
  playback_time text,
  status text not null default 'pending',
  user_agent text
);

alter table public.reports enable row level security;

drop policy if exists "Authenticated users can submit reports" on public.reports;
create policy "Authenticated users can submit reports"
  on public.reports for insert with check (true);

-- 8. Support missions progress & supporter stats
create table if not exists public.supporter_records (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_count integer not null default 0,
  total_links_solved integer not null default 0,
  total_xp integer not null default 0,
  active_mission jsonb,
  claimed_tokens jsonb not null default '[]'::jsonb,
  last_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.supporter_records enable row level security;

drop policy if exists "Users can view own supporter record" on public.supporter_records;
create policy "Users can view own supporter record"
  on public.supporter_records for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own supporter record" on public.supporter_records;
create policy "Users can insert own supporter record"
  on public.supporter_records for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own supporter record" on public.supporter_records;
create policy "Users can update own supporter record"
  on public.supporter_records for update using (auth.uid() = user_id);


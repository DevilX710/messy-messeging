-- Run this in Supabase SQL Editor.
create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  is_online boolean default false,
  last_seen timestamptz,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  receiver_id uuid not null references profiles(id) on delete cascade,
  content text default '',
  message_type text not null default 'text' check (message_type in ('text','image','audio')),
  file_url text,
  seen_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reaction text not null,
  unique(message_id,user_id)
);

alter table profiles enable row level security;
alter table messages enable row level security;
alter table reactions enable row level security;

create policy "profiles readable" on profiles for select to authenticated using (true);
create policy "own profile insert" on profiles for insert to authenticated with check (id=auth.uid());
create policy "own profile update" on profiles for update to authenticated using (id=auth.uid());

create policy "messages readable by participants" on messages for select to authenticated
using (sender_id=auth.uid() or receiver_id=auth.uid());
create policy "send own messages" on messages for insert to authenticated
with check (sender_id=auth.uid());
create policy "delete own messages" on messages for delete to authenticated
using (sender_id=auth.uid());
create policy "mark received messages seen" on messages for update to authenticated
using (receiver_id=auth.uid())
with check (receiver_id=auth.uid());

create policy "reactions readable" on reactions for select to authenticated using (true);
create policy "own reactions" on reactions for insert to authenticated with check (user_id=auth.uid());
create policy "delete own reactions" on reactions for delete to authenticated using (user_id=auth.uid());

-- Storage:
-- Create a bucket named "chat-media" in Storage and make it public.
-- Then add storage policies if your project requires them.
-- For production, tighten these policies and use private buckets/signed URLs.

-- Realtime:
-- In Supabase Dashboard → Database → Replication, enable realtime for:
-- messages, profiles, reactions.

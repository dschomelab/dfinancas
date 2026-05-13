
-- =========== profiles ===========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles select all" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);

-- trigger to create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========== groups ===========
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);
alter table public.group_members enable row level security;

-- security definer helper to avoid recursive RLS
create or replace function public.is_group_member(_group_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = _group_id and user_id = _user_id
  );
$$;

create policy "groups select member" on public.groups for select using (
  owner_id = auth.uid() or public.is_group_member(id, auth.uid())
);
create policy "groups insert own" on public.groups for insert with check (owner_id = auth.uid());
create policy "groups update owner" on public.groups for update using (owner_id = auth.uid());
create policy "groups delete owner" on public.groups for delete using (owner_id = auth.uid());

create policy "gm select self or member" on public.group_members for select using (
  user_id = auth.uid() or public.is_group_member(group_id, auth.uid())
);
create policy "gm insert by owner" on public.group_members for insert with check (
  exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  or user_id = auth.uid()
);
create policy "gm delete by owner or self" on public.group_members for delete using (
  user_id = auth.uid()
  or exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
);

-- =========== categories ===========
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('expense','income')),
  color text not null default '#3b6fa0',
  icon text not null default 'Tag',
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
create policy "cat select own" on public.categories for select using (user_id = auth.uid());
create policy "cat insert own" on public.categories for insert with check (user_id = auth.uid());
create policy "cat update own" on public.categories for update using (user_id = auth.uid());
create policy "cat delete own" on public.categories for delete using (user_id = auth.uid());

-- =========== transactions ===========
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  type text not null check (type in ('expense','income')),
  occurred_on date not null,
  competence text not null, -- 'YYYY-MM'
  description text not null,
  source text,
  amount numeric(14,2) not null,
  category_id uuid references public.categories(id) on delete set null,
  is_shared boolean not null default false,
  notes text,
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.transactions enable row level security;

create policy "tx select own or group" on public.transactions for select using (
  user_id = auth.uid()
  or (group_id is not null and public.is_group_member(group_id, auth.uid()))
);
create policy "tx insert own" on public.transactions for insert with check (user_id = auth.uid());
create policy "tx update own" on public.transactions for update using (user_id = auth.uid());
create policy "tx delete own" on public.transactions for delete using (user_id = auth.uid());

create index idx_tx_user_competence on public.transactions(user_id, competence);
create index idx_tx_group on public.transactions(group_id);
create index idx_tx_category on public.transactions(category_id);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger trg_tx_updated before update on public.transactions for each row execute procedure public.set_updated_at();
create trigger trg_profiles_updated before update on public.profiles for each row execute procedure public.set_updated_at();

-- =========== file_imports ===========
create table public.file_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  filename text not null,
  source text,
  file_type text not null,
  default_type text not null check (default_type in ('expense','income')),
  total_rows int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.file_imports enable row level security;
create policy "fi select own" on public.file_imports for select using (user_id = auth.uid());
create policy "fi insert own" on public.file_imports for insert with check (user_id = auth.uid());
create policy "fi delete own" on public.file_imports for delete using (user_id = auth.uid());

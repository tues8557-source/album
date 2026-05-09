create extension if not exists pgcrypto;

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no between 1 and 7),
  name text not null check (char_length(trim(name)) > 0),
  gender text check (gender is null or gender in ('male', 'female')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.students
  add column if not exists class_no integer,
  add column if not exists gender text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'class_id'
      and data_type in ('integer', 'smallint', 'bigint')
  ) then
    update public.students
    set class_no = class_id
    where class_no is null;
  end if;
end $$;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no between 1 and 7),
  sort_order integer not null default 0,
  password_hash text,
  access_nonce uuid not null default gen_random_uuid(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.groups
  add column if not exists class_no integer,
  add column if not exists sort_order integer not null default 0,
  add column if not exists password_hash text,
  add column if not exists access_nonce uuid default gen_random_uuid(),
  add column if not exists deleted_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'groups'
      and column_name = 'class_id'
      and data_type in ('integer', 'smallint', 'bigint')
  ) then
    update public.groups
    set class_no = class_id
    where class_no is null;
  end if;
end $$;

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, student_id)
);

alter table public.group_members
  add column if not exists group_id uuid,
  add column if not exists student_id uuid,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  storage_path text not null unique,
  original_name text,
  mime_type text,
  size bigint,
  is_favorite boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.photos
  add column if not exists group_id uuid,
  add column if not exists storage_path text,
  add column if not exists original_name text,
  add column if not exists mime_type text,
  add column if not exists size bigint,
  add column if not exists is_favorite boolean default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.photos
set is_favorite = false
where is_favorite is null;

alter table public.photos
  alter column is_favorite set default false,
  alter column is_favorite set not null;

alter table public.students
  drop constraint if exists students_class_no_check,
  add constraint students_class_no_check check (class_no between 1 and 7);

alter table public.students
  alter column gender drop not null;

alter table public.students
  drop constraint if exists students_gender_check,
  add constraint students_gender_check check (gender is null or gender in ('male', 'female'));

alter table public.groups
  drop constraint if exists groups_class_no_check,
  add constraint groups_class_no_check check (class_no between 1 and 7);

update public.groups
set access_nonce = gen_random_uuid()
where access_nonce is null;

alter table public.groups
  alter column access_nonce set default gen_random_uuid(),
  alter column access_nonce set not null;

create index if not exists students_class_sort_idx on public.students(class_no, sort_order);
create index if not exists groups_class_sort_active_idx on public.groups(class_no, sort_order)
  where deleted_at is null;
create index if not exists group_members_group_idx on public.group_members(group_id);
create index if not exists photos_group_active_idx on public.photos(group_id, created_at)
  where deleted_at is null;
create index if not exists photos_group_deleted_idx on public.photos(group_id, deleted_at)
  where deleted_at is not null;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_updated_at();

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
before update on public.groups
for each row execute function public.set_updated_at();

drop trigger if exists photos_set_updated_at on public.photos;
create trigger photos_set_updated_at
before update on public.photos
for each row execute function public.set_updated_at();

alter table public.students enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.photos enable row level security;

insert into storage.buckets (id, name, public)
values ('group-photos', 'group-photos', false)
on conflict (id) do nothing;

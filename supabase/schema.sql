create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  class_count integer not null default 7 check (class_count >= 1),
  active_home_id uuid,
  home_title_line1 text not null default '매안초 졸업앨범 촬영 준비',
  home_title_line2 text not null default '학교배경 컨셉사진',
  home_title_rows jsonb not null default '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}]'::jsonb,
  home_title_selected_index integer not null default 0,
  home_packages jsonb not null default '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진","rows":[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}],"selectedIndex":0}]'::jsonb,
  active_home_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings
  add column if not exists id boolean default true,
  add column if not exists class_count integer not null default 7,
  add column if not exists active_home_id uuid,
  add column if not exists home_title_line1 text not null default '매안초 졸업앨범 촬영 준비',
  add column if not exists home_title_line2 text not null default '학교배경 컨셉사진',
  add column if not exists home_title_rows jsonb not null default '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}]'::jsonb,
  add column if not exists home_title_selected_index integer not null default 0,
  add column if not exists home_packages jsonb not null default '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진","rows":[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}],"selectedIndex":0}]'::jsonb,
  add column if not exists active_home_index integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.app_settings
set id = true
where id is distinct from true;

update public.app_settings
set class_count = 7
where class_count is null;

update public.app_settings
set home_title_line1 = '매안초 졸업앨범 촬영 준비'
where home_title_line1 is null;

update public.app_settings
set home_title_line2 = '학교배경 컨셉사진'
where home_title_line2 is null;

update public.app_settings
set home_title_rows = jsonb_build_array(
  jsonb_build_object('line1', coalesce(home_title_line1, ''), 'line2', coalesce(home_title_line2, ''))
)
where home_title_rows is null;

update public.app_settings
set home_title_selected_index = 0
where home_title_selected_index is null;

update public.app_settings
set home_packages = jsonb_build_array(
  jsonb_build_object(
    'line1',
    coalesce(home_title_line1, ''),
    'line2',
    coalesce(home_title_line2, ''),
    'rows',
    coalesce(
      home_title_rows,
      jsonb_build_array(jsonb_build_object('line1', coalesce(home_title_line1, ''), 'line2', coalesce(home_title_line2, '')))
    ),
    'selectedIndex',
    coalesce(home_title_selected_index, 0)
  )
)
where home_packages is null;

update public.app_settings
set active_home_index = 0
where active_home_index is null;

alter table public.app_settings
  alter column id set default true,
  alter column id set not null,
  alter column class_count set default 7,
  alter column class_count set not null,
  alter column home_title_line1 set default '매안초 졸업앨범 촬영 준비',
  alter column home_title_line1 set not null,
  alter column home_title_line2 set default '학교배경 컨셉사진',
  alter column home_title_line2 set not null,
  alter column home_title_rows set default '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}]'::jsonb,
  alter column home_title_rows set not null,
  alter column home_title_selected_index set default 0,
  alter column home_title_selected_index set not null,
  alter column home_packages set default '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진","rows":[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}],"selectedIndex":0}]'::jsonb,
  alter column home_packages set not null,
  alter column active_home_index set default 0,
  alter column active_home_index set not null;

alter table public.app_settings
  drop constraint if exists app_settings_id_check,
  add constraint app_settings_id_check check (id),
  drop constraint if exists app_settings_class_count_check,
  add constraint app_settings_class_count_check check (class_count >= 1);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_settings'::regclass
      and conname = 'app_settings_pkey'
  ) then
    alter table public.app_settings add constraint app_settings_pkey primary key (id);
  end if;
end $$;

insert into public.app_settings (
  id,
  class_count,
  active_home_id,
  home_title_line1,
  home_title_line2,
  home_title_rows,
  home_title_selected_index,
  home_packages,
  active_home_index
)
values (
  true,
  7,
  null,
  '매안초 졸업앨범 촬영 준비',
  '학교배경 컨셉사진',
  '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}]'::jsonb,
  0,
  '[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진","rows":[{"line1":"매안초 졸업앨범 촬영 준비","line2":"학교배경 컨셉사진"}],"selectedIndex":0}]'::jsonb,
  0
)
on conflict (id) do nothing;

create table if not exists public.homes (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null default 1,
  title_line1 text not null default '',
  title_line2 text not null default '',
  class_count integer not null default 1 check (class_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.homes
  add column if not exists sort_order integer not null default 1,
  add column if not exists title_line1 text not null default '',
  add column if not exists title_line2 text not null default '',
  add column if not exists class_count integer not null default 1,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

with settings as (
  select
    coalesce(
      home_packages,
      jsonb_build_array(jsonb_build_object('line1', coalesce(home_title_line1, ''), 'line2', coalesce(home_title_line2, '')))
    ) as packages,
    greatest(1, coalesce(class_count, 1)) as class_count
  from public.app_settings
  limit 1
),
expanded as (
  select
    item.value,
    item.ordinality::integer as sort_order,
    settings.class_count
  from settings
  cross join lateral jsonb_array_elements(settings.packages) with ordinality as item(value, ordinality)
)
insert into public.homes (sort_order, title_line1, title_line2, class_count)
select
  expanded.sort_order,
  coalesce(expanded.value->>'line1', ''),
  coalesce(expanded.value->>'line2', ''),
  case when expanded.sort_order = 1 then expanded.class_count else 1 end
from expanded
where not exists (select 1 from public.homes);

insert into public.homes (sort_order, title_line1, title_line2, class_count)
select 1, '매안초 졸업앨범 촬영 준비', '학교배경 컨셉사진', 1
where not exists (select 1 from public.homes);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  home_id uuid,
  class_no integer not null check (class_no >= 1),
  name text not null check (char_length(trim(name)) > 0),
  gender text check (gender is null or gender in ('male', 'female')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.students
  add column if not exists home_id uuid,
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
  home_id uuid,
  class_no integer not null check (class_no >= 1),
  sort_order integer not null default 0,
  password_hash text,
  access_nonce uuid not null default gen_random_uuid(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.groups
  add column if not exists home_id uuid,
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
  add constraint students_class_no_check check (class_no >= 1);

alter table public.students
  alter column gender drop not null;

alter table public.students
  drop constraint if exists students_gender_check,
  add constraint students_gender_check check (gender is null or gender in ('male', 'female'));

alter table public.groups
  drop constraint if exists groups_class_no_check,
  add constraint groups_class_no_check check (class_no >= 1);

update public.groups
set access_nonce = gen_random_uuid()
where access_nonce is null;

alter table public.groups
  alter column access_nonce set default gen_random_uuid(),
  alter column access_nonce set not null;

with settings as (
  select greatest(0, coalesce(active_home_index, 0)) as idx
  from public.app_settings
  limit 1
),
ordered as (
  select id, row_number() over (order by sort_order asc, created_at asc, id asc) - 1 as idx
  from public.homes
),
desired as (
  select id
  from ordered
  where idx = (select idx from settings)
  limit 1
),
fallback as (
  select id
  from public.homes
  order by sort_order asc, created_at asc, id asc
  limit 1
)
update public.app_settings
set active_home_id = coalesce((select id from desired), (select id from fallback))
where active_home_id is null;

with first_home as (
  select id
  from public.homes
  order by sort_order asc, created_at asc, id asc
  limit 1
)
update public.students
set home_id = (select id from first_home)
where home_id is null;

with first_home as (
  select id
  from public.homes
  order by sort_order asc, created_at asc, id asc
  limit 1
)
update public.groups
set home_id = (select id from first_home)
where home_id is null;

alter table public.homes
  alter column sort_order set default 1,
  alter column sort_order set not null,
  alter column title_line1 set default '',
  alter column title_line1 set not null,
  alter column title_line2 set default '',
  alter column title_line2 set not null,
  alter column class_count set default 1,
  alter column class_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_settings'::regclass
      and conname = 'app_settings_active_home_id_fkey'
  ) then
    alter table public.app_settings
      add constraint app_settings_active_home_id_fkey
      foreign key (active_home_id) references public.homes(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_home_id_fkey'
  ) then
    alter table public.students
      add constraint students_home_id_fkey
      foreign key (home_id) references public.homes(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.groups'::regclass
      and conname = 'groups_home_id_fkey'
  ) then
    alter table public.groups
      add constraint groups_home_id_fkey
      foreign key (home_id) references public.homes(id) on delete cascade;
  end if;
end $$;

create index if not exists students_class_sort_idx on public.students(class_no, sort_order);
create index if not exists students_home_class_sort_idx on public.students(home_id, class_no, sort_order);
create index if not exists groups_class_sort_active_idx on public.groups(class_no, sort_order)
  where deleted_at is null;
create index if not exists groups_home_class_sort_active_idx on public.groups(home_id, class_no, sort_order)
  where deleted_at is null;
create index if not exists homes_sort_idx on public.homes(sort_order, created_at);
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

drop trigger if exists homes_set_updated_at on public.homes;
create trigger homes_set_updated_at
before update on public.homes
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.homes enable row level security;
alter table public.students enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.photos enable row level security;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'classes'
  ) then
    execute 'alter table public.classes enable row level security';
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('group-photos', 'group-photos', false)
on conflict (id) do nothing;

import { closeDb, sqlClient } from './client'
import { localUserId } from './env'

const migration = `
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  locale text not null,
  unit_system text not null,
  weight_kg numeric not null,
  target_weight_kg numeric not null,
  protein_calculation_weight_kg numeric not null,
  height_cm integer not null,
  age integer,
  sex text not null,
  activity_level text not null,
  goal text not null,
  macro_mode text not null,
  likes jsonb not null default '[]',
  dislikes jsonb not null default '[]',
  banned_foods jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists macro_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid not null references profiles(id),
  calories integer not null,
  protein_g numeric not null,
  carbs_g numeric not null,
  fat_g numeric not null,
  confidence text not null,
  formula_version text not null,
  goal text not null,
  macro_mode text not null,
  preset text not null,
  maintenance_calories integer not null,
  protein_calculation_weight_kg numeric not null,
  notes jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists weekly_menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid not null references profiles(id),
  macro_target_id uuid not null references macro_targets(id),
  week_start date not null,
  locale text not null,
  status text not null,
  generation_settings jsonb not null default '{}',
  nutrition_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists day_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  weekly_menu_id uuid not null references weekly_menus(id) on delete cascade,
  day_index integer not null,
  locked boolean not null default false
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text not null,
  locale text not null,
  description text not null,
  servings integer not null,
  prep_time_minutes integer not null,
  cuisine text not null,
  flavor_profile text not null,
  tags jsonb not null default '[]',
  steps jsonb not null default '[]',
  source text not null,
  nutrition_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position integer not null,
  name text not null,
  amount numeric not null,
  unit text not null,
  preparation text,
  normalized_amount numeric not null,
  normalized_unit text not null,
  food_id text,
  source_id text,
  confidence text not null,
  nutrition_snapshot jsonb not null default '{}',
  notes jsonb not null default '[]'
);

create table if not exists menu_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  day_plan_id uuid not null references day_plans(id) on delete cascade,
  recipe_id uuid not null references recipes(id),
  slot text not null,
  locked boolean not null default false,
  nutrition_snapshot jsonb not null default '{}'
);

create table if not exists food_items (
  id text primary key,
  canonical_name text not null,
  category text not null
);

create table if not exists food_aliases (
  id uuid primary key default gen_random_uuid(),
  food_id text not null references food_items(id) on delete cascade,
  alias text not null,
  user_id uuid references users(id) on delete cascade,
  source text not null default 'seed'
);

alter table food_aliases add column if not exists user_id uuid references users(id) on delete cascade;
alter table food_aliases add column if not exists source text not null default 'seed';
create index if not exists food_aliases_user_source_idx on food_aliases(user_id, source);
create unique index if not exists food_aliases_unique_seed_alias_idx on food_aliases(food_id, lower(alias)) where user_id is null;
create unique index if not exists food_aliases_unique_user_alias_idx on food_aliases(user_id, lower(alias)) where user_id is not null;

create table if not exists source_foods (
  id text primary key,
  source text not null,
  payload jsonb not null default '{}'
);

create table if not exists nutrition_records (
  id uuid primary key default gen_random_uuid(),
  food_id text not null references food_items(id) on delete cascade,
  source_id text not null references source_foods(id) on delete cascade,
  per_100g jsonb not null,
  confidence text not null
);

create table if not exists food_mappings (
  id uuid primary key default gen_random_uuid(),
  food_id text not null references food_items(id) on delete cascade,
  source_id text not null references source_foods(id) on delete cascade,
  confidence text not null
);

create table if not exists unit_conversions (
  id uuid primary key default gen_random_uuid(),
  unit text not null unique,
  grams numeric not null,
  notes text
);

create table if not exists ingredient_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  recipe_ingredient_id uuid not null references recipe_ingredients(id) on delete cascade,
  food_id text,
  source_id text,
  confidence text not null,
  notes jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists nutrition_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  entity_type text not null,
  entity_id uuid not null,
  nutrition_snapshot jsonb not null default '{}',
  confidence text not null,
  source_notes jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists profile_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid not null references profiles(id) on delete cascade,
  scope text not null,
  kind text not null,
  value text not null,
  strength text not null,
  created_at timestamptz not null default now()
);

create table if not exists saved_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid not null references profiles(id) on delete cascade,
  recipe_id uuid not null references recipes(id),
  created_at timestamptz not null default now(),
  unique(profile_id, recipe_id)
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid references profiles(id),
  weekly_menu_id uuid references weekly_menus(id),
  status text not null,
  kind text not null,
  failure_code text,
  logs jsonb not null default '[]',
  result jsonb not null default '{}',
  error text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid references profiles(id),
  action_name text not null,
  params jsonb not null default '{}',
  confirmation_markdown text not null,
  status text not null,
  source text not null,
  result jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists action_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  profile_id uuid references profiles(id),
  pending_action_id uuid references pending_actions(id),
  action_name text not null,
  audit_label text not null,
  status text not null,
  source text not null,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now()
);

create table if not exists ai_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  input_hash text not null,
  model text not null,
  schema_version text not null,
  output jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id, input_hash, model, schema_version)
);

create table if not exists app_settings (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists idx_profiles_user on profiles(user_id);
create index if not exists idx_weekly_menus_profile on weekly_menus(profile_id);
create index if not exists idx_day_plans_menu on day_plans(weekly_menu_id);
create index if not exists idx_menu_meals_day on menu_meals(day_plan_id);
create index if not exists idx_generation_jobs_user on generation_jobs(user_id);
create index if not exists idx_pending_actions_user_status on pending_actions(user_id, status);
create index if not exists idx_action_events_user on action_events(user_id, created_at);
`

async function main(): Promise<void> {
  const sql = sqlClient()
  await sql.unsafe(migration)
  const userId = localUserId()
  await sql`
    insert into users (id, email)
    values (${userId}, 'local@menumaker.test')
    on conflict (id) do nothing
  `
  await sql`alter table ai_cache add column if not exists user_id uuid references users(id) on delete cascade`
  await sql`update ai_cache set user_id = ${userId} where user_id is null`
  await sql`alter table ai_cache alter column user_id set not null`
  await sql`alter table ai_cache drop constraint if exists ai_cache_input_hash_model_schema_version_key`
  await sql`create unique index if not exists ai_cache_user_hash_model_schema_idx on ai_cache(user_id, input_hash, model, schema_version)`
  await sql`
    delete from nutrition_records a
    using nutrition_records b
    where a.ctid < b.ctid
      and a.food_id = b.food_id
      and a.source_id = b.source_id
  `
  await sql`
    delete from food_mappings a
    using food_mappings b
    where a.ctid < b.ctid
      and a.food_id = b.food_id
      and a.source_id = b.source_id
  `
  await sql`create unique index if not exists nutrition_records_food_source_idx on nutrition_records(food_id, source_id)`
  await sql`create unique index if not exists food_mappings_food_source_idx on food_mappings(food_id, source_id)`
  await closeDb()
  console.log('Database migrated')
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})

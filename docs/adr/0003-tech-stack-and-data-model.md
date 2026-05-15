# ADR 0003: Tech Stack And Data Model

## Status

Accepted

## Date

2026-05-15

## Context

The app is a Spanish-first, mobile web app for creating and managing weekly diets. It needs to run locally on the user's MacBook Air M2 for the first working v1. It also needs multiple profiles, weekly menu history, deterministic nutrition calculation, AI-assisted recipe and menu generation, and an MCP server for external agent access.

The implementation should avoid throwaway architecture. The web app and MCP server need to share the same domain logic so agents and the UI produce consistent behavior. The local-first implementation should preserve a clean path to hosted sync later.

## Decision

Use a TypeScript monorepo with:

- Next.js, React, and TypeScript for the mobile-first web app.
- Tailwind CSS and shadcn/ui-style components for UI implementation.
- Postgres-compatible persistence for local development, with a schema compatible with Supabase Postgres, Supabase Auth, and Row Level Security later.
- Drizzle ORM for schema definition and migrations.
- Server-side structured AI generation validated into JSON schemas.
- A separate TypeScript MCP server that shares the same core services as the web app.

## Repository Structure

Initial monorepo layout:

```text
apps/
  web/
  mcp/
packages/
  ai/
  core/
  db/
  nutrition/
```

Responsibilities:

- `apps/web`: Next.js mobile web app and PWA shell.
- `apps/mcp`: MCP server exposing structured planner tools to ChatGPT, Codex, or other agents.
- `packages/core`: domain models, planner rules, validation, profile policy, and menu operations.
- `packages/db`: Drizzle schema, migrations, database clients, and repository functions.
- `packages/nutrition`: food matching, nutrition calculation, confidence scoring, and source adapters.
- `packages/ai`: prompts, model adapters, structured output schemas, AI cache helpers, and generation orchestration.

## Frontend

The web app should be mobile-first and Spanish-first.

Use:

- Next.js App Router.
- React.
- TypeScript.
- Tailwind CSS.
- shadcn/ui-style components.
- PWA support when practical.

The UI should default to Spanish copy for new profiles and support English as a secondary locale.

## Backend And API

Use Next.js Route Handlers for web app APIs.

Server-side APIs should own:

- Profile creation and updates.
- Macro target calculation.
- Weekly menu generation requests.
- Meal, day, and week regeneration.
- Meal replacement and propagation proposals.
- Recipe starring.
- Locking and unlocking meals or days.
- Nutrition analysis.

Mutation APIs must enforce user ownership and should validate all input with shared schemas from the core package.

## Database, Auth, And Sync Path

The v1 development/runtime target is local on the user's MacBook Air M2.

For the first working app, use either:

- A local Supabase/Postgres stack, if convenient.
- Plain local Postgres, if that is simpler.

Auth may be stubbed as a single local user during early implementation.

No cloud deployment, hosted auth, or full account system is required before the first working app.

Every user-owned row must be scoped by `user_id` directly or through a parent row that is scoped by `user_id`.

The schema must remain compatible with later hosted Supabase Auth and Row Level Security. When hosted sync is enabled, RLS policies must prevent users from reading or mutating another user's profiles, menus, recipes, preferences, or generated outputs.

This keeps local development fast while avoiding schema changes when hosted sync is added later.

## Data Model

Initial tables:

- `profiles`: one person, including name, locale, unit system, current weight, target weight, protein calculation weight, age, biological sex, activity level, and profile-level preferences.
- `macro_targets`: target snapshots, including goal, calories, protein, carbs, fat, formula version, confidence, and cut or bulk preset.
- `weekly_menus`: one menu per profile per week, including week start, locale, goal, status, target snapshot, and generation settings.
- `day_plans`: one row per weekday inside a weekly menu.
- `menu_meals`: one row per breakfast, lunch, dinner, or snack; points to a recipe and stores lock state and nutrition snapshot.
- `recipes`: structured recipe with title, description, locale, prep time, servings, cuisine, tags, and generated or manual source.
- `recipe_ingredients`: ingredient lines with amount, unit, normalized grams or milliliters, preparation state, and food match.
- `food_items`: canonical normalized foods, such as broccoli, chicken breast, rice, or olive oil.
- `nutrition_records`: per-food nutrition data from USDA, BEDCA, Open Food Facts, or user-confirmed values.
- `nutrition_estimates`: per-recipe or per-meal calculated nutrition with confidence and source notes.
- `profile_preferences`: likes, dislikes, bans, soft preferences, and temporary week-level preferences.
- `saved_recipes`: starred recipes per profile.
- `generation_jobs`: async menu or meal generation jobs with status, error, retry count, and result references.
- `ai_cache`: cached structured AI outputs keyed by input hash, model, and schema version.

## Snapshot Policy

Use snapshots aggressively.

A weekly menu should store the macro target and nutrition values it was generated with. If a user later changes their profile, changes their targets, or a nutrition database match improves, old menus should not silently change.

Historical menus should remain understandable as originally generated.

## Generation Flow

Full-week generation should not be one blocking request.

Preferred flow:

1. User starts generation.
2. App creates a `generation_jobs` row.
3. Server generates candidate meals.
4. Nutrition layer validates recipe ingredients and nutrition totals.
5. Planner repairs or rebalances the menu.
6. UI polls or subscribes to job status.
7. Completed menu is saved as structured rows.

Meal, day, and week regeneration should use the same job model. Locked meals and locked days must be preserved.

## MCP Server

The MCP server should live in `apps/mcp` and use shared logic from `packages/core`, `packages/db`, `packages/nutrition`, and `packages/ai`.

MCP tools should not scrape or automate the web UI. They should call the same domain services and database operations as the web app.

MCP tools must distinguish read-only operations from mutations. Mutations that change menus, profile preferences, locks, or saved recipes require explicit confirmation.

## Consequences

Benefits:

- Shared TypeScript types and logic across the UI, API, and MCP server.
- Local v1 can run without cloud deployment or a full account system.
- The schema remains ready for hosted sync and Supabase RLS later.
- Drizzle keeps schema and migrations close to the TypeScript codebase.
- Async jobs make weekly generation more robust than a single blocking request.
- Snapshotting prevents old menus from changing unexpectedly.

Tradeoffs:

- Early auth is a local stub, not a real multi-user security boundary.
- RLS policies still need careful design before hosted sync is enabled.
- Async generation adds job-state complexity.
- Hosted sync is deferred rather than available from the first local build.
- A monorepo requires a little more setup than a single Next.js app.
- Shared packages require discipline to avoid mixing UI concerns into domain logic.

## Open Questions

- None currently.

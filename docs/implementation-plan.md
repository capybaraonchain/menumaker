# V1 Implementation Plan

## Purpose

This plan turns ADR 0001 through ADR 0009 into an implementation sequence for the first working local v1 of the weekly diet planner.

The target is a Spanish-first mobile web app running locally on the user's MacBook Air M2, with a Postgres-compatible local database, deterministic macro/nutrition calculation, AI-assisted planning through a server-side Codex OAuth provider, and a local MCP server.

The plan is dependency-ordered. Later slices should build on working behavior from earlier slices rather than replacing it with disconnected scaffolding.

## Non-Negotiable Completion Bar

The v1 is not complete until:

- The app runs locally.
- A Spanish profile can be created through onboarding.
- Suggested macro targets are calculated from the ADR 0002 policy.
- A weekly menu can be generated for one profile.
- Meals have structured recipes, ingredient lines, and nutrition snapshots.
- Calories and macros are calculated deterministically from ingredient data, not from recipe prose.
- The current week is visible in the `Semana` screen.
- A meal can be edited with replacement options and confirmed.
- Locked meals and locked days are preserved during regeneration.
- A recipe can be starred and seen in `Recetas`.
- Past weekly menus are visible in `Historial`.
- The in-app LLM provider uses server-side Codex OAuth with GPT-5.5 medium by default.
- The MCP server exposes the accepted read/proposal/mutation contract.

## Phase 0: Project Baseline

Create the monorepo structure from ADR 0003:

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

Set up:

- TypeScript.
- Package workspaces.
- Shared lint/typecheck scripts.
- Local environment files.
- Local dev scripts for web, server/API, and MCP.

Acceptance:

- A single command or documented command set starts the local development environment.
- Typecheck runs across the monorepo.
- Empty app shell renders locally.

## Phase 1: Local Persistence And Schema

Implement local Postgres-compatible persistence.

Use Drizzle for:

- Schema definitions.
- Migrations.
- Database client.
- Repository helpers.

Implement the local single-user stub while keeping `user_id` ownership fields in user-owned tables.

Initial tables:

- `users` or equivalent local user stub.
- `profiles`.
- `macro_targets`.
- `weekly_menus`.
- `day_plans`.
- `menu_meals`.
- `recipes`.
- `recipe_ingredients`.
- `food_items`.
- `food_aliases`.
- `source_foods`.
- `nutrition_records`.
- `food_mappings`.
- `unit_conversions`.
- `ingredient_matches`.
- `nutrition_estimates`.
- `profile_preferences`.
- `saved_recipes`.
- `generation_jobs`.
- `ai_cache`.

Acceptance:

- Migrations create all v1 tables locally.
- Repository code can create and read a local user, profile, recipe, and weekly menu.
- User-owned rows include ownership fields compatible with hosted sync later.

## Phase 2: Core Domain And Macro Policy

Implement ADR 0002 in `packages/core`.

Core functions:

- Create profile draft.
- Calculate maintenance calories with Mifflin-St Jeor.
- Apply activity multiplier.
- Apply maintain/cut/bulk adjustment.
- Calculate protein calculation weight.
- Allocate protein, fat, and carbohydrates.
- Validate impossible targets.
- Round targets for display.
- Produce confidence labels when age or biological sex is skipped.

Acceptance:

- Unit tests cover maintenance, cut, bulk, skipped age/sex, aggressive settings, and impossible targets.
- Macro target snapshots can be saved and read.
- Spanish conflict copy exists for impossible targets.

## Phase 3: Nutrition Seed And Matching Engine

Implement the nutrition matching foundation from ADR 0004.

For early local v1, include a small deterministic seed dataset with common foods needed to exercise the product end-to-end, such as:

- Chicken breast.
- Eggs.
- Greek yogurt.
- Rice.
- Potatoes.
- Oats.
- Lentils.
- Olive oil.
- Tomato.
- Broccoli.
- Banana.
- Tuna.
- Salmon.
- Avocado.
- Spinach.
- Whole wheat bread.
- Common v1 expansion foods: turkey, lean beef, tofu, chickpeas, quinoa, pasta, sweet potato, zucchini, bell pepper, onion, carrot, mushrooms, cucumber, lettuce, apple, berries, cottage cheese, milk, almonds, and peanut butter.

This seed dataset is not a substitute for USDA/Open Food Facts/BEDCA integration. It exists so the planner, UI, and nutrition calculation can work before full source coverage is implemented.

Implement:

- Ingredient text normalization.
- Gram/ml normalization for explicit metric units.
- Basic unit conversions for common household units.
- Food-specific serving conversions for ambiguous units such as `unidad`, `pieza`, `rebanada`, and `taza` when the matched food has a known serving weight.
- Candidate matching from aliases and seed data.
- Nutrition calculation per ingredient and recipe.
- Confidence labels.
- Ingredient match snapshots.

Acceptance:

- A structured recipe with seed ingredients produces calories, protein, carbs, and fat.
- Unknown important ingredients lower confidence.
- Ingredient matches are persisted.
- Old nutrition snapshots do not change when source records are edited.

## Phase 4: Codex OAuth LLM Provider

Implement the server-side provider adapter from ADR 0008 in `packages/ai`.

Use the reusable pattern from `/Users/capybara/Documents/New project 2`:

- `CODEX_AUTH_PROFILE` override.
- Default `~/.codex/auth.json`.
- Server-side token refresh.
- Server-only tokens.
- Redacted errors.
- Provider status without token values.

Default environment:

```text
CODEX_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=medium
```

Acceptance:

- Provider status endpoint or function reports configured/missing without leaking tokens.
- A strict structured test call succeeds when Codex OAuth is configured.
- Browser code never receives token values.

## Phase 5: AI Schemas And Generation Jobs

Implement ADR 0005 schemas and job model.

Schemas:

- `PlanningBrief`.
- `WeekSkeleton`.
- `RecipeCandidate`.
- `MealReplacementProposal`.
- `RepairRequest`.
- `RepairResult`.
- `GenerationSummary`.

Implement:

- Generation job creation.
- Queued weekly-generation job input persisted in `generation_jobs.result.jobInput`.
- A reusable weekly-generation runner that claims a queued job and produces the menu.
- Job state transitions.
- Job logs.
- Code-specific remediation metadata persisted in `generation_jobs.result.remediation` for failed jobs.
- Repair-issue remediation metadata persisted in menu/job generation settings when bounded repair cannot fully resolve the week.
- Guided profile-preference relaxation through the shared app action registry.
- Retry limit.
- Failure states.
- AI cache keyed by input hash, model, and schema version.
- LLM-first recipe candidate generation with deterministic templates only as an explicit fallback.
- LLM-first week skeleton generation with deterministic skeleton fallback only when the provider is unavailable or invalid.
- `ALLOW_RECIPE_TEMPLATE_FALLBACK=false` live mode for failing loudly instead of silently using templates.
- `ALLOW_WEEK_SKELETON_FALLBACK=false` live mode for failing loudly instead of silently assembling a deterministic skeleton.
- AI cache reads/writes for successful structured recipe candidate generations.
- AI cache reads/writes for successful structured week skeleton generations.
- AI cache reads/writes for chat tool planning.
- AI cache reads/writes for menu-context chat responses.
- AI cache reads/writes for successful generation-summary calls.
- Structured deterministic repair telemetry recorded as `RepairRequest` / `RepairResult` entries in the weekly menu and generation job trace.

Acceptance:

- A generation job can move through queued, running, completed, and failed states.
- Weekly generation can be enqueued separately from execution, even though local v1 may run the job immediately.
- Failures are represented with explicit codes.
- Structured outputs are validated before use.
- Fallback recipe templates are not used as the primary source when the provider is configured and valid candidates pass scoring.
- Menu generation metadata records recipe source, skeleton source, fallback slots, fallback policy, repair trace, and AI-cache hits.
- Chat responses can report cache hits without exposing provider tokens.
- Completed and failed weekly-generation jobs expose a concise generation summary; successful LLM summaries are cached.
- Failed jobs expose specific next steps for impossible targets, nutrition confidence, ambiguous ingredients, banned-item conflicts, repetition conflicts, and exhausted generation.

## Phase 6: Weekly Menu Planning Pipeline

Implement a first end-to-end planner.

The planner should:

- Build a planning brief from a profile and target snapshot.
- Generate or assemble a week skeleton.
- Generate structured recipe candidates through the LLM provider.
- Pass week-skeleton intent into recipe candidate generation and selection.
- Match ingredients.
- Calculate deterministic nutrition.
- Score the week.
- Repair simple failures before persistence.
- Save a finalized weekly menu.

The local deterministic recipe set is a fallback for unavailable or failed LLM generation, not the normal source of weekly menus or replacements.

Acceptance:

- A full week with breakfast, lunch, dinner, and snack can be generated.
- Menu nutrition is saved as snapshots.
- Locked items are preserved during regeneration.
- Menu generation records whether candidates came from LLM, fallback templates, or a mixed pool.
- Menu generation records whether the week skeleton came from LLM or deterministic fallback.
- Weekly quality tests cover obvious recipe repetition and daily calorie drift.
- Failure states surface when targets are impossible or nutrition confidence is too low.

## Phase 6.5: Hybrid Calorie Adjustment Planner

Implement ADR 0009.

The planner should:

- Preview calorie target changes before mutation.
- Decide per meal between portion resize, ingredient rebalance, recipe replacement, or locked preservation.
- Score candidates against daily and weekly macro targets, satiety, volume, preferences, variety, locks, and change cost.
- Store the previewed plan inside the pending action and reject confirmation if the base menu changed.
- Save adjustment metadata in weekly menu generation settings.

Acceptance:

- Chat shows a calorie adjustment plan before applying it.
- Confirmed changes apply the exact previewed plan.
- Locked meals and days remain unchanged.
- The response explains what changed and why.
- MCP exposes the same preview/apply flow.

## Phase 7: Web App UX

Implement ADR 0006 screens.

Screens:

- Onboarding.
- `Semana`.
- Meal detail.
- Meal edit/replacement flow.
- `Recetas`.
- `Historial`.
- `Perfil`.
- Profile deletion/admin reset zone.

Acceptance:

- Spanish onboarding creates a profile.
- Suggested macro review is editable.
- First weekly menu generation is launched from onboarding.
- `Semana` shows the current week and direct meal actions.
- Meal detail shows recipe, ingredients, steps, macros, confidence, star, lock, and edit actions.
- `Perfil` can delete the active profile only after exact-name confirmation and returns an export snapshot through the action result.
- Generation progress and failure states are visible in the UI from persisted generation jobs.
- Failed generation jobs can be retried through a typed app action and MCP tool.

## Phase 8: Meal Editing, Locks, Stars, And History

Implement user-facing operations:

- Lock/unlock meal.
- Lock/unlock day.
- Regenerate meal.
- Regenerate day.
- Regenerate week.
- Star/unstar recipe.
- View saved recipes.
- View previous menus.
- Duplicate or regenerate from a previous menu.
- Natural-language meal edit proposal.
- Replacement confirmation.
- Related replacement propagation proposal.
- Preference save confirmation.

Acceptance:

- Locked meals and days survive regeneration.
- One selected meal can be replaced.
- Week-wide related replacements require explicit confirmation.
- Starred recipes appear in `Recetas`.
- Previous menus appear in `Historial`.

## Phase 9: In-App Chat

Implement local in-app chat against the provider boundary.

Chat should:

- Use active profile and current menu context.
- Explain meals, macros, confidence, and tradeoffs.
- Suggest changes.
- Trigger proposal flows rather than silently mutating durable state.

Acceptance:

- Chat can answer questions about the current menu.
- Chat can propose a meal change.
- Chat does not directly mutate profile preferences, locks, menus, or saved recipes without confirmation.

## Phase 10: MCP Server And Skill

Implement ADR 0007.

MCP tool groups:

- Read-only tools.
- Proposal tools.
- Mutation tools.

Create the companion skill that instructs agents to:

- Identify active profile.
- Respect locale.
- Use deterministic nutrition.
- Preserve locks.
- Prefer proposal-first workflows.
- Require confirmation for broad or persistent changes.

Acceptance:

- MCP server starts locally.
- Read tools can list profiles and inspect a weekly menu.
- Proposal tools can suggest replacements or regeneration previews.
- Regeneration previews are server-owned plans with exact candidate recipes, base menu hash, affected/preserved meal IDs, warnings, and Spanish confirmation copy.
- Regeneration mutations can apply the previewed plan exactly and reject it if the menu changed before confirmation.
- Destructive profile deletion is exposed as a confirmed MCP mutation with exact-name verification and optional export snapshot.
- Mutation tools enforce confirmation expectations at the service boundary.
- Skill file exists and matches the tool contract.

## Phase 11: Verification And Cleanup

Run an end-to-end local scenario:

1. Start the local app and database.
2. Create a Spanish profile.
3. Use suggested macros for a cut or bulk.
4. Generate a weekly menu.
5. Inspect deterministic nutrition.
6. Lock a meal.
7. Regenerate the week and verify the lock is preserved.
8. Edit a meal with a banned/disliked ingredient request.
9. Select a replacement.
10. Save or reject the preference.
11. Star a recipe.
12. View saved recipes.
13. View menu history.
14. Ask in-app chat about the menu.
15. Use MCP read tools to inspect the profile/menu.

Acceptance:

- The scenario completes locally.
- Any missing behavior is documented as explicitly deferred or blocked.
- Typecheck and relevant tests pass.
- The final implementation matches the ADRs or documents any deviations.

## Explicitly Deferred From V1

- Pantry inventory.
- Grocery lists.
- Store pricing.
- Budget optimization.
- Clinical nutrition advice.
- Medical-diet programs.
- Eating-disorder screening.
- Medication or disease-specific recommendations.
- Multi-profile shared meals.
- Hosted sync and hosted auth.
- Full USDA/Open Food Facts/BEDCA coverage beyond the v1 adapter boundaries and seed coverage needed for local behavior.

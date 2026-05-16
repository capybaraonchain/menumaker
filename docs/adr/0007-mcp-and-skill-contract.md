# ADR 0007: MCP And Skill Contract

## Status

Accepted

## Date

2026-05-15

## Context

The app should expose an MCP server and companion agent skill so ChatGPT, Codex, or another agent can operate the weekly diet planner without scraping the web UI.

The first working v1 runs locally on the user's MacBook Air M2 against the same local database as the web app. Hosted auth and hosted sync are deferred, but the MCP contract should remain compatible with future multi-user hosted sync.

## Decision

Expose a local MCP server with task-shaped tools grouped into:

1. Read-only tools.
2. Proposal tools.
3. Mutation tools.

Mutation tools must preserve product constraints and require explicit confirmation for broad or persistent changes. The companion skill should instruct agents to use deterministic nutrition, respect profile locale, preserve locks, and prefer proposal-first workflows.

## Runtime And Scope

For v1:

- The MCP server runs locally.
- It uses the same local database as the web app.
- It may assume the single local user stub from ADR 0003.
- Tools should still require profile IDs, menu IDs, recipe IDs, or meal IDs where relevant so the contract remains compatible with hosted sync later.

MCP tools must not expose raw SQL, generic row mutation, or database-shaped write access.

## Tool Categories

Read-only tools can run freely.

Read-only tools:

- `list_profiles`
- `get_profile`
- `get_weekly_menu`
- `get_recipe`
- `get_saved_recipes`
- `get_menu_history`
- `get_generation_jobs`
- `analyze_recipe_nutrition`
- `save_ingredient_mapping`
- `set_fallback_policy`
- `explain_macro_targets`

Proposal tools can run freely because they do not persist broad changes.

Proposal tools:

- `create_weekly_menu_proposal`
- `suggest_meal_replacements`
- `find_related_replacement_opportunities`
- `preview_regenerate_meal`
- `preview_regenerate_day`
- `preview_regenerate_week`
- `preview_profile_preference_update`
- `preview_calorie_adjustment_plan`
- `enqueue_preview_generation_job`
- `run_preview_generation_job`

Mutation tools change durable state.

Mutation tools:

- `create_profile`
- `update_profile`
- `save_macro_targets`
- `enqueue_weekly_menu_generation`
- `run_generation_job`
- `cancel_generation_job`
- `start_weekly_menu_generation`
- `replace_meal`
- `apply_confirmed_replacements`
- `apply_similar_replacements`
- `lock_meal`
- `lock_day`
- `regenerate_meal`
- `regenerate_day`
- `regenerate_week`
- `star_recipe`
- `unstar_recipe`
- `save_profile_preference`
- `relax_profile_preferences`
- `apply_calorie_target_change`
- `delete_profile`
- `reset_local_data`
- `retry_generation_job`

## Confirmation Rules

Read-only tools do not require confirmation.

Proposal tools do not require confirmation.

Mutation tools require explicit user confirmation unless the user's latest instruction already clearly requested that exact mutation.

Broad or persistent changes should use a two-step flow:

1. Proposal tool returns a server-owned preview payload, affected items, macro impact, preference impact, warnings, and Spanish confirmation copy.
2. Mutation tool applies the preview payload after user confirmation.

Regeneration preview tools must return an exact `RegenerationPlan`:

- `planId`
- `baseMenuId`
- `baseMenuHash`
- affected and preserved meal IDs
- per-meal decisions and candidate recipes
- decision counts
- estimated weekly macro impact
- warnings

`regenerate_meal`, `regenerate_day`, and `regenerate_week` should receive that plan when available. Apply must reject stale plans if the menu hash differs from the previewed base menu.

Examples:

- Replacing one meal after the user selects a replacement can proceed through `replace_meal`.
- Applying similar broccoli replacements across the whole week requires explicit confirmation and should use the same LLM-candidate plus deterministic-scoring replacement pipeline as the web UI.
- Saving "broccoli" as a profile dislike or ban requires explicit confirmation.
- Regenerating the whole week requires confirmation and must preserve locked days and meals.
- Changing calorie targets requires a calorie adjustment preview when possible. The confirmed mutation should apply the previewed plan and reject it if the menu changed after preview.
- Deleting a profile requires explicit confirmation and exact profile-name echo. It must return an export snapshot when requested, clear dependent profile data, and avoid touching other profiles.
- Full local reset requires explicit confirmation and the exact phrase `BORRAR MENUMAKER LOCAL`. It must return an export snapshot when requested, clear all local user app data, and leave schema plus seed nutrition records intact.

## Mutation Return Shape

Every mutation should return:

- What changed.
- Affected profile IDs, menu IDs, recipe IDs, day IDs, or meal IDs.
- Macro and calorie impact when relevant.
- Whether locked meals and locked days were preserved.
- Nutrition confidence warnings when relevant.
- Next suggested action, if useful.
- For calorie target changes: counts of portion resizes, ingredient rebalances, recipe replacements, preserved locks, weekly impact, daily warnings, and a Spanish explanation summary.
- For regeneration: counts of recipe replacements and preserved locks, recipe titles changed, weekly impact, warnings, and whether the exact previewed plan was applied.
- For profile deletion: deleted profile ID/name, remaining active profile ID if any, and an export snapshot with profile, menus, saved recipes, preferences, and counts when requested.

Mutation tools should be idempotent where practical.

## Locale Contract

Tools should default to the profile locale.

Spanish profile behavior:

- Spanish recipe names.
- Spanish recipe steps.
- Spanish user-facing explanations.
- Spanish warnings and failure messages.

English profile behavior:

- English recipe names.
- English recipe steps.
- English user-facing explanations.
- English warnings and failure messages.

Internal IDs, enums, tags, and food identifiers should remain language-neutral. Agents may translate user-facing text, but they must not translate stable internal identifiers.

## Nutrition Honesty

The MCP server and companion skill must enforce nutrition honesty.

Agents must:

- Never claim exact calories or macros from AI-generated recipe prose.
- Use deterministic nutrition tools before answering calorie or macro questions.
- Mention confidence when nutrition is estimated, generic, or low-confidence.
- Surface important low-confidence ingredients.
- When the user confirms an unknown ingredient is equivalent to a known deterministic food, use `save_ingredient_mapping` before retrying generation or re-analyzing nutrition.
- Avoid silently changing historical menu snapshots.

## Lock And Scope Rules

MCP tools must preserve:

- Locked meals.
- Locked days.
- One weekly menu per profile.
- One serving per meal slot.
- Adult-only automatic macro policy.
- Local-first v1 runtime.
- No pantry or grocery-list expansion in v1.
- No clinical or medical-diet guidance in v1.

## Skill Contract

The companion skill should instruct agents to:

- Identify the active profile before acting.
- Prefer Spanish for Spanish profiles.
- Use proposal tools before mutation tools.
- Preserve locked meals and locked days.
- Use deterministic nutrition analysis before macro claims.
- Ask for confirmation before profile-wide or week-wide changes.
- Treat generated menus, regenerations, and long preview creation as async-capable jobs.
- Use `enqueue_weekly_menu_generation` when an external agent should create a queued job without blocking on the full planner.
- Use `run_generation_job` to execute a queued weekly-generation job after confirmation.
- Use `enqueue_preview_generation_job` and `run_preview_generation_job` when a regeneration or calorie-adjustment preview may take long enough that the agent should persist progress and the exact plan before asking for confirmation.
- Use `cancel_generation_job` when the user wants to stop a queued or running generation/preview job.
- Use `start_weekly_menu_generation` only when the user explicitly wants enqueue-and-run in one step.
- Use `get_generation_jobs` when a user asks what happened during generation, whether a menu is still running, why generation failed, or what can be retried.
- Use persisted `generationSummary`, `remediation`, `repairRemediation`, and `RepairRequest` / `RepairResult` telemetry from generation job results when explaining what changed, why a generation failed, and what the next safe action is.
- Use `retry_generation_job` only for failed generation jobs and only after explicit confirmation. It creates a queued retry job; call `process_generation_queue` or `run_generation_job` only when the user also asks to execute it now.
- Use `relax_profile_preferences` only when the user explicitly chooses which dislikes or banned foods to remove.
- Explain impossible targets by showing the calorie conflict between protein, minimum fat, and calorie target.
- Preview calorie target changes with `preview_calorie_adjustment_plan` before mutation.
- Explain whether a calorie adjustment changed portions, rebalanced ingredients, or replaced recipes.
- Validate replacement recipes against the day and week, not only the single meal.
- Treat recipe generation and replacement tools as LLM-first proposal tools with deterministic validation. Deterministic templates are fallback only and should not be presented as the ideal recipe source.
- Use `set_fallback_policy` only after explicit confirmation when switching live-test behavior between fail-loud LLM mode and local deterministic fallback.
- Keep responses focused on weekly diet planning, not pantry, shopping, or medical nutrition.

The skill should discourage agents from:

- Scraping the web UI.
- Calling raw database operations.
- Treating AI nutrition estimates as deterministic facts.
- Applying inferred preferences permanently without confirmation.
- Expanding the product into grocery lists, pantry management, or clinical advice.

## Tool Design Principle

MCP tools should be task-shaped, not database-shaped.

Good examples:

- `suggest_meal_replacements`
- `lock_day`
- `start_weekly_menu_generation`

Avoid:

- `insert_row`
- `update_table`
- `execute_sql`

This keeps agents inside product rules and prevents them from bypassing confirmation, locale, lock, nutrition, and snapshot policies.

## Consequences

Benefits:

- Agents can operate the same product logic as the web app.
- Local MCP support works before hosted auth exists.
- Proposal-first workflows reduce accidental broad changes.
- Confirmation rules protect profile memory and weekly menus.
- The contract stays compatible with hosted sync later.

Tradeoffs:

- Tools need richer return shapes than simple CRUD calls.
- Mutation confirmation adds friction.
- The MCP server must share domain services instead of taking shortcuts.
- The skill must be kept in sync with the tool contract.

## Open Questions

- None currently.

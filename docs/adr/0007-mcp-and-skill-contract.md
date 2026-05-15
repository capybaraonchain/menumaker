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
- `analyze_recipe_nutrition`
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

Mutation tools change durable state.

Mutation tools:

- `create_profile`
- `update_profile`
- `save_macro_targets`
- `start_weekly_menu_generation`
- `replace_meal`
- `apply_confirmed_replacements`
- `lock_meal`
- `lock_day`
- `star_recipe`
- `unstar_recipe`
- `save_profile_preference`

## Confirmation Rules

Read-only tools do not require confirmation.

Proposal tools do not require confirmation.

Mutation tools require explicit user confirmation unless the user's latest instruction already clearly requested that exact mutation.

Broad or persistent changes should use a two-step flow:

1. Proposal tool returns a `proposal_id`, affected items, macro impact, preference impact, and warnings.
2. Mutation tool applies the `proposal_id` after user confirmation.

Examples:

- Replacing one meal after the user selects a replacement can proceed through `replace_meal`.
- Applying similar broccoli replacements across the whole week requires explicit confirmation.
- Saving "broccoli" as a profile dislike or ban requires explicit confirmation.
- Regenerating the whole week requires confirmation and must preserve locked days and meals.

## Mutation Return Shape

Every mutation should return:

- What changed.
- Affected profile IDs, menu IDs, recipe IDs, day IDs, or meal IDs.
- Macro and calorie impact when relevant.
- Whether locked meals and locked days were preserved.
- Nutrition confidence warnings when relevant.
- Next suggested action, if useful.

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
- Treat generated menus and regenerations as async jobs.
- Explain impossible targets by showing the calorie conflict between protein, minimum fat, and calorie target.
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

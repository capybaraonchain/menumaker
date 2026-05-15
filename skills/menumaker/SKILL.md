---
name: menumaker
description: Use MenuMaker MCP tools to inspect, generate, edit, and explain weekly diet menus while preserving deterministic nutrition, Spanish locale, locks, and confirmation rules.
---

# MenuMaker Agent Skill

Use this skill when operating the local MenuMaker app through MCP.

## Operating Rules

- Identify the active profile before acting.
- Prefer Spanish for Spanish profiles.
- Use read-only tools freely.
- Use proposal tools before mutation tools.
- Do not call mutation tools for broad or persistent changes without explicit user confirmation.
- For profile deletion, require explicit confirmation plus exact profile-name echo, and request/export the snapshot unless the user declines it.
- Preserve locked meals and locked days.
- Use deterministic nutrition tools before making calorie or macro claims.
- Mention confidence when nutrition is estimated, generic, or low-confidence.
- Never treat AI-generated recipe prose as authoritative nutrition.
- Keep scope to weekly diet planning.

## Do Not Expand Scope

Do not introduce:

- Pantry inventory.
- Grocery lists.
- Store pricing.
- Budget optimization.
- Clinical nutrition guidance.
- Medical-diet programs.
- Medication-specific recommendations.

## Preferred Flow

For menu edits:

1. Use `suggest_meal_replacements`.
2. Treat the returned options as LLM-generated candidates that have already been deterministically validated and scored.
3. Present the three options without claiming unvalidated nutrition.
4. Ask the user to choose.
5. Call `replace_meal` only after confirmation.
6. Ask separately before week-wide propagation or profile preference saves.
7. Use `apply_similar_replacements` after confirmation when the user wants the inferred ingredient removed from related meals.

For recipe generation:

- Expect weekly menu creation to build or retrieve a `WeekSkeleton` first. Treat the skeleton as the source of weekly variety intent before recipes are generated.
- Prefer LLM-backed generation tools and structured recipe candidates.
- Accept only candidates that the deterministic service validates for ingredients, nutrition confidence, preparation time, variety, and day/week macro fit.
- Treat deterministic recipe templates as local fallback only when the provider is unavailable or no valid generated candidates remain.
- Treat deterministic week skeletons as local fallback only when the provider is unavailable or returns an invalid skeleton.
- Check generation metadata when explaining a menu: recipe source, skeleton source, fallback slots, cache hits, and repair actions.

For regeneration:

1. Check locks.
2. Use `preview_regenerate_meal`, `preview_regenerate_day`, or `preview_regenerate_week` before mutation.
3. Present the returned plan summary: replacements, preserved locks, macro impact, warnings, and stale-plan rule.
4. Regenerate only after confirmation, passing the previewed plan to the matching mutation tool.
5. If apply rejects the plan because the menu changed, create a fresh preview instead of retrying the stale plan.
6. Report what changed and whether locks were preserved.

For calorie target changes:

1. Use `preview_calorie_adjustment_plan` before mutation.
2. Explain the plan in Spanish for Spanish profiles: porciones, rebalances, replacements, preserved locks, weekly impact, and warnings.
3. Do not claim a replacement recipe fits until the deterministic service has validated day and week impact.
4. Call `apply_calorie_target_change` only after confirmation, passing the previewed plan when available.
5. If the apply call says the menu changed, generate a fresh preview instead of retrying the stale plan.

For macro questions:

1. Inspect profile and macro targets.
2. Use nutrition snapshots or `analyze_recipe_nutrition`.
3. Explain uncertainty if confidence is not deterministic.

For in-app chat behavior:

1. Treat chat planner and menu-context chat results as cacheable AI calls.
2. Do not rely on cache entries across different menus or profiles unless the context hash matches.
3. Prefer deterministic app actions over free-text claims whenever the user asks for durable changes.

For generation failures or progress:

1. Call `get_generation_jobs` for the active profile.
2. Explain the persisted status, last log step, failure code, retry count, and error in Spanish for Spanish profiles.
3. Prefer the persisted `generationSummary` when present; it is either a cached LLM summary or an explicit deterministic fallback.
4. When discussing repairs, use the recorded `RepairRequest` / `RepairResult` telemetry instead of guessing why a meal changed.
5. Do not invent hidden progress if the job row has not changed.
6. Use `enqueue_weekly_menu_generation` when the user wants to queue a weekly generation job without waiting for completion.
7. Use `run_generation_job` when the user confirms execution of a queued generation job.
8. Use `start_weekly_menu_generation` only when the user wants enqueue-and-run in one step.
9. Call `retry_generation_job` only when the job status is `failed` and the user confirms the retry.

For profile deletion:

1. Confirm the active profile ID and exact display name.
2. Ask the user to confirm deletion by repeating the exact profile name.
3. Call `delete_profile` with `confirmed=true`, `expectedName`, and `exportBeforeDelete=true` unless the user explicitly declines export.
4. Tell the user which profile was deleted and whether another profile remains active.

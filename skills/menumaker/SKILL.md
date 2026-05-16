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
- If a low-confidence ingredient is just an alias for a known food, ask for confirmation and use `save_ingredient_mapping` before retrying or claiming nutrition.
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
- Use `set_fallback_policy` only after confirmation when the user wants live-test fail-loud behavior or local fallback behavior changed.
- Check generation metadata when explaining a menu: recipe source, skeleton source, fallback slots, cache hits, and repair actions.

For regeneration:

1. Check locks.
2. Use `preview_regenerate_meal`, `preview_regenerate_day`, or `preview_regenerate_week` before mutation.
3. Use `enqueue_preview_generation_job` and `run_preview_generation_job` when the preview may be slow or the agent needs a persisted plan before confirmation.
4. Present the returned plan summary: replacements, preserved locks, macro impact, warnings, and stale-plan rule.
5. Regenerate only after confirmation, passing the previewed plan to the matching mutation tool.
6. If apply rejects the plan because the menu changed, create a fresh preview instead of retrying the stale plan.
7. Report what changed and whether locks were preserved.

For calorie target changes:

1. Use `preview_calorie_adjustment_plan` before mutation.
2. Use `enqueue_preview_generation_job` and `run_preview_generation_job` when the calorie preview may be slow or should be persisted in job history before confirmation.
3. Explain the plan in Spanish for Spanish profiles: porciones, rebalances, replacements, preserved locks, weekly impact, and warnings.
4. Do not claim a replacement recipe fits until the deterministic service has validated day and week impact.
5. Call `apply_calorie_target_change` only after confirmation, passing the previewed plan when available.
6. If the apply call says the menu changed, generate a fresh preview instead of retrying the stale plan.

For macro questions:

1. Inspect profile and macro targets.
2. Use nutrition snapshots or `analyze_recipe_nutrition`.
3. Explain uncertainty if confidence is not deterministic.

For ingredient matching issues:

1. Inspect the failed job or low-confidence recipe ingredient.
2. Use `search_nutrition_foods` to find source-backed deterministic food candidates before asking the user to choose a canonical food.
3. If the user has a packaged-product barcode, ask for confirmation and call `import_open_food_facts_product` before mapping aliases.
4. If the user has a local USDA FoodData Central downloadable JSON file, ask for confirmation and call `import_usda_fdc_download`; this uses no API key and should target specific FDC IDs or a reasonable limit when possible.
5. If no source record exists but the user can provide per-100g nutrition, ask for confirmation and call `create_user_nutrition_food`; in the app UI this can happen inline from the ingredient remediation modal.
6. Ask the user which deterministic food it should map to only when a source/custom/seed food already exists or the issue is an alias.
7. Call `save_ingredient_mapping` only after confirmation.
8. Retry generation or rerun nutrition analysis through deterministic tools; do not bypass validation.

For in-app chat behavior:

1. Treat chat planner and menu-context chat results as cacheable AI calls.
2. Do not rely on cache entries across different menus or profiles unless the context hash matches.
3. Prefer deterministic app actions over free-text claims whenever the user asks for durable changes.

For generation failures or progress:

1. Call `get_generation_jobs` for the active profile.
2. Explain the persisted status, last log step, failure code, retry count, and error in Spanish for Spanish profiles.
3. Prefer the persisted `generationSummary` when present; it is either a cached LLM summary or an explicit deterministic fallback.
4. If remediation offers fallback enablement, explain that it changes local generation policy and call `set_fallback_policy` only after confirmation.
5. Prefer persisted `remediation` / `repairRemediation` when present; these are deterministic next steps keyed to failure or repair reason.
6. When discussing repairs, use the recorded `RepairRequest` / `RepairResult` telemetry instead of guessing why a meal changed.
7. If persisted `repairRemediation` includes day/slot context, prefer targeted regeneration of that meal or day over regenerating the full week.
8. Do not invent hidden progress if the job row has not changed.
9. Use `enqueue_weekly_menu_generation` when the user wants to queue a weekly generation job without waiting for completion.
10. Use `run_generation_job` when the user confirms execution of a queued generation job.
11. Use `start_weekly_menu_generation` only when the user wants enqueue-and-run in one step.
12. Use `enqueue_preview_generation_job` and `run_preview_generation_job` for long-running regeneration or calorie-adjustment previews.
12a. Do not call `regenerate_meal`, `regenerate_day`, or `regenerate_week` without the server-owned preview plan from a preview response or completed preview job.
13. Use `cancel_generation_job` when the user wants to stop a queued or running generation/preview job.
14. Use `relax_profile_preferences` only after the user explicitly chooses which dislikes or banned foods to remove.
15. Call `retry_generation_job` only when the job status is `failed` and the user confirms the retry; it queues a retry job, so use `process_generation_queue` or `run_generation_job` only if the user also wants it executed now.

For profile deletion:

1. Confirm the active profile ID and exact display name.
2. Ask the user to confirm deletion by repeating the exact profile name.
3. Call `delete_profile` with `confirmed=true`, `expectedName`, and `exportBeforeDelete=true` unless the user explicitly declines export.
4. Tell the user which profile was deleted and whether another profile remains active.

For full local reset:

1. Use only when the user explicitly asks to wipe all local MenuMaker data.
2. Require exact phrase `BORRAR MENUMAKER LOCAL` and `confirmed=true`.
3. Call `reset_local_data` with `exportBeforeDelete=true` unless the user explicitly declines export.
4. Explain that schema and seed nutrition records remain, but profiles, menus, generated recipes, jobs, preferences, user aliases, local settings, and AI cache are cleared.

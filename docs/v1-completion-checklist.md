# V1 Completion Checklist

## How To Use This Checklist

This checklist is the completion contract for the first working local v1.

An item is complete only when the behavior works locally, not merely when files or placeholder UI exist. If an item cannot be completed, mark it as blocked or explicitly deferred with the reason.

## 1. Local Runtime

- [x] App runs locally on the user's MacBook Air M2.
- [x] Local database starts or is reachable.
- [x] Web app opens in a browser.
- [x] API/server routes respond locally.
- [x] MCP server can start locally.
- [x] No cloud deployment is required.
- [x] No hosted auth/account system is required.
- [x] A single local user stub is used while preserving `user_id` ownership fields.
- [x] Generated outputs and AI cache rows are user-scoped for hosted sync/RLS compatibility.
- [x] Schema ownership regression tests guard user-owned tables before hosted sync exists.

## 2. Monorepo And Tooling

- [x] Monorepo structure exists: `apps/web`, `apps/mcp`, `packages/core`, `packages/db`, `packages/nutrition`, `packages/ai`.
- [x] TypeScript is configured.
- [x] Shared package imports work.
- [x] Typecheck passes.
- [x] Equivalent static checks run through workspace typecheck and production build. A separate lint script is not configured in v1.
- [x] Local environment variables are documented.

## 3. Database And Persistence

- [x] Drizzle schema exists.
- [x] Migrations create all v1 tables.
- [x] Profiles persist.
- [x] Macro targets persist as snapshots.
- [x] Weekly menus persist.
- [x] Day plans persist.
- [x] Menu meals persist.
- [x] Recipes persist.
- [x] Recipe ingredients persist.
- [x] Nutrition records persist.
- [x] Ingredient matches persist.
- [x] Nutrition estimates persist.
- [x] Preferences persist.
- [x] Saved recipes persist.
- [x] Generation jobs persist.
- [x] AI cache persists.

## 4. Spanish-First Onboarding

- [x] New profile defaults to Spanish.
- [x] Metric units are default.
- [x] Onboarding asks for profile name.
- [x] Onboarding asks for current weight.
- [x] Onboarding asks for target weight.
- [x] Onboarding asks for height.
- [x] Onboarding allows age to be skipped.
- [x] Onboarding allows biological sex to be skipped.
- [x] Onboarding defaults activity to lightly active.
- [x] Activity choices are explained.
- [x] Onboarding asks maintain/cut/bulk.
- [x] Onboarding asks balanced/high-protein/lower-carb/manual.
- [x] Onboarding collects likes, dislikes, and banned foods.
- [x] Onboarding ends by generating or starting generation of the first weekly menu.

## 5. Macro Target Policy

- [x] Mifflin-St Jeor calculation is implemented.
- [x] Activity multipliers are implemented: `1.4`, `1.5`, `1.6`, `1.8`, `2.0`.
- [x] New profiles default to `1.5` lightly active.
- [x] Maintain uses estimated TDEE.
- [x] Cut uses conservative/standard/aggressive deficit presets.
- [x] Bulk uses conservative/standard/aggressive surplus presets.
- [x] Protein calculation weight heuristic is implemented.
- [x] Protein defaults are implemented.
- [x] Fat floor is implemented.
- [x] Lower-carb cap is implemented.
- [x] Suggested targets are rounded.
- [x] Suggested targets are editable before saving.
- [x] Skipped age/sex requires accepting a rough estimate.
- [x] Under-18 automatic suggestions are disabled.
- [x] Impossible targets are detected before generation.
- [x] Spanish impossible-target copy is shown.

## 6. Nutrition Matching And Calculation

- [x] Recipes use structured ingredient lines.
- [x] Ingredient quantities can be normalized to grams/ml where possible.
- [x] Seed nutrition dataset exists for local v1.
- [x] External/source nutrition records can be imported into `source_foods`, `nutrition_records`, and `food_mappings`.
- [x] Open Food Facts barcode products can be fetched and imported into the source nutrition tables.
- [x] Open Food Facts import is exposed through the shared app action registry and MCP.
- [x] Generation, meal-edit, and calorie-adjustment scoring read the database nutrition catalog before falling back to seed foods.
- [x] Ingredient aliases work in Spanish and English.
- [x] User-confirmed ingredient aliases can be saved and reused by the scorer.
- [x] Ingredient matching returns confidence labels.
- [x] Per-ingredient nutrition is calculated.
- [x] Per-recipe nutrition is calculated.
- [x] Per-meal nutrition snapshots are saved.
- [x] Recipe confidence accounts for meaningful calorie-contributing ingredients.
- [x] AI-estimated nutrition is visibly marked as estimated.
- [x] Historical nutrition snapshots do not silently change.

## 7. LLM Provider

- [x] Server-side Codex OAuth provider adapter exists in `packages/ai`.
- [x] `CODEX_AUTH_PROFILE` is supported.
- [x] Default auth path is `~/.codex/auth.json`.
- [x] Tokens are refreshed server-side.
- [x] Tokens are never sent to the browser.
- [x] Provider status redacts token values.
- [x] Default model is `gpt-5.5`.
- [x] Default reasoning effort is `medium`.
- [x] Structured generation validates outputs before use.
- [x] Provider errors are redacted.

## 8. AI Planning Pipeline

- [x] `PlanningBrief` schema exists.
- [x] `WeekSkeleton` schema exists.
- [x] `RecipeCandidate` schema exists.
- [x] `MealReplacementProposal` schema exists.
- [x] `RepairRequest` schema exists.
- [x] `RepairResult` schema exists.
- [x] `GenerationSummary` schema exists.
- [x] Generation jobs have persisted status and logs. Rich async progress UI is deferred in Section 12.
- [x] Week skeleton generation exists and is LLM-first when the local Codex provider is configured.
- [x] Week skeleton fallback can be disabled with `ALLOW_WEEK_SKELETON_FALLBACK=false`.
- [x] Week skeleton fallback can be enabled/disabled from persisted local app settings.
- [x] Recipe candidate generation exists.
- [x] Recipe candidate generation is LLM-first when the local Codex provider is configured.
- [x] Deterministic recipe templates are explicit fallback only and still pass validation/scoring.
- [x] Template fallback can be disabled with `ALLOW_RECIPE_TEMPLATE_FALLBACK=false`.
- [x] Template fallback can be enabled/disabled from Perfil and MCP without editing env files.
- [x] Menu state surfaces fallback slots and recipe-source metadata.
- [x] Successful structured recipe generations are cached in `ai_cache`.
- [x] Successful structured week skeleton generations are cached in `ai_cache`.
- [x] Successful chat tool-planner calls are cached in `ai_cache`.
- [x] Successful menu-context chat responses are cached in `ai_cache`.
- [x] Successful generation-summary calls are cached in `ai_cache`.
- [x] Ingredient matching runs before finalization.
- [x] Deterministic ingredient catalog covers the initial templates plus a broader common-food set for LLM-generated recipes.
- [x] Ambiguous household units use food-specific serving conversions when available and downgrade confidence when falling back to generic estimates.
- [x] Deterministic menu scoring exists.
- [x] Weekly assembly runs bounded deterministic repair for repetition, daily calorie drift, banned foods, unknown nutrition, and low weekly protein before persistence.
- [x] Weekly repair traces include structured `RepairRequest` / `RepairResult` telemetry.
- [x] Deterministic targeted regeneration/replacement is bounded.
- [x] Unresolved repair remediation can regenerate the affected meal, affected day, or week from persisted day/slot context.
- [x] Full LLM repair-loop orchestration is deferred beyond the local v1 slice.
- [x] Weekly quality tests cover skeleton coverage, excessive repetition, absurd daily calorie drift, banned-food leakage, unknown nutrition, and hard-constraint repair.
- [x] Failure states are explicit in domain schemas and job storage.
- [x] Completed weekly menu is saved as structured rows.

## 9. Semana Screen

- [x] `Semana` is the primary screen after onboarding.
- [x] Selected profile is visible.
- [x] Profile deletion exists behind exact-name confirmation and returns an export snapshot.
- [x] Full local reset exists behind exact phrase confirmation and returns an export snapshot.
- [x] Week range is visible.
- [x] Daily calories/macros are visible.
- [x] Weekly target progress is visible.
- [x] Seven days are visible.
- [x] Breakfast, lunch, dinner, and snack are visible for each day.
- [x] Day lock control exists.
- [x] Meal lock control exists.
- [x] Meal regeneration control exists.
- [x] Day regeneration control exists.
- [x] Week regeneration control exists.
- [x] Regeneration previews are server-owned plans and confirmed regeneration applies the exact previewed plan or rejects stale state.
- [x] Nutrition confidence indicators appear when relevant.

## 10. Meal Detail And Editing

- [x] Meal detail shows recipe title.
- [x] Meal detail shows calories and macros.
- [x] Meal detail shows nutrition confidence.
- [x] Meal detail shows prep time.
- [x] Meal detail shows ingredients.
- [x] Meal detail shows steps.
- [x] Meal detail can star recipe.
- [x] Meal detail can lock meal.
- [x] Meal edit accepts natural-language request.
- [x] Meal edit uses the natural-language request to generate, filter, and score replacement candidates.
- [x] Meal edit shows three distinct replacement options when enough valid candidates exist.
- [x] Replacement options include closest nutrition, creative/delicious, and macro-optimized.
- [x] Replacement options show macro/calorie impact.
- [x] Selecting a replacement updates the meal.
- [x] Related replacement opportunities are detected.
- [x] User chooses whether the edit applies only to this meal or also to related meals.
- [x] Week-wide propagation and profile preference save require explicit confirmation.

## 11. Locks, Stars, And History

- [x] Individual meals can be locked/unlocked.
- [x] Entire days can be locked/unlocked.
- [x] Locked meals are preserved during regeneration.
- [x] Locked days are preserved during regeneration.
- [x] Recipes can be starred.
- [x] Recipes can be unstarred.
- [x] Starred recipes appear in `Recetas`.
- [x] Prior weekly menus appear in `Historial`.
- [x] Old menus preserve their original target/nutrition snapshots.

## 12. Generation Progress And Failures

Local v1 generation still executes inside requests by default, but weekly generation and long preview flows are now job-owned: the app creates a queued `generation_jobs` row with serialized generation or preview input, then a reusable runner moves the job to running and completed/failed/cancelled. The UI and MCP can read job status, logs, result metadata, failure code, retry count, and errors. Full background worker queues and streaming progress remain deferred.

- [x] App state exposes recent generation jobs for the active profile.
- [x] MCP exposes recent generation jobs.
- [x] Weekly generation can be enqueued without immediate execution.
- [x] Weekly generation has a reusable runner that executes a queued job.
- [x] MCP exposes enqueue and run tools for weekly generation jobs.
- [x] Regeneration and calorie preview plans can be queued and executed through shared app actions.
- [x] MCP exposes enqueue and run tools for preview generation jobs.
- [x] Queued/running generation and preview jobs can be cancelled from the app action registry, web UI, and MCP.
- [x] Semana shows failed/running jobs instead of hiding them in database logs.
- [x] Historial shows generation jobs alongside stored menus.
- [x] Failed jobs can be retried through a typed action.
- [x] Progress includes persisted week skeleton/building state in job logs.
- [x] Progress includes persisted recipe generation state in job logs.
- [x] Progress includes persisted nutrition/finalizing state in job logs.
- [x] Impossible targets failure is visible and actionable.
- [x] Low nutrition confidence failure includes persisted remediation steps.
- [x] Ambiguous ingredient failure includes persisted remediation steps.
- [x] Low nutrition confidence and ambiguous ingredient remediation can open a guided alias-mapping flow.
- [x] Banned-item conflict failure includes persisted remediation steps.
- [x] Generation-exhausted failure includes retry and persisted remediation steps.
- [x] Unresolved repair issues can surface persisted remediation steps for the affected day/slot.
- [x] Guided preference-relaxation remediation can remove selected dislikes/prohibited foods through a typed action.
- [x] Guided preference-relaxation remediation can retry the failed generation after saving selected changes.
- [x] Repair-specific regeneration actions are available from persisted repair notices.
- [x] Guided target-editing and fallback-policy remediation forms remain deferred.

## 13. In-App Chat

- [x] Chat is available in the app.
- [x] Chat uses active profile context.
- [x] Chat can inspect current menu context.
- [x] Chat can explain macros and tradeoffs.
- [x] Chat can propose meal changes.
- [x] Chat does not silently mutate profile preferences.
- [x] Chat does not silently mutate weekly menus.
- [x] Chat does not silently mutate locks or starred recipes.
- [x] Chat previews calorie target changes before applying them.
- [x] Calorie target changes explain porciones, rebalances, replacements, locks, and macro impact.
- [x] Pending calorie plans are rejected if the menu changed before confirmation.

## 14. MCP Server And Skill

- [x] MCP server starts locally.
- [x] Read-only tools exist.
- [x] Proposal tools exist.
- [x] Mutation tools exist.
- [x] `list_profiles` works.
- [x] `get_profile` works.
- [x] `get_weekly_menu` works.
- [x] `analyze_recipe_nutrition` works.
- [x] `save_ingredient_mapping` works through the shared app action registry.
- [x] `reset_local_data` works through the shared app action registry with exact phrase confirmation.
- [x] `suggest_meal_replacements` works.
- [x] `apply_similar_replacements` works through the shared app action registry.
- [x] `preview_calorie_adjustment_plan` works.
- [x] `enqueue_preview_generation_job` and `run_preview_generation_job` work for server-owned preview plans.
- [x] `cancel_generation_job` works for queued/running generation and preview jobs.
- [x] Mutation tools preserve locks and product rules.
- [x] Broad/persistent MCP changes require confirmation.
- [x] Companion skill exists.
- [x] Skill instructs agents to use deterministic nutrition before macro claims.
- [x] Skill instructs agents to respect profile locale.
- [x] Skill instructs agents to preserve locks.
- [x] Skill instructs agents to preview calorie rebalances and validate day/week fit.
- [x] Skill discourages pantry, grocery, and medical-diet expansion.

## 15. End-To-End Verification Scenario

- [x] Start local database and app.
- [x] Open the web app locally.
- [x] Create a Spanish profile.
- [x] Choose cut or bulk.
- [x] Review and save suggested macros.
- [x] Generate a weekly menu.
- [x] Confirm breakfast/lunch/dinner/snack exist for all seven days.
- [x] Confirm menu nutrition is calculated from ingredients.
- [x] Lock one meal.
- [x] Regenerate the week.
- [x] Confirm locked meal is unchanged.
- [x] Edit one meal with a natural-language request.
- [x] Select a replacement.
- [x] Confirm macro impact is shown.
- [x] Star one recipe.
- [x] Confirm recipe appears in `Recetas`.
- [x] Confirm old/current menu appears in `Historial`.
- [x] Ask chat about the current menu.
- [x] Use MCP to inspect profile and menu.

## Explicitly Deferred

- [x] Pantry inventory is deferred.
- [x] Grocery list generation is deferred.
- [x] Store pricing is deferred.
- [x] Budget optimization is deferred.
- [x] Clinical nutrition guidance is deferred.
- [x] Medical-diet programs are deferred.
- [x] Eating-disorder screening is deferred.
- [x] Medication-specific recommendations are deferred.
- [x] Multi-profile shared meals are deferred.
- [x] Hosted auth is deferred.
- [x] Hosted sync is deferred.
- [x] Full nutrition-source coverage is deferred beyond the local v1 seed and adapter boundaries.
- [x] Full async AI planning and repair orchestration UI is deferred beyond the local v1 deterministic pipeline.

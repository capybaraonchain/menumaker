# Mock And Fallback Inventory

## Purpose

This document tracks every known v1 shortcut, fallback, mock, stub, or incomplete production substitute in MenuMaker.

Not every item here is bad. Some are intentional local-v1 constraints. The point is to keep the boundary honest: if something is not the final product architecture, it should be named, scoped, and replaceable.

## Current Policy

- LLM recipe generation is the primary recipe source.
- Deterministic nutrition calculation is the authority for calories and macros.
- Deterministic recipe templates are fallback only.
- Local-first runtime is allowed for v1, but schema and service boundaries should remain compatible with hosted sync later.
- User-facing behavior should not be patched for one example request. If a fix only works for "aguacate", it is wrong.

## Inventory

| Area | Current Shortcut | Status | Where | Why It Exists | Risk | Replacement Path |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | Single local user stub | Intentional v1 local stub | `packages/db/src/env.ts`, `packages/db/src/appService.ts`, `packages/db/src/appActions.ts` | Local personal runtime on the MacBook Air M2 | No real multi-user isolation; RLS/auth not exercised | Add hosted auth, real user identity, session mapping, and RLS policy tests while preserving existing `user_id` columns |
| Sync | Hosted sync deferred | Intentional v1 deferral | ADR 0003, ADR 0007, checklist | Personal local app first | Mobile/desktop state only works against the local server/database | Supabase/Postgres hosted deployment, account system, migrations, RLS, profile ownership validation |
| Nutrition Data | Expanded local deterministic catalog plus user-confirmed aliases, still not full source coverage | Improved seed-backed substitute | `packages/nutrition/src/seedFoods.ts`, `packages/db/src/seed.ts`, `packages/nutrition/src/engine.ts`, `packages/db/src/appService.ts` | Enables deterministic calories/macros before BEDCA/USDA/Open Food Facts import exists, and lets the user repair unknown aliases | Coverage is broader, but still curated and not authoritative enough for every ingredient | Add source adapters, import/version source records, richer serving/household unit data, source selection, and confidence UI |
| Nutrition Source Tables | Source schemas are populated from the local seed catalog | Schema-ready but still seed-sourced | `packages/db/src/migrate.ts`, `packages/db/src/schema.ts`, `packages/db/src/seed.ts` | Keeps the future data model in place and mirrors deterministic catalog rows | "database" confidence currently means local seed-backed, not full authoritative coverage | Populate `source_foods`, `nutrition_records`, and `food_mappings` from real datasets and record dataset versions |
| Unit Conversion | Generic units exist, with food-specific conversions for common ambiguous servings | Improved deterministic fallback | `packages/nutrition/src/engine.ts`, `packages/nutrition/src/seedFoods.ts` | Lets recipes with `cucharada`, `unidad`, `taza`, or `rebanada` calculate more accurately | Foods without a specific serving conversion still fall back to estimated generic units | Expand per-food household conversions and prefer grams/ml in generated recipes |
| Recipe Generation | Deterministic recipe templates remain as fallback, controlled by persisted local fallback policy with env as default | Gated, surfaced, and app-configurable | `packages/nutrition/src/recipes.ts`, `packages/db/src/appService.ts`, `packages/db/src/migrate.ts`, `apps/web/app/page.tsx`, `apps/mcp/src/server.ts` | Keeps app usable if Codex OAuth is missing, stale, slow, or returns too few valid candidates | If enabled, templates can still mask provider-quality problems, but the setting is visible and mutable from Perfil/MCP | Keep fallback disabled during live-quality testing; reduce dependence as nutrition coverage and LLM retry/caching improve |
| Recipe Candidate Scoring | Week selection uses deterministic scoring and bounded repair, not a full optimizer | Pragmatic v1 heuristic | `packages/db/src/appService.ts`, `packages/db/src/weekPlanning.test.ts` | Avoids obvious repeats, daily calorie drift, banned-food leakage, unknown nutrition, and weak weekly protein before persistence | May miss better global menu combinations | Add a proper menu-level optimizer with candidate pools, constraints, beam search/local search, and richer scoring traces |
| Week Skeleton | Weekly generation now creates a first-class `WeekSkeleton` before recipe candidates | LLM-first with app-configurable local fallback | `packages/ai/src/planning.ts`, `packages/db/src/appService.ts`, ADR 0005 | Variety planning is passed into recipe generation and stored in generation settings | Deterministic fallback still exists for missing/failed provider and no user-facing skeleton editor exists | Add richer skeleton review/editing, async progress, and source-specific failure UI |
| Repair Loop | Weekly assembly has bounded deterministic repair for repetition, daily calorie drift, banned-food leakage, unknown nutrition, and low weekly protein | Partial live implementation | `packages/db/src/appService.ts`, `packages/db/src/caloriePlanner.ts`, `packages/db/src/weekPlanning.test.ts` | Repairs obvious quality failures using the same validated candidate pools before persistence and records structured `RepairRequest` / `RepairResult` telemetry in the menu/job trace | Not yet a full LLM repair controller with repair jobs or LLM-authored proposals | Add async repair jobs, retry logs, LLM repair proposals, and code-specific failure explanations when deterministic repair cannot fix a menu |
| Generation Jobs | Weekly generation now uses a queued job row plus a job runner; app state, UI, and MCP expose job status and retry | Partial live implementation | `packages/db/src/appService.ts`, `packages/db/src/appActions.ts`, `apps/web/app/page.tsx`, `apps/mcp/src/server.ts`, `generation_jobs` table | Weekly generation input is serialized into the job, then a runner moves it queued -> running -> completed/failed; users and agents can inspect real logs/failure codes | Local v1 still runs jobs immediately inside the request; no background worker, streaming, cancellation, or preview-job execution yet | Move job execution to a worker/queue, stream progress, support cancellation, and run previews as jobs |
| AI Cache | Successful structured recipe, week-skeleton, chat-planner, menu-chat, and generation-summary calls are cached | Partial live implementation | `packages/db/src/appService.ts`, `packages/db/src/migrate.ts`, `packages/db/src/schema.ts`, `packages/ai/src/generationSummary.ts`, `apps/web/app/api/chat/route.ts` | Reduces repeated recipe/skeleton/chat/summary calls and records generated outputs | Repair LLM proposals still lack cache records because that live workflow does not exist yet; remediation is deterministic and persisted, not an AI cache user | Extend cache helper to future repair proposals |
| MCP Regeneration Previews | Regeneration previews now return server-owned plans with candidate recipes, menu hash, expected macro impact, warnings, and confirmation copy | Live for regeneration previews; broader preview coverage still partial | `apps/mcp/src/server.ts`, `packages/db/src/appService.ts`, `packages/db/src/appActions.ts` | External agents can inspect the exact regeneration plan before confirmation | Still synchronous and can be slow while candidates are generated | Move preview generation into async jobs with progress logs and cancellation |
| Chat Agent | Chat is command-surface plus limited planner, not a full tool-loop agent | Partial agentic implementation | `apps/web/app/api/chat/route.ts`, `packages/ai/src/chat.ts`, `packages/db/src/appActions.ts` | Keeps mutations behind typed actions and confirmation gates | Ambiguous multi-step requests may fall back to plain chat or shallow intents | Add full action registry planning loop, tool result memory, multi-step planning, state diffs, and explicit refusal/clarification policy |
| Chat Intent Parsing | Some chat commands use regex/deterministic heuristics before LLM planner | Intentional safety layer, incomplete coverage | `apps/web/app/api/chat/route.ts` | Reliable handling for high-risk commands like calorie changes | Coverage is uneven; phrasing outside heuristics may not trigger tools | Expand typed intents and tests; let LLM propose actions only through schemas, then deterministic validators decide |
| Local LLM Provider | Uses local Codex OAuth transport | Local-personal runtime dependency | `packages/ai/src/codexOAuth.ts` | Matches the user's current Mac setup and avoids browser tokens | Not a hosted production auth/key-management story | Keep provider boundary; add OpenAI API or hosted provider config with server-side secrets |
| Nutrition Confidence UX | Low-confidence/unknown ingredient failures can open a guided ingredient-mapping flow | Partial live implementation | `packages/nutrition/src/engine.ts`, `packages/db/src/appService.ts`, `apps/web/app/page.tsx`, `apps/mcp/src/server.ts` | v1 rejects bad candidates before UI, but the user can now save an alias and retry through the same deterministic scorer | User can map aliases to existing seed foods only; there is no source-record picker or custom per-100g override yet | Add ingredient source selection, custom user foods, confidence explanations, and imported source records |
| Failure UI | Generation failures are visible from persisted jobs with Spanish explanations, retry action, code-specific remediation metadata, guided preference relaxation, and guided ingredient mapping | Partial live implementation | `apps/web/app/page.tsx`, `packages/db/src/appService.ts`, `packages/db/src/appActions.ts`, `packages/db/src/remediation.ts`, `apps/mcp/src/server.ts` | Failed/running jobs appear on Semana/Historial, failed jobs include specific next steps, preference constraints can be relaxed, and unknown aliases can be mapped through typed actions | Target editing, fallback toggling, and repair-specific regeneration are still not guided forms | Add guided remediation flows for target edits, fallback policy, and repair-specific regeneration |
| Data Reset/Admin | Profile deletion and full local reset are app-native with exact confirmation and export snapshots | Partial live implementation | `packages/db/src/appService.ts`, `packages/db/src/appActions.ts`, `apps/web/app/page.tsx`, `apps/mcp/src/server.ts` | Personal local app needs safe cleanup during testing and iteration | No restore/import flow yet; hosted account deletion semantics are not implemented | Add restore/import and hosted account deletion semantics |
| Evaluation | Weekly quality scenarios now cover skeleton coverage, repetition, calorie drift, banned-food leakage, unknown nutrition, and repair telemetry | Partial quality harness | `packages/db/src/weekPlanning.test.ts`, `packages/db/src/caloriePlanner.test.ts` | Hard constraints and obvious weekly quality regressions are covered before persistence | Deliciousness, edit-flow variety, and real LLM output quality still need fixtures | Add golden scenario tests and scored fixtures for meal edit, LLM candidates, and subjective recipe quality |

## Items That Are Not Mocks

These are intentional product constraints, not shortcuts:

- One serving per meal for one profile.
- Spanish default for new profiles.
- Adult-only macro suggestions.
- No pantry, grocery list, store pricing, or clinical nutrition in v1.
- Confirmation gates before week-wide or persistent changes.
- Locked meals and locked days being preserved instead of optimized around aggressively.

## Recently Removed Reward-Hacky Shortcut

The previous avocado-specific fallback recipes were removed from `packages/nutrition/src/recipes.ts`.

The edit flow should now use:

```text
user request -> LLM recipe candidates -> deterministic nutrition/macro/menu scoring -> best options -> user chooses scope -> mutation
```

If the local provider is unavailable or too few candidates pass validation, fallback templates can still fill the pool, but they must pass the same filtering and scoring rules.

## Priority Replacement Order

1. Expand deterministic nutrition coverage and unit conversions.
2. Extend AI cache and trace records to future repair proposals.
3. Expand repair-loop orchestration from bounded deterministic repair with telemetry to structured async repair jobs.
4. Add guided remediation flows for failed generation and unresolved repair cases.
5. Move job execution and long preview flows to background async workers.
6. Add hosted auth/sync only when local product behavior is solid.

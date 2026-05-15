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
| Nutrition Data | Expanded local deterministic catalog, still not full source coverage | Improved seed-backed substitute | `packages/nutrition/src/seedFoods.ts`, `packages/db/src/seed.ts`, `packages/nutrition/src/engine.ts` | Enables deterministic calories/macros before BEDCA/USDA/Open Food Facts import exists | Coverage is broader, but still curated and not authoritative enough for every ingredient | Add source adapters, import/version source records, richer aliases, serving/household unit data, and confidence UI |
| Nutrition Source Tables | Source schemas are populated from the local seed catalog | Schema-ready but still seed-sourced | `packages/db/src/migrate.ts`, `packages/db/src/schema.ts`, `packages/db/src/seed.ts` | Keeps the future data model in place and mirrors deterministic catalog rows | "database" confidence currently means local seed-backed, not full authoritative coverage | Populate `source_foods`, `nutrition_records`, and `food_mappings` from real datasets and record dataset versions |
| Unit Conversion | Generic units exist, with food-specific conversions for common ambiguous servings | Improved deterministic fallback | `packages/nutrition/src/engine.ts`, `packages/nutrition/src/seedFoods.ts` | Lets recipes with `cucharada`, `unidad`, `taza`, or `rebanada` calculate more accurately | Foods without a specific serving conversion still fall back to estimated generic units | Expand per-food household conversions and prefer grams/ml in generated recipes |
| Recipe Generation | Deterministic recipe templates remain as fallback behind `ALLOW_RECIPE_TEMPLATE_FALLBACK` | Gated and surfaced | `packages/nutrition/src/recipes.ts`, `packages/db/src/appService.ts`, `packages/db/src/caloriePlanner.ts` | Keeps app usable if Codex OAuth is missing, stale, slow, or returns too few valid candidates | Could still hide provider failures if the env var remains enabled | Run live tests with `ALLOW_RECIPE_TEMPLATE_FALLBACK=false`; reduce dependence as nutrition coverage and LLM retry/caching improve |
| Recipe Candidate Scoring | Week selection uses deterministic scoring, not a full optimizer | Pragmatic v1 heuristic | `packages/db/src/appService.ts` | Good enough to avoid repeats and fit rough slot targets | May miss better global menu combinations | Add a proper menu-level optimizer with candidate pools, constraints, beam search/local search, and explicit scoring traces |
| Week Skeleton | No separate LLM-generated week skeleton object yet | ADR shortcut | `packages/db/src/appService.ts`, ADR 0005 | Direct per-slot recipe pools were faster to ship | Variety planning happens during recipe selection, not as a first-class plan | Implement `WeekSkeleton` generation, validate it, then generate candidates against skeleton slots |
| Repair Loop | No full iterative AI repair controller | Partial deterministic implementation | `packages/db/src/appService.ts`, `packages/db/src/caloriePlanner.ts` | Current repair paths cover calorie adjustment and replacement, not all failures | Some failed generations may fall back or fail instead of targeted repair | Add bounded repair jobs with structured `RepairRequest` / `RepairResult`, retry limits, and failure explanations |
| Generation Jobs | Jobs are mostly synchronous request-local work | Active v1 shortcut | `packages/db/src/appService.ts`, `generation_jobs` table | Simpler local app flow | Long LLM calls block request; progress UI is limited | Move generation to worker/queue, stream progress, persist step logs, support cancel/retry |
| AI Cache | Successful structured recipe generations are cached; chat/planner calls are not yet cached | Partial live implementation | `packages/db/src/appService.ts`, `packages/db/src/migrate.ts`, `packages/db/src/schema.ts` | Reduces repeated recipe-generation calls and records generated outputs | Other AI calls still lack cache/trace records | Extend cache helper to chat planning, week skeleton, repair requests, and generation summaries |
| MCP Regeneration Previews | Regeneration previews now return server-owned plans with candidate recipes, menu hash, expected macro impact, warnings, and confirmation copy | Live for regeneration previews; broader preview coverage still partial | `apps/mcp/src/server.ts`, `packages/db/src/appService.ts`, `packages/db/src/appActions.ts` | External agents can inspect the exact regeneration plan before confirmation | Still synchronous and can be slow while candidates are generated | Move preview generation into async jobs with progress logs and cancellation |
| Chat Agent | Chat is command-surface plus limited planner, not a full tool-loop agent | Partial agentic implementation | `apps/web/app/api/chat/route.ts`, `packages/ai/src/chat.ts`, `packages/db/src/appActions.ts` | Keeps mutations behind typed actions and confirmation gates | Ambiguous multi-step requests may fall back to plain chat or shallow intents | Add full action registry planning loop, tool result memory, multi-step planning, state diffs, and explicit refusal/clarification policy |
| Chat Intent Parsing | Some chat commands use regex/deterministic heuristics before LLM planner | Intentional safety layer, incomplete coverage | `apps/web/app/api/chat/route.ts` | Reliable handling for high-risk commands like calorie changes | Coverage is uneven; phrasing outside heuristics may not trigger tools | Expand typed intents and tests; let LLM propose actions only through schemas, then deterministic validators decide |
| Local LLM Provider | Uses local Codex OAuth transport | Local-personal runtime dependency | `packages/ai/src/codexOAuth.ts` | Matches the user's current Mac setup and avoids browser tokens | Not a hosted production auth/key-management story | Keep provider boundary; add OpenAI API or hosted provider config with server-side secrets |
| Nutrition Confidence UX | Low-confidence/unknown ingredient handling is not a rich user workflow | Partial implementation | `packages/nutrition/src/engine.ts`, UI confidence labels | v1 rejects many bad generated candidates before UI | User cannot easily fix mappings or approve an ingredient match | Add ingredient-match review, mapping correction, "use this source" flow, and confidence explanations |
| Failure UI | Dedicated generation failure screens are deferred | Explicit v1 deferral | `docs/v1-completion-checklist.md`, generation job fields | Initial app focuses on happy path plus impossible-target errors | Failures can feel abrupt or generic | Add failure screens for low nutrition confidence, ambiguous ingredient, banned conflict, repetition conflict, generation exhausted |
| Data Reset/Admin | Profile deletion is app-native with exact-name confirmation and export snapshot; full all-data reset remains dev-only | Partial live implementation | `packages/db/src/appService.ts`, `packages/db/src/appActions.ts`, `apps/web/app/page.tsx`, `apps/mcp/src/server.ts` | Personal local app needs safe profile cleanup during testing | No restore/import flow yet; full local wipe still requires dev tooling | Add restore/import, full local reset with typed confirmation, and hosted account deletion semantics |
| Evaluation | No formal recipe quality evaluation suite | Missing quality harness | Tests focus mostly on calorie planner | Manual smoke tests caught issues so far | Deliciousness, variety, and "not repetitive" can regress quietly | Add golden scenario tests and scored fixtures for meal edit, week generation, banned foods, and variety |

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
2. Extend AI cache and trace records beyond recipe generation.
3. Add full week skeleton generation and repair-loop orchestration.
4. Add richer generation failure UI.
5. Move long preview/generation flows to async jobs.
6. Add hosted auth/sync only when local product behavior is solid.

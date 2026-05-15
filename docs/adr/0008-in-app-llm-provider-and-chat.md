# ADR 0008: In-App LLM Provider And Chat

## Status

Accepted

## Date

2026-05-15

## Context

The app needs in-app LLM features for weekly menu generation, meal editing, replacement suggestions, explanations, and chat. The first working v1 runs locally on the user's MacBook Air M2.

The user has an existing local project at `/Users/capybara/Documents/New project 2` that uses local Codex OAuth tokens for server-side LLM calls. That project keeps token values on the server, reads `~/.codex/auth.json` by default, supports `CODEX_AUTH_PROFILE`, refreshes tokens server-side, and defaults to `CODEX_MODEL=gpt-5.5`.

For this app, the desired default is GPT-5.5 with medium reasoning for a fast in-app experience.

## Decision

Use a server-side LLM provider adapter based on the existing Codex OAuth pattern.

Default v1 model settings:

```text
CODEX_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=medium
```

The provider must be encapsulated behind an application-level interface so the app can later switch to another OpenAI API path or hosted provider without rewriting planning, chat, or nutrition logic.

## Provider Boundary

LLM calls should go through a provider interface in `packages/ai`.

The provider should support:

- Strict structured generation for planning pipeline objects.
- Streaming or non-streaming assistant text for in-app chat.
- Token refresh.
- Redacted error reporting.
- Configurable model and reasoning effort through environment variables.
- Timeouts and retry limits.

Application code should call task-shaped functions such as:

- `generateWeekSkeleton`
- `generateRecipeCandidates`
- `generateMealReplacementOptions`
- `repairMenuPlan`
- `chatWithMenuContext`

Application code should not call provider-specific HTTP endpoints directly outside the provider adapter.

Recipe creation, weekly generation, regeneration, meal editing, and calorie-adjustment replacement candidates should prefer these provider-backed task functions. A deterministic template set may exist for local fallback, but it must be explicit, validated by the same deterministic pipeline, and not become the normal product path.

Local live testing may set `ALLOW_RECIPE_TEMPLATE_FALLBACK=false` to disable template fallback. In that mode the app should surface provider or validation failures instead of pretending a live-generated recipe exists.

## Token Handling

Tokens must stay server-side.

The browser must never receive:

- Access tokens.
- Refresh tokens.
- ID tokens.
- Raw auth profile contents.

The server may expose a status object with:

- Whether the provider is configured.
- Auth profile path.
- Auth profile shape.
- Selected model.
- Selected reasoning effort.
- Whether an access token exists.
- Whether a refresh token exists.
- Whether an account ID exists.
- Whether the token appears stale.

The status object must not include token values.

## Auth Profile Resolution

The provider should support:

- `CODEX_AUTH_PROFILE` override.
- Default fallback to `~/.codex/auth.json`.

Additional local fallback paths may be allowed for development, but they should be explicit configuration rather than hidden product assumptions.

## Model And Reasoning Policy

Default to:

- `gpt-5.5`
- `medium` reasoning effort

This is the v1 default for fast in-app chat and generation.

The model and reasoning effort must remain configurable by environment variables:

- `CODEX_MODEL`
- `CODEX_REASONING_EFFORT`

Higher reasoning effort may be used manually during debugging or evaluation, but the product default should remain medium unless a later ADR changes it.

## Structured Generation

Planning pipeline calls should use strict structured outputs where possible.

Structured outputs must be validated by application code before being trusted.

The provider should support schemas from ADR 0005:

- `PlanningBrief`
- `WeekSkeleton`
- `RecipeCandidate`
- `MealReplacementProposal`
- `RepairRequest`
- `RepairResult`
- `GenerationSummary`

The model must not be treated as authoritative for nutrition. Calories and macros still come from deterministic nutrition calculation.

## In-App Chat

In-app chat should be scoped to the active profile and current app context.

The chat context may include:

- Active profile.
- Current weekly menu.
- Selected day or meal.
- Macro targets.
- Locks.
- Preferences.
- Relevant nutrition confidence warnings.

Chat should be able to explain, propose, and guide. Durable changes should still go through the same proposal and mutation services used by the UI and MCP server.

The chat should not silently mutate:

- Profile preferences.
- Macro targets.
- Weekly menus.
- Meal locks.
- Day locks.
- Starred recipes.

When chat infers a durable change, it should return or trigger a proposal that the user can confirm.

For calorie target changes, chat should use the calorie adjustment policy from ADR 0009. The assistant should show a summarized plan before confirmation, including portion changes, ingredient rebalances, recipe replacements, preserved locks, macro impact, and warnings. The chat should not apply the target change until the user confirms the pending action.

## Local Runtime

For v1, the LLM provider runs from the local server process alongside the web app and local database.

No hosted OpenAI key management, hosted auth, or cloud deployment is required before the first working app.

The local provider must still use redaction and server-only token handling so the code is not throwaway when hosted sync or deployment is added later.

## Consequences

Benefits:

- Reuses a local token pattern that already works on this machine.
- Keeps tokens out of the browser.
- Gives fast GPT-5.5 medium behavior by default.
- Keeps planning and chat logic provider-agnostic.
- Preserves the strict structured-output policy from ADR 0005.

Tradeoffs:

- Codex OAuth transport is a local/personal runtime dependency.
- The provider adapter must be isolated so the app can switch providers later.
- In-app chat needs proposal/confirmation plumbing instead of direct mutation shortcuts.
- Provider status and errors need careful redaction.

## Open Questions

- None currently.

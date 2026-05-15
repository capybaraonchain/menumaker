# ADR 0006: UX Navigation And Core Screens

## Status

Accepted

## Date

2026-05-15

## Context

The app is a Spanish-first, mobile-first weekly diet planner. The product value is the operational weekly menu: creating it, inspecting it, editing meals, preserving liked meals, and regenerating parts of the week without breaking constraints.

The v1 UI should not feel like a landing page or an analytics dashboard. The first useful screen after onboarding should be the current weekly menu.

## Decision

Use a mobile-first app structure with four primary navigation areas:

1. `Semana`: current weekly menu.
2. `Recetas`: starred and saved recipes.
3. `Historial`: previous weekly menus.
4. `Perfil`: profile, preferences, targets, and settings.

Profile switching should be available from the top of main screens because menus, preferences, targets, saved recipes, and history are profile-scoped.

## Navigation Model

Use bottom navigation for primary mobile navigation:

- `Semana`
- `Recetas`
- `Historial`
- `Perfil`

The current profile should be visible near the top of primary screens. The user should be able to switch profiles without going deep into settings.

## Onboarding Flow

The Spanish-first onboarding flow:

1. Welcome and create first profile.
2. Profile basics.
3. Body and goal setup.
4. Goal selection.
5. Macro mode selection.
6. Suggested macro review.
7. Food preferences.
8. Generate first week.

Profile basics:

- Name.
- Language, default Spanish.
- Metric units by default.

Body and goal setup:

- Current weight.
- Target weight.
- Height.
- Optional age.
- Optional biological sex.
- Activity level, default lightly active.

Goal selection:

- Maintain.
- Cut.
- Bulk.

Macro mode selection:

- Balanced.
- High-protein.
- Lower-carb.
- Manual.

Suggested macro review should show:

- Estimated maintenance calories.
- Selected goal adjustment.
- Final calorie target.
- Protein target.
- Carbohydrate target or range.
- Fat target or range.
- Confidence label.
- Editable fields.

Food preferences should collect:

- Banned foods.
- Dislikes.
- Likes.

The onboarding flow should end by generating the first weekly menu.

## Semana Screen

`Semana` is the main app surface.

It should show:

- Selected profile.
- Week range.
- Daily calorie and macro summary.
- Weekly target progress.
- Seven days.
- Breakfast, lunch, dinner, and snack for each day.
- Lock controls for days and meals.
- Regenerate controls for meals, days, and the week.
- Nutrition confidence indicators when values are estimated or low-confidence.

The actual meals should be visible and actionable. They should not be buried behind a dashboard.

## Meal Detail Screen

Meal detail should show:

- Recipe title.
- Calories and macros.
- Nutrition confidence.
- Preparation time.
- Ingredients.
- Steps.
- Star recipe action.
- Lock meal action.
- Edit meal action.

Ingredient source and match confidence may be hidden behind an expandable detail section.

## Meal Edit Flow

For a natural-language meal edit, the UI should:

1. Accept a user request.
2. Show three replacement options.
3. Show macro and calorie impact for each option.
4. Let the user select one.
5. Ask whether related changes should be applied elsewhere.
6. Ask whether the preference should be remembered.

The three replacement options should be:

- Closest nutritional match.
- More delicious or creative alternative.
- Macro-optimized alternative.

Preference memory choices:

- `Solo este plato`.
- `Esta semana`.
- `Guardar como preferencia`.

## Generation Progress

Generation should have visible progress states:

- Building week skeleton.
- Generating recipes.
- Matching nutrition.
- Balancing menu.
- Finalizing.

Spanish UI copy should be used for Spanish profiles.

V1 exposes these states from persisted `generation_jobs` rows. Semana should surface currently running or failed jobs, and Historial should show recent generation jobs alongside stored menus. This is not yet a streaming worker UI, but failures and progress must not remain database-only.

Failure states should be visible and actionable from persisted job metadata:

- Impossible targets.
- Low nutrition confidence.
- Ambiguous ingredient.
- Banned-item conflict.
- Generation exhausted.

The UI should explain what happened and offer the next reasonable action. Local v1 now stores deterministic remediation metadata on failed jobs and unresolved repair issues, so Semana and Historial can show specific next steps instead of a generic retry-only message.

For failed generation jobs, the first safe action is still `Reintentar`. Guided remediation forms can add editable ingredient mapping, preference relaxation, and target-adjustment flows later.

## Perfil Screen

`Perfil` should manage:

- Profile switcher.
- Create profile.
- Macro targets.
- Goal settings.
- Activity level.
- Preferences.
- Banned foods.
- Language.
- Unit system.
- Protein calculation weight.

## Recetas Screen

`Recetas` should show starred recipes.

Users should be able to:

- View a recipe.
- Unstar a recipe.
- Use a starred recipe in a future weekly menu.

Assigning a starred recipe to a specific future meal can be added later if needed.

## Historial Screen

`Historial` should show prior weekly menus.

Users should be able to:

- View an old menu.
- Duplicate or regenerate from an old menu.
- Inspect previous targets and nutrition snapshots.

## UX Principle

The app is an operational planner.

The primary experience is the current weekly menu with direct controls for editing, locking, starring, and regenerating. Supporting analytics should not displace the weekly menu as the main surface.

## Consequences

Benefits:

- The main screen directly reflects the product's core value.
- Spanish-first onboarding is explicit.
- Profile-scoped data remains visible and understandable.
- Generation and failure states are not hidden.
- Meal editing has a clear confirmation flow.

Tradeoffs:

- The `Semana` screen carries a lot of product responsibility.
- Mobile layout needs careful information density.
- Generation progress and failure UI must be implemented early, not left as logs.
- Profile switching must be available without cluttering the screen.

## Open Questions

- None currently.

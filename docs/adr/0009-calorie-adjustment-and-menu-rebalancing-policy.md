# ADR 0009: Calorie Adjustment And Menu Rebalancing Policy

## Status

Accepted

## Date

2026-05-15

## Context

Changing a profile's calorie target should not blindly scale every ingredient. Proportional scaling is sometimes correct, but it can make small meals unsatisfying, reduce protein too much, or preserve recipes that no longer fit the daily and weekly macro plan.

The app needs a deterministic policy that can explain what will change before applying it, while using AI-generated recipe candidates when a replacement is better than shrinking or stretching the current recipe. Nutrition and acceptance decisions remain deterministic.

## Decision

Use a hybrid calorie adjustment plan before mutating the menu.

For each target change, the app creates a `CalorieAdjustmentPlan` containing:

- Previous and target calories.
- Base menu ID and hash.
- Per-meal decisions.
- Daily and weekly nutrition impact.
- Warnings.
- Spanish confirmation summary.

Per-meal decisions are:

- `portion_resize`: same recipe, uniform quantity adjustment.
- `ingredient_rebalance`: same recipe concept, but dense or flexible ingredients change differently.
- `recipe_replacement`: a different recipe candidate validated against the meal, day, and week.
- `preserve_locked`: locked day or meal is copied exactly.

The app applies the exact server-owned plan after confirmation. If the current menu hash differs from the previewed menu hash, the mutation is rejected and the user must generate a fresh preview.

Recipe-replacement candidates in the plan should come from the same LLM-first recipe pipeline used by weekly generation and meal editing. Deterministic templates are fallback only when the provider is unavailable, fails, or cannot produce enough valid candidates.

## Scoring Policy

The optimizer prioritizes quality and satiety over minimizing changes.

Hard constraints:

- Preserve locked days and meals.
- Reject impossible macro targets.
- Reject banned ingredients.
- Reject recipes over the 2-hour preparation cap.
- Treat unknown nutrition in meaningful ingredients as a failure or strong warning.

Soft scoring:

- Weekly calorie and macro fit.
- Daily calorie and protein fit.
- Estimated volume and satiety.
- Protein density, fiber, and vegetable or fruit contribution.
- Culinary integrity.
- Variety and preference fit.
- Change cost.
- Extra replacement cost for starred recipes.

Weekly target fit is more important than perfect daily balance, but days should not be wildly over or under target.

## Chat, MCP, And Skill Contract

Chat must preview a summarized plan before applying calorie target changes.

MCP must expose a proposal tool:

- `preview_calorie_adjustment_plan`

The existing mutation path remains compatible:

- `apply_calorie_target_change`

When possible, callers pass the previewed plan to the mutation. If no plan is passed, the service creates one server-side before applying.

The companion skill must instruct agents to preview calorie adjustments, validate recipes against day and week targets, preserve locks, and explain whether changes were porciones, rebalances, or replacements.

## Consequences

Benefits:

- Calorie changes are explainable before confirmation.
- Small meals are less likely to become unsatisfying.
- Recipe replacements are chosen only when they improve the whole menu.
- The same policy works from UI, chat, MCP, and skill-driven agents.

Tradeoffs:

- The planner is more complex than proportional scaling.
- Preview and apply can fail if the menu changes in between.
- Scoring weights will need tuning as the recipe database grows.

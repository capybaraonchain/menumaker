# ADR 0005: AI Planning Pipeline

## Status

Accepted

## Date

2026-05-15

## Context

The app uses AI to generate varied, delicious weekly menus and meal replacements. However, AI output must be validated against deterministic nutrition, profile constraints, ingredient matching, and user-confirmed preferences.

The app should not ask the model to produce a finished weekly menu in one unverified step. Weekly diet generation needs a staged pipeline where AI proposes, deterministic code validates, and the planner repairs.

## Decision

Use a staged AI planning pipeline:

1. Build planning brief.
2. Generate week skeleton.
3. Generate structured recipe candidates.
4. Normalize and match ingredients.
5. Score the menu.
6. Repair failed or weak parts.
7. Finalize and save snapshots.

The AI is allowed to be creative. It is not allowed to be authoritative about calories or macros.

## Planning Brief

The planning brief is the deterministic input package for generation.

It should include:

- Profile.
- Locale and generation language.
- Weekly target snapshot.
- Calorie and macro tolerances.
- Goal: maintain, cut, or bulk.
- Optional macro mode, such as high-protein or lower-carb.
- Banned foods.
- Likes, dislikes, and soft preferences.
- Starred recipes.
- Locked days and locked meals.
- Meal slots: breakfast, lunch, dinner, snack.
- Preparation time maximum: 2 hours.
- Variety policy.
- Existing weekly menu context when regenerating.

The brief should be assembled by application code, not invented by the model.

## Week Skeleton Generation

The first AI step should generate a week skeleton, not full recipes.

The week skeleton should include:

- Day.
- Meal slot.
- Meal title.
- Cuisine or style.
- Main protein.
- Main carbohydrate source.
- Main fat source.
- Vegetable or fruit focus when relevant.
- Variety tags.
- Rough calorie and macro intent per meal.

This step is responsible for global variety. It helps prevent repeated proteins, cuisines, textures, and meal formats before full recipes are generated.

## Structured Recipe Candidate Generation

Recipe candidates should be generated in batches.

Each recipe candidate must be structured and include:

- Title.
- Locale.
- Description.
- Servings, fixed to 1 for v1.
- Preparation time.
- Ingredients with amounts and units.
- Preparation state for ingredients when relevant.
- Steps.
- Cuisine or style.
- Flavor profile.
- Tags.
- Banned-item self-check.

Recipe generation must respect:

- Banned ingredients.
- Profile dislikes.
- 2-hour preparation cap.
- One serving per meal slot.
- Spanish generation for Spanish profiles.

## Ingredient Normalization And Nutrition

Every recipe candidate must pass through the nutrition matching pipeline from ADR 0004.

For each ingredient:

- Normalize text.
- Normalize quantity.
- Match to a nutrition record.
- Calculate nutrition.
- Assign confidence.

The model's nutrition estimates must not be accepted as final macro data. Deterministic nutrition calculation owns calories and macros.

## Menu Scoring

The deterministic planner scores candidate menus against:

- Hard constraints.
- Daily calories.
- Weekly calories.
- Daily macro targets.
- Weekly macro averages.
- Protein minimums.
- Carbohydrate and fat flexibility.
- Variety.
- Preparation time.
- Preference fit.
- Nutrition confidence.
- Recipe completeness.

Hard constraints include:

- Banned foods.
- Explicit profile dislikes when marked as hard bans.
- Locked meals.
- Locked days.
- Impossible macro targets.

The planner should prefer weekly averages over perfect per-meal balance.

## Repair Loop

If a generated menu fails or scores poorly, the system should repair targeted parts instead of regenerating everything blindly.

Repair actions may include:

- Adjust ingredient quantities.
- Swap one recipe.
- Regenerate one meal.
- Regenerate one day.
- Rebalance carbohydrates and fat.
- Replace an ingredient.
- Ask the user when an ambiguity blocks progress.

The repair loop must have a retry limit. If the retry limit is reached, the generation job should return a clear failure state instead of looping indefinitely.

## Finalization

When a menu passes validation, save:

- Weekly menu.
- Day plans.
- Menu meals.
- Structured recipes.
- Recipe ingredients.
- Ingredient matches.
- Nutrition snapshots.
- Generation job logs.
- Confidence summary.
- User-facing explanation summary.

Finalized menus should follow the snapshot policy from ADR 0003 and ADR 0004.

## Meal Editing Pipeline

For a natural-language edit such as:

> No quiero brócoli en este plato.

The app should:

1. Parse the edit intent.
2. Generate three replacement options.
3. Calculate deterministic nutrition for each replacement.
4. Show macro and calorie impact.
5. Let the user select a replacement.
6. Detect related meals in the current week.
7. Ask whether to apply similar replacements elsewhere.
8. Ask whether to save the preference to the profile.

Replacement options should default to:

- Closest nutritional match.
- More delicious or creative alternative.
- Macro-optimized alternative.

Preference memory choices:

- Only this meal.
- This week.
- Save as a profile preference.

## Failure States

The pipeline should explicitly represent these failure states:

- `impossible_targets`: required protein and minimum fat exceed the calorie target.
- `low_nutrition_confidence`: too many meaningful calorie-contributing ingredients are estimated or unknown.
- `ambiguous_ingredient`: an important ingredient cannot be confidently matched.
- `banned_item_conflict`: the AI generated a banned ingredient.
- `repetition_conflict`: the menu is too repetitive.
- `generation_exhausted`: the repair loop hit its retry limit.

Failure states should be visible to the UI and MCP tools.

## Structured Output Policy

AI outputs must be structured and versioned.

The app should define schemas for:

- `PlanningBrief`.
- `WeekSkeleton`.
- `RecipeCandidate`.
- `MealReplacementProposal`.
- `RepairRequest`.
- `RepairResult`.
- `GenerationSummary`.

The system should use strict structured-output APIs where available. Generated objects must still be validated by application code before they are trusted.

The app should not rely on prose blobs for core planning decisions.

## Consequences

Benefits:

- Weekly planning is more reliable than a single-shot model completion.
- The AI can focus on recipe quality and variety.
- Deterministic code owns constraints, nutrition, and validation.
- Targeted repair reduces unnecessary regeneration.
- Failure states are debuggable and user-facing.
- MCP tools can expose the same generation pipeline as the web app.

Tradeoffs:

- More moving parts than a single prompt.
- Requires versioned schemas and validation.
- Async generation jobs need progress and failure reporting.
- Some generations may require user confirmation for ambiguous ingredients.
- Repair-loop limits need tuning.

## Open Questions

- None currently.

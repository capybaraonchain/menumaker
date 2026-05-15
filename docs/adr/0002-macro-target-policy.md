# ADR 0002: Macro Target Policy

## Status

Accepted

## Date

2026-05-15

## Context

The app needs to suggest calorie and macro targets during onboarding while still allowing users to enter targets manually. These suggestions should be useful for personal meal planning, but they should not pretend to be clinical nutrition advice.

The app is for adults in the initial product. For v1, suggested macro targets are only available when the profile is for an adult. If the profile age is under 18, the app should require manual targets instead of generating an automatic recommendation.

## Decision

Build a macro target policy that estimates energy needs, applies a user-selected goal adjustment, allocates macros from protein first, and lets the user edit everything before saving.

The app should ask the user whether they are trying to:

- Maintain.
- Cut.
- Bulk.

Additional macro modes, such as high-protein or lower-carb, can be layered on top of the main goal.

## Inputs

Suggested macro targets use:

- Height.
- Weight.
- Target weight.
- Protein calculation weight.
- Age.
- Biological sex.
- Exercise level.
- Goal: maintain, cut, or bulk.
- Optional macro mode: balanced, high-protein, lower-carb, or manual.

Age and biological sex may be skipped. If either is skipped, the app should still allow a suggestion, but it must label the result as lower-confidence.

Manual macro input bypasses the formula-based recommendation.

If age or biological sex is skipped, the app should ask the user to accept that the result is a rough estimate before saving suggested targets.

## Adult-Only V1

For the initial product, automatic macro suggestions are adult-only.

Rules:

- If age is 18 or older, automatic suggestions are allowed.
- If age is under 18, automatic suggestions are disabled and the user must enter targets manually.
- If age is skipped, the app may provide a rough adult-oriented estimate only if the user confirms the profile is for an adult.

## Energy Estimate

Use Mifflin-St Jeor as the default resting energy equation.

Then estimate total daily energy expenditure by applying an activity multiplier based on the selected exercise level.

The app should present this as an estimate, not an exact measurement.

Default activity choices:

- Sedentary: `1.4`, for a desk job and little exercise.
- Lightly active: `1.5`, for some walking or 1-2 workouts per week.
- Moderately active: `1.6`, for 3-4 workouts per week.
- Active: `1.8`, for 5-6 workouts per week or an active job.
- Very active: `2.0`, for hard daily training or physical work.

New profiles should default to lightly active, `1.5`, while clearly explaining the available activity choices.

## Goal Adjustment

Maintenance uses estimated total daily energy expenditure.

Cutting applies a calorie deficit.

Bulking applies a calorie surplus.

The app should explain that moderate deficits and surpluses are usually the practical sweet spot, while still allowing users to choose more aggressive settings.

Default presets:

- Conservative cut: 5-10% deficit.
- Standard cut: 10-15% deficit.
- Aggressive cut: 15-25% deficit.
- Conservative bulk: 3-5% surplus.
- Standard bulk: 5-10% surplus.
- Aggressive bulk: 10-15% surplus.

The default recommendation should be:

- Standard cut for users who choose cut.
- Standard bulk for users who choose bulk.
- Maintenance calories for users who choose maintain.

The UI should make the tradeoff clear:

- Larger deficits may make adherence, hunger, training performance, and meal variety harder.
- Larger surpluses may make macro planning easier but increase the chance of gaining more fat alongside muscle.

## Macro Allocation

Macro allocation should happen in this order:

1. Set protein target.
2. Set minimum fat target.
3. Allocate remaining calories to carbohydrates and fat according to the selected macro mode.

Protein should be treated as the strictest macro target.

Carbohydrates and fat should be treated as flexible ranges.

Lower-carb mode should cap carbohydrates first, then shift remaining calories into fat and protein.

High-protein mode should raise protein first, then allocate the remaining calories to fat and carbohydrates.

Protein should be calculated from the profile's protein calculation weight, not always from current body weight. This prevents current-weight calculations from producing unrealistic protein targets when current weight and goal weight are far apart.

The onboarding flow should collect target weight and allow the user to confirm or edit the protein calculation weight.

Default protein calculation weight heuristic:

- Maintenance: use current weight.
- Cut: use `target_weight + 0.25 * (current_weight - target_weight)`.
- Bulk: use `current_weight + 0.25 * (target_weight - current_weight)`.

This keeps the protein target anchored near the user's current body size while avoiding unrealistic protein targets when current weight and target weight are far apart.

Default protein targets:

- Maintenance, balanced: `1.6 g/kg`.
- Cut, balanced: `1.8 g/kg`.
- Aggressive cut: `2.0 g/kg`.
- Bulk, balanced: `1.6-1.8 g/kg`.
- High-protein mode: add `0.2-0.4 g/kg`, usually capped around `2.2 g/kg`.

Default fat policy:

- Normal minimum: `0.6 g/kg`.
- Aggressive cut lower bound: `0.5 g/kg`, with explanatory copy.
- Balanced planning: usually `20-35%` of calories.

Default lower-carbohydrate policy:

- Balanced mode: carbohydrates fill the remaining calories after protein and fat.
- Lower-carb mode: cap carbohydrates around `25%` of calories.
- Strong lower-carb option: `50-100 g/day`, if the user explicitly chooses it.
- Ketogenic planning is out of scope unless explicitly added later.

## Target Tolerances

Daily targets should use realistic tolerances:

- Calories should generally land within 5-8% of the daily target.
- Protein is a stricter minimum target.
- Carbohydrates and fat may use flexible ranges.
- Weekly averages are more important than perfect daily precision.

The planner should not reject a good weekly menu because one day is slightly above or below target if the weekly average is acceptable.

Meal-level macros should not be forced to be perfectly balanced. The planner should care about daily and weekly targets, especially weekly averages, while allowing breakfast, lunch, dinner, and snack to vary naturally.

## Impossible Target Handling

Some user-selected targets may be internally inconsistent. This happens when required protein and minimum fat already exceed the calorie target before any carbohydrates are added.

The app should validate:

```text
protein_grams * 4 + minimum_fat_grams * 9 <= calorie_target
```

If this check fails, the app should not attempt to generate a menu. It should explain the conflict and offer direct fixes:

- Increase calories.
- Lower protein.
- Adjust fat minimum.

Spanish UI copy can be:

> Este objetivo no encaja: solo la proteína y la grasa mínima ya superan tus calorías diarias. Sube las calorías, baja la proteína o reduce la grasa mínima.

## Rounding

Suggested targets should be rounded before display:

- Calories rounded to the nearest 25 or 50 kcal.
- Macros rounded to the nearest 5 g.

The app should not display false precision, such as 2,137 kcal or 143.6 g protein.

## User Override

Suggested targets are editable before saving.

The onboarding screen should show:

- Estimated maintenance calories.
- Selected goal adjustment.
- Final calorie target.
- Protein target.
- Carbohydrate target or range.
- Fat target or range.
- Confidence level.

Users can manually change calories, protein, carbohydrates, or fat before saving the profile.

## Consequences

Benefits:

- The app gives useful defaults without locking users into them.
- Cut and bulk are explicit product concepts.
- More aggressive goals are supported without pretending they are equally easy to follow.
- Macro planning stays practical by using tolerances and rounded values.
- Protein-first allocation gives the planner a clear priority.

Tradeoffs:

- Automatic target calculation needs confidence labels.
- Skipped age or biological sex creates broader estimates.
- Aggressive goals may make weekly menu generation harder.
- The app must explain target tradeoffs clearly without becoming a medical-advice product.

## Open Questions

- None currently.

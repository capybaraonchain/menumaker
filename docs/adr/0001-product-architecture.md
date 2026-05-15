# ADR 0001: Product Architecture for AI-Assisted Weekly Diet Planning

## Status

Accepted

## Date

2026-05-15

## Context

The app is a personal-use mobile web app for creating and managing weekly diets. The core product goal is to let a user generate a full week of varied, delicious meals that satisfy calorie, macro, and preference constraints, then edit individual meals without breaking the rest of the weekly plan.

AI models are useful for recipe ideation, meal variation, natural-language edits, and preference interpretation. They should not be treated as the source of truth for calories or macros. Nutrition values must be calculated from deterministic ingredient data wherever possible.

The app must support multiple profiles, such as the user, their brother, and their girlfriend. Each profile should remember targets, likes, dislikes, banned ingredients, and prior feedback.

The app must support Spanish as a first-class app language. This includes UI copy, recipe names, recipe instructions, preference prompts, and generated meal-plan explanations.

## Decision

Build a mobile-first weekly diet planner with three separate layers:

1. A deterministic nutrition layer for calories, macros, ingredient normalization, and profile constraints.
2. An AI planning layer for recipe generation, substitution suggestions, preference interpretation, and meal-plan explanations.
3. A user-confirmation workflow for edits that may affect the rest of the weekly menu.

The app will not initially include pantry management, grocery shopping, budget optimization, medical-diet guidance, or clinical safety workflows. Allergies, banned ingredients, and explicit profile constraints remain in scope because they are necessary for meal planning.

## Scope

In scope:

- Weekly menu generation.
- Daily calorie and macro targets.
- Goal-specific macro profiles, such as maintenance, fat loss, muscle gain, high-protein, or lower-carb.
- Onboarding flow for suggested macro targets based on height, weight, age, biological sex, exercise level, and purpose, with optional skips for age and biological sex.
- Manual macro input for users who already know their targets.
- Metric units by default.
- Banned ingredients and disliked foods.
- Multiple user profiles.
- One weekly menu per profile.
- Stored weekly menu history.
- Local-first v1 runtime with a hosted-sync-compatible data model.
- Recipe generation with structured ingredients and quantities.
- Deterministic nutrition calculation from structured ingredients.
- Meal variety constraints across the week.
- Individual meal editing.
- Individual meal, day, and week regeneration.
- Substitution suggestions.
- User-confirmed propagation of substitutions across the current week or profile preferences.
- Spanish and English app localization.
- Spanish recipe generation and Spanish natural-language interaction.
- MCP server and Codex/agent skill for external agent access.

Out of scope for the initial product:

- Pantry inventory.
- Grocery list generation.
- Store pricing.
- Budget optimization.
- Clinical nutrition advice.
- Medical-diet programs.
- Eating-disorder screening.
- Medication or disease-specific recommendations.

## Product Model

The central objects are:

- `Profile`: person-specific goals, calorie target, macro target, language, likes, dislikes, banned ingredients, and remembered feedback.
- `WeeklyMenu`: seven-day meal plan for one profile and one goal.
- `DayPlan`: meals for a specific date or weekday.
- `MealSlot`: breakfast, lunch, dinner, snack, or custom slot.
- `Recipe`: structured meal with title, description, ingredients, steps, tags, cuisine style, and serving count.
- `SavedRecipe`: profile-specific starred recipe that can be reused in future weekly menus.
- `IngredientLine`: ingredient, amount, unit, preparation state, optionality, and normalized nutrition match.
- `NutritionEstimate`: calories, protein, carbs, fat, fiber, source confidence, and calculation notes.
- `MenuLock`: lock on an entire day or individual meal so regeneration does not overwrite it.
- `MealEditRequest`: user request to change one meal.
- `PropagationProposal`: suggested related changes caused by a meal edit, such as replacing broccoli in other meals.

## Onboarding Strategy

New profiles default to Spanish.

The onboarding flow should ask whether the user wants the app to suggest macro targets or whether they want to enter macros manually.

For suggested targets, onboarding should collect:

- Height.
- Weight.
- Age, with an option to skip.
- Biological sex, with an option to skip.
- Exercise level.
- Planning purpose, such as maintenance, fat loss, muscle gain, high-protein, or lower-carb.

Suggested macro targets should be editable before they are saved to the profile. The app should store both the selected purpose and the resulting calorie and macro targets.

If age or biological sex is skipped, the app may still suggest targets, but it should label the result as a rougher estimate.

Metric units are the default:

- Kilograms for weight.
- Centimeters for height.
- Kilocalories for energy.
- Grams for macronutrients.

The default meal slots are:

- Breakfast.
- Lunch.
- Dinner.
- Snack.

## Nutrition Strategy

AI-generated recipes must be converted into structured recipes before they are accepted into a weekly menu. Each ingredient should be normalized to a canonical food item and quantity.

Nutrition should be calculated by multiplying ingredient quantities against deterministic nutrition records. The app should prefer data sources in this order:

1. User-confirmed exact product or ingredient data.
2. Official or public food composition databases.
3. Branded food databases when the user specifies a product.
4. AI-estimated fallback only when deterministic matching fails.

Potential data sources:

- USDA FoodData Central for broad generic and branded food composition data.
- Open Food Facts for packaged products and barcode-oriented data.
- BEDCA for Spanish food composition data.

Every nutrition result should include a confidence level:

- `exact`: user-confirmed product or ingredient data.
- `database`: matched to a trusted database food.
- `generic`: matched to a generic equivalent.
- `estimated`: quantity or ingredient had to be inferred by the model.
- `unknown`: insufficient information.

The UI should avoid fake precision. Estimated meals should show approximate values, while exact or database-backed meals may show more specific values.

Daily target matching should use tolerances rather than pretending exact macro hits are required:

- Calories should generally land within 5-8% of the daily target.
- Protein is a stricter minimum target.
- Carbohydrates and fat may use flexible ranges.
- Weekly averages are more important than perfect daily precision.

## Weekly Planning Strategy

Weekly menu creation should be treated as a constrained planning problem, not a single AI completion.

The planner should score candidate meals against:

- Daily calorie target.
- Daily macro target.
- Weekly macro consistency.
- Banned ingredients.
- Profile dislikes.
- Repetition of main ingredient.
- Repetition of cuisine style.
- Repetition of texture or meal type.
- Recipe compatibility, flavor coherence, and ingredient complementarity.
- User feedback history.

The AI layer may generate candidate recipes, but the deterministic layer must validate whether those recipes fit the profile and menu constraints.

The planner will use a hybrid variety model:

- Hard-block banned ingredients, explicit dislikes, locked meals, and extreme repetition.
- Soft-score cuisine variety, texture variety, ingredient overlap, and flavor diversity.

The default planner should avoid repeating the same main protein, cuisine style, or very similar meal format too often in a week. However, it should be allowed to reuse compatible ingredients when doing so helps meet tight calorie and macro constraints. The planner should prefer "varied but practical" over novelty at all costs.

Users can lock:

- Entire days.
- Individual meals.

Users can star recipes to save them for future plans. Starred recipes should be eligible for reuse, but they should still be checked against the active profile, calorie target, macro target, and variety constraints.

Users can regenerate:

- An individual meal.
- An entire day.
- The whole week.

Locked meals and locked days are preserved during regeneration.

Recipe preparation time should be capped at 2 hours for the initial product. The app should not otherwise over-constrain recipe style, ingredient commonness, or complexity.

Each meal slot represents one serving for one profile. Multi-serving leftovers and shared household meals are out of scope for the initial product.

Each weekly menu belongs to one profile. Multi-profile shared menu planning is out of scope for the initial product.

## Meal Editing Strategy

Users can edit an individual meal with natural language, for example:

> No quiero brócoli en este plato.

The app should then:

1. Parse the edit intent.
2. Generate replacement options for that meal.
3. Recalculate nutrition for each option.
4. Show the macro/calorie impact.
5. Let the user choose a replacement.
6. Detect whether the same issue appears elsewhere in the week.
7. Ask whether similar replacements should be applied to other affected meals.
8. Ask whether the preference should be saved to the profile.

Propagation must be explicit. The app should not silently rewrite the rest of the weekly menu.

When a user rejects or changes an ingredient, the UI should ask how strongly to remember the preference:

- Only this meal.
- This week.
- Save as a profile preference.

Meal replacement suggestions should default to three options:

- Closest nutritional match.
- More delicious or creative alternative.
- Macro-optimized alternative.

## Localization Strategy

Spanish is a first-class language, not a later translation pass.

The app should support:

- `es`: Spanish UI, Spanish prompts, Spanish recipes, Spanish explanations.
- `en`: English UI, English prompts, English recipes, English explanations.

Profile language should determine the default language for generated recipes and user-facing explanations. Internal recipe and nutrition structures should remain language-neutral where possible, using stable identifiers for foods, tags, and constraints.

Generated text should be stored with a locale field so that Spanish and English outputs are not mixed accidentally.

New profiles should default to `es`.

## Storage And Sync Strategy

The first working v1 should run locally on the user's MacBook Air M2. Cloud deployment, hosted auth, and a full account system are not required before the app works locally.

The data model should remain hosted-sync-compatible from the beginning. User-owned rows should include ownership fields such as `user_id` so hosted sync, Supabase Auth, and Row Level Security can be enabled later without schema surgery.

During early implementation, auth may be stubbed as a single local user.

The app should persist:

- Profiles.
- Macro targets and goal history.
- Weekly menus.
- Meal locks.
- Starred recipes.
- Preference memory.
- Structured recipes.
- Nutrition calculations and source confidence.
- Cached AI outputs that are still useful and valid.

AI-generated recipes and deterministic nutrition analyses should be cached so the app does not repeatedly call the model for the same recipe or recalculate unchanged nutrition data.

## MCP And Skill Strategy

The app should expose an MCP server so ChatGPT, Codex, or another agent can operate the planner through structured tools.

Initial MCP tools:

- `create_weekly_menu(profile_id, goal, constraints)`
- `get_weekly_menu(menu_id)`
- `analyze_recipe_nutrition(recipe)`
- `suggest_meal_replacements(menu_id, day, meal_slot, edit_request)`
- `replace_meal(menu_id, day, meal_slot, recipe_id)`
- `find_related_replacement_opportunities(menu_id, ingredient_or_issue)`
- `apply_confirmed_replacements(menu_id, replacements)`
- `update_profile_preferences(profile_id, preferences)`
- `list_profiles()`
- `get_profile(profile_id)`

The companion skill should teach agents to:

- Use deterministic nutrition tools before claiming calories or macros.
- Ask for confirmation before applying broad weekly changes.
- Respect profile language.
- Preserve locked meals.
- Explain uncertainty when nutrition data is estimated.
- Treat read-only MCP tools differently from mutation tools.
- Require explicit confirmation before changing menus, profile preferences, locks, or saved recipes.

## Consequences

Benefits:

- Better nutrition accuracy than model-only planning.
- Clear separation between creative generation and deterministic validation.
- Easier debugging when macros do not add up.
- Good support for profile-specific preferences.
- Spanish support is built into the product model from the beginning.
- MCP tools make the app usable from external agents without scraping the UI.

Tradeoffs:

- Ingredient normalization becomes a core engineering problem.
- The app needs a structured recipe format before the UI can feel reliable.
- Weekly planning may require iterative generation and repair instead of one fast model call.
- Nutrition results will sometimes need to show uncertainty instead of pretending to be exact.

## Open Questions

- None currently.

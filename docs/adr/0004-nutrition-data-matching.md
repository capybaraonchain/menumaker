# ADR 0004: Nutrition Data Matching

## Status

Accepted

## Date

2026-05-15

## Context

The app uses AI to generate recipes and menus, but calories and macros must come from deterministic ingredient-level nutrition data wherever possible. Recipe names or free-text meal descriptions are not reliable enough for weekly macro planning.

The app is Spanish-first and personal-use, but nutrition matching should still be structured enough to support confidence labels, user corrections, historical menu snapshots, and MCP access.

## Decision

Never calculate weekly macros from recipe names. Calculate nutrition from normalized ingredient lines matched to nutrition records.

An accepted recipe must have structured ingredients, including:

- Ingredient name.
- Amount.
- Unit.
- Normalized grams or milliliters where possible.
- Preparation state, such as raw, cooked, boiled, fried, or drained.
- Nutrition match and confidence.

## Source Priority

Use nutrition sources in this order:

1. User-confirmed exact item or ingredient mapping.
2. Barcode or packaged product match, using Open Food Facts first.
3. Spanish generic food data, preferring BEDCA when available.
4. Generic international food data, using USDA FoodData Central.
5. AI-estimated fallback when no deterministic match exists.

AI-estimated nutrition is allowed only as a fallback and must be marked as estimated.

BEDCA is product-relevant for Spanish food composition, but its machine access may be less straightforward than USDA FoodData Central or Open Food Facts. The system should include a BEDCA adapter boundary, but v1 should not be blocked if initial implementation starts with an imported/static BEDCA dataset or defers full BEDCA coverage.

## Matching Flow

For each recipe ingredient line:

1. Normalize ingredient text.
2. Normalize quantity.
3. Generate candidate matches.
4. Score candidates.
5. Accept, flag, or ask the user.

Ingredient text normalization should handle:

- Spanish and English aliases.
- Singular and plural forms.
- Accents.
- Preparation words.
- Common ingredient synonyms.

Quantity normalization should prefer grams and milliliters. Household units such as tablespoon, cup, piece, or slice require conversion. Unknown units should lower confidence.

For v1, household conversions are resolved in this order:

1. Food-specific serving conversion from the matched deterministic food, for example `2 huevos`, `1 plátano`, `2 rebanadas de pan integral`, or `1 taza de quinoa cocida`.
2. Generic unit conversion for less ambiguous units such as `g`, `kg`, `ml`, `cucharada`, or `cucharadita`.
3. Estimated generic fallback for ambiguous units such as `unidad`, `pieza`, `rebanada`, or `taza` when the matched food has no specific serving conversion.

The app should preserve the confidence downgrade and notes produced by those conversions in ingredient snapshots.

Candidate generation should use:

- Exact saved mappings.
- Barcode matches when available.
- Source database search.
- Alias tables.
- Fuzzy or semantic matching.

Candidate scoring should consider:

- Name similarity.
- Food category match.
- Preparation state match.
- Branded vs generic match.
- Locale and source preference.
- Prior user confirmation.

Acceptance policy:

- High confidence: auto-accept.
- Medium confidence: use but mark as `generic` or `database`.
- Low confidence: ask the user or use AI fallback marked as `estimated`.

## Confidence Labels

Nutrition confidence labels:

- `exact`: user-confirmed product or ingredient mapping.
- `barcode`: packaged product match by barcode.
- `database`: strong generic database match.
- `generic`: acceptable but broad generic match.
- `estimated`: AI-inferred nutrition or uncertain quantity conversion.
- `unknown`: insufficient information to calculate.

Recipe-level confidence should be based on meaningful calorie-contributing ingredients, not tiny garnishes. An unknown parsley garnish should not dominate the recipe confidence. An unknown oil, grain, meat, dairy, or sauce should.

## Ingredient Policy

Match at ingredient level, not meal level.

Use the ingredient as written:

- If the recipe says cooked rice, match cooked rice.
- If the recipe says dry rice, match dry rice.
- If the recipe says raw chicken breast, match raw chicken breast.

Oils count fully unless the recipe clearly says they are discarded.

For v1 macro math, ignore salt-to-taste and other negligible seasoning quantities unless they materially affect calories or macros. Micronutrients and sodium can be added later.

## User Corrections

If the user corrects a match, remember it.

Corrections may be stored as:

- Profile-specific overrides when the correction reflects the user's preference or local product.
- Global mappings when the correction is generally safe and source-backed.

Future matches should prefer prior user-confirmed mappings.

## Snapshot Policy

Store the exact source record and calculated nutrition snapshot used for each recipe or menu.

Old menus must not silently change if:

- A better food match appears later.
- A source database updates its nutrition record.
- The user changes a profile.
- The user corrects a future ingredient mapping.

Historical menus should remain understandable as originally generated.

## Data Model Refinement

Nutrition matching uses these tables or equivalent structures:

- `food_items`: canonical app foods.
- `food_aliases`: Spanish and English aliases for canonical foods, plus user-confirmed aliases for local remediation.
- `source_foods`: raw imported or searchable records from USDA, BEDCA, Open Food Facts, or other sources.
- `nutrition_records`: per-100g or per-serving nutrition values from a source.
- `food_mappings`: mappings from canonical food items to source foods.
- `unit_conversions`: conversions for tablespoon, cup, piece, slice, and similar units.
- `ingredient_matches`: saved result for a recipe ingredient line.
- `user_food_overrides`: user-confirmed per-100g corrections, deferred beyond the first alias-remediation slice.

These refine the broader `food_items`, `nutrition_records`, `recipe_ingredients`, and `nutrition_estimates` tables from ADR 0003.

Local v1 now uses these tables as an active scoring source, not only as future schema. Normalized source records can be imported with:

```bash
npm --workspace @menumaker/db run nutrition:import -- ./foods.json
```

The import is idempotent on `(food_id, source_id)`. App scoring builds a nutrition catalog from `food_items`, `food_aliases`, `source_foods`, and `nutrition_records`; non-seed sources are preferred over seed records for the same canonical food. Seed data remains the baseline when no imported source record exists.

Open Food Facts barcode products can also be fetched directly:

```bash
npm --workspace @menumaker/db run nutrition:import:off -- 3017620422003
```

The Open Food Facts adapter uses the public product-by-barcode API, imports per-100g macros from `nutriments`, stores the barcode as the source ID, and marks confidence as `barcode`.

The same import is exposed through the shared app action registry and MCP as `import_open_food_facts_product`, behind explicit confirmation. Agents should use that tool instead of shelling out to the CLI when operating MenuMaker.

## V1 Source Plan

For v1:

- Use Open Food Facts for barcode and packaged-product matches. Local v1 includes the barcode import command; app UI search/scanning can be added later.
- Use USDA FoodData Central for robust generic food coverage.
- Include a BEDCA adapter boundary.
- Implement BEDCA if access or import is straightforward. The generic normalized import path exists first; official dataset-specific adapters should emit that format.
- Use a user confirmation loop for ambiguous ingredients. In local v1 this first lands as alias mapping to an existing deterministic food; later versions can add source-record picking and custom nutrition records.
- Allow AI fallback only when visibly marked as estimated.

## Consequences

Benefits:

- Macro calculations are grounded in ingredient quantities and deterministic records.
- Spanish food data is treated as important without blocking v1 on BEDCA access.
- User corrections improve future matching.
- Historical menu nutrition remains stable.
- MCP tools can expose confidence and source details instead of opaque estimates.

Tradeoffs:

- Ingredient normalization becomes a core product problem.
- Unit conversion needs careful handling.
- Some recipes will require user confirmation before they can be considered high confidence.
- Imported source data may require maintenance and versioning.
- AI fallback remains useful but must be treated as lower confidence.

## Open Questions

- None currently.

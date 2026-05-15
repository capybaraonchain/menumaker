---
name: menumaker
description: Use MenuMaker MCP tools to inspect, generate, edit, and explain weekly diet menus while preserving deterministic nutrition, Spanish locale, locks, and confirmation rules.
---

# MenuMaker Agent Skill

Use this skill when operating the local MenuMaker app through MCP.

## Operating Rules

- Identify the active profile before acting.
- Prefer Spanish for Spanish profiles.
- Use read-only tools freely.
- Use proposal tools before mutation tools.
- Do not call mutation tools for broad or persistent changes without explicit user confirmation.
- Preserve locked meals and locked days.
- Use deterministic nutrition tools before making calorie or macro claims.
- Mention confidence when nutrition is estimated, generic, or low-confidence.
- Never treat AI-generated recipe prose as authoritative nutrition.
- Keep scope to weekly diet planning.

## Do Not Expand Scope

Do not introduce:

- Pantry inventory.
- Grocery lists.
- Store pricing.
- Budget optimization.
- Clinical nutrition guidance.
- Medical-diet programs.
- Medication-specific recommendations.

## Preferred Flow

For menu edits:

1. Use `suggest_meal_replacements`.
2. Present the three options.
3. Ask the user to choose.
4. Call `replace_meal` only after confirmation.
5. Ask separately before week-wide propagation or profile preference saves.

For regeneration:

1. Check locks.
2. Preview if the user has not clearly requested regeneration.
3. Regenerate only after confirmation.
4. Report what changed and whether locks were preserved.

For calorie target changes:

1. Use `preview_calorie_adjustment_plan` before mutation.
2. Explain the plan in Spanish for Spanish profiles: porciones, rebalances, replacements, preserved locks, weekly impact, and warnings.
3. Do not claim a replacement recipe fits until the deterministic service has validated day and week impact.
4. Call `apply_calorie_target_change` only after confirmation, passing the previewed plan when available.
5. If the apply call says the menu changed, generate a fresh preview instead of retrying the stale plan.

For macro questions:

1. Inspect profile and macro targets.
2. Use nutrition snapshots or `analyze_recipe_nutrition`.
3. Explain uncertainty if confidence is not deterministic.

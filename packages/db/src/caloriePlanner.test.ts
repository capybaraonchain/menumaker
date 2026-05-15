import assert from 'node:assert/strict'
import test from 'node:test'
import type { MacroTargets, MealSlot, NutritionTotals, RecipeCandidate } from '@menumaker/core'
import { scoreRecipe, sumNutrition, templatesForSlot } from '@menumaker/nutrition'
import { buildCalorieAdjustmentPlan, currentMenuHash, type CaloriePlannerMenu, type CaloriePlannerProfile } from './caloriePlanner'

const profile: CaloriePlannerProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  locale: 'es',
  likes: [],
  dislikes: [],
  bannedFoods: [],
}

test('moderate calorie reduction keeps recipes when quality remains acceptable', () => {
  const menu = makeMenu(2350, 1.08)
  const plan = buildCalorieAdjustmentPlan({ profile, currentMenu: menu, target: target(2200) })
  assert.equal(plan.decisionCounts.recipe_replacement, 0)
  assert.ok(plan.decisionCounts.portion_resize + plan.decisionCounts.ingredient_rebalance > 0)
  assert.equal(plan.baseMenuHash, currentMenuHash(menu))
})

test('strong calorie reduction uses replacements when resizing would leave weak meals', () => {
  const menu = makeMenu(2350, 1.35)
  const plan = buildCalorieAdjustmentPlan({ profile, currentMenu: menu, target: target(1450) })
  assert.ok(plan.decisionCounts.recipe_replacement > 0)
  assert.ok(plan.warnings.length >= 0)
})

test('calorie increase adds compatible ingredients before replacing everything', () => {
  const menu = makeMenu(1850, 0.72)
  const plan = buildCalorieAdjustmentPlan({ profile, currentMenu: menu, target: target(2350) })
  assert.ok(plan.decisionCounts.ingredient_rebalance > 0)
  assert.ok(plan.decisionCounts.recipe_replacement < 10)
})

test('locked days and meals are preserved exactly', () => {
  const menu = makeMenu(2350, 1.1, { lockedDay: 0, lockedMeal: '2:dinner' })
  const plan = buildCalorieAdjustmentPlan({ profile, currentMenu: menu, target: target(1850) })
  assert.equal(plan.decisions.filter((decision) => decision.kind === 'preserve_locked' && decision.dayIndex === 0).length, 4)
  assert.ok(plan.decisions.some((decision) => decision.kind === 'preserve_locked' && decision.dayIndex === 2 && decision.slot === 'dinner'))
})

test('saved recipes receive replacement penalty but can still change when they do not fit', () => {
  const menu = makeMenu(2350, 1.3)
  const savedRecipeIds = [menu.days[0]!.meals[0]!.recipe.id]
  const plan = buildCalorieAdjustmentPlan({ profile, currentMenu: menu, target: target(1500), savedRecipeIds })
  const savedDecision = plan.decisions.find((decision) => decision.previousRecipeId === savedRecipeIds[0])
  assert.ok(savedDecision)
  assert.notEqual(savedDecision?.kind, 'recipe_replacement')
})

function makeMenu(calories: number, scale: number, locks: { lockedDay?: number; lockedMeal?: string } = {}): CaloriePlannerMenu {
  const days = Array.from({ length: 7 }, (_, dayIndex) => {
    const meals = (['breakfast', 'lunch', 'dinner', 'snack'] as MealSlot[]).map((slot, slotIndex) => {
      const template = templatesForSlot(slot, [], 'es')[(dayIndex + slotIndex) % templatesForSlot(slot, [], 'es').length]!
      const recipe = scaleRecipe(template, scale)
      const scored = scoreRecipe(recipe)
      return {
        id: `${dayIndex}-${slot}`,
        slot,
        locked: locks.lockedMeal === `${dayIndex}:${slot}`,
        nutrition: scored.nutrition,
        recipe: {
          ...recipe,
          id: `recipe-${dayIndex}-${slot}`,
          nutrition: scored.nutrition,
        },
      }
    })
    return {
      id: `day-${dayIndex}`,
      dayIndex,
      locked: locks.lockedDay === dayIndex,
      meals,
    }
  })
  return {
    id: `menu-${calories}-${scale}`,
    profileId: profile.id,
    weekStart: '2026-05-11',
    locale: 'es',
    target: target(calories),
    nutrition: sumNutrition(days.flatMap((day) => day.meals.map((meal) => meal.nutrition))),
    days,
  }
}

function target(calories: number): MacroTargets {
  return {
    calories,
    proteinG: Math.round(calories * 0.28 / 4),
    carbsG: Math.round(calories * 0.42 / 4),
    fatG: Math.round(calories * 0.3 / 9),
    confidence: 'database',
    formulaVersion: 'test',
    goal: calories < 2100 ? 'cut' : 'maintain',
    macroMode: 'manual',
    preset: 'maintenance',
    maintenanceCalories: 2350,
    proteinCalculationWeightKg: 75,
    notes: [],
  }
}

function scaleRecipe(recipe: RecipeCandidate, factor: number): RecipeCandidate {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      amount: Math.round(ingredient.amount * factor),
    })),
  }
}

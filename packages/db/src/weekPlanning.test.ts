import assert from 'node:assert/strict'
import test from 'node:test'
import type { MacroTargets, MealSlot, RecipeCandidate } from '@menumaker/core'
import { scoreRecipe, templatesForSlot } from '@menumaker/nutrition'
import { deterministicWeekSkeleton, evaluateWeekRecipeSelection, repairWeekRecipeSelection, type ProfileRow } from './appService'

const profile: ProfileRow = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Alex',
  locale: 'es',
  unitSystem: 'metric',
  weightKg: 78,
  targetWeightKg: 72,
  proteinCalculationWeightKg: 75,
  heightCm: 178,
  age: 32,
  sex: 'male',
  activityLevel: 'lightly_active',
  goal: 'cut',
  macroMode: 'balanced',
  likes: ['tomate'],
  dislikes: ['aguacate'],
  bannedFoods: ['brócoli'],
}

test('deterministic week skeleton covers every day and default meal slot', () => {
  const skeleton = deterministicWeekSkeleton(profile, target(1850))
  assert.equal(skeleton.days.length, 7)
  for (const [dayIndex, day] of skeleton.days.entries()) {
    assert.equal(day.dayIndex, dayIndex)
    assert.deepEqual(day.meals.map((meal) => meal.slot), ['breakfast', 'lunch', 'dinner', 'snack'])
    assert.ok(day.meals.every((meal) => meal.intent.includes('Priorizar volumen')))
    assert.ok(day.meals.every((meal) => meal.avoidRepeating.includes('aguacate')))
    assert.ok(day.meals.every((meal) => meal.avoidRepeating.includes('brócoli')))
  }
})

test('quality evaluation flags excessive weekly recipe repetition', () => {
  const repeated = scoredTemplate('breakfast', 0)
  const days = Array.from({ length: 7 }, () => ([
    { slot: 'breakfast' as MealSlot, recipe: repeated },
    { slot: 'lunch' as MealSlot, recipe: scoredTemplate('lunch', 0) },
    { slot: 'dinner' as MealSlot, recipe: scoredTemplate('dinner', 1) },
    { slot: 'snack' as MealSlot, recipe: scoredTemplate('snack', 0) },
  ]))
  const issues = evaluateWeekRecipeSelection(days, target(2200))
  assert.ok(issues.some((issue) => issue.reason === 'repetition_conflict' && issue.title === repeated.title))
})

test('quality evaluation flags absurdly low daily calories before persistence', () => {
  const days = Array.from({ length: 7 }, (_, dayIndex) => ([
    { slot: 'breakfast' as MealSlot, recipe: uniqueScaledScoredTemplate('breakfast', 0, 0.25, `${dayIndex}-breakfast`) },
    { slot: 'lunch' as MealSlot, recipe: uniqueScaledScoredTemplate('lunch', 0, 0.25, `${dayIndex}-lunch`) },
    { slot: 'dinner' as MealSlot, recipe: uniqueScaledScoredTemplate('dinner', 0, 0.25, `${dayIndex}-dinner`) },
    { slot: 'snack' as MealSlot, recipe: uniqueScaledScoredTemplate('snack', 0, 0.25, `${dayIndex}-snack`) },
  ]))
  const issues = evaluateWeekRecipeSelection(days, target(2350))
  assert.ok(issues.some((issue) => issue.reason === 'daily_calorie_drift'))
})

test('repair trace records structured requests and results', () => {
  const repeated = scoredTemplate('breakfast', 0)
  const days = Array.from({ length: 7 }, (_, dayIndex) => ([
    { slot: 'breakfast' as MealSlot, recipe: repeated },
    { slot: 'lunch' as MealSlot, recipe: uniqueScaledScoredTemplate('lunch', 0, 1, `${dayIndex}-lunch`) },
    { slot: 'dinner' as MealSlot, recipe: uniqueScaledScoredTemplate('dinner', 0, 1, `${dayIndex}-dinner`) },
    { slot: 'snack' as MealSlot, recipe: uniqueScaledScoredTemplate('snack', 0, 1, `${dayIndex}-snack`) },
  ]))
  const trace = repairWeekRecipeSelection(days, new Map([
    ['breakfast', {
      recipes: [
        { recipe: repeated, source: 'template' },
        { recipe: uniqueScaledScoredTemplate('breakfast', 1, 1, 'replacement-a'), source: 'template' },
        { recipe: uniqueScaledScoredTemplate('breakfast', 2, 1, 'replacement-b'), source: 'template' },
      ],
    } as any],
  ]), target(2200))

  assert.equal(trace.attempted, true)
  assert.ok(trace.repairRequests.some((request) => request.reason === 'repetition_conflict'))
  assert.ok(trace.repairResults.some((result) => result.reason === 'repetition_conflict'))
  assert.ok(trace.actions.length > 0)
})

function scoredTemplate(slot: MealSlot, index: number) {
  return scoreRecipe(templatesForSlot(slot, [], 'es')[index]!)
}

function uniqueScaledScoredTemplate(slot: MealSlot, index: number, factor: number, suffix: string) {
  return scoreRecipe({
    ...scaleRecipe(templatesForSlot(slot, [], 'es')[index]!, factor),
    title: `${templatesForSlot(slot, [], 'es')[index]!.title} ${suffix}`,
  })
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

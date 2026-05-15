import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateIngredientNutrition, scoreRecipe, type NutritionFood } from './engine'

test('uses food-specific unit conversions for ambiguous household units', () => {
  const eggs = calculateIngredientNutrition({ name: 'huevos', amount: 2, unit: 'unidad' })
  assert.equal(eggs.normalizedAmount, 100)
  assert.equal(eggs.confidence, 'database')
  assert.equal(eggs.nutrition.calories, 143)

  const bread = calculateIngredientNutrition({ name: 'pan integral', amount: 2, unit: 'rebanadas' })
  assert.equal(bread.normalizedAmount, 70)
  assert.equal(bread.confidence, 'generic')
  assert.match(bread.notes.join(' '), /Conversión específica/)

  const banana = calculateIngredientNutrition({ name: 'plátano', amount: 1, unit: 'unidad' })
  assert.equal(banana.normalizedAmount, 118)
  assert.equal(banana.nutrition.calories, 105)
})

test('falls back to estimated generic units only when no food-specific conversion exists', () => {
  const tofu = calculateIngredientNutrition({ name: 'tofu firme', amount: 1, unit: 'unidad' })
  assert.equal(tofu.foodId, 'tofu')
  assert.equal(tofu.normalizedAmount, 80)
  assert.equal(tofu.confidence, 'estimated')
  assert.match(tofu.notes.join(' '), /Unidad genérica/)
})

test('broader deterministic food catalog validates common LLM-style recipes', () => {
  const recipe = scoreRecipe({
    title: 'Bol de quinoa con tofu y verduras',
    locale: 'es',
    description: 'Plato vegetal equilibrado.',
    servings: 1,
    prepTimeMinutes: 30,
    cuisine: 'mediterránea',
    flavorProfile: 'fresco, salado',
    tags: ['vegetal'],
    ingredients: [
      { name: 'quinoa cocida', amount: 180, unit: 'g' },
      { name: 'tofu firme', amount: 160, unit: 'g' },
      { name: 'pimiento rojo', amount: 90, unit: 'g' },
      { name: 'calabacín', amount: 120, unit: 'g' },
      { name: 'aceite de oliva', amount: 10, unit: 'g' },
    ],
    steps: ['Saltea las verduras.', 'Añade quinoa y tofu.'],
  })

  assert.notEqual(recipe.nutrition.confidence, 'unknown')
  assert.deepEqual(recipe.matchedIngredients.map((ingredient) => ingredient.foodId), [
    'quinoa_cooked',
    'tofu',
    'bell_pepper',
    'zucchini',
    'olive_oil',
  ])
  assert.ok(recipe.nutrition.calories > 550)
  assert.ok(recipe.nutrition.proteinG > 25)
})

test('can score against an imported source catalog instead of seed-only foods', () => {
  const catalog: NutritionFood[] = [{
    id: 'skyr_natural',
    canonicalName: 'skyr natural',
    aliases: ['skyr', 'skyr natural'],
    category: 'protein',
    source: 'bedca',
    sourceId: 'bedca:skyr-natural',
    confidence: 'database',
    per100g: { calories: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
    householdUnits: [
      { units: ['vaso', 'unidad'], grams: 150, confidence: 'database', note: 'Vaso de skyr natural.' },
    ],
  }]

  const ingredient = calculateIngredientNutrition({ name: 'skyr', amount: 1, unit: 'vaso' }, [], catalog)
  assert.equal(ingredient.foodId, 'skyr_natural')
  assert.equal(ingredient.sourceId, 'bedca:skyr-natural')
  assert.equal(ingredient.normalizedAmount, 150)
  assert.equal(ingredient.nutrition.proteinG, 16.5)
})

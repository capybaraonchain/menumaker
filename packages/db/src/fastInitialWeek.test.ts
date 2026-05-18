import assert from 'node:assert/strict'
import test from 'node:test'
import type { MacroTargets, MealSlot, RecipeCandidate } from '@menumaker/core'
import { mealSlots } from '@menumaker/core'
import { seedFoods } from '@menumaker/nutrition'
import { FAST_INITIAL_CANDIDATES_PER_SLOT, FAST_INITIAL_LLM_TIMEOUT_MS, FAST_INITIAL_REASONING_EFFORT, FAST_INITIAL_WEEK_SCHEMA_VERSION, type FastRecipePayload, type FastWeekGenerationInput, type FastWeekGenerationResult, type FastWeekPayload } from '@menumaker/ai'
import { buildFastIngredientBank, buildFastInitialWeek, FastInitialGenerationError, type ProfileRow } from './appService'

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
  likes: ['salmón', 'arroz'],
  dislikes: ['atún'],
  bannedFoods: [],
}

test('successful fast initial generation returns a validated 7 day menu without fallback', async () => {
  const week = await buildFastInitialWeek(profile, target(2200), {
    nutritionCatalog: seedFoods,
    ingredientMappings: [],
    generateFastInitialWeek: async (input) => generationResult(input, validDraft()),
  })

  assert.equal(week.source, 'llm')
  assert.deepEqual(week.fallbackSlots, [])
  assert.equal(week.trace.mode, 'fast_full_week')
  assert.equal(week.trace.fallbackAllowed, false)
  assert.equal(week.trace.fast.fallbackUsed, false)
  assert.equal(week.trace.fast.reasoningEffort, FAST_INITIAL_REASONING_EFFORT)
  assert.equal(week.trace.fast.rawCandidateMealCount, mealSlots.length * FAST_INITIAL_CANDIDATES_PER_SLOT)
  assert.equal(week.trace.fast.acceptedSelectedMealCount, 28)
  assert.equal(week.trace.fast.acceptedReserveMealCount, 0)
  assert.equal(week.trace.fast.repair.issuesAfter.length, 0)
  assert.equal(week.days.length, 7)
  for (const day of week.days) {
    assert.deepEqual(day.map((meal) => meal.slot), mealSlots)
    assert.ok(day.every((meal) => meal.recipe.nutrition.confidence !== 'unknown'))
  }
})

test('fast initial generation rejects hard restrictions before returning a menu', async () => {
  const draft = validDraft()
  const lunch = draft.candidates.find((candidate) => candidate.slot === 'lunch')
  assert.ok(lunch)
  lunch.recipe = payloadFromRecipe({
    ...baseRecipe('lunch'),
    title: 'Pollo con brócoli prohibido',
    ingredients: [
      { name: 'pechuga de pollo', amount: 180, unit: 'g' },
      { name: 'brócoli', amount: 120, unit: 'g' },
      { name: 'arroz cocido', amount: 160, unit: 'g' },
    ],
  }, 'lunch')

  await assert.rejects(
    () => buildFastInitialWeek({ ...profile, bannedFoods: ['brócoli'] }, target(2200), {
      nutritionCatalog: seedFoods,
      ingredientMappings: [],
      generateFastInitialWeek: async (input) => generationResult(input, draft),
    }),
    (error) => {
      assert.ok(error instanceof FastInitialGenerationError)
      assert.equal(error.failureCode, 'banned_item_conflict')
      assert.ok(error.message.includes('No puedo comer'))
      return true
    },
  )
})

test('fast initial generation rejects partial LLM weeks', async () => {
  const draft = validDraft()
  draft.candidates.pop()

  await assert.rejects(
    () => buildFastInitialWeek(profile, target(2200), {
      nutritionCatalog: seedFoods,
      ingredientMappings: [],
      generateFastInitialWeek: async (input) => generationResult(input, draft),
    }),
    (error) => {
      assert.ok(error instanceof FastInitialGenerationError)
      assert.equal(error.failureCode, 'generation_exhausted')
      assert.ok(error.message.includes('incompleta'))
      return true
    },
  )
})

test('fast ingredient bank excludes banned foods and avoids full alias expansion', () => {
  const bank = buildFastIngredientBank(seedFoods, { ...profile, bannedFoods: ['atún'] })
  const flat = Object.values(bank).flat()
  assert.ok(flat.length < seedFoods.flatMap((food) => food.aliases).length)
  assert.equal(flat.some((item) => item.id === 'tuna' || item.label.toLowerCase().includes('atún') || item.label.toLowerCase().includes('tuna')), false)
  assert.ok(flat.every((item) => item.id.length > 0 && item.label.length > 0 && item.role.length > 0))
  assert.ok(Object.values(bank).every((items) => items.length <= 20))
})

function validDraft(): FastWeekPayload {
  return {
    candidates: mealSlots.flatMap((slot) => Array.from({ length: FAST_INITIAL_CANDIDATES_PER_SLOT }, (_, index) => ({
      candidateId: `${slot}-${index}`,
      slot,
      recipe: payloadFromRecipe(recipeForSlot(slot, index), slot),
    }))),
  }
}

function generationResult(input: FastWeekGenerationInput, draft: FastWeekPayload): FastWeekGenerationResult {
  return {
    providerConfigured: true,
    source: 'llm',
    draft,
    cacheHit: false,
    trace: {
      schemaVersion: FAST_INITIAL_WEEK_SCHEMA_VERSION,
      timeoutMs: FAST_INITIAL_LLM_TIMEOUT_MS,
      requestedCandidateMeals: input.mealSlots.length * FAST_INITIAL_CANDIDATES_PER_SLOT,
      ingredientBankCounts: Object.fromEntries(Object.entries(input.ingredientBank).map(([key, values]) => [key, values.length])),
      reasoningEffort: FAST_INITIAL_REASONING_EFFORT,
    },
  }
}

function payloadFromRecipe(recipe: RecipeCandidate, slot: MealSlot): FastRecipePayload {
  return {
    titleHint: recipe.title,
    format: formatForTestSlot(slot),
    ingredients: recipe.ingredients.slice(0, 5).map((ingredient) => ({
      ingredientId: ingredientIdForTestIngredient(ingredient.name),
      role: roleForTestIngredient(ingredient.name),
    })),
  }
}

function formatForTestSlot(slot: MealSlot): FastRecipePayload['format'] {
  if (slot === 'breakfast') return 'breakfast_bowl'
  if (slot === 'snack') return 'snack_plate'
  return 'warm_plate'
}

function ingredientIdForTestIngredient(name: string): string {
  const normalized = name.toLowerCase()
  if (/pollo/.test(normalized)) return 'chicken_breast'
  if (/pavo/.test(normalized)) return 'turkey_breast'
  if (/ternera/.test(normalized)) return 'lean_beef'
  if (/salmón|salmon/.test(normalized)) return 'salmon'
  if (/atún|atun/.test(normalized)) return 'tuna'
  if (/tofu/.test(normalized)) return 'tofu'
  if (/garbanzo/.test(normalized)) return 'chickpeas_cooked'
  if (/lenteja/.test(normalized)) return 'lentils_cooked'
  if (/yogur/.test(normalized)) return 'greek_yogurt'
  if (/requesón|requeson/.test(normalized)) return 'cottage_cheese'
  if (/huevo/.test(normalized)) return 'egg'
  if (/leche/.test(normalized)) return 'milk'
  if (/arroz/.test(normalized)) return 'rice_cooked'
  if (/patata/.test(normalized)) return 'potato'
  if (/quinoa/.test(normalized)) return 'quinoa_cooked'
  if (/pasta/.test(normalized)) return 'pasta_cooked'
  if (/avena/.test(normalized)) return 'oats'
  if (/pan/.test(normalized)) return 'whole_wheat_bread'
  if (/brócoli|brocoli/.test(normalized)) return 'broccoli'
  if (/espinaca/.test(normalized)) return 'spinach'
  if (/calabac/.test(normalized)) return 'zucchini'
  if (/tomate/.test(normalized)) return 'tomato'
  if (/pimiento/.test(normalized)) return 'bell_pepper'
  if (/champi/.test(normalized)) return 'mushroom'
  if (/pepino/.test(normalized)) return 'cucumber'
  if (/lechuga/.test(normalized)) return 'lettuce'
  if (/cebolla/.test(normalized)) return 'onion'
  if (/zanahoria/.test(normalized)) return 'carrot'
  if (/plátano|platano/.test(normalized)) return 'banana'
  if (/manzana/.test(normalized)) return 'apple'
  if (/frutos/.test(normalized)) return 'berries'
  if (/aceite/.test(normalized)) return 'olive_oil'
  if (/aguacate/.test(normalized)) return 'avocado'
  if (/almendra/.test(normalized)) return 'almonds'
  if (/cacahuete/.test(normalized)) return 'peanut_butter'
  return name
}

function recipeForSlot(slot: MealSlot, index: number): RecipeCandidate {
  const breakfast = [
    ['Bol de yogur griego con avena y plátano', ['yogur griego natural', 'copos de avena', 'plátano']],
    ['Tostada integral con huevo y tomate', ['pan integral', 'huevo', 'tomate']],
    ['Requesón con avena y manzana', ['requesón', 'copos de avena', 'manzana']],
    ['Leche con avena y frutos rojos', ['leche', 'copos de avena', 'frutos rojos']],
    ['Huevos con pan integral y aguacate', ['huevo', 'pan integral', 'aguacate']],
    ['Yogur griego con berries y almendras', ['yogur griego natural', 'frutos rojos', 'almendras']],
    ['Requesón con plátano y crema de cacahuete', ['requesón', 'plátano', 'crema de cacahuete']],
    ['Tostada integral con huevo y espinacas', ['pan integral', 'huevo', 'espinacas']],
    ['Leche con pan integral y manzana', ['leche', 'pan integral', 'manzana']],
    ['Yogur griego con avena y manzana', ['yogur griego natural', 'copos de avena', 'manzana']],
  ] as const
  const snack = [
    ['Yogur griego con manzana', ['yogur griego natural', 'manzana', 'almendras']],
    ['Garbanzos con pan integral y tomate', ['garbanzos cocidos', 'pan integral', 'tomate']],
    ['Leche con plátano', ['leche', 'plátano', 'almendras']],
    ['Tostada integral con crema de cacahuete', ['pan integral', 'crema de cacahuete', 'plátano']],
    ['Huevo con pan integral', ['huevo', 'pan integral', 'tomate']],
    ['Yogur griego con berries', ['yogur griego natural', 'frutos rojos', 'almendras']],
    ['Garbanzos con pepino y tomate', ['garbanzos cocidos', 'pepino', 'tomate']],
    ['Leche con pan integral', ['leche', 'pan integral', 'crema de cacahuete']],
    ['Huevo con aguacate', ['huevo', 'aguacate', 'tomate']],
    ['Yogur griego con plátano', ['yogur griego natural', 'plátano', 'almendras']],
  ] as const
  const mains = [
    ['Pollo con arroz y brócoli', ['pechuga de pollo', 'arroz cocido', 'brócoli', 'aceite de oliva']],
    ['Pavo con patata y espinacas', ['pechuga de pavo', 'patata', 'espinacas', 'aceite de oliva']],
    ['Salmón con quinoa y calabacín', ['salmón', 'quinoa cocida', 'calabacín', 'tomate']],
    ['Ternera con pasta y pimiento', ['ternera magra', 'pasta cocida', 'pimiento', 'champiñones']],
    ['Tofu con arroz y brócoli', ['tofu', 'arroz cocido', 'brócoli', 'calabacín']],
    ['Atún con patata y pepino', ['atún', 'patata', 'pepino', 'tomate']],
    ['Garbanzos con quinoa y espinacas', ['garbanzos cocidos', 'quinoa cocida', 'espinacas', 'cebolla']],
    ['Lentejas con arroz y tomate', ['lentejas cocidas', 'arroz cocido', 'tomate', 'espinacas']],
    ['Pollo con pasta y calabacín', ['pechuga de pollo', 'pasta cocida', 'calabacín', 'pimiento']],
    ['Salmón con patata y ensalada', ['salmón', 'patata', 'lechuga', 'pepino']],
  ] as const
  const selected = slot === 'breakfast'
    ? breakfast[index % breakfast.length]
    : slot === 'snack'
      ? snack[index % snack.length]
      : mains[(index + (slot === 'dinner' ? 4 : 0)) % mains.length]
  return recipeFromNames(slot === 'dinner' ? `Cena de ${selected![0]}` : selected![0], slot, selected![1])
}

function recipeFromNames(title: string, slot: MealSlot, names: readonly string[]): RecipeCandidate {
  return {
    title,
    locale: 'es',
    description: 'Receta de prueba.',
    servings: 1,
    prepTimeMinutes: slot === 'breakfast' || slot === 'snack' ? 8 : 30,
    cuisine: 'casera',
    flavorProfile: 'equilibrado',
    tags: ['test'],
    ingredients: names.map((name) => ({ name, amount: 100, unit: 'g' as const })),
    steps: ['Preparar y servir.'],
  }
}

function roleForTestIngredient(name: string): 'protein' | 'carb' | 'main_veg' | 'fruit' | 'fat' | 'aromatic' {
  const normalized = name.toLowerCase()
  if (/arroz|patata|quinoa|pasta|avena|pan/.test(normalized)) return 'carb'
  if (/brócoli|brocoli|espinaca|calabac|tomate|pimiento|champi|pepino|lechuga|cebolla/.test(normalized)) return 'main_veg'
  if (/plátano|platano|manzana|frutos/.test(normalized)) return 'fruit'
  if (/aceite|aguacate|almendra|cacahuete/.test(normalized)) return 'fat'
  return 'protein'
}

function baseRecipe(slot: MealSlot): RecipeCandidate {
  if (slot === 'breakfast') {
    return {
      title: 'Bol de yogur con avena',
      locale: 'es',
      description: 'Desayuno alto en proteína.',
      servings: 1,
      prepTimeMinutes: 8,
      cuisine: 'casera',
      flavorProfile: 'cremoso',
      tags: ['rápido'],
      ingredients: [
        { name: 'yogur griego natural', amount: 240, unit: 'g' },
        { name: 'copos de avena', amount: 45, unit: 'g' },
        { name: 'plátano', amount: 90, unit: 'g' },
      ],
      steps: ['Mezclar y servir.'],
    }
  }
  if (slot === 'snack') {
    return {
      title: 'Snack de yogur con pan integral',
      locale: 'es',
      description: 'Snack simple y proteico.',
      servings: 1,
      prepTimeMinutes: 5,
      cuisine: 'casera',
      flavorProfile: 'suave',
      tags: ['snack'],
      ingredients: [
        { name: 'yogur griego natural', amount: 180, unit: 'g' },
        { name: 'pan integral', amount: 45, unit: 'g' },
      ],
      steps: ['Servir junto.'],
    }
  }
  return {
    title: slot === 'lunch' ? 'Pollo con arroz y tomate' : 'Pavo con patata y espinacas',
    locale: 'es',
    description: 'Plato principal equilibrado.',
    servings: 1,
    prepTimeMinutes: 30,
    cuisine: 'mediterránea',
    flavorProfile: 'salado',
    tags: ['alto en proteína'],
    ingredients: slot === 'lunch'
      ? [
          { name: 'pechuga de pollo', amount: 170, unit: 'g' },
          { name: 'arroz cocido', amount: 180, unit: 'g' },
          { name: 'tomate', amount: 120, unit: 'g' },
          { name: 'aceite de oliva', amount: 8, unit: 'g' },
        ]
      : [
          { name: 'pechuga de pavo', amount: 170, unit: 'g' },
          { name: 'patata', amount: 260, unit: 'g' },
          { name: 'espinacas', amount: 90, unit: 'g' },
          { name: 'aceite de oliva', amount: 8, unit: 'g' },
        ],
    steps: ['Cocinar los ingredientes y servir.'],
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
    goal: 'cut',
    macroMode: 'manual',
    preset: 'maintenance',
    maintenanceCalories: 2350,
    proteinCalculationWeightKg: 75,
    notes: [],
  }
}

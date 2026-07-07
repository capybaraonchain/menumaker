import { mealSlots, type Locale, type MacroTargets, type MealSlot } from '@menumaker/core'
import { codexStatus, completeStructured } from './provider'

export const FAST_INITIAL_WEEK_SCHEMA_VERSION = 'menumaker_fast_initial_week:v8'
export const FAST_INITIAL_LLM_TIMEOUT_MS = 45_000
export const FAST_INITIAL_SKETCH_TIMEOUT_MS = 20_000
export const FAST_INITIAL_DAY_TIMEOUT_MS = 22_000
export const FAST_INITIAL_REASONING_EFFORT = 'none'
export const FAST_INITIAL_CANDIDATES_PER_SLOT = 14

export type FastRecipeIngredientRole = 'protein' | 'carb' | 'main_veg' | 'fruit' | 'fat' | 'aromatic'
export type FastRecipeFormat =
  | 'breakfast_bowl'
  | 'toast'
  | 'omelette'
  | 'smoothie'
  | 'protein_bowl'
  | 'warm_plate'
  | 'salad_bowl'
  | 'stew'
  | 'pasta_plate'
  | 'snack_plate'

export interface FastRecipePayload {
  titleHint?: string
  title?: string
  description?: string
  prepTimeMinutes?: number
  cuisine?: string
  flavorProfile?: string
  tags?: string[]
  steps?: string[]
  format: FastRecipeFormat
  ingredients: Array<{
    ingredientId?: string
    name?: string
    amount?: number
    unit?: 'g' | 'ml'
    role: FastRecipeIngredientRole
  }>
}

export interface FastWeekPayload {
  candidates: Array<{
    candidateId: string
    dayIndex?: number
    slot: MealSlot
    recipe: FastRecipePayload
  }>
}

export interface FastWeekGenerationInput {
  locale: Locale
  target: Pick<MacroTargets, 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'goal' | 'macroMode'>
  likes: string[]
  dislikes: string[]
  bannedFoods: string[]
  mealSlots: MealSlot[]
  ingredientBank: Record<string, Array<{
    id: string
    label: string
    role: FastRecipeIngredientRole
    family: string
    tags: string[]
  }>>
  maxPrepTimeMinutes: number
}

export interface FastWeekGenerationResult {
  providerConfigured: boolean
  source: 'llm' | 'unavailable' | 'failed'
  draft: FastWeekPayload | null
  cacheHit?: boolean
  error?: string
  trace: {
    schemaVersion: typeof FAST_INITIAL_WEEK_SCHEMA_VERSION
    timeoutMs: number
    requestedCandidateMeals: number
    ingredientBankCounts: Record<string, number>
    reasoningEffort: typeof FAST_INITIAL_REASONING_EFFORT
  }
}

interface FastMenuSketchPayload {
  days: Array<{
    dayIndex: number
    theme: string
    avoidRepeating: string[]
    meals: Array<{
      slot: MealSlot
      concept: string
      targetCalories: number
      proteinFocus: string
      carbFocus: string
      style: string
    }>
  }>
}

export async function generateFastInitialWeek(input: FastWeekGenerationInput): Promise<FastWeekGenerationResult> {
  const trace = fastTrace(input)
  const status = codexStatus()
  if (!status.configured) {
    return { providerConfigured: false, source: 'unavailable', draft: null, trace }
  }

  try {
    const sketch = await generateFastMenuSketch(input).catch((error) => {
      throw new Error(`sketch failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    const dayPayloads = await Promise.all(sketch.days
      .sort((left, right) => left.dayIndex - right.dayIndex)
      .map((day) => generateFastDayRecipes(input, sketch, day).catch((error) => {
        throw new Error(`day ${day.dayIndex} failed: ${error instanceof Error ? error.message : String(error)}`)
      })))
    return {
      providerConfigured: true,
      source: 'llm',
      draft: { candidates: dayPayloads.flatMap((payload) => payload.candidates) },
      trace,
    }
  } catch (error) {
    return {
      providerConfigured: true,
      source: 'failed',
      draft: null,
      error: error instanceof Error ? error.message : String(error),
      trace,
    }
  }
}

function fastTrace(input: FastWeekGenerationInput): FastWeekGenerationResult['trace'] {
  return {
    schemaVersion: FAST_INITIAL_WEEK_SCHEMA_VERSION,
    timeoutMs: FAST_INITIAL_LLM_TIMEOUT_MS,
    requestedCandidateMeals: input.mealSlots.length * FAST_INITIAL_CANDIDATES_PER_SLOT,
    ingredientBankCounts: Object.fromEntries(Object.entries(input.ingredientBank).map(([key, values]) => [key, values.length])),
    reasoningEffort: FAST_INITIAL_REASONING_EFFORT,
  }
}

async function generateFastMenuSketch(input: FastWeekGenerationInput): Promise<FastMenuSketchPayload> {
  const ingredientOptions = compactIngredientOptions(input)
  const system = input.locale === 'es'
    ? [
        'Eres el planificador culinario rápido de MenuMaker.',
        'Crea un boceto compacto de 7 días para una semana variada.',
        'No escribas recetas ni cantidades; solo conceptos, temas y focos de ingredientes exactos.',
        'Respeta No puedo comer y Evitar. Devuelve solo JSON válido.',
      ].join(' ')
    : [
        'You are MenuMaker fast culinary planner.',
        'Create a compact 7-day sketch for a varied weekly menu.',
        'Do not write full recipes or ingredient lists; only concepts, themes, and diversity focus.',
        'Respect Cannot eat and Avoid. Return only valid JSON.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    mealSlots: input.mealSlots,
    target: input.target,
    slotTargets: Object.fromEntries(input.mealSlots.map((slot) => [slot, Math.round(input.target.calories * slotShare(slot))])),
    ingredientOptions,
    profile: {
      likes: input.likes,
      avoid: input.dislikes,
      cannotEat: input.bannedFoods,
    },
    rules: [
      'Devuelve exactamente 7 días: dayIndex 0..6.',
      'Cada día debe tener exactamente breakfast, lunch, dinner y snack.',
      'Varía formato, proteína principal, base de carbohidrato, textura y estilo entre días cercanos.',
      'Evita que dos días consecutivos se sientan iguales.',
      'proteinFocus y carbFocus deben ser nombres exactos de ingredientOptions cuando aplique.',
      'No uses la misma proteinFocus más de 4 veces en toda la semana.',
      'Reparte breakfast y snack entre proteínas distintas; no concentres toda la semana en lácteos.',
      'No incluyas alimentos de cannotEat.',
      'No calcules nutrición exacta; solo reparte targetCalories por slot.',
    ],
  })

  const sketch = await completeStructured<FastMenuSketchPayload>({
    schemaName: 'menumaker_fast_menu_sketch',
    schema: fastMenuSketchSchema,
    system,
    user,
    timeoutMs: FAST_INITIAL_SKETCH_TIMEOUT_MS,
    reasoningEffort: FAST_INITIAL_REASONING_EFFORT,
  })
  return sanitizeSketch(sketch, input)
}

async function generateFastDayRecipes(
  input: FastWeekGenerationInput,
  sketch: FastMenuSketchPayload,
  day: FastMenuSketchPayload['days'][number],
): Promise<FastWeekPayload> {
  const supportedIngredientNames = Object.values(input.ingredientBank)
    .flat()
    .map((ingredient) => ingredient.label)
    .filter(Boolean)
  const surroundingDays = sketch.days
    .filter((item) => item.dayIndex !== day.dayIndex)
    .map((item) => ({
      dayIndex: item.dayIndex,
      theme: item.theme,
      concepts: item.meals.map((meal) => `${meal.slot}: ${meal.concept}`),
    }))
  const system = input.locale === 'es'
    ? [
        'Eres un chef-nutricionista de MenuMaker.',
        'Crea 4 recetas compactas para un solo día, con título y gramos/ml por ingrediente.',
        'Usa solo nombres exactos de supportedIngredientNames para que la app pueda calcular nutrición.',
        'No escribas descripciones, pasos, etiquetas ni nutrición. Respeta No puedo comer y Evitar. Devuelve solo JSON válido.',
      ].join(' ')
    : [
        'You are a MenuMaker chef-nutritionist.',
        'Create 4 compact recipes for one day, with title and grams/ml per ingredient.',
        'Use only exact names from supportedIngredientNames so the app can calculate nutrition.',
        'Do not write descriptions, steps, tags, or nutrition. Respect Cannot eat and Avoid. Return only valid JSON.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    day,
    surroundingDays: surroundingDays.map((item) => ({
      dayIndex: item.dayIndex,
      theme: item.theme,
    })),
    target: input.target,
    slotTargets: Object.fromEntries(input.mealSlots.map((slot) => [slot, {
      calories: Math.round(input.target.calories * slotShare(slot)),
      proteinG: Math.round(input.target.proteinG * slotShare(slot)),
      carbsG: Math.round(input.target.carbsG * slotShare(slot)),
      fatG: Math.round(input.target.fatG * slotShare(slot)),
    }])),
    profile: {
      likes: input.likes,
      avoid: input.dislikes,
      cannotEat: input.bannedFoods,
    },
    supportedIngredientNames,
    maxPrepTimeMinutes: input.maxPrepTimeMinutes,
    outputRules: [
      'Devuelve exactamente 8 candidatos: dos opciones por cada slot del día.',
      'candidateId debe ser único y corto.',
      'dayIndex debe ser el dayIndex asignado.',
      'Usa nombres naturales exactos de supportedIngredientNames, no IDs.',
      'Cada ingrediente debe tener amount numérico y unit g o ml.',
      'Ajusta cantidades para acercarse al target del slot. La app recalculará nutrición real.',
      'No uses ni menciones alimentos de cannotEat.',
      'Incluye el proteinFocus del slot si aparece en supportedIngredientNames.',
      'El proteinFocus debe ser la proteína principal; no añadas otra proteína principal para subir macros.',
      'Si breakfast o snack tienen un proteinFocus que no es lácteo, no añadas lácteos extra como proteína secundaria.',
      'Incluye el carbFocus del slot si aparece en supportedIngredientNames y encaja con la comida.',
      'Para lunch y dinner incluye al menos una proteína, un carbohidrato o legumbre, y una verdura principal.',
      'Para breakfast y snack incluye al menos una proteína y un carbohidrato, fruta o grasa saludable.',
      'Cada comida debe tener 3-7 ingredientes.',
      'Los títulos deben sonar como recetas concretas, no listas mecánicas de ingredientes.',
      'No nombres ingredientes en el título que no estén en la receta.',
      'No incluyas pasos, descripción, cuisine, flavorProfile ni tags en esta respuesta.',
      'Cada comida es una porción para una persona.',
    ],
  })

  const payload = await completeStructured<FastWeekPayload>({
    schemaName: 'menumaker_fast_day_recipes',
    schema: fastWeekSchemaForIngredients(supportedIngredientNames),
    system,
    user,
    timeoutMs: FAST_INITIAL_DAY_TIMEOUT_MS,
    reasoningEffort: FAST_INITIAL_REASONING_EFFORT,
  })
  return sanitizeDayPayload(payload, input, day.dayIndex)
}

function compactIngredientOptions(input: FastWeekGenerationInput): Record<string, string[]> {
  const roles = ['protein', 'carb', 'fruit', 'fat'] as const
  return Object.fromEntries(roles.map((role) => [
    role,
    (input.ingredientBank[role] ?? []).map((ingredient) => ingredient.label).filter(Boolean).slice(0, 12),
  ]))
}

const fastRecipeSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    prepTimeMinutes: { type: 'number' },
    cuisine: { type: 'string' },
    flavorProfile: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    format: { type: 'string', enum: ['breakfast_bowl', 'toast', 'omelette', 'smoothie', 'protein_bowl', 'warm_plate', 'salad_bowl', 'stew', 'pasta_plate', 'snack_plate'] },
    ingredients: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          unit: { type: 'string', enum: ['g', 'ml'] },
          role: { type: 'string', enum: ['protein', 'carb', 'main_veg', 'fruit', 'fat', 'aromatic'] },
        },
      },
    },
  },
}

const fastCompactRecipeSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    format: { type: 'string', enum: ['breakfast_bowl', 'toast', 'omelette', 'smoothie', 'protein_bowl', 'warm_plate', 'salad_bowl', 'stew', 'pasta_plate', 'snack_plate'] },
    ingredients: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          unit: { type: 'string', enum: ['g', 'ml'] },
          role: { type: 'string', enum: ['protein', 'carb', 'main_veg', 'fruit', 'fat', 'aromatic'] },
        },
      },
    },
  },
}

const fastWeekSchema = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      minItems: mealSlots.length,
      maxItems: mealSlots.length,
      items: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          dayIndex: { type: 'number' },
          slot: { type: 'string', enum: mealSlots },
          recipe: fastRecipeSchema,
        },
      },
    },
  },
}

function fastWeekSchemaForIngredients(supportedIngredientNames: string[]) {
  const ingredientNames = Array.from(new Set(supportedIngredientNames)).filter(Boolean)
  return {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        minItems: mealSlots.length * 2,
        maxItems: mealSlots.length * 2,
        items: {
          type: 'object',
          properties: {
            candidateId: { type: 'string' },
            dayIndex: { type: 'number' },
            slot: { type: 'string', enum: mealSlots },
            recipe: {
              ...fastCompactRecipeSchema,
              properties: {
                ...fastCompactRecipeSchema.properties,
                ingredients: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 7,
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', enum: ingredientNames },
                      amount: { type: 'number' },
                      unit: { type: 'string', enum: ['g', 'ml'] },
                      role: { type: 'string', enum: ['protein', 'carb', 'main_veg', 'fruit', 'fat', 'aromatic'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}

const fastMenuSketchSchema = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      minItems: 7,
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          dayIndex: { type: 'number' },
          theme: { type: 'string' },
          avoidRepeating: { type: 'array', items: { type: 'string' } },
          meals: {
            type: 'array',
            minItems: mealSlots.length,
            maxItems: mealSlots.length,
            items: {
              type: 'object',
              properties: {
                slot: { type: 'string', enum: mealSlots },
                concept: { type: 'string' },
                targetCalories: { type: 'number' },
                proteinFocus: { type: 'string' },
                carbFocus: { type: 'string' },
                style: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

function sanitizeSketch(sketch: FastMenuSketchPayload, input: FastWeekGenerationInput): FastMenuSketchPayload {
  return {
    days: Array.from({ length: 7 }, (_, dayIndex) => {
      const day = sketch.days?.find((item) => Math.round(Number(item.dayIndex)) === dayIndex)
      return {
        dayIndex,
        theme: day?.theme?.trim() || `Día ${dayIndex + 1}`,
        avoidRepeating: (day?.avoidRepeating ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 8),
        meals: input.mealSlots.map((slot) => {
          const meal = day?.meals?.find((item) => item.slot === slot)
          return {
            slot,
            concept: meal?.concept?.trim() || slot,
            targetCalories: Math.round(Number(meal?.targetCalories) || input.target.calories * slotShare(slot)),
            proteinFocus: meal?.proteinFocus?.trim() || 'variada',
            carbFocus: meal?.carbFocus?.trim() || 'equilibrada',
            style: meal?.style?.trim() || 'casero',
          }
        }),
      }
    }),
  }
}

function sanitizeDayPayload(payload: FastWeekPayload, input: FastWeekGenerationInput, dayIndex: number): FastWeekPayload {
  return {
    candidates: input.mealSlots.flatMap((slot) => {
      const candidates = (payload.candidates ?? []).filter((item) => item.slot === slot).slice(0, 2)
      if (candidates.length < 2) throw new Error(`Day ${dayIndex} missing ${slot} options`)
      return candidates.map((candidate, index) => ({
        candidateId: `${dayIndex}-${slot}-${index}`,
        dayIndex,
        slot,
        recipe: sanitizeFastRecipePayload(candidate.recipe, slot, input.locale),
      }))
    }),
  }
}

function sanitizeFastRecipePayload(recipe: FastRecipePayload, slot: MealSlot, locale: Locale): FastRecipePayload {
  const title = recipe.title?.trim() || slot
  const ingredients = (recipe.ingredients ?? [])
    .map((ingredient) => ({
      name: ingredient.name?.trim(),
      amount: Math.max(1, Math.round(Number(ingredient.amount) || 0)),
      unit: ingredient.unit === 'ml' ? 'ml' as const : 'g' as const,
      role: (['protein', 'carb', 'main_veg', 'fruit', 'fat', 'aromatic'] as FastRecipeIngredientRole[]).includes(ingredient.role) ? ingredient.role : 'protein',
    }))
    .filter((ingredient) => ingredient.name && ingredient.amount > 0)
    .slice(0, 7)
  if (ingredients.length < 2) throw new Error(`Invalid recipe for ${slot}`)
  return {
    title,
    description: recipe.description?.trim() || title,
    prepTimeMinutes: Math.max(1, Math.min(120, Math.round(Number(recipe.prepTimeMinutes) || (slot === 'breakfast' || slot === 'snack' ? 10 : 30)))),
    cuisine: recipe.cuisine?.trim() || (locale === 'es' ? 'casera' : 'home cooking'),
    flavorProfile: recipe.flavorProfile?.trim() || (locale === 'es' ? 'equilibrado' : 'balanced'),
    tags: Array.from(new Set((recipe.tags ?? []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 4),
    steps: (recipe.steps ?? []).map((step) => step.trim()).filter(Boolean).slice(0, 4),
    format: recipe.format,
    ingredients,
  }
}

function slotShare(slot: MealSlot): number {
  if (slot === 'breakfast') return 0.23
  if (slot === 'lunch') return 0.32
  if (slot === 'dinner') return 0.32
  return 0.13
}

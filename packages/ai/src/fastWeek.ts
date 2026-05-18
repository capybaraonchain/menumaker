import { mealSlots, type Locale, type MacroTargets, type MealSlot } from '@menumaker/core'
import { codexStatus, completeStructured } from './codexOAuth'

export const FAST_INITIAL_WEEK_SCHEMA_VERSION = 'menumaker_fast_initial_week:v6'
export const FAST_INITIAL_LLM_TIMEOUT_MS = 45_000
export const FAST_INITIAL_REASONING_EFFORT = 'none'
export const FAST_INITIAL_CANDIDATES_PER_SLOT = 12

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
  format: FastRecipeFormat
  ingredients: Array<{
    ingredientId: string
    role: FastRecipeIngredientRole
  }>
}

export interface FastWeekPayload {
  candidates: Array<{
    candidateId: string
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

export async function generateFastInitialWeek(input: FastWeekGenerationInput): Promise<FastWeekGenerationResult> {
  const trace = fastTrace(input)
  const status = codexStatus()
  if (!status.configured) {
    return { providerConfigured: false, source: 'unavailable', draft: null, trace }
  }

  const system = input.locale === 'es'
    ? [
        'Eres el generador rápido de la primera semana de MenuMaker.',
        'Crea candidatos compactos, realistas y variados para que la app arme la semana localmente.',
        'Devuelve solo JSON válido y compacto con un pool de candidatos.',
        'Usa exclusivamente ingredientId exactos del ingredientBank. No inventes nombres de ingredientes.',
        'No incluyas cantidades, nutrición, descripciones, tags, cocina, tiempos ni pasos; la app calcula y completa eso después.',
        'Nunca uses alimentos de No puedo comer. Evita los alimentos de Evitar siempre que sea posible.',
        'No uses aromáticos o condimentos como ingredientes principales.',
      ].join(' ')
    : [
        'You generate MenuMaker first-week menus quickly.',
        'Create compact, realistic, varied meal candidates so the app can assemble the week locally.',
        'Return only compact JSON with a candidate pool.',
        'Use only exact ingredientIds from the ingredientBank. Do not invent ingredient names.',
        'Do not include amounts, nutrition, descriptions, tags, cuisine, prep times, or cooking steps; the app calculates and fills those later.',
        'Never use foods from Cannot eat. Avoid foods from Avoid whenever possible.',
        'Do not use aromatics or condiments as main ingredients.',
      ].join(' ')

  const requestedCandidateMeals = input.mealSlots.length * FAST_INITIAL_CANDIDATES_PER_SLOT
  const user = JSON.stringify({
    locale: input.locale,
    mealSlots: input.mealSlots,
    requestedCandidateMeals,
    candidatesPerSlot: FAST_INITIAL_CANDIDATES_PER_SLOT,
    target: input.target,
    profile: {
      likes: input.likes,
      avoid: input.dislikes,
      cannotEat: input.bannedFoods,
    },
    ingredientBank: input.ingredientBank,
    maxPrepTimeMinutes: input.maxPrepTimeMinutes,
    outputRules: [
      `Devuelve exactamente ${FAST_INITIAL_CANDIDATES_PER_SLOT} candidatos por slot (${requestedCandidateMeals} total).`,
      'candidateId debe ser único y corto.',
      'Usa solo ingredientId exactos del ingredientBank. Si no existe el id, no uses ese ingrediente.',
      'No repitas exactamente el mismo conjunto de ingredientId dentro del mismo slot.',
      'Varía proteínas, carbohidratos, verduras, familias y formatos dentro de cada slot.',
      'No uses ni menciones alimentos de cannotEat.',
      'Para lunch y dinner incluye al menos una proteína, un carbohidrato o legumbre, y una verdura principal.',
      'Para breakfast y snack incluye al menos una proteína y un carbohidrato, fruta o grasa saludable.',
      'Usa role=aromatic solo para ajo, hierbas, especias o condimentos pequeños; nunca cuenta como main_veg.',
      'No llenes el pool con variaciones mínimas de lácteo + fruta + pan; ofrece opciones saladas, vegetales y legumbres también.',
      'Para macroMode balanced, prioriza carbohidratos suficientes y evita menús excesivamente altos en grasa o proteína.',
      'No combines pescado con plátano o crema de cacahuete.',
      'No combines queso salado con plátano.',
      'Cada comida debe tener 2-5 ingredientes.',
      'titleHint es opcional; si lo usas, no nombres ingredientes que no estén en ingredientIds.',
      'No escribas cantidades, instrucciones, pasos, descripciones, tags ni nutrición.',
      'Cada comida es una porción para una persona.',
    ],
  }, null, 2)

  try {
    const draft = await completeStructured<FastWeekPayload>({
      schemaName: 'menumaker_fast_initial_week',
      schema: fastWeekSchema,
      system,
      user,
      timeoutMs: FAST_INITIAL_LLM_TIMEOUT_MS,
      reasoningEffort: FAST_INITIAL_REASONING_EFFORT,
    })
    return { providerConfigured: true, source: 'llm', draft, trace }
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

const fastRecipeSchema = {
  type: 'object',
  properties: {
    titleHint: { type: 'string' },
    format: { type: 'string', enum: ['breakfast_bowl', 'toast', 'omelette', 'smoothie', 'protein_bowl', 'warm_plate', 'salad_bowl', 'stew', 'pasta_plate', 'snack_plate'] },
    ingredients: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          ingredientId: { type: 'string' },
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
      minItems: mealSlots.length * FAST_INITIAL_CANDIDATES_PER_SLOT,
      maxItems: mealSlots.length * FAST_INITIAL_CANDIDATES_PER_SLOT,
      items: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          slot: { type: 'string', enum: mealSlots },
          recipe: fastRecipeSchema,
        },
      },
    },
  },
}

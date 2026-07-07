import { mealSlots, type Locale, type MacroTargets, type MealSlot, type WeekSkeleton } from '@menumaker/core'
import { codexStatus, completeStructured } from './provider'

export interface WeekSkeletonGenerationInput {
  locale: Locale
  profileName?: string
  mealSlots: MealSlot[]
  target: MacroTargets
  likes?: string[]
  dislikes?: string[]
  bannedFoods?: string[]
  maxPrepTimeMinutes: number
}

export interface WeekSkeletonGenerationResult {
  providerConfigured: boolean
  source: 'llm' | 'unavailable' | 'failed'
  skeleton: WeekSkeleton | null
  cacheHit?: boolean
  error?: string
}

export async function generateWeekSkeleton(input: WeekSkeletonGenerationInput): Promise<WeekSkeletonGenerationResult> {
  const status = codexStatus()
  if (!status.configured) {
    return { providerConfigured: false, source: 'unavailable', skeleton: null }
  }

  const system = input.locale === 'es'
    ? [
        'Eres el planificador semanal de MenuMaker.',
        'Crea un esqueleto de menú, no recetas completas.',
        'El esqueleto debe mejorar variedad, saciedad y coherencia culinaria antes de generar recetas.',
        'Devuelve solo JSON válido con siete días y todos los slots pedidos.',
        'No incluyas calorías ni nutrición calculada; eso lo valida la app después.',
      ].join(' ')
    : [
        'You are MenuMaker weekly planning.',
        'Create a menu skeleton, not full recipes.',
        'The skeleton should improve variety, satiety, and culinary coherence before recipe generation.',
        'Return only valid JSON with seven days and every requested meal slot.',
        'Do not include calculated nutrition; the app validates that later.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    profile: {
      name: input.profileName,
      likes: input.likes ?? [],
      dislikes: input.dislikes ?? [],
      bannedFoods: input.bannedFoods ?? [],
    },
    mealSlots: input.mealSlots,
    target: {
      calories: input.target.calories,
      proteinG: input.target.proteinG,
      carbsG: input.target.carbsG,
      fatG: input.target.fatG,
      goal: input.target.goal,
      macroMode: input.target.macroMode,
    },
    maxPrepTimeMinutes: input.maxPrepTimeMinutes,
    outputRules: [
      'Cada dayIndex debe existir del 0 al 6.',
      'Cada día debe contener exactamente los mealSlots pedidos.',
      'intent debe describir el tipo de plato esperado, formato, proteína/carbos/verduras o estilo culinario.',
      'avoidRepeating debe listar temas, formatos o ingredientes que conviene no repetir cerca de ese plato.',
      'No uses alimentos prohibidos o disliked como intención principal.',
      'Evita que desayuno, comida, cena y snack del mismo día parezcan la misma receta.',
      'Varía proteínas, carbohidratos, formatos, texturas y perfiles de sabor durante la semana.',
    ],
  }, null, 2)

  try {
    const response = await completeStructured<WeekSkeletonPayload>({
      schemaName: 'menumaker_week_skeleton',
      schema: weekSkeletonGenerationSchema,
      system,
      user,
      timeoutMs: 90_000,
    })
    const skeleton = sanitizeWeekSkeleton(response, input.mealSlots)
    if (!skeleton) {
      return {
        providerConfigured: true,
        source: 'failed',
        skeleton: null,
        error: 'El proveedor devolvió un esqueleto semanal incompleto o inválido.',
      }
    }
    return { providerConfigured: true, source: 'llm', skeleton }
  } catch (error) {
    return {
      providerConfigured: true,
      source: 'failed',
      skeleton: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

interface WeekSkeletonPayload {
  days: Array<{
    dayIndex: number
    meals: Array<{
      slot: MealSlot
      intent: string
      avoidRepeating?: string[]
    }>
  }>
}

const weekSkeletonGenerationSchema = {
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
          meals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slot: { type: 'string', enum: mealSlots },
                intent: { type: 'string' },
                avoidRepeating: { type: 'array', items: { type: 'string' } },
              },
              required: ['slot', 'intent', 'avoidRepeating'],
              additionalProperties: false,
            },
          },
        },
        required: ['dayIndex', 'meals'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
}

function sanitizeWeekSkeleton(raw: WeekSkeletonPayload | undefined, requestedSlots: MealSlot[]): WeekSkeleton | null {
  const days = []
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const rawDay = raw?.days?.find((day) => Number(day.dayIndex) === dayIndex)
    if (!rawDay) return null
    const meals = []
    for (const slot of requestedSlots) {
      const rawMeal = rawDay.meals?.find((meal) => meal.slot === slot)
      const intent = rawMeal?.intent?.trim()
      if (!intent) return null
      meals.push({
        slot,
        intent,
        avoidRepeating: Array.from(new Set((rawMeal!.avoidRepeating ?? []).map((item) => item.trim()).filter(Boolean))).slice(0, 6),
      })
    }
    days.push({ dayIndex, meals })
  }
  return { days }
}

import type { Locale, MealSlot, NutritionTotals, RecipeCandidate } from '@menumaker/core'
import { codexStatus, completeStructured } from './codexOAuth'

export interface RecipeGenerationInput {
  locale: Locale
  slot: MealSlot
  count: number
  profileName?: string
  likes?: string[]
  dislikes?: string[]
  bannedFoods?: string[]
  avoidFoods?: string[]
  avoidTitles?: string[]
  userRequest?: string
  targetNutrition?: Partial<NutritionTotals>
  menuContext?: unknown
  allowedIngredients: string[]
}

export interface RecipeGenerationResult {
  providerConfigured: boolean
  source: 'llm' | 'unavailable' | 'failed'
  recipes: RecipeCandidate[]
  error?: string
}

export async function generateRecipeCandidates(input: RecipeGenerationInput): Promise<RecipeGenerationResult> {
  const status = codexStatus()
  if (!status.configured) return { providerConfigured: false, source: 'unavailable', recipes: [] }

  const system = input.locale === 'es'
    ? [
        'Eres el generador de recetas estructuradas de MenuMaker.',
        'Genera recetas reales, apetecibles y variadas para una app de planificación semanal.',
        'Devuelve solo JSON válido con la forma pedida.',
        'Cada receta es una porción para una persona.',
        'Usa únicamente ingredientes de la lista permitida y cantidades numéricas en g o ml.',
        'Respeta alimentos evitados/prohibidos, títulos evitados, variedad del menú, slot de comida, tiempo máximo de 120 minutos y objetivo aproximado de macros.',
        'No incluyas nutrición; la app la calcula determinísticamente después.',
      ].join(' ')
    : [
        'You generate structured recipe candidates for MenuMaker.',
        'Return only valid JSON matching the schema.',
        'Each recipe is one serving for one person.',
        'Use only allowed ingredients and numeric g/ml quantities.',
        'Respect avoided foods, avoided titles, menu variety, meal slot, max 120 minutes prep time, and approximate nutrition target.',
        'Do not include nutrition; the app calculates it deterministically afterwards.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    slot: input.slot,
    requestedCount: input.count,
    profile: {
      name: input.profileName,
      likes: input.likes ?? [],
      dislikes: input.dislikes ?? [],
      bannedFoods: input.bannedFoods ?? [],
    },
    userRequest: input.userRequest ?? null,
    targetNutrition: input.targetNutrition ?? null,
    avoidFoods: input.avoidFoods ?? [],
    avoidTitles: input.avoidTitles ?? [],
    menuContext: input.menuContext ?? null,
    allowedIngredients: input.allowedIngredients,
    outputRules: [
      'No repitas títulos.',
      'No devuelvas ninguna receta cuyo título esté en avoidTitles.',
      'No uses ningún alimento de avoidFoods, dislikes o bannedFoods.',
      'Haz recetas culinariamente coherentes: ingredientes que combinen entre sí.',
      'Varía proteínas, formatos, texturas y sabores respecto al menú existente.',
      'Mantén prepTimeMinutes <= 120.',
    ],
  }, null, 2)

  try {
    const response = await completeStructured<RecipeGenerationPayload>({
      schemaName: 'menumaker_recipe_candidates',
      schema: recipeGenerationSchema,
      system,
      user,
      timeoutMs: 120_000,
    })
    return {
      providerConfigured: true,
      source: 'llm',
      recipes: sanitizeRecipes(response.recipes, input.locale, input.count),
    }
  } catch (error) {
    return {
      providerConfigured: true,
      source: 'failed',
      recipes: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

interface RecipeGenerationPayload {
  recipes: Array<{
    title: string
    description: string
    prepTimeMinutes: number
    cuisine: string
    flavorProfile: string
    tags: string[]
    ingredients: Array<{ name: string; amount: number; unit: string; preparation?: string | null }>
    steps: string[]
  }>
}

const recipeGenerationSchema = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          prepTimeMinutes: { type: 'number' },
          cuisine: { type: 'string' },
          flavorProfile: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                amount: { type: 'number' },
                unit: { type: 'string', enum: ['g', 'ml'] },
                preparation: { type: ['string', 'null'] },
              },
              required: ['name', 'amount', 'unit'],
              additionalProperties: false,
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description', 'prepTimeMinutes', 'cuisine', 'flavorProfile', 'tags', 'ingredients', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipes'],
  additionalProperties: false,
}

function sanitizeRecipes(raw: RecipeGenerationPayload['recipes'] | undefined, locale: Locale, limit: number): RecipeCandidate[] {
  const result: RecipeCandidate[] = []
  const seen = new Set<string>()
  for (const recipe of raw ?? []) {
    const title = recipe.title?.trim()
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const ingredients = (recipe.ingredients ?? [])
      .map((ingredient) => ({
        name: ingredient.name?.trim(),
        amount: Number(ingredient.amount),
        unit: ingredient.unit === 'ml' ? 'ml' : 'g',
        preparation: ingredient.preparation?.trim() || undefined,
      }))
      .filter((ingredient) => ingredient.name && Number.isFinite(ingredient.amount) && ingredient.amount > 0)
    if (ingredients.length < 2) continue
    result.push({
      title,
      locale,
      description: recipe.description?.trim() || title,
      servings: 1,
      prepTimeMinutes: Math.max(1, Math.round(Number(recipe.prepTimeMinutes) || 30)),
      cuisine: recipe.cuisine?.trim() || 'casera',
      flavorProfile: recipe.flavorProfile?.trim() || 'equilibrado',
      tags: Array.from(new Set((recipe.tags ?? []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 6),
      ingredients,
      steps: (recipe.steps ?? []).map((step) => step.trim()).filter(Boolean).slice(0, 8),
    })
    if (result.length >= limit) break
  }
  return result
}

import type { Locale, MealSlot } from '@menumaker/core'
import { codexStatus, completeStructured } from './provider'

export const RECIPE_DETAIL_ENRICHMENT_SCHEMA_VERSION = 'menumaker_recipe_detail_enrichment:v1'
export const RECIPE_DETAIL_ENRICHMENT_TIMEOUT_MS = 120_000
export const RECIPE_DETAIL_ENRICHMENT_REASONING_EFFORT = 'none'

export interface RecipeDetailEnrichmentInput {
  locale: Locale
  slot?: MealSlot
  existingTitles?: string[]
  recipes: Array<{
    recipeId: string
    title: string
    slot?: MealSlot
    ingredients: Array<{ name: string; amount: number; unit: string }>
  }>
}

export interface RecipeDetailPayload {
  recipeId: string
  displayTitle: string
  description: string
  prepTimeMinutes: number
  cuisine: string
  flavorProfile: string
  tags: string[]
  steps: string[]
}

export interface RecipeDetailEnrichmentResult {
  providerConfigured: boolean
  source: 'llm' | 'unavailable' | 'failed'
  details: RecipeDetailPayload[]
  error?: string
  trace: {
    schemaVersion: typeof RECIPE_DETAIL_ENRICHMENT_SCHEMA_VERSION
    timeoutMs: number
    reasoningEffort: typeof RECIPE_DETAIL_ENRICHMENT_REASONING_EFFORT
    requestedRecipeCount: number
  }
}

export async function generateRecipeDetails(input: RecipeDetailEnrichmentInput): Promise<RecipeDetailEnrichmentResult> {
  const trace: RecipeDetailEnrichmentResult['trace'] = {
    schemaVersion: RECIPE_DETAIL_ENRICHMENT_SCHEMA_VERSION,
    timeoutMs: RECIPE_DETAIL_ENRICHMENT_TIMEOUT_MS,
    reasoningEffort: RECIPE_DETAIL_ENRICHMENT_REASONING_EFFORT,
    requestedRecipeCount: input.recipes.length,
  }
  const status = codexStatus()
  if (!status.configured) return { providerConfigured: false, source: 'unavailable', details: [], trace }

  const system = input.locale === 'es'
    ? [
        'Eres el redactor culinario de MenuMaker.',
        'Convierte recetas validadas localmente en recetas apetecibles y humanas sin cambiar ingredientes ni cantidades.',
        'Puedes mejorar el título visible, pero no puedes nombrar alimentos que no estén en la lista bloqueada.',
        'No calcules nutrición. Devuelve solo JSON válido. Escribe en español.',
      ].join(' ')
    : [
        'You are MenuMaker culinary copywriter.',
        'Turn locally validated recipes into appealing human recipes without changing ingredients or amounts.',
        'You may improve the visible title, but must not name foods absent from the locked ingredient list.',
        'Do not calculate nutrition. Return only valid JSON. Write in English.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    slot: input.slot,
    existingTitles: input.existingTitles ?? [],
    recipes: input.recipes,
    outputRules: [
      'Devuelve un objeto por cada recipeId.',
      'displayTitle debe sonar como una receta real, no como una lista mecánica de ingredientes.',
      'displayTitle debe usar una forma culinaria cuando ayude: bowl, tostada, wrap, ensalada, salteado, pasta, plato, dip, crema, tortilla, etc.',
      'displayTitle no puede nombrar ingredientes ausentes. Puede usar palabras genéricas de forma culinaria como bowl, wrap, tostada, dip, ensalada o salteado.',
      'Evita títulos repetidos o demasiado parecidos a existingTitles.',
      'description debe ser una frase corta y apetecible.',
      'steps debe tener de 2 a 4 pasos prácticos.',
      'tags debe tener máximo 4 valores.',
      'prepTimeMinutes debe estar entre 3 y 90.',
      'No añadas ingredientes nuevos.',
    ],
  }, null, 2)

  try {
    const payload = await completeStructured<{ recipes: RecipeDetailPayload[] }>({
      schemaName: 'menumaker_recipe_detail_enrichment',
      schema: recipeDetailEnrichmentSchema,
      system,
      user,
      timeoutMs: RECIPE_DETAIL_ENRICHMENT_TIMEOUT_MS,
      reasoningEffort: RECIPE_DETAIL_ENRICHMENT_REASONING_EFFORT,
    })
    return {
      providerConfigured: true,
      source: 'llm',
      details: sanitizeDetails(payload.recipes, input.recipes.map((recipe) => ({ recipeId: recipe.recipeId, title: recipe.title }))),
      trace,
    }
  } catch (error) {
    return {
      providerConfigured: true,
      source: 'failed',
      details: [],
      error: error instanceof Error ? error.message : String(error),
      trace,
    }
  }
}

function sanitizeDetails(raw: RecipeDetailPayload[] | undefined, recipes: Array<{ recipeId: string; title: string }>): RecipeDetailPayload[] {
  const allowed = new Set(recipes.map((recipe) => recipe.recipeId))
  const titleById = new Map(recipes.map((recipe) => [recipe.recipeId, recipe.title]))
  const seen = new Set<string>()
  const details: RecipeDetailPayload[] = []
  for (const item of raw ?? []) {
    const recipeId = item.recipeId?.trim()
    if (!allowed.has(recipeId) || seen.has(recipeId)) continue
    const description = item.description?.trim()
    if (!description) continue
    const steps = (item.steps ?? []).map((step) => step.trim()).filter(Boolean).slice(0, 4)
    if (steps.length < 1) continue
    seen.add(recipeId)
    details.push({
      recipeId,
      displayTitle: sanitizeDisplayTitle(item.displayTitle, titleById.get(recipeId) ?? recipeId),
      description,
      prepTimeMinutes: Math.max(3, Math.min(90, Math.round(Number(item.prepTimeMinutes) || 20))),
      cuisine: item.cuisine?.trim() || 'casera',
      flavorProfile: item.flavorProfile?.trim() || 'equilibrado',
      tags: Array.from(new Set((item.tags ?? []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 4),
      steps,
    })
  }
  return details
}

function sanitizeDisplayTitle(value: unknown, fallback: string): string {
  const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return title.length >= 4 && title.length <= 90 ? title : fallback
}

const recipeDetailSchema = {
  type: 'object',
  properties: {
    recipeId: { type: 'string' },
    displayTitle: { type: 'string' },
    description: { type: 'string' },
    prepTimeMinutes: { type: 'number' },
    cuisine: { type: 'string' },
    flavorProfile: { type: 'string' },
    tags: { type: 'array', maxItems: 4, items: { type: 'string' } },
    steps: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
  },
}

const recipeDetailEnrichmentSchema = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: recipeDetailSchema,
    },
  },
}

import type { Locale } from '@menumaker/core'
import { codexStatus, completeStructured } from './codexOAuth'

export const RECIPE_DETAIL_ENRICHMENT_SCHEMA_VERSION = 'menumaker_recipe_detail_enrichment:v1'
export const RECIPE_DETAIL_ENRICHMENT_TIMEOUT_MS = 120_000
export const RECIPE_DETAIL_ENRICHMENT_REASONING_EFFORT = 'none'

export interface RecipeDetailEnrichmentInput {
  locale: Locale
  recipes: Array<{
    recipeId: string
    title: string
    ingredients: Array<{ name: string; amount: number; unit: string }>
  }>
}

export interface RecipeDetailPayload {
  recipeId: string
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
        'Completa detalles culinarios breves para recetas ya validadas por MenuMaker.',
        'No cambies títulos ni ingredientes. No calcules nutrición.',
        'Devuelve solo JSON válido. Escribe descripciones y pasos concisos en español.',
      ].join(' ')
    : [
        'Complete brief cooking details for recipes already validated by MenuMaker.',
        'Do not change titles or ingredients. Do not calculate nutrition.',
        'Return only valid JSON. Keep descriptions and steps concise.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    recipes: input.recipes,
    outputRules: [
      'Devuelve un objeto por cada recipeId.',
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
      details: sanitizeDetails(payload.recipes, input.recipes.map((recipe) => recipe.recipeId)),
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

function sanitizeDetails(raw: RecipeDetailPayload[] | undefined, recipeIds: string[]): RecipeDetailPayload[] {
  const allowed = new Set(recipeIds)
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

const recipeDetailSchema = {
  type: 'object',
  properties: {
    recipeId: { type: 'string' },
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

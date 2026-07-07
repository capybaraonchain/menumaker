import type { Locale, MacroTargets, MealSlot, NutritionTotals } from '@menumaker/core'
import { codexStatus, completeStructured } from './provider'

export interface GenerationSummaryInput {
  locale: Locale
  profileName?: string
  jobId: string
  status: 'completed' | 'failed'
  kind: string
  target: MacroTargets
  weeklyNutrition?: NutritionTotals | null
  recipeSource?: string | null
  fallbackSlots?: MealSlot[]
  repair?: unknown
  logs: string[]
  failureCode?: string | null
  error?: string | null
}

export interface GenerationSummaryResult {
  providerConfigured: boolean
  source: 'llm' | 'unavailable' | 'failed'
  summary: string
  warnings: string[]
  nextActions: string[]
  error?: string
  cacheHit?: boolean
}

export async function summarizeGeneration(input: GenerationSummaryInput): Promise<GenerationSummaryResult> {
  const status = codexStatus()
  if (!status.configured) {
    return {
      providerConfigured: false,
      source: 'unavailable',
      ...deterministicSummary(input),
    }
  }

  const system = input.locale === 'es'
    ? [
        'Eres el resumidor de trazabilidad de MenuMaker.',
        'Resume trabajos de generación de menú para una app de dieta personal.',
        'Sé concreto: explica qué fuente se usó, si hubo fallback, reparaciones y riesgos.',
        'No inventes cambios, recetas ni nutrición que no estén en el input.',
        'Devuelve solo JSON válido.',
      ].join(' ')
    : [
        'You summarize MenuMaker generation traceability.',
        'Be concrete: explain source, fallback, repair actions, and risks.',
        'Do not invent changes, recipes, or nutrition not present in the input.',
        'Return only valid JSON.',
      ].join(' ')

  const user = JSON.stringify({
    locale: input.locale,
    profileName: input.profileName,
    jobId: input.jobId,
    status: input.status,
    kind: input.kind,
    target: compactTarget(input.target),
    weeklyNutrition: input.weeklyNutrition ?? null,
    recipeSource: input.recipeSource ?? null,
    fallbackSlots: input.fallbackSlots ?? [],
    repair: input.repair ?? null,
    logs: input.logs,
    failureCode: input.failureCode ?? null,
    error: input.error ?? null,
    outputRules: [
      'summary debe ser una frase corta en español si locale es es.',
      'warnings debe listar riesgos accionables, no repetir logs.',
      'nextActions debe proponer acciones concretas para usuario/agente.',
      'No digas que el menú es clínicamente perfecto.',
    ],
  }, null, 2)

  try {
    const response = await completeStructured<GenerationSummaryPayload>({
      schemaName: 'menumaker_generation_summary',
      schema: generationSummarySchema,
      system,
      user,
      timeoutMs: 90_000,
    })
    const sanitized = sanitizeSummary(response, input)
    return { providerConfigured: true, source: 'llm', ...sanitized }
  } catch (error) {
    return {
      providerConfigured: true,
      source: 'failed',
      ...deterministicSummary(input),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

interface GenerationSummaryPayload {
  summary: string
  warnings: string[]
  nextActions: string[]
}

const generationSummarySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
}

function sanitizeSummary(raw: GenerationSummaryPayload | undefined, input: GenerationSummaryInput): Omit<GenerationSummaryResult, 'providerConfigured' | 'source' | 'error' | 'cacheHit'> {
  const fallback = deterministicSummary(input)
  const summary = raw?.summary?.trim() || fallback.summary
  return {
    summary: summary.length > 420 ? `${summary.slice(0, 417)}...` : summary,
    warnings: cleanList(raw?.warnings).slice(0, 5),
    nextActions: cleanList(raw?.nextActions).slice(0, 5),
  }
}

function deterministicSummary(input: GenerationSummaryInput): Omit<GenerationSummaryResult, 'providerConfigured' | 'source' | 'error' | 'cacheHit'> {
  const fallbackSlots = input.fallbackSlots ?? []
  const repair = repairSummary(input.repair)
  const warnings = [
    fallbackSlots.length > 0 ? `Se usaron plantillas determinísticas en ${fallbackSlots.join(', ')}.` : null,
    repair.unresolved > 0 ? `Quedaron ${repair.unresolved} problema(s) de calidad tras la reparación.` : null,
    input.failureCode ? `Fallo de generación: ${input.failureCode}.` : null,
  ].filter((item): item is string => Boolean(item))
  if (input.status === 'failed') {
    return {
      summary: 'La generación no terminó y no se creó un menú nuevo.',
      warnings,
      nextActions: ['Reintentar el trabajo', 'Revisar proveedor LLM y alimentos prohibidos', 'Reducir restricciones si el objetivo es demasiado estrecho'],
    }
  }
  const sourceText = input.recipeSource === 'llm'
    ? 'recetas LLM validadas'
    : input.recipeSource === 'mixed'
      ? 'recetas LLM y plantillas fallback'
      : 'plantillas determinísticas'
  return {
    summary: `Menú generado con ${sourceText}; ${repair.actions} reparación(es) de selección aplicadas.`,
    warnings,
    nextActions: repair.unresolved > 0
      ? ['Revisar platos repetidos o días fuera de objetivo', 'Regenerar la semana si la calidad no convence']
      : ['Revisar el menú visible', 'Bloquear platos que quieras preservar'],
  }
}

function repairSummary(repair: unknown): { actions: number; unresolved: number } {
  if (!repair || typeof repair !== 'object') return { actions: 0, unresolved: 0 }
  const current = repair as { actions?: unknown[]; issuesAfter?: unknown[] }
  return {
    actions: Array.isArray(current.actions) ? current.actions.length : 0,
    unresolved: Array.isArray(current.issuesAfter) ? current.issuesAfter.length : 0,
  }
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)))
}

function compactTarget(target: MacroTargets): Record<string, unknown> {
  return {
    calories: target.calories,
    proteinG: target.proteinG,
    carbsG: target.carbsG,
    fatG: target.fatG,
    goal: target.goal,
    macroMode: target.macroMode,
  }
}

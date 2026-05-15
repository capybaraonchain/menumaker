import type { GenerationFailureCode, MacroTargets, MealSlot, NutritionTotals } from '@menumaker/core'

export type RemediationCode =
  | GenerationFailureCode
  | 'daily_calorie_drift'
  | 'weekly_protein_low'
  | 'provider_unavailable'
  | 'provider_failed'
  | 'too_few_valid_candidates'

export interface GenerationRemediationAction {
  kind:
    | 'retry_generation'
    | 'check_provider'
    | 'enable_fallback'
    | 'adjust_targets'
    | 'review_ingredients'
    | 'relax_preferences'
    | 'regenerate_week'
    | 'regenerate_day'
    | 'regenerate_meal'
  label: string
  requiresConfirmation: boolean
}

export interface GenerationRemediationPlan {
  code: RemediationCode
  severity: 'info' | 'warning' | 'blocking'
  title: string
  summary: string
  steps: string[]
  actions: GenerationRemediationAction[]
  context: Record<string, unknown>
}

interface BuildRemediationInput {
  code: RemediationCode
  error?: string | null
  slot?: MealSlot | null
  dayIndex?: number | null
  title?: string | null
  target?: Pick<MacroTargets, 'calories' | 'proteinG' | 'carbsG' | 'fatG'> | null
  weeklyNutrition?: NutritionTotals | null
  fallbackAllowed?: boolean | null
}

interface RepairTraceForRemediation {
  issuesAfter?: Array<{
    reason: RemediationCode
    message: string
    dayIndex?: number
    slot?: MealSlot
    title?: string
  }>
}

export function classifyGenerationFailure(error: unknown): GenerationFailureCode {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const normalized = normalize(message)
  if (normalized.includes('objetivo') && normalized.includes('imposible')) return 'impossible_targets'
  if (normalized.includes('alimento prohibido') || normalized.includes('banned')) return 'banned_item_conflict'
  if (normalized.includes('ingrediente') && normalized.includes('ambigu')) return 'ambiguous_ingredient'
  if (normalized.includes('nutricion') && (normalized.includes('confianza') || normalized.includes('determinista'))) return 'low_nutrition_confidence'
  if (normalized.includes('repeticion') || normalized.includes('repetition')) return 'repetition_conflict'
  return 'generation_exhausted'
}

export function buildGenerationRemediationPlan(input: BuildRemediationInput): GenerationRemediationPlan {
  const code = input.code
  if (code === 'impossible_targets') {
    return plan(input, {
      severity: 'blocking',
      title: 'Objetivo imposible',
      summary: 'El objetivo de calorías/macros no deja espacio suficiente para proteína y grasa mínima.',
      steps: [
        'Sube el límite calórico o baja proteína/grasa manual.',
        'Vuelve a previsualizar el objetivo antes de regenerar la semana.',
        'Mantén el cambio detrás de confirmación porque afecta todo el menú.',
      ],
      actions: [
        action('adjust_targets', 'Ajustar objetivo'),
      ],
    })
  }
  if (code === 'low_nutrition_confidence') {
    return plan(input, {
      severity: 'blocking',
      title: 'Nutrición con baja confianza',
      summary: 'Una o más recetas candidatas no tienen nutrición determinística suficiente para finalizar el menú.',
      steps: [
        'Pide recetas con ingredientes del catálogo determinístico y cantidades en g/ml.',
        'Evita ingredientes genéricos o marcas sin mapeo nutricional.',
        'Reintenta la generación cuando los ingredientes sean calculables.',
      ],
      actions: [
        action('review_ingredients', 'Revisar ingredientes'),
        action('retry_generation', 'Reintentar'),
      ],
    })
  }
  if (code === 'ambiguous_ingredient') {
    return plan(input, {
      severity: 'blocking',
      title: 'Ingrediente ambiguo',
      summary: 'El planner no pudo mapear un ingrediente con suficiente precisión.',
      steps: [
        'Usa nombres concretos de alimentos en vez de descripciones abiertas.',
        'Pide cantidades en gramos o mililitros.',
        'Reintenta con una instrucción más concreta.',
      ],
      actions: [
        action('review_ingredients', 'Precisar ingrediente'),
        action('retry_generation', 'Reintentar'),
      ],
    })
  }
  if (code === 'banned_item_conflict') {
    return plan(input, {
      severity: 'blocking',
      title: 'Conflicto con alimento prohibido',
      summary: 'La generación produjo o necesitó un alimento bloqueado por el perfil.',
      steps: [
        'Mantén el alimento prohibido y pide alternativas compatibles.',
        'Si el bloqueo era demasiado amplio, edita preferencias del perfil.',
        'Reintenta la generación para crear candidatos sin ese alimento.',
      ],
      actions: [
        action('relax_preferences', 'Revisar preferencias'),
        action('retry_generation', 'Reintentar'),
      ],
    })
  }
  if (code === 'repetition_conflict') {
    return plan(input, {
      severity: 'warning',
      title: 'Demasiada repetición',
      summary: 'El menú quedó con platos, formatos o ingredientes demasiado repetidos.',
      steps: [
        'Regenera la comida o el día afectado si quieres preservar el resto.',
        'Regenera la semana si la repetición afecta varios días.',
        'Bloquea primero los platos que sí quieras conservar.',
      ],
      actions: [
        regenerationAction(input),
      ],
    })
  }
  if (code === 'daily_calorie_drift') {
    return plan(input, {
      severity: 'warning',
      title: 'Día fuera del objetivo',
      summary: 'Un día quedó demasiado alto o bajo respecto al objetivo calórico diario.',
      steps: [
        'Regenera el día afectado o una comida grande de ese día.',
        'Prioriza corregir el total semanal si la diferencia diaria es puntual.',
        'Revisa platos bloqueados porque pueden impedir una corrección automática.',
      ],
      actions: [
        regenerationAction(input),
      ],
    })
  }
  if (code === 'weekly_protein_low') {
    return plan(input, {
      severity: 'warning',
      title: 'Proteína semanal baja',
      summary: 'La selección semanal no alcanza la proteína mínima con suficiente margen.',
      steps: [
        'Regenera snacks o desayunos con proteína alta antes de rehacer toda la semana.',
        'Revisa si hay demasiados platos bloqueados con poca proteína.',
        'Si el objetivo es manual, confirma que la proteína sea compatible con las calorías.',
      ],
      actions: [
        action('regenerate_week', 'Rebalancear semana'),
      ],
    })
  }
  if (code === 'provider_unavailable' || code === 'provider_failed') {
    return plan(input, {
      severity: 'blocking',
      title: code === 'provider_unavailable' ? 'Proveedor LLM no configurado' : 'Proveedor LLM falló',
      summary: code === 'provider_unavailable'
        ? 'La generación live necesita el perfil local de Codex OAuth o fallback explícito.'
        : 'El proveedor LLM no devolvió una respuesta válida para el planner.',
      steps: [
        'Revisa el perfil Codex OAuth local y que el token no esté caducado.',
        'Mantén fallback habilitado si quieres que la app siga usable sin LLM.',
        'Reintenta cuando el proveedor esté disponible.',
      ],
      actions: [
        action('check_provider', 'Revisar proveedor'),
        action('retry_generation', 'Reintentar'),
      ],
    })
  }
  if (code === 'too_few_valid_candidates') {
    return plan(input, {
      severity: 'blocking',
      title: 'Pocas recetas válidas',
      summary: 'El LLM generó candidatos, pero muy pocos pasaron nutrición, variedad, preferencias y tiempo máximo.',
      steps: [
        'Relaja preferencias no críticas o alimentos evitados demasiado amplios.',
        'Pide ingredientes más comunes y cantidades en g/ml.',
        'Reintenta con fallback habilitado si necesitas un menú usable ahora.',
      ],
      actions: [
        action('relax_preferences', 'Revisar preferencias'),
        action('enable_fallback', 'Habilitar fallback'),
        action('retry_generation', 'Reintentar'),
      ],
    })
  }
  return plan(input, {
    severity: 'blocking',
    title: 'Generación agotada',
    summary: 'El planner no encontró una combinación suficiente para crear el menú semanal.',
    steps: [
      'Revisa proveedor LLM, fallback de plantillas y restricciones del perfil.',
      'Reduce restricciones si hay muchos alimentos prohibidos o dislikes.',
      'Reintenta la generación después de corregir el bloqueo principal.',
    ],
    actions: [
      action('check_provider', 'Revisar proveedor'),
      action('relax_preferences', 'Revisar preferencias'),
      action('retry_generation', 'Reintentar'),
    ],
  })
}

export function buildRepairRemediationPlans(repair: RepairTraceForRemediation | null | undefined): GenerationRemediationPlan[] {
  const issues = Array.isArray(repair?.issuesAfter) ? repair.issuesAfter : []
  return issues.slice(0, 5).map((issue) => buildGenerationRemediationPlan({
    code: issue.reason,
    dayIndex: issue.dayIndex,
    slot: issue.slot,
    title: issue.title,
    error: issue.message,
  }))
}

function plan(input: BuildRemediationInput, body: Omit<GenerationRemediationPlan, 'code' | 'context'>): GenerationRemediationPlan {
  return {
    code: input.code,
    ...body,
    context: {
      error: input.error ?? null,
      dayIndex: input.dayIndex ?? null,
      slot: input.slot ?? null,
      title: input.title ?? null,
      target: input.target ?? null,
      weeklyNutrition: input.weeklyNutrition ?? null,
      fallbackAllowed: input.fallbackAllowed ?? null,
    },
  }
}

function action(kind: GenerationRemediationAction['kind'], label: string): GenerationRemediationAction {
  return {
    kind,
    label,
    requiresConfirmation: kind.startsWith('regenerate') || kind === 'retry_generation' || kind === 'adjust_targets' || kind === 'relax_preferences',
  }
}

function regenerationAction(input: BuildRemediationInput): GenerationRemediationAction {
  if (input.dayIndex !== undefined && input.dayIndex !== null && input.slot) return action('regenerate_meal', 'Regenerar comida')
  if (input.dayIndex !== undefined && input.dayIndex !== null) return action('regenerate_day', 'Regenerar día')
  return action('regenerate_week', 'Regenerar semana')
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

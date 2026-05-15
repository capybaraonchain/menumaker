import { z } from 'zod'
import {
  applyCalorieAdjustmentPlan,
  applySimilarIngredientReplacements,
  getAppState,
  getCurrentMenu,
  getWeeklyMenu,
  lockDay,
  lockMeal,
  regenerateDay,
  regenerateMeal,
  regenerateWeek,
  replaceMeal,
  saveProfilePreference,
  starRecipe,
  suggestMealReplacements,
  unstarRecipe,
  previewCalorieAdjustmentPlan,
  type WeeklyMenuView,
} from './appService'
import type { CalorieAdjustmentPlan } from './caloriePlanner'
import { sqlClient } from './client'
import { localUserId } from './env'

const uuid = z.string().uuid()

const recipeCandidateSchema = z.object({
  title: z.string(),
  locale: z.enum(['es', 'en']),
  description: z.string(),
  servings: z.literal(1),
  prepTimeMinutes: z.number(),
  cuisine: z.string(),
  flavorProfile: z.string(),
  tags: z.array(z.string()),
  ingredients: z.array(z.object({
    name: z.string(),
    amount: z.number(),
    unit: z.string(),
    preparation: z.string().optional(),
  })),
  steps: z.array(z.string()),
})

export const appActionSchemas = {
  proposeCalorieAdjustmentPlan: z.object({
    profileId: uuid,
    calories: z.number().int().min(900).max(5000),
  }),
  proposeCalorieTargetChange: z.object({
    profileId: uuid,
    calories: z.number().int().min(900).max(5000),
  }),
  applyCalorieTargetChange: z.object({
    profileId: uuid,
    calories: z.number().int().min(900).max(5000),
    plan: z.any().optional(),
  }),
  regenerateWeek: z.object({
    profileId: uuid.optional(),
    menuId: uuid,
  }),
  regenerateDay: z.object({
    profileId: uuid.optional(),
    dayPlanId: uuid,
  }),
  regenerateMeal: z.object({
    profileId: uuid.optional(),
    menuMealId: uuid,
  }),
  lockDay: z.object({
    profileId: uuid.optional(),
    dayPlanId: uuid,
    locked: z.boolean(),
  }),
  lockMeal: z.object({
    profileId: uuid.optional(),
    menuMealId: uuid,
    locked: z.boolean(),
  }),
  savePreference: z.object({
    profileId: uuid,
    value: z.string().min(1),
    kind: z.enum(['like', 'dislike', 'ban']).default('dislike'),
    scope: z.string().default('profile'),
  }),
  starRecipe: z.object({
    profileId: uuid,
    recipeId: uuid,
  }),
  unstarRecipe: z.object({
    profileId: uuid.optional(),
    savedRecipeId: uuid,
  }),
  suggestMealReplacement: z.object({
    profileId: uuid.optional(),
    menuMealId: uuid,
    request: z.string().min(1),
  }),
  replaceMeal: z.object({
    profileId: uuid.optional(),
    menuMealId: uuid,
    recipe: recipeCandidateSchema,
  }),
  applySimilarReplacements: z.object({
    profileId: uuid,
    menuMealIds: z.array(uuid).default([]),
    ingredient: z.string().min(1),
  }),
} as const

export type AppActionName = keyof typeof appActionSchemas
export type AppActionInput<Name extends AppActionName = AppActionName> = z.infer<(typeof appActionSchemas)[Name]>

export interface AppActionDefinition<Name extends AppActionName = AppActionName> {
  name: Name
  inputSchema: (typeof appActionSchemas)[Name]
  requiresConfirmation: boolean
  auditLabel: string
  confirmationCopyEs: (input: AppActionInput<Name>) => Promise<string> | string
  successCopyEs: (input: AppActionInput<Name>, result: unknown) => Promise<string> | string
  execute: (input: AppActionInput<Name>) => Promise<unknown>
}

export interface PendingChatAction {
  id: string
  type: 'confirmPendingAction'
  label: string
  payload: { pendingActionId: string }
}

export interface PendingActionView {
  id: string
  actionName: AppActionName
  profileId: string | null
  params: unknown
  confirmationMarkdown: string
  status: string
  source: string
  expiresAt: string
  action: PendingChatAction
}

export type AppChatResponse =
  | { type: 'message'; markdown: string; text: string; actions: [] }
  | {
      type: 'confirmation_required'
      markdown: string
      text: string
      action: PendingChatAction
      actions: PendingChatAction[]
    }

function appStateResult(profileId?: string) {
  return getAppState(profileId)
}

export const appActionRegistry: { [Name in AppActionName]: AppActionDefinition<Name> } = {
  proposeCalorieAdjustmentPlan: {
    name: 'proposeCalorieAdjustmentPlan',
    inputSchema: appActionSchemas.proposeCalorieAdjustmentPlan,
    requiresConfirmation: false,
    auditLabel: 'proposal.calorie_adjustment_plan',
    confirmationCopyEs: async (input) => (await previewCalorieAdjustmentPlan(input.profileId, input.calories)).confirmationMarkdown,
    successCopyEs: (_, result) => resultChangeSummary(result) || 'Plan de reajuste preparado.',
    async execute(input) {
      const plan = await previewCalorieAdjustmentPlan(input.profileId, input.calories)
      return {
        type: 'calorie_adjustment_plan',
        markdown: plan.confirmationMarkdown,
        plan,
        affectedMealIds: plan.affectedMealIds,
        decisionCounts: plan.decisionCounts,
        warnings: plan.warnings,
        requiresConfirmation: true,
      }
    },
  },
  proposeCalorieTargetChange: {
    name: 'proposeCalorieTargetChange',
    inputSchema: appActionSchemas.proposeCalorieTargetChange,
    requiresConfirmation: false,
    auditLabel: 'proposal.calorie_target_change',
    confirmationCopyEs: async (input) => (await previewCalorieAdjustmentPlan(input.profileId, input.calories)).confirmationMarkdown,
    successCopyEs: (_, result) => actionResultSummary('proposeCalorieTargetChange', result),
    async execute(input) {
      const plan = await previewCalorieAdjustmentPlan(input.profileId, input.calories)
      return {
        type: 'confirmation_required',
        markdown: plan.confirmationMarkdown,
        action: {
          name: 'applyCalorieTargetChange',
          params: { ...input, plan },
          requiresConfirmation: true,
          auditLabel: 'mutation.calorie_target_change',
        },
        currentCalories: plan.baseCalories,
        requestedCalories: input.calories,
        plan,
      }
    },
  },
  applyCalorieTargetChange: {
    name: 'applyCalorieTargetChange',
    inputSchema: appActionSchemas.applyCalorieTargetChange,
    requiresConfirmation: true,
    auditLabel: 'mutation.calorie_target_change',
    confirmationCopyEs: calorieAdjustmentConfirmation,
    successCopyEs: (input, result) => [
      `Listo. Apliqué el reajuste híbrido a **${input.calories} kcal/día** respetando locks y validando el menú completo.`,
      resultChangeSummary(result),
    ].filter(Boolean).join('\n\n'),
    async execute(input) {
      const applied = await applyCalorieAdjustmentPlan(input.profileId, input.calories, caloriePlanFromInput(input))
      return {
        state: await appStateResult(input.profileId),
        menu: applied.menu,
        plan: applied.plan,
        changeSummary: applied.changeSummary,
      }
    },
  },
  regenerateWeek: {
    name: 'regenerateWeek',
    inputSchema: appActionSchemas.regenerateWeek,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_week',
    confirmationCopyEs: () => 'Se regenerará la semana completa respetando días y comidas bloqueadas. ¿Continuar?',
    successCopyEs: (_, result) => ['Listo. Regeneré la semana respetando los días y comidas bloqueadas.', resultChangeSummary(result)].filter(Boolean).join('\n\n'),
    async execute(input) {
      const before = await getWeeklyMenu(input.menuId)
      const menu = await regenerateWeek(input.menuId)
      return {
        state: await appStateResult(input.profileId),
        menu,
        changeSummary: summarizeMenuChanges(before, menu),
      }
    },
  },
  regenerateDay: {
    name: 'regenerateDay',
    inputSchema: appActionSchemas.regenerateDay,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_day',
    confirmationCopyEs: () => 'Se regenerarán las comidas no bloqueadas de este día. ¿Continuar?',
    successCopyEs: (_, result) => ['Listo. Regeneré el día respetando las comidas bloqueadas.', resultChangeSummary(result)].filter(Boolean).join('\n\n'),
    async execute(input) {
      const before = input.profileId ? await getCurrentMenu(input.profileId) : null
      const menu = await regenerateDay(input.dayPlanId)
      return {
        state: await appStateResult(input.profileId),
        menu,
        changeSummary: summarizeMenuChanges(before, menu),
      }
    },
  },
  regenerateMeal: {
    name: 'regenerateMeal',
    inputSchema: appActionSchemas.regenerateMeal,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_meal',
    confirmationCopyEs: () => 'Se reemplazará esta comida si no está bloqueada. ¿Continuar?',
    successCopyEs: (_, result) => ['Listo. Regeneré la comida seleccionada.', resultChangeSummary(result)].filter(Boolean).join('\n\n'),
    async execute(input) {
      const before = input.profileId ? await getCurrentMenu(input.profileId) : null
      const menu = await regenerateMeal(input.menuMealId)
      return {
        state: await appStateResult(input.profileId),
        menu,
        changeSummary: summarizeMenuChanges(before, menu),
      }
    },
  },
  lockDay: {
    name: 'lockDay',
    inputSchema: appActionSchemas.lockDay,
    requiresConfirmation: false,
    auditLabel: 'mutation.lock_day',
    confirmationCopyEs: () => '',
    successCopyEs: (input) => input.locked ? 'Día bloqueado.' : 'Día desbloqueado.',
    async execute(input) {
      await lockDay(input.dayPlanId, input.locked)
      return appStateResult(input.profileId)
    },
  },
  lockMeal: {
    name: 'lockMeal',
    inputSchema: appActionSchemas.lockMeal,
    requiresConfirmation: false,
    auditLabel: 'mutation.lock_meal',
    confirmationCopyEs: () => '',
    successCopyEs: (input) => input.locked ? 'Comida bloqueada.' : 'Comida desbloqueada.',
    async execute(input) {
      await lockMeal(input.menuMealId, input.locked)
      return appStateResult(input.profileId)
    },
  },
  savePreference: {
    name: 'savePreference',
    inputSchema: appActionSchemas.savePreference,
    requiresConfirmation: true,
    auditLabel: 'mutation.save_preference',
    confirmationCopyEs: (input) => `Se guardará "${input.value}" como preferencia de perfil. ¿Continuar?`,
    successCopyEs: (input) => `Listo. Guardé **${input.value}** como preferencia de perfil.`,
    async execute(input) {
      await saveProfilePreference(input.profileId, input.value, input.kind, input.scope)
      return appStateResult(input.profileId)
    },
  },
  starRecipe: {
    name: 'starRecipe',
    inputSchema: appActionSchemas.starRecipe,
    requiresConfirmation: false,
    auditLabel: 'mutation.star_recipe',
    confirmationCopyEs: () => '',
    successCopyEs: () => 'Receta guardada.',
    async execute(input) {
      await starRecipe(input.profileId, input.recipeId)
      return appStateResult(input.profileId)
    },
  },
  unstarRecipe: {
    name: 'unstarRecipe',
    inputSchema: appActionSchemas.unstarRecipe,
    requiresConfirmation: false,
    auditLabel: 'mutation.unstar_recipe',
    confirmationCopyEs: () => '',
    successCopyEs: () => 'Receta eliminada de guardadas.',
    async execute(input) {
      await unstarRecipe(input.savedRecipeId)
      return appStateResult(input.profileId)
    },
  },
  suggestMealReplacement: {
    name: 'suggestMealReplacement',
    inputSchema: appActionSchemas.suggestMealReplacement,
    requiresConfirmation: false,
    auditLabel: 'proposal.meal_replacement',
    confirmationCopyEs: () => '',
    successCopyEs: (_, result) => actionResultSummary('suggestMealReplacement', result),
    async execute(input) {
      return suggestMealReplacements(input.menuMealId, input.request)
    },
  },
  replaceMeal: {
    name: 'replaceMeal',
    inputSchema: appActionSchemas.replaceMeal,
    requiresConfirmation: true,
    auditLabel: 'mutation.replace_meal',
    confirmationCopyEs: () => 'Se reemplazará esta comida por la receta seleccionada. ¿Continuar?',
    successCopyEs: () => 'Listo. Reemplacé la comida seleccionada.',
    async execute(input) {
      await replaceMeal(input.menuMealId, input.recipe)
      return appStateResult(input.profileId)
    },
  },
  applySimilarReplacements: {
    name: 'applySimilarReplacements',
    inputSchema: appActionSchemas.applySimilarReplacements,
    requiresConfirmation: true,
    auditLabel: 'mutation.apply_similar_replacements',
    confirmationCopyEs: (input) => `Encontré **${input.menuMealIds.length}** comida(s) con **${input.ingredient}**. Si continúas, guardaré esa preferencia y reemplazaré las comidas no bloqueadas usando el proceso real de sugerencias. ¿Continuar?`,
    successCopyEs: (input, result) => {
      const changed = result && typeof result === 'object' && Array.isArray((result as { replacedMealIds?: unknown[] }).replacedMealIds)
        ? (result as { replacedMealIds: unknown[] }).replacedMealIds.length
        : 0
      return `Listo. Guardé **${input.ingredient}** como preferencia y reemplacé **${changed}** comida(s) no bloqueadas.`
    },
    async execute(input) {
      const replacementResult = await applySimilarIngredientReplacements(input.profileId, input.menuMealIds, input.ingredient)
      return {
        ...replacementResult,
        state: await appStateResult(input.profileId),
      }
    },
  },
}

export async function executeAppAction<Name extends AppActionName>(
  name: Name,
  rawInput: unknown,
  source = 'direct',
): Promise<unknown> {
  const definition = appActionRegistry[name]
  const input = definition.inputSchema.parse(rawInput)
  try {
    const result = await definition.execute(input as never)
    await logActionEvent(name, definition.auditLabel, 'completed', source, input, result, profileIdFromInput(input))
    return result
  } catch (error) {
    await logActionEvent(name, definition.auditLabel, 'failed', source, input, {}, profileIdFromInput(input), error)
    throw error
  }
}

export async function getActionConfirmation<Name extends AppActionName>(
  name: Name,
  rawInput: unknown,
): Promise<string> {
  const definition = appActionRegistry[name]
  const input = definition.inputSchema.parse(rawInput)
  return definition.confirmationCopyEs(input as never)
}

export function appActionMetadata() {
  return Object.values(appActionRegistry).map((action) => ({
    name: action.name,
    requiresConfirmation: action.requiresConfirmation,
    auditLabel: action.auditLabel,
  }))
}

export async function createPendingAction<Name extends AppActionName>(
  name: Name,
  rawInput: unknown,
  source = 'chat',
): Promise<PendingActionView> {
  const definition = appActionRegistry[name]
  if (!definition.requiresConfirmation) throw new Error(`${name} does not require a pending confirmation.`)
  const input = await preparePendingInput(name, definition.inputSchema.parse(rawInput))
  const confirmationMarkdown = await definition.confirmationCopyEs(input as never)
  const profileId = profileIdFromInput(input)
  const sql = sqlClient()
  const [row] = await sql<[{ id: string; expires_at: Date | string }]>`
    insert into pending_actions (
      user_id, profile_id, action_name, params, confirmation_markdown, status, source, result, expires_at
    )
    values (
      ${localUserId()}, ${profileId}, ${name}, ${sql.json(input as any)}, ${confirmationMarkdown},
      'pending', ${source}, '{}', now() + interval '30 minutes'
    )
    returning id, expires_at
  `
  if (!row) throw new Error('No se pudo crear la acción pendiente.')
  await logActionEvent(name, definition.auditLabel, 'proposed', source, input, { pendingActionId: row.id }, profileId, undefined, row.id)
  return pendingActionView({
    id: row.id,
    action_name: name,
    profile_id: profileId,
    params: input,
    confirmation_markdown: confirmationMarkdown,
    status: 'pending',
    source,
    expires_at: String(row.expires_at),
  })
}

async function preparePendingInput<Name extends AppActionName>(name: Name, input: AppActionInput<Name>): Promise<AppActionInput<Name>> {
  if (name !== 'applyCalorieTargetChange') return input
  const calorieInput = input as AppActionInput<'applyCalorieTargetChange'>
  if (calorieInput.plan) return input
  const plan = await previewCalorieAdjustmentPlan(calorieInput.profileId, calorieInput.calories)
  return { ...calorieInput, plan } as AppActionInput<Name>
}

export async function confirmPendingAction(pendingActionId: string): Promise<{
  markdown: string
  result: unknown
  state: unknown
}> {
  const sql = sqlClient()
  const [pending] = await sql`
    select * from pending_actions
    where id = ${pendingActionId} and user_id = ${localUserId()}
    limit 1
  `
  if (!pending) throw new Error('Acción pendiente no encontrada.')
  if (pending.status !== 'pending') throw new Error('Esta acción ya no está pendiente.')
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await sql`
      update pending_actions set status = 'expired', resolved_at = now()
      where id = ${pendingActionId} and user_id = ${localUserId()}
    `
    throw new Error('Esta confirmación ha caducado. Vuelve a pedir el cambio.')
  }

  const actionName = pending.action_name as AppActionName
  const definition = appActionRegistry[actionName]
  if (!definition) throw new Error('Acción pendiente no soportada.')
  const input = definition.inputSchema.parse(pending.params)
  try {
    const result = await definition.execute(input as never)
    const markdown = await definition.successCopyEs(input as never, result)
    await sql`
      update pending_actions set status = 'confirmed', result = ${sql.json({ markdown } as any)}, resolved_at = now()
      where id = ${pendingActionId} and user_id = ${localUserId()}
    `
    await logActionEvent(actionName, definition.auditLabel, 'confirmed', pending.source, input, result, profileIdFromInput(input), undefined, pendingActionId)
    return {
      markdown,
      result,
      state: profileIdFromInput(input) ? await getAppState(profileIdFromInput(input) ?? undefined) : result,
    }
  } catch (error) {
    await sql`
      update pending_actions set status = 'failed', error = ${error instanceof Error ? error.message : 'Error'}, resolved_at = now()
      where id = ${pendingActionId} and user_id = ${localUserId()}
    `
    await logActionEvent(actionName, definition.auditLabel, 'failed', pending.source, input, {}, profileIdFromInput(input), error, pendingActionId)
    throw error
  }
}

export async function cancelPendingAction(pendingActionId: string): Promise<{ markdown: string }> {
  const sql = sqlClient()
  const [pending] = await sql`
    update pending_actions set status = 'cancelled', resolved_at = now()
    where id = ${pendingActionId} and user_id = ${localUserId()} and status = 'pending'
    returning *
  `
  if (!pending) return { markdown: 'No había una acción pendiente que cancelar.' }
  const actionName = pending.action_name as AppActionName
  const definition = appActionRegistry[actionName]
  await logActionEvent(actionName, definition?.auditLabel ?? 'pending.cancelled', 'cancelled', pending.source, pending.params, {}, pending.profile_id, undefined, pendingActionId)
  return { markdown: 'Cancelado. No cambio el menú.' }
}

function pendingActionView(row: {
  id: string
  action_name: string
  profile_id: string | null
  params: unknown
  confirmation_markdown: string
  status: string
  source: string
  expires_at: string | Date
}): PendingActionView {
  const name = row.action_name as AppActionName
  return {
    id: row.id,
    actionName: name,
    profileId: row.profile_id,
    params: row.params,
    confirmationMarkdown: row.confirmation_markdown,
    status: row.status,
    source: row.source,
    expiresAt: String(row.expires_at),
    action: {
      id: row.id,
      type: 'confirmPendingAction',
      label: actionLabelEs(name, row.params),
      payload: { pendingActionId: row.id },
    },
  }
}

function actionLabelEs(name: AppActionName, input: unknown): string {
  const params = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (name === 'applyCalorieTargetChange') return `Aplicar reajuste a ${params.calories} kcal/día`
  if (name === 'proposeCalorieAdjustmentPlan') return 'Preparar reajuste'
  if (name === 'regenerateWeek') return 'Regenerar semana'
  if (name === 'regenerateDay') return 'Regenerar día'
  if (name === 'regenerateMeal') return 'Regenerar comida'
  if (name === 'savePreference') return 'Guardar preferencia'
  if (name === 'replaceMeal') return 'Reemplazar comida'
  if (name === 'applySimilarReplacements') return 'Aplicar similares'
  return 'Continuar'
}

async function logActionEvent(
  name: AppActionName,
  auditLabel: string,
  status: string,
  source: string,
  input: unknown,
  output: unknown,
  profileId?: string | null,
  error?: unknown,
  pendingActionId?: string,
): Promise<void> {
  const sql = sqlClient()
  await sql`
    insert into action_events (
      user_id, profile_id, pending_action_id, action_name, audit_label, status, source, input, output, error
    )
    values (
      ${localUserId()}, ${profileId ?? null}, ${pendingActionId ?? null}, ${name}, ${auditLabel},
      ${status}, ${source}, ${sql.json(input as any)}, ${sql.json(output as any)},
      ${error instanceof Error ? error.message : error ? String(error) : null}
    )
  `
}

function profileIdFromInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const profileId = (input as Record<string, unknown>).profileId
  return typeof profileId === 'string' ? profileId : null
}

function actionResultSummary(name: AppActionName, result: unknown): string {
  if (name === 'suggestMealReplacement' && result && typeof result === 'object') {
    const options = (result as { options?: unknown[] }).options
    return `Encontré ${Array.isArray(options) ? options.length : 0} opciones de reemplazo.`
  }
  return 'Listo.'
}

function resultChangeSummary(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const changeSummary = (result as { changeSummary?: unknown }).changeSummary
  return typeof changeSummary === 'string' ? changeSummary : ''
}

function summarizeMenuChanges(before: WeeklyMenuView | null, after: WeeklyMenuView | null): string {
  if (!before || !after) return ''
  const beforeMeals = new Map<string, WeeklyMenuView['days'][number]['meals'][number]>()
  for (const day of before.days) {
    for (const meal of day.meals) beforeMeals.set(`${day.dayIndex}:${meal.slot}`, meal)
  }

  const changedTitles: string[] = []
  const portionChanges: Array<{ label: string; title: string; deltaCalories: number }> = []
  let unchanged = 0

  for (const day of after.days) {
    for (const meal of day.meals) {
      const previous = beforeMeals.get(`${day.dayIndex}:${meal.slot}`)
      if (!previous) continue
      const deltaCalories = round1(meal.nutrition.calories - previous.nutrition.calories)
      if (previous.recipe.title !== meal.recipe.title) {
        changedTitles.push(`${dayName(day.dayIndex)} ${slotLabel(meal.slot)}: ${previous.recipe.title} -> ${meal.recipe.title}`)
      } else if (Math.abs(deltaCalories) >= 1) {
        portionChanges.push({ label: `${dayName(day.dayIndex)} ${slotLabel(meal.slot)}`, title: meal.recipe.title, deltaCalories })
      } else {
        unchanged += 1
      }
    }
  }

  const nutritionDelta = {
    calories: round1(after.nutrition.calories - before.nutrition.calories),
    proteinG: round1(after.nutrition.proteinG - before.nutrition.proteinG),
    carbsG: round1(after.nutrition.carbsG - before.nutrition.carbsG),
    fatG: round1(after.nutrition.fatG - before.nutrition.fatG),
  }
  const lines = [
    `**Resumen de cambios:** ${changedTitles.length > 0 ? `cambié ${changedTitles.length} receta(s)` : 'no cambié nombres de recetas'}; ${portionChanges.length} comida(s) cambiaron de porción${unchanged ? ` y ${unchanged} quedaron igual` : ''}.`,
    `**Impacto semanal:** ${formatSigned(nutritionDelta.calories)} kcal, ${formatSigned(nutritionDelta.proteinG)} g proteína, ${formatSigned(nutritionDelta.carbsG)} g carbos, ${formatSigned(nutritionDelta.fatG)} g grasa.`,
  ]

  const biggestPortionChanges = [...portionChanges].sort((left, right) => Math.abs(right.deltaCalories) - Math.abs(left.deltaCalories)).slice(0, 4)
  if (changedTitles.length > 0) {
    lines.push(`**Recetas reemplazadas:**\n${changedTitles.slice(0, 6).map((item) => `- ${item}`).join('\n')}`)
  }
  if (biggestPortionChanges.length > 0) {
    lines.push(`**Mayores ajustes de porción:**\n${biggestPortionChanges.map((item) => `- ${item.label}: ${item.title} (${formatSigned(item.deltaCalories)} kcal)`).join('\n')}`)
  }
  return lines.join('\n\n')
}

function dayName(dayIndex: number): string {
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][dayIndex] ?? `Día ${dayIndex + 1}`
}

function slotLabel(slot: string): string {
  if (slot === 'breakfast') return 'desayuno'
  if (slot === 'lunch') return 'comida'
  if (slot === 'dinner') return 'cena'
  if (slot === 'snack') return 'snack'
  return slot
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${round1(value)}`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

async function calorieAdjustmentConfirmation(input: AppActionInput<'applyCalorieTargetChange'>): Promise<string> {
  const plan = caloriePlanFromInput(input) ?? await previewCalorieAdjustmentPlan(input.profileId, input.calories)
  return plan.confirmationMarkdown
}

function caloriePlanFromInput(input: AppActionInput<'applyCalorieTargetChange'>): CalorieAdjustmentPlan | undefined {
  if (!input.plan || typeof input.plan !== 'object') return undefined
  const plan = input.plan as Partial<CalorieAdjustmentPlan>
  if (
    typeof plan.planId === 'string' &&
    typeof plan.profileId === 'string' &&
    typeof plan.baseMenuId === 'string' &&
    typeof plan.baseMenuHash === 'string' &&
    typeof plan.targetCalories === 'number' &&
    Array.isArray(plan.decisions)
  ) {
    return input.plan as CalorieAdjustmentPlan
  }
  return undefined
}

async function calorieTargetConfirmation(input: AppActionInput<'proposeCalorieTargetChange'>): Promise<string> {
  const menu = await getCurrentMenu(input.profileId)
  if (!menu) return 'Necesitas tener un menú semanal activo antes de reajustar el objetivo calórico.'
  const currentCalories = menu.target.calories
  if (currentCalories === input.calories) return `Tu objetivo calórico diario ya está en **${currentCalories} kcal/día**.`
  const direction = input.calories < currentCalories ? 'bajar' : 'subir'
  return (
    `El objetivo calórico diario está en **${currentCalories} kcal/día**. ` +
    `Si deseas ${direction} el objetivo calórico a **${input.calories} kcal/día**, deberás reajustar el menú semanal. ` +
    'Cualquier comida que no esté bloqueada será regenerada; las recetas guardadas seguirán guardadas en Recetas. ¿Continuar?'
  )
}

import { z } from 'zod'
import {
  applyCalorieAdjustmentPlan,
  applyRegenerationPlan,
  applySimilarIngredientReplacements,
  cancelGenerationJob,
  createUserNutritionFood,
  deleteProfile,
  enqueuePreviewGenerationJob,
  enqueueWeeklyMenuGenerationJob,
  getAppState,
  lockDay,
  lockMeal,
  previewRegenerateDayPlan,
  previewRegenerateMealPlan,
  previewRegenerateWeekPlan,
  replaceMeal,
  resetLocalData,
  retryGenerationJob,
  runQueuedGenerationJobs,
  runPreviewGenerationJob,
  runGenerationJob,
  saveIngredientMapping,
  saveProfilePreference,
  searchNutritionFoods,
  setFallbackPolicy,
  relaxProfilePreferences,
  starRecipe,
  suggestMealReplacements,
  unstarRecipe,
  previewCalorieAdjustmentPlan,
  updateMacroTargetAndGenerate,
  type RegenerationPlan,
  type PreviewGenerationJobInput,
  type UserNutritionFoodInput,
  type MacroTargetEditInput,
} from './appService'
import type { CalorieAdjustmentPlan } from './caloriePlanner'
import { sqlClient } from './client'
import { localUserId } from './env'
import { importOpenFoodFactsBarcodes, importUsdaFoodDataCentralDownloadFile } from './nutritionSourceImport'

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
    plan: z.any().optional(),
  }),
  regenerateDay: z.object({
    profileId: uuid.optional(),
    dayPlanId: uuid,
    plan: z.any().optional(),
  }),
  regenerateMeal: z.object({
    profileId: uuid.optional(),
    menuMealId: uuid,
    plan: z.any().optional(),
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
  deleteProfile: z.object({
    profileId: uuid,
    expectedName: z.string().min(1),
    exportBeforeDelete: z.boolean().default(true),
  }),
  resetLocalData: z.object({
    expectedPhrase: z.string().min(1),
    exportBeforeDelete: z.boolean().default(true),
  }),
  retryGenerationJob: z.object({
    profileId: uuid.optional(),
    jobId: uuid,
  }),
  cancelGenerationJob: z.object({
    profileId: uuid.optional(),
    jobId: uuid,
  }),
  processQueuedGenerationJobs: z.object({
    profileId: uuid.optional(),
    limit: z.number().int().positive().max(10).default(1),
  }),
  relaxProfilePreferences: z.object({
    profileId: uuid,
    removeDislikes: z.array(z.string()).default([]),
    removeBannedFoods: z.array(z.string()).default([]),
  }),
  updateMacroTargetAndGenerate: z.object({
    profileId: uuid,
    calories: z.number().int().min(900).max(5000),
    proteinG: z.number().nonnegative().optional(),
    carbsG: z.number().nonnegative().optional(),
    fatG: z.number().nonnegative().optional(),
    runNow: z.boolean().default(false),
    retryJobId: uuid.optional(),
  }),
  startWeeklyMenuGeneration: z.object({
    profileId: uuid,
    runNow: z.boolean().default(true),
  }),
  runGenerationJob: z.object({
    profileId: uuid.optional(),
    jobId: uuid,
  }),
  enqueuePreviewGenerationJob: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preview_regenerate_week'), profileId: uuid, menuId: uuid }),
    z.object({ kind: z.literal('preview_regenerate_day'), profileId: uuid, dayPlanId: uuid }),
    z.object({ kind: z.literal('preview_regenerate_meal'), profileId: uuid, menuMealId: uuid }),
    z.object({ kind: z.literal('preview_calorie_adjustment'), profileId: uuid, calories: z.number().int().min(900).max(5000) }),
  ]),
  runPreviewGenerationJob: z.object({
    profileId: uuid.optional(),
    jobId: uuid,
  }),
  saveIngredientMapping: z.object({
    profileId: uuid,
    ingredientName: z.string().min(1),
    canonicalFoodName: z.string().min(1),
  }),
  searchNutritionFoods: z.object({
    profileId: uuid.optional(),
    query: z.string().min(2),
    limit: z.number().int().positive().max(50).default(12),
    source: z.string().min(1).optional(),
  }),
  importOpenFoodFactsProduct: z.object({
    profileId: uuid.optional(),
    barcode: z.string().regex(/^\d{6,14}$/, 'Código de barras inválido.'),
  }),
  importUsdaFoodDataCentralDownload: z.object({
    profileId: uuid.optional(),
    path: z.string().min(1),
    limit: z.number().int().positive().optional(),
    fdcIds: z.array(z.number().int().positive()).default([]),
  }),
  createUserNutritionFood: z.object({
    profileId: uuid.optional(),
    canonicalName: z.string().min(2),
    category: z.string().min(1).default('user food'),
    aliases: z.array(z.string().min(1)).default([]),
    per100g: z.object({
      calories: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
      fiberG: z.number().nonnegative().optional(),
    }),
    householdUnits: z.array(z.object({
      units: z.array(z.string().min(1)).min(1),
      grams: z.number().positive(),
      note: z.string().optional(),
    })).default([]),
  }),
  setFallbackPolicy: z.object({
    profileId: uuid.optional(),
    recipeTemplateFallbackAllowed: z.boolean().optional(),
    weekSkeletonFallbackAllowed: z.boolean().optional(),
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
    confirmationCopyEs: regenerationConfirmation,
    successCopyEs: (_, result) => ['Listo. Apliqué la regeneración semanal respetando días y comidas bloqueadas.', resultChangeSummary(result)].filter(Boolean).join('\n\n'),
    async execute(input) {
      const plan = regenerationPlanFromInput(input)
      if (!plan) throw new Error('Esta regeneración necesita una previsualización server-owned antes de aplicarse.')
      const applied = await applyRegenerationPlan(plan)
      return {
        state: await appStateResult(input.profileId ?? applied.plan.profileId),
        menu: applied.menu,
        plan: applied.plan,
        changeSummary: applied.changeSummary,
      }
    },
  },
  regenerateDay: {
    name: 'regenerateDay',
    inputSchema: appActionSchemas.regenerateDay,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_day',
    confirmationCopyEs: regenerationConfirmation,
    successCopyEs: (_, result) => ['Listo. Apliqué la regeneración del día respetando las comidas bloqueadas.', resultChangeSummary(result)].filter(Boolean).join('\n\n'),
    async execute(input) {
      const plan = regenerationPlanFromInput(input)
      if (!plan) throw new Error('Esta regeneración necesita una previsualización server-owned antes de aplicarse.')
      const applied = await applyRegenerationPlan(plan)
      return {
        state: await appStateResult(input.profileId ?? applied.plan.profileId),
        menu: applied.menu,
        plan: applied.plan,
        changeSummary: applied.changeSummary,
      }
    },
  },
  regenerateMeal: {
    name: 'regenerateMeal',
    inputSchema: appActionSchemas.regenerateMeal,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_meal',
    confirmationCopyEs: regenerationConfirmation,
    successCopyEs: (_, result) => ['Listo. Apliqué la regeneración de la comida seleccionada.', resultChangeSummary(result)].filter(Boolean).join('\n\n'),
    async execute(input) {
      const plan = regenerationPlanFromInput(input)
      if (!plan) throw new Error('Esta regeneración necesita una previsualización server-owned antes de aplicarse.')
      const applied = await applyRegenerationPlan(plan)
      return {
        state: await appStateResult(input.profileId ?? applied.plan.profileId),
        menu: applied.menu,
        plan: applied.plan,
        changeSummary: applied.changeSummary,
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
  deleteProfile: {
    name: 'deleteProfile',
    inputSchema: appActionSchemas.deleteProfile,
    requiresConfirmation: true,
    auditLabel: 'mutation.delete_profile',
    confirmationCopyEs: (input) => `Se eliminará el perfil **${input.expectedName}** con sus menús, preferencias y recetas generadas que ya no se usen. Devolveré un snapshot de exportación en la respuesta. ¿Continuar?`,
    successCopyEs: (_, result) => {
      const deletedName = result && typeof result === 'object' && typeof (result as { deletedProfileName?: unknown }).deletedProfileName === 'string'
        ? (result as { deletedProfileName: string }).deletedProfileName
        : 'perfil'
      const counts = result && typeof result === 'object'
        ? (result as { export?: { counts?: { menus?: number; meals?: number; savedRecipes?: number } } }).export?.counts
        : null
      return [
        `Listo. Eliminé **${deletedName}**.`,
        counts ? `Snapshot incluido: ${counts.menus ?? 0} menú(s), ${counts.meals ?? 0} comida(s), ${counts.savedRecipes ?? 0} receta(s) guardadas.` : '',
      ].filter(Boolean).join('\n\n')
    },
    async execute(input) {
      const result = await deleteProfile(input.profileId, input.expectedName, input.exportBeforeDelete)
      return {
        ...result,
        state: await appStateResult(result.remainingProfileId ?? undefined),
      }
    },
  },
  resetLocalData: {
    name: 'resetLocalData',
    inputSchema: appActionSchemas.resetLocalData,
    requiresConfirmation: true,
    auditLabel: 'mutation.reset_local_data',
    confirmationCopyEs: () => 'Se borrarán todos los datos locales de MenuMaker: perfiles, menús, recetas generadas, trabajos, preferencias, alias de ingredientes, ajustes locales y caché AI. Se devolverá un snapshot de exportación si está habilitado. ¿Continuar?',
    successCopyEs: (_, result) => {
      const counts = result && typeof result === 'object'
        ? (result as { deletedCounts?: { profiles?: number; menus?: number; meals?: number; generationJobs?: number } }).deletedCounts
        : null
      return counts
        ? `Listo. Borré los datos locales: ${counts.profiles ?? 0} perfil(es), ${counts.menus ?? 0} menú(s), ${counts.meals ?? 0} comida(s), ${counts.generationJobs ?? 0} trabajo(s).`
        : 'Listo. Borré los datos locales.'
    },
    async execute(input) {
      const result = await resetLocalData(input.expectedPhrase, input.exportBeforeDelete)
      return {
        ...result,
        state: await appStateResult(),
      }
    },
  },
  retryGenerationJob: {
    name: 'retryGenerationJob',
    inputSchema: appActionSchemas.retryGenerationJob,
    requiresConfirmation: false,
    auditLabel: 'mutation.retry_generation_job',
    confirmationCopyEs: () => '',
    successCopyEs: (_, result) => {
      const menuId = result && typeof result === 'object' && typeof (result as { menu?: { id?: unknown } }).menu?.id === 'string'
        ? (result as { menu: { id: string } }).menu.id
        : null
      const jobId = result && typeof result === 'object' && typeof (result as { newJobId?: unknown }).newJobId === 'string'
        ? (result as { newJobId: string }).newJobId
        : null
      return menuId
        ? 'Listo. Reintenté la generación y guardé un nuevo menú.'
        : `Listo. Dejé el reintento en cola${jobId ? ` (${jobId})` : ''}.`
    },
    async execute(input) {
      const result = await retryGenerationJob(input.jobId)
      return {
        ...result,
        state: await appStateResult(input.profileId ?? result.job.profileId ?? undefined),
      }
    },
  },
  cancelGenerationJob: {
    name: 'cancelGenerationJob',
    inputSchema: appActionSchemas.cancelGenerationJob,
    requiresConfirmation: false,
    auditLabel: 'mutation.cancel_generation_job',
    confirmationCopyEs: () => '',
    successCopyEs: () => 'Cancelado. El trabajo no seguirá avanzando.',
    async execute(input) {
      const result = await cancelGenerationJob(input.jobId)
      return {
        ...result,
        state: await appStateResult(input.profileId ?? result.job.profileId ?? undefined),
      }
    },
  },
  processQueuedGenerationJobs: {
    name: 'processQueuedGenerationJobs',
    inputSchema: appActionSchemas.processQueuedGenerationJobs,
    requiresConfirmation: true,
    auditLabel: 'mutation.process_queued_generation_jobs',
    confirmationCopyEs: (input) => `Se procesarán hasta **${input.limit}** trabajo(s) en cola con el worker local. Puede crear menús o planes de previsualización. ¿Continuar?`,
    successCopyEs: (_, result) => {
      const completed = result && typeof result === 'object' && typeof (result as { completed?: unknown }).completed === 'number'
        ? (result as { completed: number }).completed
        : 0
      const failed = result && typeof result === 'object' && typeof (result as { failed?: unknown }).failed === 'number'
        ? (result as { failed: number }).failed
        : 0
      return `Listo. Worker local: ${completed} completado(s), ${failed} fallido(s).`
    },
    async execute(input) {
      const result = await runQueuedGenerationJobs(input.limit, input.profileId)
      return {
        ...result,
        state: await appStateResult(input.profileId),
      }
    },
  },
  relaxProfilePreferences: {
    name: 'relaxProfilePreferences',
    inputSchema: appActionSchemas.relaxProfilePreferences,
    requiresConfirmation: true,
    auditLabel: 'mutation.relax_profile_preferences',
    confirmationCopyEs: (input) => {
      const removed = [...input.removeDislikes, ...input.removeBannedFoods]
      return `Se relajarán **${removed.length}** preferencia(s) del perfil para que el planner tenga más margen. ¿Continuar?`
    },
    successCopyEs: (_, result) => {
      const removedDislikes = result && typeof result === 'object' && Array.isArray((result as { removedDislikes?: unknown[] }).removedDislikes)
        ? (result as { removedDislikes: unknown[] }).removedDislikes.length
        : 0
      const removedBanned = result && typeof result === 'object' && Array.isArray((result as { removedBannedFoods?: unknown[] }).removedBannedFoods)
        ? (result as { removedBannedFoods: unknown[] }).removedBannedFoods.length
        : 0
      return `Listo. Relajé ${removedDislikes + removedBanned} preferencia(s) del perfil.`
    },
    async execute(input) {
      const result = await relaxProfilePreferences(input.profileId, input.removeDislikes, input.removeBannedFoods)
      return {
        ...result,
        state: await appStateResult(input.profileId),
      }
    },
  },
  saveIngredientMapping: {
    name: 'saveIngredientMapping',
    inputSchema: appActionSchemas.saveIngredientMapping,
    requiresConfirmation: false,
    auditLabel: 'mutation.save_ingredient_mapping',
    confirmationCopyEs: () => '',
    successCopyEs: (input) => `Listo. Cuando aparezca **${input.ingredientName}**, lo trataré como **${input.canonicalFoodName}** para calcular nutrición.`,
    async execute(input) {
      const mapping = await saveIngredientMapping(input.profileId, input.ingredientName, input.canonicalFoodName)
      return {
        mapping,
        state: await appStateResult(input.profileId),
      }
    },
  },
  searchNutritionFoods: {
    name: 'searchNutritionFoods',
    inputSchema: appActionSchemas.searchNutritionFoods,
    requiresConfirmation: false,
    auditLabel: 'read.search_nutrition_foods',
    confirmationCopyEs: () => '',
    successCopyEs: (_, result) => {
      const foods = result && typeof result === 'object' && Array.isArray((result as { foods?: unknown[] }).foods)
        ? (result as { foods: unknown[] }).foods.length
        : 0
      return `Encontré ${foods} alimento(s) determinístico(s).`
    },
    async execute(input) {
      return searchNutritionFoods(input)
    },
  },
  importOpenFoodFactsProduct: {
    name: 'importOpenFoodFactsProduct',
    inputSchema: appActionSchemas.importOpenFoodFactsProduct,
    requiresConfirmation: true,
    auditLabel: 'mutation.import_open_food_facts_product',
    confirmationCopyEs: (input) => `Se consultará Open Food Facts y se importará el producto con código **${input.barcode}** como fuente nutricional determinística. ¿Continuar?`,
    successCopyEs: (_, result) => {
      const records = result && typeof result === 'object' ? (result as { records?: Array<{ canonicalName?: string }> }).records : null
      const names = records?.map((record) => record.canonicalName).filter(Boolean) ?? []
      return names.length > 0
        ? `Listo. Importé **${names.join(', ')}** desde Open Food Facts.`
        : 'Listo. Importé el producto desde Open Food Facts.'
    },
    async execute(input) {
      const result = await importOpenFoodFactsBarcodes([input.barcode])
      return {
        ...result,
        state: await appStateResult(input.profileId),
      }
    },
  },
  importUsdaFoodDataCentralDownload: {
    name: 'importUsdaFoodDataCentralDownload',
    inputSchema: appActionSchemas.importUsdaFoodDataCentralDownload,
    requiresConfirmation: true,
    auditLabel: 'mutation.import_usda_fdc_download',
    confirmationCopyEs: (input) => [
      `Se importará el dataset descargado de USDA FoodData Central desde **${input.path}** como fuente nutricional determinística.`,
      input.fdcIds.length ? `Solo se importarán los FDC IDs: ${input.fdcIds.join(', ')}.` : '',
      input.limit ? `Límite de registros: ${input.limit}.` : '',
      '¿Continuar?',
    ].filter(Boolean).join('\n\n'),
    successCopyEs: (_, result) => {
      const imported = result && typeof result === 'object' && typeof (result as { imported?: unknown }).imported === 'number'
        ? (result as { imported: number }).imported
        : 0
      return `Listo. Importé **${imported}** alimento(s) desde USDA FoodData Central.`
    },
    async execute(input) {
      const result = await importUsdaFoodDataCentralDownloadFile(input.path, {
        limit: input.limit,
        includeFdcIds: input.fdcIds.length ? input.fdcIds : undefined,
      })
      return {
        ...result,
        state: await appStateResult(input.profileId),
      }
    },
  },
  createUserNutritionFood: {
    name: 'createUserNutritionFood',
    inputSchema: appActionSchemas.createUserNutritionFood,
    requiresConfirmation: true,
    auditLabel: 'mutation.create_user_nutrition_food',
    confirmationCopyEs: (input) => `Se creará **${input.canonicalName}** como alimento determinístico local con nutrición por 100g definida por el usuario. ¿Continuar?`,
    successCopyEs: (input) => `Listo. Creé **${input.canonicalName}** como alimento determinístico local y ya puede usarse para mapear ingredientes.`,
    async execute(input) {
      return createUserNutritionFood(input as UserNutritionFoodInput)
    },
  },
  setFallbackPolicy: {
    name: 'setFallbackPolicy',
    inputSchema: appActionSchemas.setFallbackPolicy,
    requiresConfirmation: true,
    auditLabel: 'mutation.set_fallback_policy',
    confirmationCopyEs: (input) => {
      const changes = [
        input.recipeTemplateFallbackAllowed === undefined ? null : `fallback de recetas ${input.recipeTemplateFallbackAllowed ? 'habilitado' : 'deshabilitado'}`,
        input.weekSkeletonFallbackAllowed === undefined ? null : `fallback de esqueleto semanal ${input.weekSkeletonFallbackAllowed ? 'habilitado' : 'deshabilitado'}`,
      ].filter(Boolean)
      return `Se actualizará la política local de generación: ${changes.join(', ')}. ¿Continuar?`
    },
    successCopyEs: (_, result) => {
      const settings = result && typeof result === 'object'
        ? (result as { runtimeSettings?: { recipeTemplateFallbackAllowed?: boolean; weekSkeletonFallbackAllowed?: boolean } }).runtimeSettings
        : null
      return settings
        ? `Listo. Fallback recetas: **${settings.recipeTemplateFallbackAllowed ? 'habilitado' : 'deshabilitado'}**. Fallback esqueleto: **${settings.weekSkeletonFallbackAllowed ? 'habilitado' : 'deshabilitado'}**.`
        : 'Listo. Actualicé la política local de fallback.'
    },
    async execute(input) {
      const result = await setFallbackPolicy({
        recipeTemplateFallbackAllowed: input.recipeTemplateFallbackAllowed,
        weekSkeletonFallbackAllowed: input.weekSkeletonFallbackAllowed,
      })
      return {
        ...result,
        state: await appStateResult(input.profileId),
      }
    },
  },
  enqueuePreviewGenerationJob: {
    name: 'enqueuePreviewGenerationJob',
    inputSchema: appActionSchemas.enqueuePreviewGenerationJob,
    requiresConfirmation: false,
    auditLabel: 'proposal.enqueue_preview_generation_job',
    confirmationCopyEs: () => '',
    successCopyEs: () => 'Previsualización en cola.',
    async execute(input) {
      const job = await enqueuePreviewGenerationJob(input as PreviewGenerationJobInput)
      return {
        job,
        state: await appStateResult(input.profileId),
      }
    },
  },
  runPreviewGenerationJob: {
    name: 'runPreviewGenerationJob',
    inputSchema: appActionSchemas.runPreviewGenerationJob,
    requiresConfirmation: false,
    auditLabel: 'proposal.run_preview_generation_job',
    confirmationCopyEs: () => '',
    successCopyEs: () => 'Previsualización completada.',
    async execute(input) {
      const result = await runPreviewGenerationJob(input.jobId)
      return {
        ...result,
        state: await appStateResult(input.profileId ?? result.job.profileId ?? undefined),
      }
    },
  },
  updateMacroTargetAndGenerate: {
    name: 'updateMacroTargetAndGenerate',
    inputSchema: appActionSchemas.updateMacroTargetAndGenerate,
    requiresConfirmation: true,
    auditLabel: 'mutation.update_macro_target_and_generate',
    confirmationCopyEs: (input) => [
      `Se guardará un nuevo objetivo de **${input.calories} kcal/día**.`,
      input.proteinG === undefined ? '' : `Proteína: **${input.proteinG} g**.`,
      input.fatG === undefined ? '' : `Grasa: **${input.fatG} g**.`,
      input.carbsG === undefined ? '' : `Carbohidratos: **${input.carbsG} g**.`,
      input.runNow ? 'Después se lanzará una nueva generación semanal.' : 'La generación quedará en cola para ejecutarse después.',
      '¿Continuar?',
    ].filter(Boolean).join('\n\n'),
    successCopyEs: (input, result) => {
      const job = result && typeof result === 'object' ? (result as { job?: { id?: string } }).job : null
      return input.runNow
        ? `Listo. Guardé el objetivo de **${input.calories} kcal/día** y ejecuté una nueva generación.`
        : `Listo. Guardé el objetivo de **${input.calories} kcal/día** y dejé la generación en cola${job?.id ? ` (${job.id})` : ''}.`
    },
    async execute(input) {
      const result = await updateMacroTargetAndGenerate(input.profileId, input as MacroTargetEditInput)
      return {
        ...result,
        state: await appStateResult(input.profileId),
      }
    },
  },
  startWeeklyMenuGeneration: {
    name: 'startWeeklyMenuGeneration',
    inputSchema: appActionSchemas.startWeeklyMenuGeneration,
    requiresConfirmation: true,
    auditLabel: 'mutation.start_weekly_generation',
    confirmationCopyEs: () => 'Se creará un trabajo de generación semanal con el objetivo macro actual. ¿Continuar?',
    successCopyEs: (_, result) => {
      const ran = result && typeof result === 'object' && Boolean((result as { menu?: unknown }).menu)
      return ran ? 'Listo. Creé el trabajo y generé una nueva semana.' : 'Listo. Dejé el trabajo de generación en cola.'
    },
    async execute(input) {
      const job = await enqueueWeeklyMenuGenerationJob(input.profileId)
      if (!input.runNow) {
        return {
          job,
          state: await appStateResult(input.profileId),
        }
      }
      const menu = await runGenerationJob(job.id)
      return {
        job,
        menu,
        state: await appStateResult(input.profileId),
      }
    },
  },
  runGenerationJob: {
    name: 'runGenerationJob',
    inputSchema: appActionSchemas.runGenerationJob,
    requiresConfirmation: true,
    auditLabel: 'mutation.run_generation_job',
    confirmationCopyEs: () => 'Se ejecutará este trabajo de generación y puede crear un menú nuevo. ¿Continuar?',
    successCopyEs: () => 'Listo. Ejecuté el trabajo de generación.',
    async execute(input) {
      const menu = await runGenerationJob(input.jobId)
      return {
        menu,
        state: await appStateResult(input.profileId ?? menu.profileId),
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
    await logActionEvent(name, definition.auditLabel, 'completed', source, input, result, eventProfileId(name, input))
    return result
  } catch (error) {
    await logActionEvent(name, definition.auditLabel, 'failed', source, input, {}, eventProfileId(name, input), error)
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
  if (name === 'applyCalorieTargetChange') {
    const calorieInput = input as AppActionInput<'applyCalorieTargetChange'>
    if (caloriePlanFromInput(calorieInput)) return input
    const plan = await previewCalorieAdjustmentPlan(calorieInput.profileId, calorieInput.calories)
    return { ...calorieInput, plan } as AppActionInput<Name>
  }
  if (name === 'regenerateWeek') {
    const regenerateInput = input as AppActionInput<'regenerateWeek'>
    const plan = regenerationPlanFromInput(regenerateInput) ?? await previewRegenerateWeekPlan(regenerateInput.menuId)
    return { ...regenerateInput, profileId: regenerateInput.profileId ?? plan.profileId, plan } as AppActionInput<Name>
  }
  if (name === 'regenerateDay') {
    const regenerateInput = input as AppActionInput<'regenerateDay'>
    const plan = regenerationPlanFromInput(regenerateInput) ?? await previewRegenerateDayPlan(regenerateInput.dayPlanId)
    return { ...regenerateInput, profileId: regenerateInput.profileId ?? plan.profileId, plan } as AppActionInput<Name>
  }
  if (name === 'regenerateMeal') {
    const regenerateInput = input as AppActionInput<'regenerateMeal'>
    const plan = regenerationPlanFromInput(regenerateInput) ?? await previewRegenerateMealPlan(regenerateInput.menuMealId)
    return { ...regenerateInput, profileId: regenerateInput.profileId ?? plan.profileId, plan } as AppActionInput<Name>
  }
  return input
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
    await logActionEvent(actionName, definition.auditLabel, 'confirmed', pending.source, input, result, eventProfileId(actionName, input), undefined, pendingActionId)
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
    await logActionEvent(actionName, definition.auditLabel, 'failed', pending.source, input, {}, eventProfileId(actionName, input), error, pendingActionId)
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
  if (name === 'deleteProfile') return 'Eliminar perfil'
  if (name === 'resetLocalData') return 'Borrar datos locales'
  if (name === 'retryGenerationJob') return 'Reintentar generación'
  if (name === 'cancelGenerationJob') return 'Cancelar generación'
  if (name === 'relaxProfilePreferences') return 'Relajar preferencias'
  if (name === 'updateMacroTargetAndGenerate') return `Guardar ${params.calories} kcal y generar`
  if (name === 'startWeeklyMenuGeneration') return 'Generar semana'
  if (name === 'runGenerationJob') return 'Ejecutar generación'
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

function eventProfileId(name: AppActionName, input: unknown): string | null {
  if (name === 'deleteProfile' || name === 'resetLocalData') return null
  return profileIdFromInput(input)
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

async function regenerationConfirmation(
  input: AppActionInput<'regenerateWeek'> | AppActionInput<'regenerateDay'> | AppActionInput<'regenerateMeal'>,
): Promise<string> {
  const existingPlan = regenerationPlanFromInput(input)
  if (existingPlan) return existingPlan.confirmationMarkdown
  if ('menuId' in input) return (await previewRegenerateWeekPlan(input.menuId)).confirmationMarkdown
  if ('dayPlanId' in input) return (await previewRegenerateDayPlan(input.dayPlanId)).confirmationMarkdown
  return (await previewRegenerateMealPlan(input.menuMealId)).confirmationMarkdown
}

function regenerationPlanFromInput(input: unknown): RegenerationPlan | undefined {
  if (!input || typeof input !== 'object') return undefined
  const plan = (input as { plan?: unknown }).plan
  if (!plan || typeof plan !== 'object') return undefined
  const candidate = plan as Partial<RegenerationPlan>
  if (
    typeof candidate.planId === 'string' &&
    (candidate.kind === 'week' || candidate.kind === 'day' || candidate.kind === 'meal') &&
    typeof candidate.profileId === 'string' &&
    typeof candidate.baseMenuId === 'string' &&
    typeof candidate.baseMenuHash === 'string' &&
    Array.isArray(candidate.decisions)
  ) {
    return plan as RegenerationPlan
  }
  return undefined
}

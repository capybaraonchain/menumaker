import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  activityDescriptionsEs,
  calculateMacroTargets,
  impossibleTargetConflict,
} from '@menumaker/core'
import {
  appActionMetadata,
  cancelPendingAction,
  confirmPendingAction,
  createPendingAction,
  createProfileAndFirstMenu,
  createWeeklyMenu,
  executeAppAction,
  getAppState,
  getCurrentMenu,
  getMenuHistory,
  getRecipe,
  getSavedRecipes,
  getWeeklyMenu,
  listProfiles,
  lockDay,
  lockMeal,
  previewRegenerateDayPlan,
  previewRegenerateMealPlan,
  previewRegenerateWeekPlan,
  replaceMeal,
  saveMacroTarget,
  saveProfilePreference,
  starRecipe,
  suggestMealReplacements,
  unstarRecipe,
  updateProfile,
  type MenuMealView,
  type ProfileRow,
} from '@menumaker/db'
import { scoreRecipe } from '@menumaker/nutrition'
import { z } from 'zod'

const server = new McpServer({
  name: 'menumaker',
  version: '0.1.0',
})

const pendingActionNames = [
  'applyCalorieTargetChange',
  'regenerateWeek',
  'regenerateDay',
  'regenerateMeal',
  'savePreference',
  'replaceMeal',
  'applySimilarReplacements',
] as const

function json(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

const profileInputSchema = {
  name: z.string().min(1),
  locale: z.enum(['es', 'en']).default('es'),
  weightKg: z.number().positive(),
  targetWeightKg: z.number().positive(),
  heightCm: z.number().positive(),
  age: z.number().int().positive().nullable().optional(),
  acceptsRoughEstimate: z.boolean().default(false),
  sex: z.enum(['female', 'male', 'skipped']).default('skipped'),
  activityLevel: z.enum(['sedentary', 'lightly_active', 'moderately_active', 'active', 'very_active']).default('lightly_active'),
  goal: z.enum(['maintain', 'cut', 'bulk']),
  macroMode: z.enum(['balanced', 'high_protein', 'lower_carb', 'manual']).default('balanced'),
  manualTargets: z.object({
    calories: z.number().int().positive(),
    proteinG: z.number().positive(),
    carbsG: z.number().min(0),
    fatG: z.number().positive(),
  }).nullable().optional(),
  likes: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  bannedFoods: z.array(z.string()).default([]),
}

const recipeCandidateSchema = z.object({
  title: z.string(),
  locale: z.enum(['es', 'en']),
  description: z.string(),
  servings: z.literal(1),
  prepTimeMinutes: z.number(),
  cuisine: z.string(),
  flavorProfile: z.string(),
  tags: z.array(z.string()),
  ingredients: z.array(z.object({ name: z.string(), amount: z.number(), unit: z.string(), preparation: z.string().optional() })),
  steps: z.array(z.string()),
})

function requireConfirmation(confirmed: boolean | undefined, action: string) {
  if (!confirmed) throw new Error(`Explicit confirmation required for ${action}.`)
}

function summarizeMacroTarget(profile: ProfileRow) {
  if (!profile.latestTarget) throw new Error('El perfil no tiene objetivos de macros.')
  return {
    profileId: profile.id,
    locale: profile.locale,
    target: profile.latestTarget,
    explanation:
      profile.locale === 'es'
        ? [
            `Objetivo: ${profile.latestTarget.goal}.`,
            `Actividad: ${profile.activityLevel} (${activityDescriptionsEs[profile.activityLevel]}).`,
            `Mantenimiento estimado: ${profile.latestTarget.maintenanceCalories} kcal.`,
            `Peso usado para proteína: ${profile.latestTarget.proteinCalculationWeightKg} kg.`,
            `Día objetivo: ${profile.latestTarget.calories} kcal, ${profile.latestTarget.proteinG} g proteína, ${profile.latestTarget.carbsG} g carbohidratos, ${profile.latestTarget.fatG} g grasa.`,
            ...profile.latestTarget.notes,
          ]
        : [
            `Goal: ${profile.latestTarget.goal}.`,
            `Estimated maintenance: ${profile.latestTarget.maintenanceCalories} kcal.`,
            `Protein calculation weight: ${profile.latestTarget.proteinCalculationWeightKg} kg.`,
            `Daily target: ${profile.latestTarget.calories} kcal, ${profile.latestTarget.proteinG} g protein, ${profile.latestTarget.carbsG} g carbs, ${profile.latestTarget.fatG} g fat.`,
            ...profile.latestTarget.notes,
          ],
  }
}

function mealIncludesIngredient(meal: MenuMealView, ingredient: string) {
  const normalized = ingredient.toLowerCase()
  return meal.recipe.ingredients.some((item) => item.name.toLowerCase().includes(normalized))
}

server.registerTool(
  'get_action_registry',
  {
    description: 'Read-only: list shared MenuMaker app actions, confirmation requirements, and audit labels.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => json(appActionMetadata()),
)

server.registerTool(
  'create_pending_action',
  {
    description: 'Create a server-owned pending MenuMaker action and return Spanish confirmation copy plus a pendingActionId. Does not perform the underlying mutation.',
    inputSchema: {
      actionName: z.enum(pendingActionNames),
      params: z.record(z.unknown()),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ actionName, params }) => json(await createPendingAction(actionName, params, 'mcp')),
)

server.registerTool(
  'confirm_pending_action',
  {
    description: 'Confirm and execute a previously created pending MenuMaker action.',
    inputSchema: { pendingActionId: z.string().uuid() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ pendingActionId }) => json(await confirmPendingAction(pendingActionId)),
)

server.registerTool(
  'cancel_pending_action',
  {
    description: 'Cancel a previously created pending MenuMaker action without changing the menu.',
    inputSchema: { pendingActionId: z.string().uuid() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ pendingActionId }) => json(await cancelPendingAction(pendingActionId)),
)

server.registerTool(
  'list_profiles',
  {
    description: 'Read-only: list local MenuMaker profiles.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => json(await listProfiles()),
)

server.registerTool(
  'get_profile',
  {
    description: 'Read-only: get a profile and current state.',
    inputSchema: { profileId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId }) => json(await getAppState(profileId)),
)

server.registerTool(
  'get_weekly_menu',
  {
    description: 'Read-only: get a weekly menu by id, or current menu for profileId.',
    inputSchema: { menuId: z.string().uuid().optional(), profileId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ menuId, profileId }) => {
    if (menuId) return json(await getWeeklyMenu(menuId))
    if (!profileId) throw new Error('menuId or profileId is required')
    return json(await getCurrentMenu(profileId))
  },
)

server.registerTool(
  'get_recipe',
  {
    description: 'Read-only: get one saved or generated recipe by id.',
    inputSchema: { recipeId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ recipeId }) => json(await getRecipe(recipeId)),
)

server.registerTool(
  'get_saved_recipes',
  {
    description: 'Read-only: list starred recipes for one profile.',
    inputSchema: { profileId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId }) => json(await getSavedRecipes(profileId)),
)

server.registerTool(
  'get_menu_history',
  {
    description: 'Read-only: list stored weekly menus for one profile.',
    inputSchema: { profileId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId }) => json(await getMenuHistory(profileId)),
)

server.registerTool(
  'analyze_recipe_nutrition',
  {
    description: 'Read-only: deterministically calculate recipe nutrition from structured ingredients.',
    inputSchema: {
      recipe: z.object({
        title: z.string(),
        locale: z.enum(['es', 'en']),
        description: z.string(),
        servings: z.literal(1),
        prepTimeMinutes: z.number(),
        cuisine: z.string(),
        flavorProfile: z.string(),
        tags: z.array(z.string()),
        ingredients: z.array(z.object({ name: z.string(), amount: z.number(), unit: z.string(), preparation: z.string().optional() })),
        steps: z.array(z.string()),
      }),
      bannedFoods: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ recipe, bannedFoods }) => json(scoreRecipe(recipe, bannedFoods ?? [])),
)

server.registerTool(
  'explain_macro_targets',
  {
    description: 'Read-only: explain how macro targets were calculated for a profile.',
    inputSchema: { profileId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId }) => {
    const profile = (await listProfiles()).find((item) => item.id === profileId)
    if (!profile) throw new Error('Perfil no encontrado.')
    return json(summarizeMacroTarget(profile))
  },
)

server.registerTool(
  'propose_calorie_target_change',
  {
    description: 'Proposal: prepare a calorie target change confirmation using the shared app action registry. Includes a hybrid adjustment plan and does not mutate state.',
    inputSchema: { profileId: z.string().uuid(), calories: z.number().int().min(900).max(5000) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId, calories }) => json(await executeAppAction('proposeCalorieTargetChange', { profileId, calories })),
)

server.registerTool(
  'preview_calorie_adjustment_plan',
  {
    description: 'Proposal: build a hybrid calorie adjustment plan with per-meal decisions, weekly/daily macro impact, warnings, and Spanish confirmation copy. Does not mutate state.',
    inputSchema: { profileId: z.string().uuid(), calories: z.number().int().min(900).max(5000) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId, calories }) => json(await executeAppAction('proposeCalorieAdjustmentPlan', { profileId, calories })),
)

server.registerTool(
  'apply_calorie_target_change',
  {
    description: 'Mutation: save a new calorie target and apply a hybrid calorie adjustment plan through the shared app action registry. Pass the preview plan when available. Requires confirmed=true.',
    inputSchema: {
      profileId: z.string().uuid(),
      calories: z.number().int().min(900).max(5000),
      plan: z.any().optional(),
      confirmed: z.boolean(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, calories, plan, confirmed }) => {
    requireConfirmation(confirmed, 'calorie target change')
    return json(await executeAppAction('applyCalorieTargetChange', { profileId, calories, plan }))
  },
)

server.registerTool(
  'create_weekly_menu_proposal',
  {
    description: 'Proposal: preview a new weekly menu generation. Does not mutate state.',
    inputSchema: { profileId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId }) => {
    const profile = (await listProfiles()).find((item) => item.id === profileId)
    if (!profile) throw new Error('Perfil no encontrado.')
    return json({
      proposalId: crypto.randomUUID(),
      profileId,
      target: profile.latestTarget,
      willCreateStoredMenu: true,
      willUseSpanishByDefault: profile.locale === 'es',
      willAvoid: [...profile.dislikes, ...profile.bannedFoods],
      requiresConfirmation: true,
    })
  },
)

server.registerTool(
  'suggest_meal_replacements',
  {
    description: 'Proposal: suggest three replacement meals using LLM-generated candidates validated by deterministic nutrition and menu scoring. Does not mutate state.',
    inputSchema: { menuMealId: z.string().uuid(), request: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ menuMealId, request }) => json(await suggestMealReplacements(menuMealId, request)),
)

server.registerTool(
  'find_related_replacement_opportunities',
  {
    description: 'Proposal: find other meals in a menu that contain the same ingredient. Does not mutate state.',
    inputSchema: { menuId: z.string().uuid(), ingredient: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ menuId, ingredient }) => {
    const menu = await getWeeklyMenu(menuId)
    const affectedMeals = menu.days.flatMap((day) =>
      day.meals.filter((meal) => mealIncludesIngredient(meal, ingredient)).map((meal) => ({
        dayId: day.id,
        dayIndex: day.dayIndex,
        menuMealId: meal.id,
        slot: meal.slot,
        recipeId: meal.recipe.id,
        recipeTitle: meal.recipe.title,
        locked: day.locked || meal.locked,
      })),
    )
    return json({
      proposalId: crypto.randomUUID(),
      menuId,
      ingredient,
      affectedMeals,
      requiresConfirmationForBulkChange: true,
    })
  },
)

server.registerTool(
  'preview_regenerate_meal',
  {
    description: 'Proposal: build a server-owned plan for regenerating one meal, including exact candidate recipe, menu hash, expected macro impact, and Spanish confirmation copy. Does not mutate state.',
    inputSchema: { menuMealId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ menuMealId }) => json({
    type: 'regeneration_plan',
    requiresConfirmation: true,
    plan: await previewRegenerateMealPlan(menuMealId),
  }),
)

server.registerTool(
  'preview_regenerate_day',
  {
    description: 'Proposal: build a server-owned plan for regenerating one day, preserving locks and carrying exact candidate recipes plus menu hash. Does not mutate state.',
    inputSchema: { dayPlanId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ dayPlanId }) => json({
    type: 'regeneration_plan',
    requiresConfirmation: true,
    plan: await previewRegenerateDayPlan(dayPlanId),
  }),
)

server.registerTool(
  'preview_regenerate_week',
  {
    description: 'Proposal: build a server-owned plan for regenerating the week, preserving locks and carrying exact candidate recipes plus menu hash. Does not mutate state.',
    inputSchema: { menuId: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ menuId }) =>
    json({
      type: 'regeneration_plan',
      requiresConfirmation: true,
      plan: await previewRegenerateWeekPlan(menuId),
    }),
)

server.registerTool(
  'preview_profile_preference_update',
  {
    description: 'Proposal: preview saving a like, dislike, or ban for a profile. Does not mutate state.',
    inputSchema: {
      profileId: z.string().uuid(),
      value: z.string(),
      kind: z.enum(['like', 'dislike', 'ban']).default('dislike'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profileId, value, kind }) => {
    const menu = await getCurrentMenu(profileId)
    const affectedMeals = kind === 'like' || !menu
      ? []
      : menu.days.flatMap((day) =>
          day.meals.filter((meal) => mealIncludesIngredient(meal, value)).map((meal) => ({
            dayId: day.id,
            menuMealId: meal.id,
            recipeTitle: meal.recipe.title,
            locked: day.locked || meal.locked,
          })),
        )
    return json({
      proposalId: crypto.randomUUID(),
      profileId,
      value,
      kind,
      affectedMeals,
      preferenceImpact: kind === 'ban' ? 'Future generated recipes will avoid this item.' : 'Future suggestions will use this preference.',
      requiresConfirmation: true,
    })
  },
)

server.registerTool(
  'create_profile',
  {
    description: 'Mutation: create a profile and first stored week. Requires confirmed=true.',
    inputSchema: { ...profileInputSchema, confirmed: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ confirmed, ...input }) => {
    requireConfirmation(confirmed, 'profile creation')
    if ((!input.age || input.sex === 'skipped') && !input.acceptsRoughEstimate) {
      throw new Error('Rough estimate acceptance required when age or sex is skipped.')
    }
    return json(await createProfileAndFirstMenu(input))
  },
)

server.registerTool(
  'update_profile',
  {
    description: 'Mutation: update profile settings and recalculate macro targets. Requires confirmed=true.',
    inputSchema: {
      profileId: z.string().uuid(),
      confirmed: z.boolean(),
      name: z.string().min(1).optional(),
      locale: z.enum(['es', 'en']).optional(),
      weightKg: z.number().positive().optional(),
      targetWeightKg: z.number().positive().optional(),
      heightCm: z.number().positive().optional(),
      age: z.number().int().positive().nullable().optional(),
      sex: z.enum(['female', 'male', 'skipped']).optional(),
      activityLevel: z.enum(['sedentary', 'lightly_active', 'moderately_active', 'active', 'very_active']).optional(),
      goal: z.enum(['maintain', 'cut', 'bulk']).optional(),
      macroMode: z.enum(['balanced', 'high_protein', 'lower_carb', 'manual']).optional(),
      likes: z.array(z.string()).optional(),
      dislikes: z.array(z.string()).optional(),
      bannedFoods: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, confirmed, ...input }) => {
    requireConfirmation(confirmed, 'profile update')
    return json(await updateProfile(profileId, input))
  },
)

server.registerTool(
  'save_macro_targets',
  {
    description: 'Mutation: save manual macro targets for a profile. Requires confirmed=true.',
    inputSchema: {
      profileId: z.string().uuid(),
      confirmed: z.boolean(),
      calories: z.number().int().positive(),
      proteinG: z.number().positive(),
      carbsG: z.number().min(0),
      fatG: z.number().positive(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, confirmed, calories, proteinG, carbsG, fatG }) => {
    requireConfirmation(confirmed, 'manual macro target save')
    const profile = (await listProfiles()).find((item) => item.id === profileId)
    if (!profile) throw new Error('Perfil no encontrado.')
    const targets = calculateMacroTargets({
      weightKg: profile.weightKg,
      targetWeightKg: profile.targetWeightKg,
      heightCm: profile.heightCm,
      age: profile.age,
      sex: profile.sex,
      activityLevel: profile.activityLevel,
      goal: profile.goal,
      macroMode: 'manual',
      manualTargets: { calories, proteinG, carbsG, fatG },
    })
    const conflict = impossibleTargetConflict(targets)
    if (conflict.impossible) throw new Error(conflict.messageEs)
    const targetId = await saveMacroTarget(profileId, targets)
    return json({ changed: true, profileId, targetId, target: targets })
  },
)

server.registerTool(
  'start_weekly_menu_generation',
  {
    description: 'Mutation: generate a new weekly menu for a profile. Requires confirmed=true.',
    inputSchema: { profileId: z.string().uuid(), confirmed: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, confirmed }) => {
    requireConfirmation(confirmed, 'weekly menu generation')
    const profiles = await listProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile?.latestTarget) throw new Error('Profile or macro target not found.')
    return json(await createWeeklyMenu(profileId, undefined, profile.latestTarget, 'mcp_generation'))
  },
)

server.registerTool(
  'replace_meal',
  {
    description: 'Mutation: replace one meal with a selected recipe candidate.',
    inputSchema: {
      menuMealId: z.string().uuid(),
      confirmed: z.boolean(),
      recipe: z.any(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ menuMealId, confirmed, recipe }) => {
    requireConfirmation(confirmed, 'meal replacement')
    return json(await replaceMeal(menuMealId, recipe))
  },
)

server.registerTool(
  'apply_confirmed_replacements',
  {
    description: 'Mutation: apply one or more confirmed meal replacements, optionally saving the preference. Requires confirmed=true.',
    inputSchema: {
      replacements: z.array(z.object({ menuMealId: z.string().uuid(), recipe: recipeCandidateSchema })).min(1),
      profileId: z.string().uuid().optional(),
      preferenceValue: z.string().optional(),
      preferenceKind: z.enum(['like', 'dislike', 'ban']).optional(),
      confirmed: z.boolean(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ replacements, profileId, preferenceValue, preferenceKind, confirmed }) => {
    requireConfirmation(confirmed, 'confirmed replacements')
    let latest: unknown = null
    for (const replacement of replacements) latest = await replaceMeal(replacement.menuMealId, replacement.recipe)
    if (profileId && preferenceValue && preferenceKind) {
      await saveProfilePreference(profileId, preferenceValue, preferenceKind, 'profile')
    }
    return json({
      changed: true,
      replacementCount: replacements.length,
      profilePreferenceSaved: Boolean(profileId && preferenceValue && preferenceKind),
      latestMenu: latest,
    })
  },
)

server.registerTool(
  'apply_similar_replacements',
  {
    description: 'Mutation: replace related meals that contain an avoided ingredient using the shared suggestion pipeline, and save the preference. Requires confirmed=true.',
    inputSchema: {
      profileId: z.string().uuid(),
      menuMealIds: z.array(z.string().uuid()).default([]),
      ingredient: z.string().min(1),
      confirmed: z.boolean(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, menuMealIds, ingredient, confirmed }) => {
    requireConfirmation(confirmed, 'similar replacements')
    return json(await executeAppAction('applySimilarReplacements', { profileId, menuMealIds, ingredient }))
  },
)

server.registerTool(
  'lock_meal',
  {
    description: 'Mutation: lock or unlock one meal.',
    inputSchema: { menuMealId: z.string().uuid(), locked: z.boolean(), confirmed: z.boolean().default(true) },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ menuMealId, locked }) => json(await lockMeal(menuMealId, locked)),
)

server.registerTool(
  'lock_day',
  {
    description: 'Mutation: lock or unlock one day.',
    inputSchema: { dayPlanId: z.string().uuid(), locked: z.boolean(), confirmed: z.boolean().default(true) },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ dayPlanId, locked }) => json(await lockDay(dayPlanId, locked)),
)

server.registerTool(
  'regenerate_meal',
  {
    description: 'Mutation: apply a server-owned regeneration preview for one meal. Pass the preview plan when available; stale plans are rejected.',
    inputSchema: { menuMealId: z.string().uuid(), profileId: z.string().uuid().optional(), plan: z.any().optional(), confirmed: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ menuMealId, profileId, plan, confirmed }) => {
    requireConfirmation(confirmed, 'meal regeneration')
    return json(await executeAppAction('regenerateMeal', { menuMealId, profileId, plan }))
  },
)

server.registerTool(
  'regenerate_day',
  {
    description: 'Mutation: apply a server-owned regeneration preview for one day while preserving locked meals. Pass the preview plan when available; stale plans are rejected.',
    inputSchema: { dayPlanId: z.string().uuid(), profileId: z.string().uuid().optional(), plan: z.any().optional(), confirmed: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ dayPlanId, profileId, plan, confirmed }) => {
    requireConfirmation(confirmed, 'day regeneration')
    return json(await executeAppAction('regenerateDay', { dayPlanId, profileId, plan }))
  },
)

server.registerTool(
  'regenerate_week',
  {
    description: 'Mutation: apply a server-owned regeneration preview for the week while preserving locked days and meals. Pass the preview plan when available; stale plans are rejected.',
    inputSchema: { menuId: z.string().uuid(), profileId: z.string().uuid().optional(), plan: z.any().optional(), confirmed: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ menuId, profileId, plan, confirmed }) => {
    requireConfirmation(confirmed, 'week regeneration')
    return json(await executeAppAction('regenerateWeek', { menuId, profileId, plan }))
  },
)

server.registerTool(
  'star_recipe',
  {
    description: 'Mutation: star a recipe for a profile.',
    inputSchema: { profileId: z.string().uuid(), recipeId: z.string().uuid(), confirmed: z.boolean().default(true) },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, recipeId }) => {
    await starRecipe(profileId, recipeId)
    return json({ changed: true, profileId, recipeId })
  },
)

server.registerTool(
  'unstar_recipe',
  {
    description: 'Mutation: remove a starred recipe.',
    inputSchema: { savedRecipeId: z.string().uuid(), confirmed: z.boolean().default(true) },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ savedRecipeId }) => {
    await unstarRecipe(savedRecipeId)
    return json({ changed: true, savedRecipeId })
  },
)

server.registerTool(
  'save_profile_preference',
  {
    description: 'Mutation: save a durable profile preference. Requires confirmed=true.',
    inputSchema: {
      profileId: z.string().uuid(),
      value: z.string(),
      kind: z.enum(['like', 'dislike', 'ban']).default('dislike'),
      confirmed: z.boolean(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ profileId, value, kind, confirmed }) => {
    requireConfirmation(confirmed, 'profile preference changes')
    await saveProfilePreference(profileId, value, kind, 'profile')
    return json({ changed: true, profileId, value, kind })
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('MenuMaker MCP server running on stdio')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

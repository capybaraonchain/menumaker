import { z } from 'zod'
import {
  adjustCaloriesAndRegenerateWeek,
  applySimilarIngredientReplacements,
  getAppState,
  getCurrentMenu,
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
} from './appService'

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
  proposeCalorieTargetChange: z.object({
    profileId: uuid,
    calories: z.number().int().min(900).max(5000),
  }),
  applyCalorieTargetChange: z.object({
    profileId: uuid,
    calories: z.number().int().min(900).max(5000),
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
  execute: (input: AppActionInput<Name>) => Promise<unknown>
}

function appStateResult(profileId?: string) {
  return getAppState(profileId)
}

export const appActionRegistry: { [Name in AppActionName]: AppActionDefinition<Name> } = {
  proposeCalorieTargetChange: {
    name: 'proposeCalorieTargetChange',
    inputSchema: appActionSchemas.proposeCalorieTargetChange,
    requiresConfirmation: false,
    auditLabel: 'proposal.calorie_target_change',
    confirmationCopyEs: calorieTargetConfirmation,
    async execute(input) {
      const state = await getAppState(input.profileId)
      const currentCalories = state.currentMenu?.target.calories
      return {
        type: 'confirmation_required',
        markdown: await calorieTargetConfirmation(input),
        action: {
          name: 'applyCalorieTargetChange',
          params: input,
          requiresConfirmation: true,
          auditLabel: 'mutation.calorie_target_change',
        },
        currentCalories,
        requestedCalories: input.calories,
      }
    },
  },
  applyCalorieTargetChange: {
    name: 'applyCalorieTargetChange',
    inputSchema: appActionSchemas.applyCalorieTargetChange,
    requiresConfirmation: true,
    auditLabel: 'mutation.calorie_target_change',
    confirmationCopyEs: calorieTargetConfirmation,
    async execute(input) {
      await adjustCaloriesAndRegenerateWeek(input.profileId, input.calories)
      return appStateResult(input.profileId)
    },
  },
  regenerateWeek: {
    name: 'regenerateWeek',
    inputSchema: appActionSchemas.regenerateWeek,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_week',
    confirmationCopyEs: () => 'Se regenerará la semana completa respetando días y comidas bloqueadas. ¿Continuar?',
    async execute(input) {
      await regenerateWeek(input.menuId)
      return appStateResult(input.profileId)
    },
  },
  regenerateDay: {
    name: 'regenerateDay',
    inputSchema: appActionSchemas.regenerateDay,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_day',
    confirmationCopyEs: () => 'Se regenerarán las comidas no bloqueadas de este día. ¿Continuar?',
    async execute(input) {
      await regenerateDay(input.dayPlanId)
      return appStateResult(input.profileId)
    },
  },
  regenerateMeal: {
    name: 'regenerateMeal',
    inputSchema: appActionSchemas.regenerateMeal,
    requiresConfirmation: true,
    auditLabel: 'mutation.regenerate_meal',
    confirmationCopyEs: () => 'Se reemplazará esta comida si no está bloqueada. ¿Continuar?',
    async execute(input) {
      await regenerateMeal(input.menuMealId)
      return appStateResult(input.profileId)
    },
  },
  lockDay: {
    name: 'lockDay',
    inputSchema: appActionSchemas.lockDay,
    requiresConfirmation: false,
    auditLabel: 'mutation.lock_day',
    confirmationCopyEs: () => '',
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
    confirmationCopyEs: (input) => `Se reemplazarán comidas similares con "${input.ingredient}" si no están bloqueadas. ¿Continuar?`,
    async execute(input) {
      await applySimilarIngredientReplacements(input.profileId, input.menuMealIds, input.ingredient)
      return appStateResult(input.profileId)
    },
  },
}

export async function executeAppAction<Name extends AppActionName>(
  name: Name,
  rawInput: unknown,
): Promise<unknown> {
  const definition = appActionRegistry[name]
  const input = definition.inputSchema.parse(rawInput)
  return definition.execute(input as never)
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

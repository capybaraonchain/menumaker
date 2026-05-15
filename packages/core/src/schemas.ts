import { z } from 'zod'

export const localeSchema = z.enum(['es', 'en'])
export const goalSchema = z.enum(['maintain', 'cut', 'bulk'])
export const macroModeSchema = z.enum(['balanced', 'high_protein', 'lower_carb', 'manual'])
export const activityLevelSchema = z.enum(['sedentary', 'lightly_active', 'moderately_active', 'active', 'very_active'])
export const sexSchema = z.enum(['female', 'male', 'skipped'])
export const mealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])

export const ingredientLineSchema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
  unit: z.string().min(1),
  preparation: z.string().optional(),
})

export const recipeCandidateSchema = z.object({
  title: z.string().min(1),
  locale: localeSchema,
  description: z.string(),
  servings: z.literal(1),
  prepTimeMinutes: z.number().int().min(1).max(120),
  cuisine: z.string(),
  flavorProfile: z.string(),
  tags: z.array(z.string()),
  ingredients: z.array(ingredientLineSchema).min(1),
  steps: z.array(z.string()).min(1),
})

export const planningBriefSchema = z.object({
  profileId: z.string().uuid(),
  locale: localeSchema,
  weekStart: z.string(),
  mealSlots: z.array(mealSlotSchema),
  target: z.object({
    calories: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
  }),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  bannedFoods: z.array(z.string()),
  maxPrepTimeMinutes: z.number().int().max(120).default(120),
})

export const weekSkeletonSchema = z.object({
  days: z.array(z.object({
    dayIndex: z.number().int().min(0).max(6),
    meals: z.array(z.object({
      slot: mealSlotSchema,
      intent: z.string(),
      avoidRepeating: z.array(z.string()).default([]),
    })),
  })).length(7),
})

export const mealReplacementProposalSchema = z.object({
  proposalId: z.string().uuid(),
  affectedMeals: z.array(z.string().uuid()),
  inferredIngredient: z.string().nullable(),
  options: z.array(z.object({
    kind: z.enum(['closest_nutrition', 'creative_delicious', 'macro_optimized']),
    recipe: recipeCandidateSchema,
    macroImpact: z.object({
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
    }),
  })).length(3),
})

export const repairRequestSchema = z.object({
  reason: z.enum(['impossible_targets', 'low_nutrition_confidence', 'ambiguous_ingredient', 'banned_item_conflict', 'repetition_conflict', 'generation_exhausted']),
  message: z.string(),
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().min(1),
})

export const repairResultSchema = z.object({
  repaired: z.boolean(),
  retry: z.boolean(),
  notes: z.array(z.string()),
})

export const generationSummarySchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  menuId: z.string().uuid().optional(),
  failureCode: z.string().optional(),
  logs: z.array(z.string()),
})

export const onboardingSchema = z.object({
  name: z.string().min(1),
  locale: localeSchema.default('es'),
  weightKg: z.number().positive(),
  targetWeightKg: z.number().positive(),
  heightCm: z.number().positive(),
  age: z.number().int().positive().nullable().optional(),
  acceptsRoughEstimate: z.boolean().default(false),
  sex: sexSchema.default('skipped'),
  activityLevel: activityLevelSchema.default('lightly_active'),
  goal: goalSchema,
  macroMode: macroModeSchema.default('balanced'),
  manualTargets: z.object({
    calories: z.number().int().positive(),
    proteinG: z.number().positive(),
    carbsG: z.number().min(0),
    fatG: z.number().positive(),
  }).nullable().optional(),
  likes: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  bannedFoods: z.array(z.string()).default([]),
})

export type OnboardingInput = z.infer<typeof onboardingSchema>

export const mealEditSchema = z.object({
  menuMealId: z.string().uuid(),
  request: z.string().min(1),
})

export const lockSchema = z.object({
  id: z.string().uuid(),
  locked: z.boolean(),
})

export const regenerateSchema = z.object({
  menuId: z.string().uuid(),
  dayPlanId: z.string().uuid().optional(),
  menuMealId: z.string().uuid().optional(),
})

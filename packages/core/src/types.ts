export type Locale = 'es' | 'en'
export type UnitSystem = 'metric'
export type Sex = 'female' | 'male' | 'skipped'
export type Goal = 'maintain' | 'cut' | 'bulk'
export type MacroMode = 'balanced' | 'high_protein' | 'lower_carb' | 'manual'
export type ActivityLevel = 'sedentary' | 'lightly_active' | 'moderately_active' | 'active' | 'very_active'
export type CutBulkPreset =
  | 'maintenance'
  | 'conservative_cut'
  | 'standard_cut'
  | 'aggressive_cut'
  | 'conservative_bulk'
  | 'standard_bulk'
  | 'aggressive_bulk'

export type NutritionConfidence = 'exact' | 'barcode' | 'database' | 'generic' | 'estimated' | 'unknown'
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed'
export type GenerationFailureCode =
  | 'impossible_targets'
  | 'low_nutrition_confidence'
  | 'ambiguous_ingredient'
  | 'banned_item_conflict'
  | 'repetition_conflict'
  | 'generation_exhausted'

export interface MacroInputs {
  weightKg: number
  targetWeightKg: number
  heightCm: number
  age?: number | null
  sex?: Sex | null
  activityLevel: ActivityLevel
  goal: Goal
  preset?: CutBulkPreset
  macroMode: MacroMode
  manualTargets?: Partial<MacroTargets> | null
}

export interface MacroTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  confidence: NutritionConfidence
  formulaVersion: string
  goal: Goal
  macroMode: MacroMode
  preset: CutBulkPreset
  maintenanceCalories: number
  proteinCalculationWeightKg: number
  notes: string[]
}

export interface NutritionTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  confidence: NutritionConfidence
}

export interface IngredientLine {
  name: string
  amount: number
  unit: string
  preparation?: string
}

export interface MatchedIngredient extends IngredientLine {
  normalizedAmount: number
  normalizedUnit: 'g' | 'ml'
  foodId?: string
  sourceId?: string
  confidence: NutritionConfidence
  nutrition: NutritionTotals
  notes: string[]
}

export interface RecipeCandidate {
  title: string
  locale: Locale
  description: string
  servings: 1
  prepTimeMinutes: number
  cuisine: string
  flavorProfile: string
  tags: string[]
  ingredients: IngredientLine[]
  steps: string[]
}

export interface ScoredRecipe extends RecipeCandidate {
  id?: string
  matchedIngredients: MatchedIngredient[]
  nutrition: NutritionTotals
}

export interface ProfileDraft {
  name: string
  locale: Locale
  unitSystem: UnitSystem
  weightKg: number
  targetWeightKg: number
  heightCm: number
  age?: number | null
  sex?: Sex | null
  activityLevel: ActivityLevel
  goal: Goal
  macroMode: MacroMode
  preset?: CutBulkPreset
  likes: string[]
  dislikes: string[]
  bannedFoods: string[]
}

export interface MealPlanItem {
  dayIndex: number
  slot: MealSlot
  recipe: ScoredRecipe
  locked: boolean
}

export interface DayPlan {
  dayIndex: number
  locked: boolean
  meals: MealPlanItem[]
}

export interface WeeklyMenuPlan {
  profileId: string
  weekStart: string
  locale: Locale
  targets: MacroTargets
  days: DayPlan[]
  nutrition: NutritionTotals
}

export interface ProviderStatus {
  configured: boolean
  path: string
  shape: 'direct' | 'codex-auth' | 'missing' | 'invalid'
  model: string
  reasoningEffort: string
  tokenPresent: boolean
  refreshTokenPresent: boolean
  accountIdPresent: boolean
  expires: number | null
  stale: boolean | null
}

export const mealSlots: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const mealSlotLabels: Record<Locale, Record<MealSlot, string>> = {
  es: {
    breakfast: 'Desayuno',
    lunch: 'Comida',
    dinner: 'Cena',
    snack: 'Snack',
  },
  en: {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snack',
  },
}


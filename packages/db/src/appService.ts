import { createHash, randomUUID } from 'node:crypto'
import {
  codexStatus,
  generateRecipeCandidates,
  generateWeekSkeleton,
  chatWithMenuContext,
  planChatCommand,
  summarizeGeneration,
  type GenerationSummaryInput,
  type GenerationSummaryResult,
  type PlannedChatCommand,
  type RecipeGenerationInput,
  type RecipeGenerationResult,
  type WeekSkeletonGenerationInput,
  type WeekSkeletonGenerationResult,
} from '@menumaker/ai'
import {
  calculateMacroTargets,
  impossibleTargetConflict,
  mealSlots,
  roundToNearest,
  type ActivityLevel,
  type Goal,
  type Locale,
  type MacroMode,
  type MacroTargets,
  type MealSlot,
  type NutritionTotals,
  type OnboardingInput,
  type RecipeCandidate,
  type Sex,
  type WeekSkeleton,
  type WeekSkeletonMeal,
} from '@menumaker/core'
import { normalizeIngredientName, scoreRecipe, seedFoods, sumNutrition, templatesForSlot } from '@menumaker/nutrition'
import {
  buildCalorieAdjustmentPlan,
  currentMenuHash,
  type CalorieAdjustmentPlan,
  type CaloriePlannerMenu,
} from './caloriePlanner'
import { closeDb, sqlClient } from './client'
import { loadDotEnv, localUserId } from './env'
import {
  buildGenerationRemediationPlan,
  buildRepairRemediationPlans,
  classifyGenerationFailure,
  type GenerationRemediationPlan,
} from './remediation'

export interface AppState {
  provider?: unknown
  profiles: ProfileRow[]
  activeProfile: ProfileRow | null
  currentMenu: WeeklyMenuView | null
  savedRecipes: SavedRecipeView[]
  history: MenuHistoryItem[]
  generationJobs: GenerationJobView[]
}

export interface ProfileRow {
  id: string
  name: string
  locale: Locale
  unitSystem: 'metric'
  weightKg: number
  targetWeightKg: number
  proteinCalculationWeightKg: number
  heightCm: number
  age: number | null
  sex: Sex
  activityLevel: ActivityLevel
  goal: Goal
  macroMode: MacroMode
  likes: string[]
  dislikes: string[]
  bannedFoods: string[]
  latestTarget?: MacroTargets
}

export interface WeeklyMenuView {
  id: string
  profileId: string
  weekStart: string
  locale: 'es' | 'en'
  status: string
  generationSettings: Record<string, unknown>
  nutrition: NutritionTotals
  target: MacroTargets
  days: DayPlanView[]
}

export interface DayPlanView {
  id: string
  dayIndex: number
  locked: boolean
  meals: MenuMealView[]
}

export interface MenuMealView {
  id: string
  slot: MealSlot
  locked: boolean
  recipe: RecipeView
  nutrition: NutritionTotals
}

export interface RecipeView {
  id: string
  title: string
  locale: string
  description: string
  servings: number
  prepTimeMinutes: number
  cuisine: string
  flavorProfile: string
  tags: string[]
  steps: string[]
  source: string
  nutrition: NutritionTotals
  ingredients: IngredientView[]
  saved?: boolean
}

export interface IngredientView {
  id: string
  name: string
  amount: number
  unit: string
  preparation: string | null
  normalizedAmount: number
  normalizedUnit: 'g' | 'ml'
  foodId: string | null
  sourceId: string | null
  confidence: string
  nutrition: NutritionTotals
  notes: string[]
}

export interface SavedRecipeView {
  savedRecipeId: string
  recipe: RecipeView
}

export interface MenuHistoryItem {
  id: string
  profileId: string
  weekStart: string
  createdAt: string
  nutrition: NutritionTotals
}

export interface GenerationJobView {
  id: string
  profileId: string | null
  weeklyMenuId: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  kind: string
  failureCode: string | null
  logs: string[]
  result: Record<string, unknown>
  remediation: GenerationRemediationPlan | null
  error: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
}

export interface RetryGenerationJobResult {
  retriedJobId: string
  newJobId: string
  retryOfKind: string
  menu: WeeklyMenuView
}

export interface RelaxProfilePreferencesResult {
  profileId: string
  removedDislikes: string[]
  removedBannedFoods: string[]
  profile: ProfileRow
}

export interface ChatCommandPlanningInput {
  message: string
  locale: Locale
  profileId?: string
  menuContext?: unknown
}

export interface CachedPlannedChatCommand extends PlannedChatCommand {
  cacheHit: boolean
}

export interface MenuChatInput {
  message: string
  locale: Locale
  profileName?: string
  menuContext?: unknown
}

export interface CachedMenuChatResponse {
  text: string
  providerConfigured: boolean
  cacheHit: boolean
}

export interface CachedGenerationSummary extends GenerationSummaryResult {
  cacheHit: boolean
}

interface WeeklyMenuGenerationJobInput {
  profileId: string
  macroTargetId: string
  target: MacroTargets
  kind: string
}

export interface ProfileDeletionExport {
  exportedAt: string
  profile: ProfileRow
  menus: WeeklyMenuView[]
  savedRecipes: SavedRecipeView[]
  preferences: Array<{
    id: string
    kind: string
    value: string
    scope: string
    strength: string
    createdAt: string
  }>
  counts: {
    menus: number
    days: number
    meals: number
    savedRecipes: number
    preferences: number
    generatedRecipesConsideredForCleanup: number
  }
}

export interface ProfileDeletionResult {
  deletedProfileId: string
  deletedProfileName: string
  remainingProfileId: string | null
  export: ProfileDeletionExport | null
}

export interface ReplacementProposal {
  proposalId: string
  affectedMeals: string[]
  inferredIngredient: string | null
  options: Array<{
    kind: 'closest_nutrition' | 'creative_delicious' | 'macro_optimized'
    recipe: RecipeCandidate
    nutrition: NutritionTotals
    macroImpact: NutritionTotals
  }>
}

export interface SimilarReplacementResult {
  changed: boolean
  ingredient: string
  replacedMealIds: string[]
  skippedLockedMealIds: string[]
  menu: WeeklyMenuView | null
}

export interface AppliedCalorieAdjustmentResult {
  menu: WeeklyMenuView
  plan: CalorieAdjustmentPlan
  changeSummary: string
}

export type RegenerationPlanKind = 'meal' | 'day' | 'week'
export type RegenerationDecisionKind = 'recipe_replacement' | 'preserve_locked'

export interface RegenerationDecision {
  dayIndex: number
  dayId: string
  dayLocked: boolean
  slot: MealSlot
  menuMealId: string
  locked: boolean
  kind: RegenerationDecisionKind
  reason: string
  previousRecipeId: string
  previousTitle: string
  nextTitle: string
  existingRecipeId?: string
  recipe: RecipeCandidate
  nutrition: NutritionTotals
  previousNutrition: NutritionTotals
  delta: NutritionTotals
  source: 'llm' | 'template' | 'existing'
}

export interface RegenerationPlan {
  planId: string
  kind: RegenerationPlanKind
  profileId: string
  baseMenuId: string
  baseMenuHash: string
  targetDayPlanId?: string
  targetMenuMealId?: string
  affectedMealIds: string[]
  preservedMealIds: string[]
  decisionCounts: Record<RegenerationDecisionKind, number>
  fallbackSlots: MealSlot[]
  decisions: RegenerationDecision[]
  warnings: string[]
  trace: {
    fallbackAllowed: boolean
    slots: Partial<Record<MealSlot, RecipePoolTrace>>
  }
  summaryMarkdown: string
  confirmationMarkdown: string
}

export interface AppliedRegenerationPlanResult {
  menu: WeeklyMenuView
  plan: RegenerationPlan
  changeSummary: string
}

type ReplacementOptionKind = ReplacementProposal['options'][number]['kind']

interface ReplacementRequestFeatures {
  avoidedFoods: string[]
  wantsMoreProtein: boolean
  wantsLowerCalories: boolean
  wantsLowerFat: boolean
}

interface ReplacementRankedCandidate {
  recipe: RecipeCandidate
  nutrition: NutritionTotals
  macroImpact: NutritionTotals
  closestScore: number
  creativeScore: number
  macroScore: number
  overallScore: number
}

interface GeneratedScoredRecipe {
  recipe: ReturnType<typeof scoreRecipe>
  source: 'llm' | 'template'
}

interface RecipePoolResult {
  recipes: GeneratedScoredRecipe[]
  source: 'llm' | 'template' | 'mixed'
  llmResult: RecipeGenerationResult
  trace: RecipePoolTrace
}

interface RecipePoolTrace {
  requestedCount: number
  providerConfigured: boolean
  providerSource: RecipeGenerationResult['source']
  cacheHit: boolean
  llmRawCandidateCount: number
  acceptedLlmCandidateCount: number
  fallbackAllowed: boolean
  fallbackUsed: boolean
  fallbackReason: 'none' | 'provider_unavailable' | 'provider_failed' | 'too_few_valid_candidates'
  fallbackCandidateCount: number
  returnedCandidateCount: number
  error?: string
}

interface WeekSkeletonTrace {
  providerConfigured: boolean
  providerSource: WeekSkeletonGenerationResult['source']
  cacheHit: boolean
  fallbackAllowed: boolean
  fallbackUsed: boolean
  fallbackReason: 'none' | 'provider_unavailable' | 'provider_failed'
  error?: string
}

interface WeekRepairIssue {
  reason: 'repetition_conflict' | 'daily_calorie_drift' | 'weekly_protein_low'
  dayIndex?: number
  slot?: MealSlot
  title?: string
  message: string
}

interface WeekRepairAction {
  attempt: number
  reason: WeekRepairIssue['reason']
  dayIndex: number
  slot: MealSlot
  previousTitle: string
  nextTitle: string
  delta: NutritionTotals
}

interface WeekRepairRequest {
  reason: WeekRepairIssue['reason']
  message: string
  attempt: number
  maxAttempts: number
  dayIndex?: number
  slot?: MealSlot
  title?: string
}

interface WeekRepairResult {
  repaired: boolean
  retry: boolean
  notes: string[]
  attempt: number
  reason: WeekRepairIssue['reason']
  dayIndex?: number
  slot?: MealSlot
  actionCount: number
}

interface WeekRepairTrace {
  attempted: boolean
  maxAttempts: number
  issuesBefore: WeekRepairIssue[]
  repairRequests: WeekRepairRequest[]
  repairResults: WeekRepairResult[]
  actions: WeekRepairAction[]
  issuesAfter: WeekRepairIssue[]
  repaired: boolean
}

const RECIPE_GENERATION_SCHEMA_VERSION = 'menumaker_recipe_candidates:v1'
const WEEK_SKELETON_SCHEMA_VERSION = 'menumaker_week_skeleton:v1'
const CHAT_COMMAND_SCHEMA_VERSION = 'menumaker_chat_command:v1'
const MENU_CHAT_SCHEMA_VERSION = 'menumaker_menu_chat:v1'
const GENERATION_SUMMARY_SCHEMA_VERSION = 'menumaker_generation_summary:v1'

const replacementSlotShares: Record<MealSlot, number> = {
  breakfast: 0.23,
  lunch: 0.32,
  dinner: 0.32,
  snack: 0.13,
}

export interface ProfileUpdateInput {
  name?: string
  locale?: Locale
  weightKg?: number
  targetWeightKg?: number
  heightCm?: number
  age?: number | null
  sex?: Sex
  activityLevel?: ActivityLevel
  goal?: Goal
  macroMode?: MacroMode
  likes?: string[]
  dislikes?: string[]
  bannedFoods?: string[]
}

export async function ensureLocalUser(): Promise<void> {
  const sql = sqlClient()
  await sql`
    insert into users (id, email)
    values (${localUserId()}, 'local@menumaker.test')
    on conflict (id) do nothing
  `
}

export async function getAppState(profileId?: string): Promise<AppState> {
  await ensureLocalUser()
  const profiles = await listProfiles()
  const activeProfile = profiles.find((profile) => profile.id === profileId) ?? profiles[0] ?? null
  return {
    profiles,
    activeProfile,
    currentMenu: activeProfile ? await getCurrentMenu(activeProfile.id) : null,
    savedRecipes: activeProfile ? await getSavedRecipes(activeProfile.id) : [],
    history: activeProfile ? await getMenuHistory(activeProfile.id) : [],
    generationJobs: activeProfile ? await getGenerationJobs(activeProfile.id) : [],
  }
}

export async function createProfileAndFirstMenu(input: OnboardingInput): Promise<AppState> {
  await ensureLocalUser()
  const targets = calculateMacroTargets({
    weightKg: input.weightKg,
    targetWeightKg: input.targetWeightKg,
    heightCm: input.heightCm,
    age: input.age,
    sex: input.sex,
    activityLevel: input.activityLevel,
    goal: input.goal,
    macroMode: input.macroMode,
    manualTargets: input.macroMode === 'manual' ? input.manualTargets : null,
  })

  const conflict = impossibleTargetConflict(targets)
  if (conflict.impossible) throw new Error(conflict.messageEs)

  const sql = sqlClient()
  const [profile] = await sql<[{ id: string }]>`
    insert into profiles (
      user_id, name, locale, unit_system, weight_kg, target_weight_kg, protein_calculation_weight_kg,
      height_cm, age, sex, activity_level, goal, macro_mode, likes, dislikes, banned_foods
    )
    values (
      ${localUserId()}, ${input.name}, ${input.locale}, 'metric', ${input.weightKg}, ${input.targetWeightKg},
      ${targets.proteinCalculationWeightKg}, ${input.heightCm}, ${input.age ?? null}, ${input.sex},
      ${input.activityLevel}, ${input.goal}, ${input.macroMode}, ${sql.json(input.likes as any)},
      ${sql.json(input.dislikes as any)}, ${sql.json(input.bannedFoods as any)}
    )
    returning id
  `
  if (!profile) throw new Error('No se pudo crear el perfil.')
  const targetId = await saveMacroTarget(profile.id, targets)
  await createWeeklyMenu(profile.id, targetId, targets, 'initial_generation')
  return getAppState(profile.id)
}

export async function updateProfile(profileId: string, input: ProfileUpdateInput): Promise<AppState> {
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const next = { ...profile, ...input }
  const targets = calculateMacroTargets({
    weightKg: next.weightKg,
    targetWeightKg: next.targetWeightKg,
    heightCm: next.heightCm,
    age: next.age,
    sex: next.sex,
    activityLevel: next.activityLevel,
    goal: next.goal,
    macroMode: next.macroMode,
  })
  const conflict = impossibleTargetConflict(targets)
  if (conflict.impossible) throw new Error(conflict.messageEs)

  const sql = sqlClient()
  await sql`
    update profiles set
      name = ${next.name},
      locale = ${next.locale},
      weight_kg = ${next.weightKg},
      target_weight_kg = ${next.targetWeightKg},
      protein_calculation_weight_kg = ${targets.proteinCalculationWeightKg},
      height_cm = ${next.heightCm},
      age = ${next.age ?? null},
      sex = ${next.sex},
      activity_level = ${next.activityLevel},
      goal = ${next.goal},
      macro_mode = ${next.macroMode},
      likes = ${sql.json(next.likes as any)},
      dislikes = ${sql.json(next.dislikes as any)},
      banned_foods = ${sql.json(next.bannedFoods as any)},
      updated_at = now()
    where id = ${profileId} and user_id = ${localUserId()}
  `
  await saveMacroTarget(profileId, targets)
  return getAppState(profileId)
}

export async function relaxProfilePreferences(
  profileId: string,
  removeDislikes: string[],
  removeBannedFoods: string[],
): Promise<RelaxProfilePreferencesResult> {
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const removedDislikes = selectedExistingValues(profile.dislikes, removeDislikes)
  const removedBannedFoods = selectedExistingValues(profile.bannedFoods, removeBannedFoods)
  if (removedDislikes.length === 0 && removedBannedFoods.length === 0) {
    throw new Error('Selecciona al menos una preferencia para relajar.')
  }
  const nextDislikes = removeSelectedValues(profile.dislikes, removedDislikes)
  const nextBannedFoods = removeSelectedValues(profile.bannedFoods, removedBannedFoods)
  const sql = sqlClient()
  await sql`
    update profiles
    set dislikes = ${sql.json(nextDislikes as any)},
      banned_foods = ${sql.json(nextBannedFoods as any)}
    where id = ${profileId} and user_id = ${localUserId()}
  `
  const updated = (await listProfiles()).find((item) => item.id === profileId)
  if (!updated) throw new Error('Perfil no encontrado después de actualizar preferencias.')
  return {
    profileId,
    removedDislikes,
    removedBannedFoods,
    profile: updated,
  }
}

export async function planChatCommandCached(input: ChatCommandPlanningInput): Promise<CachedPlannedChatCommand | null> {
  const status = codexStatus()
  if (!status.configured) return null
  const cacheInput = {
    ...input,
    menuContext: compactMenuForPlannerCache(input.menuContext),
  }
  const cached = await readAiCache<PlannedChatCommand>(CHAT_COMMAND_SCHEMA_VERSION, cacheInput)
  if (cached) return { ...cached, cacheHit: true }
  const result = await planChatCommand(input)
  if (!result) return null
  await writeAiCache(CHAT_COMMAND_SCHEMA_VERSION, cacheInput, result)
  return { ...result, cacheHit: false }
}

export async function chatWithMenuContextCached(input: MenuChatInput): Promise<CachedMenuChatResponse> {
  const status = codexStatus()
  if (!status.configured) {
    const response = await chatWithMenuContext(input)
    return { ...response, cacheHit: false }
  }
  const cacheInput = {
    ...input,
    menuContext: compactMenuForChatCache(input.menuContext),
  }
  const cached = await readAiCache<{ text: string; providerConfigured: boolean }>(MENU_CHAT_SCHEMA_VERSION, cacheInput)
  if (cached) return { ...cached, cacheHit: true }
  const result = await chatWithMenuContext(input)
  if (result.providerConfigured) await writeAiCache(MENU_CHAT_SCHEMA_VERSION, cacheInput, result)
  return { ...result, cacheHit: false }
}

export async function summarizeGenerationCached(input: GenerationSummaryInput): Promise<CachedGenerationSummary> {
  const status = codexStatus()
  const cacheInput = compactGenerationSummaryInput(input)
  if (!status.configured) {
    const response = await summarizeGeneration(input)
    return { ...response, cacheHit: false }
  }
  const cached = await readAiCache<GenerationSummaryResult>(GENERATION_SUMMARY_SCHEMA_VERSION, cacheInput)
  if (cached) return { ...cached, cacheHit: true }
  const result = await summarizeGeneration(input)
  if (result.source === 'llm') await writeAiCache(GENERATION_SUMMARY_SCHEMA_VERSION, cacheInput, { ...result, cacheHit: false })
  return { ...result, cacheHit: false }
}

export async function exportProfileData(profileId: string): Promise<ProfileDeletionExport> {
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const sql = sqlClient()
  const menuRows = await sql`
    select id from weekly_menus
    where profile_id = ${profileId} and user_id = ${localUserId()}
    order by created_at asc
  `
  const menus: WeeklyMenuView[] = []
  for (const row of menuRows) menus.push(await getWeeklyMenu(row.id))
  const preferenceRows = await sql`
    select id, kind, value, scope, strength, created_at
    from profile_preferences
    where profile_id = ${profileId} and user_id = ${localUserId()}
    order by created_at asc
  `
  const recipeRows = await sql`
    select distinct r.id
    from recipes r
    where r.user_id = ${localUserId()} and (
      exists (
        select 1 from weekly_menus wm
        join day_plans dp on dp.weekly_menu_id = wm.id
        join menu_meals mm on mm.day_plan_id = dp.id
        where wm.profile_id = ${profileId} and mm.recipe_id = r.id
      )
      or exists (
        select 1 from saved_recipes sr
        where sr.profile_id = ${profileId} and sr.recipe_id = r.id
      )
    )
  `
  return {
    exportedAt: new Date().toISOString(),
    profile,
    menus,
    savedRecipes: await getSavedRecipes(profileId),
    preferences: preferenceRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      value: row.value,
      scope: row.scope,
      strength: row.strength,
      createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    })),
    counts: {
      menus: menus.length,
      days: menus.reduce((total, menu) => total + menu.days.length, 0),
      meals: menus.reduce((total, menu) => total + menu.days.reduce((dayTotal, day) => dayTotal + day.meals.length, 0), 0),
      savedRecipes: await countRows(sql`select count(*)::int as count from saved_recipes where profile_id = ${profileId} and user_id = ${localUserId()}`),
      preferences: preferenceRows.length,
      generatedRecipesConsideredForCleanup: recipeRows.length,
    },
  }
}

export async function deleteProfile(profileId: string, expectedName: string, exportBeforeDelete = true): Promise<ProfileDeletionResult> {
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  if (expectedName.trim() !== profile.name) {
    throw new Error(`Para eliminar este perfil, escribe exactamente "${profile.name}".`)
  }

  const exportSnapshot = exportBeforeDelete ? await exportProfileData(profileId) : null
  const sql = sqlClient()
  const recipeRows = await sql<{ id: string }[]>`
    select distinct r.id
    from recipes r
    where r.user_id = ${localUserId()} and (
      exists (
        select 1 from weekly_menus wm
        join day_plans dp on dp.weekly_menu_id = wm.id
        join menu_meals mm on mm.day_plan_id = dp.id
        where wm.profile_id = ${profileId} and mm.recipe_id = r.id
      )
      or exists (
        select 1 from saved_recipes sr
        where sr.profile_id = ${profileId} and sr.recipe_id = r.id
      )
    )
  `
  const menuRows = await sql<{ id: string }[]>`
    select id from weekly_menus
    where profile_id = ${profileId} and user_id = ${localUserId()}
  `

  await sql.begin(async (tx) => {
    for (const row of menuRows) {
      await tx`
        update generation_jobs set weekly_menu_id = null
        where weekly_menu_id = ${row.id} and user_id = ${localUserId()}
      `
    }
    await tx`
      update generation_jobs set profile_id = null
      where profile_id = ${profileId} and user_id = ${localUserId()}
    `
    await tx`
      update pending_actions set profile_id = null
      where profile_id = ${profileId} and user_id = ${localUserId()}
    `
    await tx`
      update action_events set profile_id = null
      where profile_id = ${profileId} and user_id = ${localUserId()}
    `
    await tx`delete from saved_recipes where profile_id = ${profileId} and user_id = ${localUserId()}`
    await tx`delete from profile_preferences where profile_id = ${profileId} and user_id = ${localUserId()}`
    await tx`delete from weekly_menus where profile_id = ${profileId} and user_id = ${localUserId()}`
    await tx`delete from macro_targets where profile_id = ${profileId} and user_id = ${localUserId()}`
    await tx`delete from profiles where id = ${profileId} and user_id = ${localUserId()}`
    for (const row of recipeRows) {
      await tx`
        delete from nutrition_estimates
        where user_id = ${localUserId()} and entity_type = 'recipe' and entity_id = ${row.id}
          and not exists (select 1 from menu_meals where recipe_id = ${row.id})
          and not exists (select 1 from saved_recipes where recipe_id = ${row.id})
      `
      await tx`
        delete from recipes
        where id = ${row.id} and user_id = ${localUserId()}
          and not exists (select 1 from menu_meals where recipe_id = ${row.id})
          and not exists (select 1 from saved_recipes where recipe_id = ${row.id})
      `
    }
  })

  const remainingProfile = (await listProfiles())[0] ?? null
  return {
    deletedProfileId: profileId,
    deletedProfileName: profile.name,
    remainingProfileId: remainingProfile?.id ?? null,
    export: exportSnapshot,
  }
}

export async function listProfiles(): Promise<ProfileRow[]> {
  const sql = sqlClient()
  const rows = await sql`
    select p.*, mt.id as target_id, mt.calories, mt.protein_g, mt.carbs_g, mt.fat_g, mt.confidence,
      mt.formula_version, mt.goal as target_goal, mt.macro_mode as target_macro_mode, mt.preset,
      mt.maintenance_calories, mt.protein_calculation_weight_kg as target_protein_weight, mt.notes
    from profiles p
    left join lateral (
      select * from macro_targets mt where mt.profile_id = p.id order by mt.created_at desc limit 1
    ) mt on true
    where p.user_id = ${localUserId()}
    order by p.created_at asc
  `
  return rows.map((row) => profileFromRow(row))
}

export async function saveMacroTarget(profileId: string, targets: MacroTargets): Promise<string> {
  const sql = sqlClient()
  const [row] = await sql<[{ id: string }]>`
    insert into macro_targets (
      user_id, profile_id, calories, protein_g, carbs_g, fat_g, confidence, formula_version, goal,
      macro_mode, preset, maintenance_calories, protein_calculation_weight_kg, notes
    )
    values (
      ${localUserId()}, ${profileId}, ${targets.calories}, ${targets.proteinG}, ${targets.carbsG},
      ${targets.fatG}, ${targets.confidence}, ${targets.formulaVersion}, ${targets.goal},
      ${targets.macroMode}, ${targets.preset}, ${targets.maintenanceCalories},
      ${targets.proteinCalculationWeightKg}, ${sql.json(targets.notes as any)}
    )
    returning id
  `
  if (!row) throw new Error('No se pudo guardar el objetivo de macros.')
  return row.id
}

export async function createWeeklyMenu(profileId: string, targetId?: string, targets?: MacroTargets, kind = 'weekly_generation'): Promise<WeeklyMenuView> {
  const job = await enqueueWeeklyMenuGenerationJob(profileId, targetId, targets, kind)
  return runGenerationJob(job.id)
}

export async function enqueueWeeklyMenuGenerationJob(profileId: string, targetId?: string, targets?: MacroTargets, kind = 'weekly_generation'): Promise<GenerationJobView> {
  const sql = sqlClient()
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const target = targets ?? profile.latestTarget
  if (!target) throw new Error('El perfil no tiene objetivos de macros.')
  const macroTargetId = targetId ?? (await saveMacroTarget(profileId, target))
  const input: WeeklyMenuGenerationJobInput = {
    profileId,
    macroTargetId,
    target,
    kind,
  }
  const [job] = await sql`
    insert into generation_jobs (user_id, profile_id, status, kind, logs, result)
    values (${localUserId()}, ${profileId}, 'queued', ${kind}, ${sql.json(['En cola'] as any)}, ${sql.json({ jobInput: input } as any)})
    returning id, profile_id, weekly_menu_id, status, kind, failure_code, logs, result, error, retry_count, created_at, updated_at
  `
  if (!job) throw new Error('No se pudo crear el trabajo de generación.')
  return generationJobFromRow(job)
}

export async function runGenerationJob(jobId: string): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const [job] = await sql`
    select id, profile_id, status, kind, result
    from generation_jobs
    where id = ${jobId} and user_id = ${localUserId()}
  `
  if (!job) throw new Error('Trabajo de generación no encontrado.')
  if (job.status === 'completed') {
    const [completed] = await sql`select weekly_menu_id from generation_jobs where id = ${jobId} and user_id = ${localUserId()}`
    if (completed?.weekly_menu_id) return getWeeklyMenu(completed.weekly_menu_id)
    throw new Error('El trabajo está completado pero no tiene menú asociado.')
  }
  if (job.status !== 'queued' && job.status !== 'failed') {
    throw new Error(`No se puede ejecutar un trabajo en estado ${job.status}.`)
  }
  const input = weeklyMenuJobInputFromResult(job.result)
  const profile = (await listProfiles()).find((item) => item.id === input.profileId)
  if (!profile) throw new Error('Perfil no encontrado para el trabajo de generación.')
  await sql`
    update generation_jobs
    set status = 'running',
      logs = ${sql.json(['En cola', 'Construyendo semana'] as any)},
      error = null,
      failure_code = null,
      updated_at = now()
    where id = ${jobId} and user_id = ${localUserId()}
  `

  let weekRecipes: Awaited<ReturnType<typeof buildRecipesForWeek>>
  try {
    weekRecipes = await buildRecipesForWeek(profile, input.target)
  } catch (error) {
    const failureLogs = ['En cola', 'Construyendo semana', 'Generando esqueleto semanal', 'Generando candidatos con LLM', 'Fallo de generación']
    const failureCode = classifyGenerationFailure(error)
    const remediation = buildGenerationRemediationPlan({
      code: failureCode,
      error: error instanceof Error ? error.message : String(error),
      target: input.target,
    })
    const generationSummary = await summarizeGenerationCached({
      locale: profile.locale,
      profileName: profile.name,
      jobId,
      status: 'failed',
      kind: input.kind,
      target: input.target,
      weeklyNutrition: null,
      recipeSource: null,
      fallbackSlots: [],
      repair: null,
      logs: failureLogs,
      failureCode,
      error: error instanceof Error ? error.message : String(error),
    })
    await sql`
      update generation_jobs set status = 'failed',
        failure_code = ${failureCode},
        logs = ${sql.json(failureLogs as any)},
        result = coalesce(result, '{}'::jsonb) || ${sql.json({
          jobInput: input,
          generationSummary,
          remediation,
        } as any)}::jsonb,
        error = ${error instanceof Error ? error.message : String(error)},
        updated_at = now()
      where id = ${jobId} and user_id = ${localUserId()}
    `
    throw error
  }

  const [menu] = await sql<[{ id: string }]>`
    insert into weekly_menus (user_id, profile_id, macro_target_id, week_start, locale, status, generation_settings, nutrition_snapshot)
    values (${localUserId()}, ${input.profileId}, ${input.macroTargetId}, ${currentWeekStart()}, ${profile.locale}, 'completed', ${sql.json({
      kind: input.kind,
      generationJobId: jobId,
      recipeSource: weekRecipes.source,
      fallbackSlots: weekRecipes.fallbackSlots,
      fallbackAllowed: weekRecipes.trace.fallbackAllowed,
      weekSkeleton: weekRecipes.skeleton,
      weekSkeletonTrace: weekRecipes.skeletonTrace,
      repair: weekRecipes.repair,
      trace: weekRecipes.trace,
    } as any)}, '{}')
    returning id
  `
  if (!menu) throw new Error('No se pudo crear el menú.')

  const dayNutrition: NutritionTotals[] = []
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const [day] = await sql<[{ id: string }]>`
      insert into day_plans (user_id, weekly_menu_id, day_index, locked)
      values (${localUserId()}, ${menu.id}, ${dayIndex}, false)
      returning id
    `
    if (!day) throw new Error('No se pudo crear el día.')
    const dayRecipes = weekRecipes.days[dayIndex] ?? []
    for (const item of dayRecipes) {
      const recipeId = await persistRecipe(item.recipe, weekRecipes.source === 'template' ? 'template_generated' : 'llm_generated')
      await sql`
        insert into menu_meals (user_id, day_plan_id, recipe_id, slot, locked, nutrition_snapshot)
        values (${localUserId()}, ${day.id}, ${recipeId}, ${item.slot}, false, ${sql.json(item.recipe.nutrition as any)})
      `
    }
    dayNutrition.push(sumNutrition(dayRecipes.map((item) => item.recipe.nutrition)))
  }

  const weeklyNutrition = sumNutrition(dayNutrition)
  const repairRemediation = buildRepairRemediationPlans(weekRecipes.repair)
  const completedLogs = [
    'En cola',
    'Construyendo semana',
    weekRecipes.skeletonTrace.fallbackUsed ? 'Usando esqueleto semanal determinístico' : 'Generando esqueleto semanal con LLM',
    weekRecipes.source === 'template' ? 'Usando fallback determinístico de recetas' : 'Generando candidatos con LLM',
    weekRecipes.repair.attempted ? 'Reparando selección semanal' : 'Validando calidad semanal',
    'Calculando nutrición',
    'Resumiendo generación',
    'Finalizando',
  ]
  const generationSummary = await summarizeGenerationCached({
    locale: profile.locale,
    profileName: profile.name,
    jobId,
    status: 'completed',
    kind: input.kind,
    target: input.target,
    weeklyNutrition,
    recipeSource: weekRecipes.source,
    fallbackSlots: weekRecipes.fallbackSlots,
    repair: weekRecipes.repair,
    logs: completedLogs,
    failureCode: null,
    error: null,
  })
  await sql`
    update weekly_menus
    set nutrition_snapshot = ${sql.json(weeklyNutrition as any)},
      generation_settings = generation_settings || ${sql.json({
        generationSummary,
        repairRemediation,
      } as any)}::jsonb
    where id = ${menu.id}
  `
  await sql`
    update generation_jobs set status = 'completed', weekly_menu_id = ${menu.id},
      logs = ${sql.json(completedLogs as any)},
      result = ${sql.json({
        jobInput: input,
        menuId: menu.id,
        recipeSource: weekRecipes.source,
        fallbackSlots: weekRecipes.fallbackSlots,
        weekSkeletonTrace: weekRecipes.skeletonTrace,
        repair: weekRecipes.repair,
        trace: weekRecipes.trace,
        generationSummary,
        repairRemediation,
      } as any)}, updated_at = now()
    where id = ${jobId} and user_id = ${localUserId()}
  `
  return getWeeklyMenu(menu.id)
}

export async function getCurrentMenu(profileId: string): Promise<WeeklyMenuView | null> {
  const sql = sqlClient()
  const [row] = await sql<[{ id: string }]>`
    select id from weekly_menus
    where user_id = ${localUserId()} and profile_id = ${profileId}
    order by created_at desc
    limit 1
  `
  return row ? getWeeklyMenu(row.id) : null
}

export async function getWeeklyMenu(menuId: string): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const [menu] = await sql`
    select wm.*, mt.calories, mt.protein_g, mt.carbs_g, mt.fat_g, mt.confidence, mt.formula_version,
      mt.goal, mt.macro_mode, mt.preset, mt.maintenance_calories, mt.protein_calculation_weight_kg, mt.notes
    from weekly_menus wm
    join macro_targets mt on mt.id = wm.macro_target_id
    where wm.user_id = ${localUserId()} and wm.id = ${menuId}
  `
  if (!menu) throw new Error('Menú no encontrado.')

  const dayRows = await sql`
    select * from day_plans
    where weekly_menu_id = ${menuId} and user_id = ${localUserId()}
    order by day_index asc
  `
  const days: DayPlanView[] = []
  for (const day of dayRows) {
    const mealRows = await sql`
      select mm.id as menu_meal_id, mm.slot, mm.locked, mm.nutrition_snapshot as meal_nutrition, r.*
      from menu_meals mm
      join recipes r on r.id = mm.recipe_id
      where mm.day_plan_id = ${day.id} and mm.user_id = ${localUserId()}
      order by case mm.slot when 'breakfast' then 1 when 'lunch' then 2 when 'dinner' then 3 when 'snack' then 4 else 5 end
    `
    const meals: MenuMealView[] = []
    for (const meal of mealRows) {
      meals.push({
        id: meal.menu_meal_id,
        slot: meal.slot,
        locked: meal.locked,
        nutrition: meal.meal_nutrition,
        recipe: await recipeFromRow(meal),
      })
    }
    days.push({ id: day.id, dayIndex: day.day_index, locked: day.locked, meals })
  }

  return {
    id: menu.id,
    profileId: menu.profile_id,
    weekStart: menu.week_start,
    locale: menu.locale,
    status: menu.status,
    generationSettings: menu.generation_settings ?? {},
    nutrition: menu.nutrition_snapshot,
    target: targetFromRow(menu),
    days,
  }
}

export async function getRecipe(recipeId: string): Promise<RecipeView> {
  const sql = sqlClient()
  const [row] = await sql`
    select * from recipes
    where id = ${recipeId} and user_id = ${localUserId()}
  `
  if (!row) throw new Error('Receta no encontrada.')
  return recipeFromRow(row)
}

export async function getMenuHistory(profileId: string): Promise<MenuHistoryItem[]> {
  const sql = sqlClient()
  const rows = await sql`
    select id, profile_id, week_start, created_at, nutrition_snapshot
    from weekly_menus
    where profile_id = ${profileId} and user_id = ${localUserId()}
    order by created_at desc
    limit 12
  `
  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    weekStart: row.week_start,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    nutrition: row.nutrition_snapshot,
  }))
}

export async function getGenerationJobs(profileId: string, limit = 12): Promise<GenerationJobView[]> {
  const sql = sqlClient()
  const rows = await sql`
    select id, profile_id, weekly_menu_id, status, kind, failure_code, logs, result, error, retry_count, created_at, updated_at
    from generation_jobs
    where user_id = ${localUserId()} and profile_id = ${profileId}
    order by updated_at desc, created_at desc
    limit ${Math.max(1, Math.min(50, Math.round(limit)))}
  `
  return rows.map(generationJobFromRow)
}

export async function retryGenerationJob(jobId: string): Promise<RetryGenerationJobResult> {
  const sql = sqlClient()
  const [job] = await sql`
    select id, profile_id, status, kind
    from generation_jobs
    where id = ${jobId} and user_id = ${localUserId()}
  `
  if (!job) throw new Error('Trabajo de generación no encontrado.')
  if (job.status !== 'failed') throw new Error('Solo se pueden reintentar trabajos fallidos.')
  if (!job.profile_id) throw new Error('Este trabajo ya no tiene un perfil asociado.')
  const profile = (await listProfiles()).find((item) => item.id === job.profile_id)
  if (!profile) throw new Error('Perfil no encontrado para reintentar la generación.')
  if (!profile.latestTarget) throw new Error('El perfil no tiene objetivos de macros para reintentar la generación.')

  const retryJob = await enqueueWeeklyMenuGenerationJob(profile.id, undefined, profile.latestTarget, `retry_${String(job.kind).slice(0, 48)}`)
  await sql`
    update generation_jobs
    set retry_count = retry_count + 1,
      result = coalesce(result, '{}'::jsonb) || ${sql.json({ retriedAt: new Date().toISOString(), retriedByJobId: retryJob.id } as any)}::jsonb,
      updated_at = now()
    where id = ${jobId} and user_id = ${localUserId()}
  `
  const menu = await runGenerationJob(retryJob.id)
  return {
    retriedJobId: jobId,
    newJobId: retryJob.id,
    retryOfKind: String(job.kind),
    menu,
  }
}

function weeklyMenuJobInputFromResult(result: unknown): WeeklyMenuGenerationJobInput {
  const candidate = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as { jobInput?: Partial<WeeklyMenuGenerationJobInput> }).jobInput
    : null
  if (
    candidate &&
    typeof candidate.profileId === 'string' &&
    typeof candidate.macroTargetId === 'string' &&
    typeof candidate.kind === 'string' &&
    candidate.target &&
    typeof candidate.target === 'object' &&
    typeof (candidate.target as Partial<MacroTargets>).calories === 'number'
  ) {
    return candidate as WeeklyMenuGenerationJobInput
  }
  throw new Error('El trabajo no contiene input de generación semanal.')
}

async function countRows(query: Promise<Array<{ count: number | string }>>): Promise<number> {
  const [row] = await query
  return Number(row?.count ?? 0)
}

export async function lockMeal(menuMealId: string, locked: boolean): Promise<MenuMealView> {
  const sql = sqlClient()
  await sql`update menu_meals set locked = ${locked} where id = ${menuMealId} and user_id = ${localUserId()}`
  const menu = await menuForMeal(menuMealId)
  return menu.days.flatMap((day) => day.meals).find((meal) => meal.id === menuMealId)!
}

export async function lockDay(dayPlanId: string, locked: boolean): Promise<DayPlanView> {
  const sql = sqlClient()
  await sql`update day_plans set locked = ${locked} where id = ${dayPlanId} and user_id = ${localUserId()}`
  const [row] = await sql`select weekly_menu_id from day_plans where id = ${dayPlanId} and user_id = ${localUserId()}`
  if (!row) throw new Error('Día no encontrado.')
  const menu = await getWeeklyMenu(row.weekly_menu_id)
  return menu.days.find((day) => day.id === dayPlanId)!
}

export async function regenerateWeek(menuId: string): Promise<WeeklyMenuView> {
  return (await applyRegenerationPlan(await previewRegenerateWeekPlan(menuId))).menu
}

export async function previewRegenerateWeekPlan(menuId: string): Promise<RegenerationPlan> {
  const current = await getWeeklyMenu(menuId)
  const profile = await profileForMenu(current)
  const weekRecipes = await buildRecipesForWeek(profile, current.target)
  const decisions: RegenerationDecision[] = []
  for (const day of current.days) {
    const generatedDay = weekRecipes.days[day.dayIndex] ?? []
    for (const meal of day.meals) {
      const generated = generatedDay.find((item) => item.slot === meal.slot)
      if (day.locked || meal.locked || !generated) {
        decisions.push(preserveDecision(day, meal, day.locked ? 'Día bloqueado preservado.' : meal.locked ? 'Comida bloqueada preservada.' : 'No se generó candidato válido para esta comida.'))
        continue
      }
      decisions.push(replaceDecision(
        day,
        meal,
        generated.recipe,
        weekRecipes.fallbackSlots.includes(meal.slot) ? 'template' : 'llm',
        'Receta regenerada desde el plan semanal previsualizado.',
      ))
    }
  }
  return regenerationPlanFromDecisions({
    kind: 'week',
    menu: current,
    decisions,
    fallbackSlots: weekRecipes.fallbackSlots,
    trace: weekRecipes.trace,
  })
}

export async function previewCalorieAdjustmentPlan(profileId: string, calories: number): Promise<CalorieAdjustmentPlan> {
  const current = await getCurrentMenu(profileId)
  if (!current) throw new Error('Menú no encontrado.')
  if (!Number.isFinite(calories) || calories < 900 || calories > 5000) {
    throw new Error('El objetivo calórico debe estar entre 900 y 5000 kcal/día.')
  }

  const target = retargetCalories(current.target, Math.round(calories))
  const conflict = impossibleTargetConflict(target)
  if (conflict.impossible) throw new Error(conflict.messageEs)
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const savedRecipeIds = (await getSavedRecipes(profileId)).map((item) => item.recipe.id)
  const replacementCandidatesBySlot: Partial<Record<MealSlot, RecipeCandidate[]>> = {}
  for (const slot of mealSlots) {
    const pool = await recipePoolForSlot({
      profile,
      slot,
      count: 8,
      avoidFoods: profileAvoidedFoods(profile),
      avoidTitles: current.days.flatMap((day) => day.meals.filter((meal) => meal.slot === slot).map((meal) => meal.recipe.title)),
      targetNutrition: targetNutritionForSlot(target, slot),
      userRequest: `Genera candidatos alternativos para reajustar calorías en ${slotLabel(slot)} sin romper variedad semanal.`,
      menuContext: compactMenuForGeneration(current),
    })
    replacementCandidatesBySlot[slot] = pool.recipes.map((item) => item.recipe)
  }
  return buildCalorieAdjustmentPlan({
    profile: {
      id: profile.id,
      locale: profile.locale,
      likes: profile.likes,
      dislikes: profile.dislikes,
      bannedFoods: profile.bannedFoods,
    },
    currentMenu: toPlannerMenu(current),
    target,
    savedRecipeIds,
    replacementCandidatesBySlot,
  })
}

export async function adjustCaloriesAndRegenerateWeek(profileId: string, calories: number, plan?: CalorieAdjustmentPlan): Promise<WeeklyMenuView> {
  return (await applyCalorieAdjustmentPlan(profileId, calories, plan)).menu
}

export async function applyCalorieAdjustmentPlan(profileId: string, calories: number, plan?: CalorieAdjustmentPlan): Promise<AppliedCalorieAdjustmentResult> {
  const current = await getCurrentMenu(profileId)
  if (!current) throw new Error('Menú no encontrado.')
  if (!Number.isFinite(calories) || calories < 900 || calories > 5000) {
    throw new Error('El objetivo calórico debe estar entre 900 y 5000 kcal/día.')
  }

  const target = retargetCalories(current.target, Math.round(calories))
  const conflict = impossibleTargetConflict(target)
  if (conflict.impossible) throw new Error(conflict.messageEs)

  const resolvedPlan = plan ?? await previewCalorieAdjustmentPlan(profileId, calories)
  if (resolvedPlan.profileId !== profileId || resolvedPlan.targetCalories !== target.calories) {
    throw new Error('El plan de reajuste no corresponde a este perfil u objetivo calórico.')
  }
  if (resolvedPlan.baseMenuId !== current.id || resolvedPlan.baseMenuHash !== currentMenuHash(toPlannerMenu(current))) {
    throw new Error('El menú cambió desde que preparé el reajuste. Vuelve a pedir el cambio para generar un plan actualizado.')
  }
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')

  const targetId = await saveMacroTarget(profileId, target)
  const menu = await createWeeklyMenuFromCalorieAdjustmentPlan(profile, targetId, target, resolvedPlan)
  return {
    menu,
    plan: resolvedPlan,
    changeSummary: appliedSummaryFromPlan(resolvedPlan),
  }
}

export async function regenerateDay(dayPlanId: string): Promise<WeeklyMenuView> {
  return (await applyRegenerationPlan(await previewRegenerateDayPlan(dayPlanId))).menu
}

export async function regenerateMeal(menuMealId: string): Promise<WeeklyMenuView> {
  return (await applyRegenerationPlan(await previewRegenerateMealPlan(menuMealId))).menu
}

export async function previewRegenerateDayPlan(dayPlanId: string): Promise<RegenerationPlan> {
  const menu = await menuForDay(dayPlanId)
  const day = menu.days.find((item) => item.id === dayPlanId)
  if (!day) throw new Error('Día no encontrado.')
  const profile = await profileForMenu(menu)
  const decisions: RegenerationDecision[] = []
  const traces: Partial<Record<MealSlot, RecipePoolTrace>> = {}
  const fallbackSlots = new Set<MealSlot>()
  for (const meal of day.meals) {
    if (day.locked || meal.locked) {
      decisions.push(preserveDecision(day, meal, day.locked ? 'Día bloqueado preservado.' : 'Comida bloqueada preservada.'))
      continue
    }
    const candidate = await replacementDecisionForMeal(menu, day, meal, profile, `Regenera ${slotLabel(meal.slot)} con una receta nueva para este día, manteniendo variedad semanal.`)
    decisions.push(candidate.decision)
    traces[meal.slot] = candidate.trace
    if (candidate.source !== 'llm') fallbackSlots.add(meal.slot)
  }
  return regenerationPlanFromDecisions({
    kind: 'day',
    menu,
    targetDayPlanId: dayPlanId,
    decisions,
    fallbackSlots: [...fallbackSlots],
    trace: {
      fallbackAllowed: recipeTemplateFallbackAllowed(),
      slots: traces,
    },
  })
}

export async function previewRegenerateMealPlan(menuMealId: string): Promise<RegenerationPlan> {
  const menu = await menuForMeal(menuMealId)
  const day = menu.days.find((item) => item.meals.some((meal) => meal.id === menuMealId))
  const meal = day?.meals.find((item) => item.id === menuMealId)
  if (!day || !meal) throw new Error('Comida no encontrada.')
  const profile = await profileForMenu(menu)
  let decisions: RegenerationDecision[]
  let trace: Partial<Record<MealSlot, RecipePoolTrace>> = {}
  let fallbackSlots: MealSlot[] = []
  if (day.locked || meal.locked) {
    decisions = [preserveDecision(day, meal, day.locked ? 'Día bloqueado preservado.' : 'Comida bloqueada preservada.')]
  } else {
    const candidate = await replacementDecisionForMeal(menu, day, meal, profile, `Regenera ${slotLabel(meal.slot)} con una receta nueva, rica y coherente con el menú semanal.`)
    decisions = [candidate.decision]
    trace = { [meal.slot]: candidate.trace }
    fallbackSlots = candidate.source === 'llm' ? [] : [meal.slot]
  }
  return regenerationPlanFromDecisions({
    kind: 'meal',
    menu,
    targetDayPlanId: day.id,
    targetMenuMealId: menuMealId,
    decisions,
    fallbackSlots,
    trace: {
      fallbackAllowed: recipeTemplateFallbackAllowed(),
      slots: trace,
    },
  })
}

export async function applyRegenerationPlan(plan: RegenerationPlan): Promise<AppliedRegenerationPlanResult> {
  const current = await getWeeklyMenu(plan.baseMenuId)
  if (current.profileId !== plan.profileId || currentMenuHash(toPlannerMenu(current)) !== plan.baseMenuHash) {
    throw new Error('El menú cambió desde que preparé la regeneración. Vuelve a pedir el cambio para generar un plan actualizado.')
  }
  const menu = plan.kind === 'week'
    ? await createWeeklyMenuFromRegenerationPlan(current, plan)
    : await updateCurrentMenuFromRegenerationPlan(current, plan)
  return {
    menu,
    plan,
    changeSummary: summarizeRegenerationPlan(plan),
  }
}

export async function suggestMealReplacements(menuMealId: string, request: string): Promise<ReplacementProposal> {
  const menu = await menuForMeal(menuMealId)
  const day = menu.days.find((item) => item.meals.some((meal) => meal.id === menuMealId))
  const meal = day?.meals.find((item) => item.id === menuMealId)
  if (!day || !meal) throw new Error('Comida no encontrada.')
  const profile = (await listProfiles()).find((item) => item.id === menu.profileId)
  if (!profile) throw new Error('Perfil no encontrado.')

  const requestFeatures = parseReplacementRequest(request, menu, meal)
  const avoidedFoods = unique([...profileAvoidedFoods(profile), ...requestFeatures.avoidedFoods])
  const ranked = await rankReplacementCandidates({
    menu,
    day,
    meal,
    profile,
    avoidedFoods,
    requestFeatures,
  })
  if (ranked.length === 0) throw new Error('No encontré opciones que respeten ese cambio y mantengan el menú coherente.')
  const inferredIngredient = requestFeatures.avoidedFoods[0] ?? null
  const affectedMeals = inferredIngredient
    ? menu.days.flatMap((day) => day.meals).filter((item) => recipeIncludes(item.recipe, inferredIngredient)).map((item) => item.id)
    : [menuMealId]
  const options = selectReplacementOptions(ranked)

  return {
    proposalId: crypto.randomUUID(),
    inferredIngredient,
    affectedMeals,
    options,
  }
}

export async function replaceMeal(menuMealId: string, recipe: RecipeCandidate): Promise<WeeklyMenuView> {
  const menu = await menuForMeal(menuMealId)
  const day = menu.days.find((item) => item.meals.some((meal) => meal.id === menuMealId))
  const meal = day?.meals.find((item) => item.id === menuMealId)
  if (!day || !meal) throw new Error('Comida no encontrada.')
  if (day.locked || meal.locked) throw new Error('Este plato está bloqueado. Desbloquéalo antes de cambiarlo.')
  const profile = (await listProfiles()).find((item) => item.id === menu.profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  if (recipeIncludesAny(recipe, profile.bannedFoods)) throw new Error('La receta propuesta contiene un alimento prohibido para este perfil.')
  const scored = scoreRecipe(recipe, profile.bannedFoods)
  if (scored.nutrition.confidence === 'unknown') throw new Error('La receta propuesta tiene ingredientes sin nutrición determinista suficiente.')
  const recipeId = await persistRecipe(scored, 'replacement')
  const sql = sqlClient()
  await sql`
    update menu_meals set recipe_id = ${recipeId}, nutrition_snapshot = ${sql.json(scored.nutrition as any)}
    where id = ${menuMealId} and user_id = ${localUserId()}
  `
  await recalculateMenuNutrition(menu.id)
  return getWeeklyMenu(menu.id)
}

export async function applySimilarIngredientReplacements(
  profileId: string,
  menuMealIds: string[],
  ingredient: string,
): Promise<SimilarReplacementResult> {
  const current = await getCurrentMenu(profileId)
  if (!current) throw new Error('Menú no encontrado.')
  const unlockedIds: string[] = []
  const skippedLockedMealIds: string[] = []
  const requested = new Set(menuMealIds)
  for (const day of current.days) {
    for (const meal of day.meals) {
      if (!requested.has(meal.id)) continue
      if (day.locked || meal.locked) skippedLockedMealIds.push(meal.id)
      else unlockedIds.push(meal.id)
    }
  }

  let menu: WeeklyMenuView | null = current
  for (const [index, menuMealId] of unlockedIds.entries()) {
    const proposal = await suggestMealReplacements(menuMealId, `No quiero ${ingredient}`)
    const option = proposal.options[index % proposal.options.length] ?? proposal.options[0]
    if (option) menu = await replaceMeal(menuMealId, option.recipe)
  }
  await saveProfilePreference(profileId, ingredient, 'dislike', 'profile')
  return {
    changed: unlockedIds.length > 0,
    ingredient,
    replacedMealIds: unlockedIds,
    skippedLockedMealIds,
    menu,
  }
}

export async function saveProfilePreference(profileId: string, value: string, kind = 'dislike', scope = 'profile'): Promise<void> {
  const sql = sqlClient()
  await sql`
    insert into profile_preferences (user_id, profile_id, scope, kind, value, strength)
    values (${localUserId()}, ${profileId}, ${scope}, ${kind}, ${value}, 'confirmed')
  `
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) return
  const likes = unique(kind === 'like' ? [...profile.likes, value] : profile.likes)
  const dislikes = unique(kind === 'dislike' || kind === 'ban' ? [...profile.dislikes, value] : profile.dislikes)
  const bannedFoods = unique(kind === 'ban' ? [...profile.bannedFoods, value] : profile.bannedFoods)
  await sql`
    update profiles set
      likes = ${sql.json(likes as any)},
      dislikes = ${sql.json(dislikes as any)},
      banned_foods = ${sql.json(bannedFoods as any)},
      updated_at = now()
    where id = ${profileId} and user_id = ${localUserId()}
  `
}

export async function starRecipe(profileId: string, recipeId: string): Promise<void> {
  const sql = sqlClient()
  await sql`
    insert into saved_recipes (user_id, profile_id, recipe_id)
    values (${localUserId()}, ${profileId}, ${recipeId})
    on conflict (profile_id, recipe_id) do nothing
  `
}

export async function unstarRecipe(savedRecipeId: string): Promise<void> {
  const sql = sqlClient()
  await sql`delete from saved_recipes where id = ${savedRecipeId} and user_id = ${localUserId()}`
}

export async function getSavedRecipes(profileId: string): Promise<SavedRecipeView[]> {
  const sql = sqlClient()
  const rows = await sql`
    select sr.id as saved_recipe_id, r.*
    from saved_recipes sr
    join recipes r on r.id = sr.recipe_id
    where sr.profile_id = ${profileId} and sr.user_id = ${localUserId()}
    order by sr.created_at desc
  `
  const result: SavedRecipeView[] = []
  for (const row of rows) result.push({ savedRecipeId: row.saved_recipe_id, recipe: { ...(await recipeFromRow(row)), saved: true } })
  return result
}

export async function shutdown(): Promise<void> {
  await closeDb()
}

async function createWeeklyMenuFromCalorieAdjustmentPlan(
  profile: ProfileRow,
  targetId: string,
  target: MacroTargets,
  plan: CalorieAdjustmentPlan,
): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const [menu] = await sql<[{ id: string }]>`
    insert into weekly_menus (user_id, profile_id, macro_target_id, week_start, locale, status, generation_settings, nutrition_snapshot)
    values (
      ${localUserId()}, ${profile.id}, ${targetId}, ${currentWeekStart()}, ${profile.locale}, 'completed',
      ${sql.json({
        kind: 'hybrid_calorie_adjustment',
        planId: plan.planId,
        baseMenuId: plan.baseMenuId,
        baseMenuHash: plan.baseMenuHash,
        decisionCounts: plan.decisionCounts,
        weeklyImpact: plan.weeklyImpact,
        warnings: plan.warnings,
      } as any)},
      ${sql.json(plan.plannedWeeklyNutrition as any)}
    )
    returning id
  `
  if (!menu) throw new Error('No se pudo crear el menú reajustado.')

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayDecisions = plan.decisions
      .filter((decision) => decision.dayIndex === dayIndex)
      .sort((left, right) => mealSlots.indexOf(left.slot) - mealSlots.indexOf(right.slot))
    const [day] = await sql<[{ id: string }]>`
      insert into day_plans (user_id, weekly_menu_id, day_index, locked)
      values (${localUserId()}, ${menu.id}, ${dayIndex}, ${dayDecisions.some((decision) => decision.dayLocked)})
      returning id
    `
    if (!day) throw new Error('No se pudo crear el día reajustado.')

    for (const decision of dayDecisions) {
      const recipeId = decision.kind === 'preserve_locked' && decision.existingRecipeId
        ? decision.existingRecipeId
        : await persistRecipe(scoreRecipe(decision.recipe, profile.bannedFoods), decision.kind)
      await sql`
        insert into menu_meals (user_id, day_plan_id, recipe_id, slot, locked, nutrition_snapshot)
        values (${localUserId()}, ${day.id}, ${recipeId}, ${decision.slot}, ${decision.locked}, ${sql.json(decision.nutrition as any)})
      `
    }
  }

  await recalculateMenuNutrition(menu.id)
  return getWeeklyMenu(menu.id)
}

async function createWeeklyMenuFromRegenerationPlan(
  current: WeeklyMenuView,
  plan: RegenerationPlan,
): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const profile = await profileForMenu(current)
  const targetId = await saveMacroTarget(current.profileId, current.target)
  const plannedWeeklyNutrition = sumNutrition(plan.decisions.map((decision) => decision.nutrition))
  const [menu] = await sql<[{ id: string }]>`
    insert into weekly_menus (user_id, profile_id, macro_target_id, week_start, locale, status, generation_settings, nutrition_snapshot)
    values (
      ${localUserId()}, ${current.profileId}, ${targetId}, ${currentWeekStart()}, ${current.locale}, 'completed',
      ${sql.json(regenerationGenerationSettings(plan, plannedWeeklyNutrition) as any)},
      ${sql.json(plannedWeeklyNutrition as any)}
    )
    returning id
  `
  if (!menu) throw new Error('No se pudo crear el menú regenerado.')

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayDecisions = plan.decisions
      .filter((decision) => decision.dayIndex === dayIndex)
      .sort((left, right) => mealSlots.indexOf(left.slot) - mealSlots.indexOf(right.slot))
    const [day] = await sql<[{ id: string }]>`
      insert into day_plans (user_id, weekly_menu_id, day_index, locked)
      values (${localUserId()}, ${menu.id}, ${dayIndex}, ${dayDecisions.some((decision) => decision.dayLocked)})
      returning id
    `
    if (!day) throw new Error('No se pudo crear el día regenerado.')

    for (const decision of dayDecisions) {
      const recipeId = await recipeIdForRegenerationDecision(profile, decision)
      await sql`
        insert into menu_meals (user_id, day_plan_id, recipe_id, slot, locked, nutrition_snapshot)
        values (${localUserId()}, ${day.id}, ${recipeId}, ${decision.slot}, ${decision.locked}, ${sql.json(decision.nutrition as any)})
      `
    }
  }

  await recalculateMenuNutrition(menu.id)
  return getWeeklyMenu(menu.id)
}

async function updateCurrentMenuFromRegenerationPlan(
  current: WeeklyMenuView,
  plan: RegenerationPlan,
): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const profile = await profileForMenu(current)
  for (const decision of plan.decisions) {
    if (decision.kind === 'preserve_locked') continue
    const recipeId = await recipeIdForRegenerationDecision(profile, decision)
    await sql`
      update menu_meals set recipe_id = ${recipeId}, nutrition_snapshot = ${sql.json(decision.nutrition as any)}
      where id = ${decision.menuMealId} and user_id = ${localUserId()}
    `
  }
  await sql`
    update weekly_menus set generation_settings = ${sql.json({
      ...current.generationSettings,
      lastRegenerationPlan: regenerationGenerationSettings(plan, sumNutrition(plan.decisions.map((decision) => decision.nutrition))),
    } as any)}
    where id = ${current.id} and user_id = ${localUserId()}
  `
  await recalculateMenuNutrition(current.id)
  return getWeeklyMenu(current.id)
}

async function recipeIdForRegenerationDecision(profile: ProfileRow, decision: RegenerationDecision): Promise<string> {
  if (decision.kind === 'preserve_locked' && decision.existingRecipeId) return decision.existingRecipeId
  const source = decision.source === 'llm' ? 'llm_regenerated' : 'template_regenerated'
  return persistRecipe(scoreRecipe(decision.recipe, profile.bannedFoods), source)
}

async function replacementDecisionForMeal(
  menu: WeeklyMenuView,
  day: DayPlanView,
  meal: MenuMealView,
  profile: ProfileRow,
  userRequest: string,
): Promise<{ decision: RegenerationDecision; trace: RecipePoolTrace; source: 'llm' | 'template' }> {
  const sameDayTitles = day.meals
    .filter((item) => item.id !== meal.id)
    .map((item) => item.recipe.title)
  const pool = await recipePoolForSlot({
    profile,
    slot: meal.slot,
    count: 8,
    avoidFoods: profileAvoidedFoods(profile),
    avoidTitles: [meal.recipe.title, ...sameDayTitles],
    targetNutrition: targetNutritionForSlot(menu.target, meal.slot),
    userRequest,
    menuContext: compactMenuForGeneration(menu),
  })
  const candidate = chooseReplacementCandidate(pool.recipes, menu, day, meal, menu.target)
  if (!candidate) throw new Error(`No encontré una receta válida para ${slotLabel(meal.slot)}.`)
  return {
    decision: replaceDecision(
      day,
      meal,
      candidate.recipe,
      candidate.source,
      'Receta candidata generada y validada contra el día y la semana antes de confirmar.',
    ),
    trace: pool.trace,
    source: candidate.source,
  }
}

function regenerationPlanFromDecisions(input: {
  kind: RegenerationPlanKind
  menu: WeeklyMenuView
  targetDayPlanId?: string
  targetMenuMealId?: string
  decisions: RegenerationDecision[]
  fallbackSlots: MealSlot[]
  trace: RegenerationPlan['trace']
}): RegenerationPlan {
  const decisionCounts = countRegenerationDecisions(input.decisions)
  const warnings = regenerationWarnings(input.decisions, input.fallbackSlots)
  const plannedWeeklyNutrition = sumNutrition(input.decisions.map((decision) => decision.nutrition))
  const summaryMarkdown = regenerationPlanSummary({
    kind: input.kind,
    menu: input.menu,
    decisions: input.decisions,
    decisionCounts,
    warnings,
    plannedWeeklyNutrition,
  })
  return {
    planId: randomUUID(),
    kind: input.kind,
    profileId: input.menu.profileId,
    baseMenuId: input.menu.id,
    baseMenuHash: currentMenuHash(toPlannerMenu(input.menu)),
    targetDayPlanId: input.targetDayPlanId,
    targetMenuMealId: input.targetMenuMealId,
    affectedMealIds: input.decisions.filter((decision) => decision.kind !== 'preserve_locked').map((decision) => decision.menuMealId),
    preservedMealIds: input.decisions.filter((decision) => decision.kind === 'preserve_locked').map((decision) => decision.menuMealId),
    decisionCounts,
    fallbackSlots: Array.from(new Set(input.fallbackSlots)),
    decisions: input.decisions,
    warnings,
    trace: input.trace,
    summaryMarkdown,
    confirmationMarkdown: `${summaryMarkdown}\n\n¿Aplicar esta regeneración?`,
  }
}

function preserveDecision(day: DayPlanView, meal: MenuMealView, reason: string): RegenerationDecision {
  return {
    dayIndex: day.dayIndex,
    dayId: day.id,
    dayLocked: day.locked,
    slot: meal.slot,
    menuMealId: meal.id,
    locked: meal.locked,
    kind: 'preserve_locked',
    reason,
    previousRecipeId: meal.recipe.id,
    previousTitle: meal.recipe.title,
    nextTitle: meal.recipe.title,
    existingRecipeId: meal.recipe.id,
    recipe: recipeCandidateFromRecipe(meal.recipe),
    nutrition: meal.nutrition,
    previousNutrition: meal.nutrition,
    delta: diffNutrition(meal.nutrition, meal.nutrition),
    source: 'existing',
  }
}

function replaceDecision(
  day: DayPlanView,
  meal: MenuMealView,
  recipe: RecipeCandidate & { nutrition?: NutritionTotals },
  source: 'llm' | 'template',
  reason: string,
): RegenerationDecision {
  const candidate = recipeCandidateFromRecipe(recipe)
  const nutrition = recipe.nutrition ?? scoreRecipe(candidate).nutrition
  return {
    dayIndex: day.dayIndex,
    dayId: day.id,
    dayLocked: day.locked,
    slot: meal.slot,
    menuMealId: meal.id,
    locked: meal.locked,
    kind: 'recipe_replacement',
    reason,
    previousRecipeId: meal.recipe.id,
    previousTitle: meal.recipe.title,
    nextTitle: candidate.title,
    recipe: candidate,
    nutrition,
    previousNutrition: meal.nutrition,
    delta: diffNutrition(nutrition, meal.nutrition),
    source,
  }
}

function recipeCandidateFromRecipe(recipe: RecipeView | RecipeCandidate): RecipeCandidate {
  return {
    title: recipe.title,
    locale: recipe.locale === 'en' ? 'en' : 'es',
    description: recipe.description,
    servings: 1,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cuisine: recipe.cuisine,
    flavorProfile: recipe.flavorProfile,
    tags: [...recipe.tags],
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      amount: ingredient.amount,
      unit: ingredient.unit,
      preparation: ingredient.preparation ?? undefined,
    })),
    steps: [...recipe.steps],
  }
}

function countRegenerationDecisions(decisions: RegenerationDecision[]): Record<RegenerationDecisionKind, number> {
  return {
    recipe_replacement: decisions.filter((decision) => decision.kind === 'recipe_replacement').length,
    preserve_locked: decisions.filter((decision) => decision.kind === 'preserve_locked').length,
  }
}

function regenerationWarnings(decisions: RegenerationDecision[], fallbackSlots: MealSlot[]): string[] {
  const warnings: string[] = []
  const locked = decisions.filter((decision) => decision.kind === 'preserve_locked').length
  if (locked > 0) warnings.push(`${locked} comida(s) bloqueadas se conservarán exactamente.`)
  if (fallbackSlots.length > 0) {
    warnings.push(`Se usó fallback determinístico en ${Array.from(new Set(fallbackSlots)).map(slotLabel).join(', ')} porque no hubo suficientes candidatos LLM válidos.`)
  }
  return warnings
}

function regenerationPlanSummary(input: {
  kind: RegenerationPlanKind
  menu: WeeklyMenuView
  decisions: RegenerationDecision[]
  decisionCounts: Record<RegenerationDecisionKind, number>
  warnings: string[]
  plannedWeeklyNutrition: NutritionTotals
}): string {
  const changed = input.decisions.filter((decision) => decision.kind === 'recipe_replacement')
  const weeklyDelta = diffNutrition(input.plannedWeeklyNutrition, input.menu.nutrition)
  const scope = input.kind === 'week' ? 'la semana' : input.kind === 'day' ? 'el día' : 'la comida'
  const replacements = changed
    .slice(0, 6)
    .map((decision) => `- ${dayName(decision.dayIndex)} ${slotLabel(decision.slot)}: ${decision.previousTitle} -> ${decision.nextTitle} (${formatSigned(decision.delta.calories)} kcal)`)
  const lines = [
    `Preparé una regeneración de **${scope}**. Todavía no he cambiado el menú.`,
    `**Cambios previstos:** ${input.decisionCounts.recipe_replacement} reemplazo(s); ${input.decisionCounts.preserve_locked} comida(s) preservadas por lock o falta de candidato válido.`,
    `**Impacto semanal estimado:** ${formatSigned(weeklyDelta.calories)} kcal, ${formatSigned(weeklyDelta.proteinG)} g proteína, ${formatSigned(weeklyDelta.carbsG)} g carbos, ${formatSigned(weeklyDelta.fatG)} g grasa.`,
  ]
  if (replacements.length > 0) lines.push(`**Recetas que cambiarían:**\n${replacements.join('\n')}`)
  if (input.warnings.length > 0) lines.push(`**Avisos:**\n${input.warnings.map((warning) => `- ${warning}`).join('\n')}`)
  lines.push('Si el menú cambia antes de confirmar, rechazaré este plan y pediré una nueva previsualización.')
  return lines.join('\n\n')
}

function summarizeRegenerationPlan(plan: RegenerationPlan): string {
  return plan.summaryMarkdown
    .replace('Preparé una regeneración', 'Apliqué una regeneración')
    .replace('Todavía no he cambiado el menú.', 'El menú ya quedó actualizado.')
    .replace('Recetas que cambiarían:', 'Recetas reemplazadas:')
}

function regenerationGenerationSettings(plan: RegenerationPlan, plannedWeeklyNutrition: NutritionTotals): Record<string, unknown> {
  return {
    kind: 'regeneration_plan',
    regenerationKind: plan.kind,
    planId: plan.planId,
    baseMenuId: plan.baseMenuId,
    baseMenuHash: plan.baseMenuHash,
    decisionCounts: plan.decisionCounts,
    fallbackSlots: plan.fallbackSlots,
    fallbackAllowed: plan.trace.fallbackAllowed,
    recipeSource: plan.fallbackSlots.length === 0 ? 'llm' : plan.fallbackSlots.length === mealSlots.length ? 'template' : 'mixed',
    plannedWeeklyNutrition,
    warnings: plan.warnings,
    trace: plan.trace,
  }
}

async function buildRecipesForWeek(profile: ProfileRow, targets: MacroTargets): Promise<{
  days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>
  source: 'llm' | 'template' | 'mixed'
  fallbackSlots: MealSlot[]
  skeleton: WeekSkeleton
  skeletonTrace: WeekSkeletonTrace
  repair: WeekRepairTrace
  trace: {
    fallbackAllowed: boolean
    slots: Record<MealSlot, RecipePoolTrace>
  }
}> {
  const skeletonResult = await buildWeekSkeleton(profile, targets)
  const pools = new Map<MealSlot, RecipePoolResult>()
  for (const slot of mealSlots) {
    const slotSkeleton = skeletonResult.skeleton.days.map((day) => ({
      dayIndex: day.dayIndex,
      meal: skeletonMeal(day, slot),
    }))
    pools.set(slot, await recipePoolForSlot({
      profile,
      slot,
      count: 12,
      avoidFoods: profileAvoidedFoods(profile),
      avoidTitles: [],
      targetNutrition: targetNutritionForSlot(targets, slot),
      userRequest: [
        `Genera opciones variadas para ${slotLabel(slot)} de una semana completa.`,
        'Estas recetas deben poder cubrir el siguiente esqueleto semanal de intenciones:',
        ...slotSkeleton.map((item) => `${dayName(item.dayIndex)}: ${item.meal?.intent ?? 'variedad equilibrada'}`),
      ].join('\n'),
      menuContext: {
        target: targets,
        weekSkeleton: skeletonResult.skeleton,
        slotSkeleton,
        existingTitles: [],
      },
    }))
  }

  const titleCounts = new Map<string, number>()
  const days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>> = []
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayItems: Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }> = []
    for (const slot of mealSlots) {
      const pool = pools.get(slot)
      if (!pool || pool.recipes.length === 0) throw new Error(`No hay receta disponible para ${slot}.`)
      const recipe = chooseWeekRecipe(pool.recipes, {
        slot,
        target: targetNutritionForSlot(targets, slot),
        dayItems,
        titleCounts,
        dayIndex,
        skeletonMeal: skeletonMeal(skeletonResult.skeleton.days[dayIndex]!, slot),
      })
      dayItems.push({ slot, recipe })
      const title = normalizeIngredientName(recipe.title)
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
    }
    days.push(dayItems)
  }
  const repair = repairWeekRecipeSelection(days, pools, targets)

  const fallbackSlots = mealSlots.filter((slot) => pools.get(slot)?.source !== 'llm')
  const slotTraces = Object.fromEntries(mealSlots.map((slot) => [slot, pools.get(slot)!.trace])) as Record<MealSlot, RecipePoolTrace>
  return {
    days,
    source: fallbackSlots.length === 0 ? 'llm' : fallbackSlots.length === mealSlots.length ? 'template' : 'mixed',
    fallbackSlots,
    skeleton: skeletonResult.skeleton,
    skeletonTrace: skeletonResult.trace,
    repair,
    trace: {
      fallbackAllowed: recipeTemplateFallbackAllowed(),
      slots: slotTraces,
    },
  }
}

async function buildWeekSkeleton(profile: ProfileRow, targets: MacroTargets): Promise<{
  skeleton: WeekSkeleton
  trace: WeekSkeletonTrace
}> {
  const generationInput: WeekSkeletonGenerationInput = {
    locale: profile.locale,
    profileName: profile.name,
    mealSlots,
    target: targets,
    likes: profile.likes,
    dislikes: profile.dislikes,
    bannedFoods: profile.bannedFoods,
    maxPrepTimeMinutes: 120,
  }
  const result = await generateWeekSkeletonCached(generationInput)
  if (result.source === 'llm' && result.skeleton) {
    return {
      skeleton: result.skeleton,
      trace: {
        providerConfigured: result.providerConfigured,
        providerSource: result.source,
        cacheHit: Boolean(result.cacheHit),
        fallbackAllowed: weekSkeletonFallbackAllowed(),
        fallbackUsed: false,
        fallbackReason: 'none',
        error: result.error,
      },
    }
  }

  const fallbackAllowed = weekSkeletonFallbackAllowed()
  if (!fallbackAllowed) {
    throw new Error(`No se pudo generar el esqueleto semanal con LLM. El fallback determinístico está desactivado por ALLOW_WEEK_SKELETON_FALLBACK=false.`)
  }

  return {
    skeleton: deterministicWeekSkeleton(profile, targets),
    trace: {
      providerConfigured: result.providerConfigured,
      providerSource: result.source,
      cacheHit: Boolean(result.cacheHit),
      fallbackAllowed,
      fallbackUsed: true,
      fallbackReason: result.source === 'unavailable' ? 'provider_unavailable' : 'provider_failed',
      error: result.error,
    },
  }
}

async function generateWeekSkeletonCached(input: WeekSkeletonGenerationInput): Promise<WeekSkeletonGenerationResult> {
  const cached = await readAiCache<WeekSkeletonGenerationResult>(WEEK_SKELETON_SCHEMA_VERSION, input)
  if (cached) return { ...cached, cacheHit: true }
  const result = await generateWeekSkeleton(input)
  if (result.source === 'llm' && result.skeleton) {
    await writeAiCache(WEEK_SKELETON_SCHEMA_VERSION, input, { ...result, cacheHit: false })
  }
  return { ...result, cacheHit: false }
}

export function deterministicWeekSkeleton(profile: ProfileRow, targets: MacroTargets): WeekSkeleton {
  const slotIntents: Record<MealSlot, string[]> = {
    breakfast: [
      'bol alto en proteína con lácteo, cereal integral y fruta',
      'tostada salada con huevo o pescado, verdura fresca y grasa moderada',
      'desayuno rápido con yogur, avena y fruta de temporada',
      'plato templado con proteína magra, patata o pan integral y verduras',
      'opción dulce equilibrada con lácteo, fruta y frutos secos medidos',
      'tostada crujiente con proteína magra y tomate o espinacas',
      'bol saciante con cereal integral, proteína láctea y fruta',
    ],
    lunch: [
      'plato principal mediterráneo con proteína magra, arroz o patata y verduras',
      'ensalada completa templada con legumbre o pescado, tubérculo y hortalizas',
      'bol de grano integral con proteína alta y verduras de color diferente',
      'plato casero de carne magra o pescado con carbohidrato moderado y vegetales',
      'comida saciante con legumbre, verdura y complemento proteico',
      'plato de pescado o pollo con patata, arroz o pasta y ensalada fresca',
      'comida de cuchara ligera con proteína suficiente y carbohidrato controlado',
    ],
    dinner: [
      'cena ligera pero completa con proteína magra y verduras cocinadas',
      'plato templado con pescado o pollo, carbohidrato ajustado y hortalizas',
      'cena mediterránea con legumbre moderada, verduras y proteína complementaria',
      'salteado o plancha con proteína alta, verduras y carbohidrato pequeño',
      'cena saciante baja en grasa con patata, arroz o pan medido',
      'plato sencillo de huevo, pescado o ave con verduras distintas a la comida',
      'cena casera equilibrada con textura diferente al almuerzo',
    ],
    snack: [
      'snack proteico rápido con fruta o cereal simple',
      'lácteo alto en proteína con fruta y textura crujiente',
      'tostada o bocado salado pequeño con proteína magra',
      'snack dulce controlado con yogur, avena o fruta',
      'opción fresca alta en proteína y baja en preparación',
      'bocado saciante con carbohidrato fácil de ajustar',
      'snack ligero que complete proteína sin repetir el desayuno',
    ],
  }
  const modifier = targets.goal === 'cut'
    ? 'Priorizar volumen, proteína y saciedad sin subir grasa.'
    : targets.goal === 'bulk'
      ? 'Priorizar energía útil con carbohidratos compatibles y proteína suficiente.'
      : 'Mantener equilibrio y variedad semanal.'
  const preferenceHint = profile.likes.length > 0 ? ` Incluir cuando encaje: ${profile.likes.slice(0, 3).join(', ')}.` : ''
  return {
    days: Array.from({ length: 7 }, (_, dayIndex) => ({
      dayIndex,
      meals: mealSlots.map((slot) => {
        const intent = `${slotIntents[slot][dayIndex % slotIntents[slot].length]}. ${modifier}${preferenceHint}`
        return {
          slot,
          intent,
          avoidRepeating: [
            slotIntents[slot][(dayIndex + 6) % slotIntents[slot].length] ?? '',
            ...profile.dislikes.slice(0, 3),
            ...profile.bannedFoods.slice(0, 3),
          ].filter((item): item is string => Boolean(item)),
        }
      }),
    })),
  }
}

function skeletonMeal(day: WeekSkeleton['days'][number], slot: MealSlot): WeekSkeletonMeal | undefined {
  return day.meals.find((meal) => meal.slot === slot)
}

async function recipePoolForSlot(input: {
  profile: ProfileRow
  slot: MealSlot
  count: number
  avoidFoods: string[]
  avoidTitles: string[]
  targetNutrition: NutritionTotals
  userRequest?: string
  menuContext?: unknown
}): Promise<RecipePoolResult> {
  const avoidFoods = unique([...input.profile.bannedFoods, ...input.profile.dislikes, ...input.avoidFoods])
  const generationInput: RecipeGenerationInput = {
    locale: input.profile.locale,
    slot: input.slot,
    count: input.count,
    profileName: input.profile.name,
    likes: input.profile.likes,
    dislikes: input.profile.dislikes,
    bannedFoods: input.profile.bannedFoods,
    avoidFoods,
    avoidTitles: input.avoidTitles,
    userRequest: input.userRequest,
    targetNutrition: input.targetNutrition,
    menuContext: input.menuContext,
    allowedIngredients: seedFoods.flatMap((food) => food.aliases.slice(0, 2)),
  }
  const llmResult = await generateRecipeCandidatesCached(generationInput)
  const llmRecipes = scoreGeneratedCandidates({
    candidates: llmResult.recipes,
    avoidedFoods: avoidFoods,
    avoidTitles: input.avoidTitles,
    targetNutrition: input.targetNutrition,
    source: 'llm',
    limit: input.count,
  })
  if (llmRecipes.length >= Math.min(input.count, 3)) {
    return {
      recipes: llmRecipes,
      source: 'llm',
      llmResult,
      trace: {
        requestedCount: input.count,
        providerConfigured: llmResult.providerConfigured,
        providerSource: llmResult.source,
        cacheHit: Boolean(llmResult.cacheHit),
        llmRawCandidateCount: llmResult.recipes.length,
        acceptedLlmCandidateCount: llmRecipes.length,
        fallbackAllowed: recipeTemplateFallbackAllowed(),
        fallbackUsed: false,
        fallbackReason: 'none',
        fallbackCandidateCount: 0,
        returnedCandidateCount: llmRecipes.length,
        error: llmResult.error,
      },
    }
  }

  const fallbackAllowed = recipeTemplateFallbackAllowed()
  const fallbackReason = recipeFallbackReason(llmResult, llmRecipes.length)
  if (!fallbackAllowed) {
    throw new Error(`No hay suficientes recetas LLM válidas para ${slotLabel(input.slot)} (${llmRecipes.length}/${Math.min(input.count, 3)}). El fallback determinístico está desactivado por ALLOW_RECIPE_TEMPLATE_FALLBACK=false.`)
  }

  const templateRecipes = scoreGeneratedCandidates({
    candidates: templatesForSlot(input.slot, avoidFoods, input.profile.locale),
    avoidedFoods: avoidFoods,
    avoidTitles: input.avoidTitles,
    targetNutrition: input.targetNutrition,
    source: 'template',
    limit: input.count,
  })
  const seen = new Set(llmRecipes.map((item) => normalizeIngredientName(item.recipe.title)))
  const merged = [
    ...llmRecipes,
    ...templateRecipes.filter((item) => !seen.has(normalizeIngredientName(item.recipe.title))),
  ].slice(0, input.count)
  const source = templateRecipes.length === 0 && llmRecipes.length > 0
    ? 'llm'
    : llmRecipes.length > 0
      ? 'mixed'
      : 'template'
  return {
    recipes: merged,
    source,
    llmResult,
    trace: {
      requestedCount: input.count,
      providerConfigured: llmResult.providerConfigured,
      providerSource: llmResult.source,
      cacheHit: Boolean(llmResult.cacheHit),
      llmRawCandidateCount: llmResult.recipes.length,
      acceptedLlmCandidateCount: llmRecipes.length,
      fallbackAllowed,
      fallbackUsed: templateRecipes.length > 0,
      fallbackReason,
      fallbackCandidateCount: templateRecipes.length,
      returnedCandidateCount: merged.length,
      error: llmResult.error,
    },
  }
}

async function generateRecipeCandidatesCached(input: RecipeGenerationInput): Promise<RecipeGenerationResult> {
  const cached = await readAiCache<RecipeGenerationResult>(RECIPE_GENERATION_SCHEMA_VERSION, input)
  if (cached) return { ...cached, cacheHit: true }
  const result = await generateRecipeCandidates(input)
  if (result.source === 'llm' && result.recipes.length > 0) {
    await writeAiCache(RECIPE_GENERATION_SCHEMA_VERSION, input, { ...result, cacheHit: false })
  }
  return { ...result, cacheHit: false }
}

async function readAiCache<T>(schemaVersion: string, input: unknown): Promise<T | null> {
  const status = codexStatus()
  const inputHash = aiCacheInputHash(schemaVersion, input, status.model, status.reasoningEffort)
  const sql = sqlClient()
  const [cached] = await sql<[{ output: T }]>`
    select output from ai_cache
    where input_hash = ${inputHash}
      and model = ${status.model}
      and schema_version = ${schemaVersion}
    order by created_at desc
    limit 1
  `
  return cached?.output ?? null
}

async function writeAiCache(schemaVersion: string, input: unknown, output: unknown): Promise<void> {
  const status = codexStatus()
  const inputHash = aiCacheInputHash(schemaVersion, input, status.model, status.reasoningEffort)
  const sql = sqlClient()
  await sql`
    insert into ai_cache (input_hash, model, schema_version, output)
    values (${inputHash}, ${status.model}, ${schemaVersion}, ${sql.json(output as any)})
  `
}

function aiCacheInputHash(schemaVersion: string, input: unknown, model: string, reasoningEffort: string): string {
  return hashStableJson({
    schemaVersion,
    model,
    reasoningEffort,
    input,
  })
}

function recipeTemplateFallbackAllowed(): boolean {
  loadDotEnv()
  return String(process.env.ALLOW_RECIPE_TEMPLATE_FALLBACK ?? 'true').toLowerCase() !== 'false'
}

function weekSkeletonFallbackAllowed(): boolean {
  loadDotEnv()
  return String(process.env.ALLOW_WEEK_SKELETON_FALLBACK ?? 'true').toLowerCase() !== 'false'
}

function recipeFallbackReason(result: RecipeGenerationResult, acceptedCount: number): RecipePoolTrace['fallbackReason'] {
  if (result.source === 'unavailable') return 'provider_unavailable'
  if (result.source === 'failed') return 'provider_failed'
  return 'too_few_valid_candidates'
}

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
}

function scoreGeneratedCandidates(input: {
  candidates: RecipeCandidate[]
  avoidedFoods: string[]
  avoidTitles: string[]
  targetNutrition: NutritionTotals
  source: 'llm' | 'template'
  limit: number
}): GeneratedScoredRecipe[] {
  const avoidedTitles = new Set(input.avoidTitles.map(normalizeIngredientName))
  const seen = new Set<string>()
  const scored: Array<GeneratedScoredRecipe & { fitScore: number }> = []
  for (const candidate of input.candidates) {
    const title = normalizeIngredientName(candidate.title)
    if (!title || seen.has(title) || avoidedTitles.has(title)) continue
    seen.add(title)
    if (candidate.prepTimeMinutes > 120) continue
    if (recipeIncludesAny(candidate, input.avoidedFoods)) continue

    const raw = scoreRecipe(candidate, input.avoidedFoods)
    if (hasUnknownIngredients(raw)) continue
    const factor = clamp(input.targetNutrition.calories / Math.max(raw.nutrition.calories, 1), 0.72, 1.28)
    const scaled = scoreRecipe(scaleRecipe(candidate, factor), input.avoidedFoods)
    if (hasUnknownIngredients(scaled)) continue
    scored.push({
      recipe: scaled,
      source: input.source,
      fitScore: recipeFitScore(scaled.nutrition, input.targetNutrition),
    })
  }
  return scored.sort((left, right) => right.fitScore - left.fitScore).slice(0, input.limit)
}

function chooseWeekRecipe(input: GeneratedScoredRecipe[], context: {
  slot: MealSlot
  target: NutritionTotals
  dayItems: Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>
  titleCounts: Map<string, number>
  dayIndex: number
  skeletonMeal?: WeekSkeletonMeal
}): ReturnType<typeof scoreRecipe> {
  const scored = input.map((item) => {
    const title = normalizeIngredientName(item.recipe.title)
    const repeatCount = context.titleCounts.get(title) ?? 0
    const sameDay = context.dayItems.some((existing) => normalizeIngredientName(existing.recipe.title) === title)
    const score = recipeFitScore(item.recipe.nutrition, context.target) -
      repeatCount * 45 -
      (sameDay ? 120 : 0) +
      (item.source === 'llm' ? 8 : 0) -
      Math.abs((context.dayIndex % 3) - (title.length % 3)) * 0.5 +
      skeletonFitScore(item.recipe, context.skeletonMeal)
    return { item, score }
  })
  return scored.sort((left, right) => right.score - left.score)[0]?.item.recipe ?? input[0]!.recipe
}

export function repairWeekRecipeSelection(
  days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>,
  pools: Map<MealSlot, RecipePoolResult>,
  targets: MacroTargets,
): WeekRepairTrace {
  const maxAttempts = 2
  const issuesBefore = evaluateWeekRecipeSelection(days, targets)
  const actions: WeekRepairAction[] = []
  const repairRequests: WeekRepairRequest[] = []
  const repairResults: WeekRepairResult[] = []
  if (issuesBefore.length === 0) {
    return { attempted: false, maxAttempts, issuesBefore, repairRequests, repairResults, actions, issuesAfter: [], repaired: true }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const issues = evaluateWeekRecipeSelection(days, targets)
    if (issues.length === 0) break
    let changed = false
    for (const issue of issues) {
      repairRequests.push(repairRequestFromIssue(issue, attempt, maxAttempts))
      const replacement = findRepairReplacement(days, pools, targets, issue)
      if (!replacement) {
        repairResults.push({
          repaired: false,
          retry: attempt < maxAttempts,
          notes: ['No se encontró un reemplazo que mejorara el menú completo.'],
          attempt,
          reason: issue.reason,
          dayIndex: issue.dayIndex,
          slot: issue.slot,
          actionCount: 0,
        })
        continue
      }
      const previous = days[replacement.dayIndex]![replacement.mealIndex]!
      days[replacement.dayIndex]![replacement.mealIndex] = {
        slot: previous.slot,
        recipe: replacement.candidate.recipe,
      }
      const action = {
        attempt,
        reason: issue.reason,
        dayIndex: replacement.dayIndex,
        slot: previous.slot,
        previousTitle: previous.recipe.title,
        nextTitle: replacement.candidate.recipe.title,
        delta: diffNutrition(replacement.candidate.recipe.nutrition, previous.recipe.nutrition),
      }
      actions.push(action)
      repairResults.push({
        repaired: true,
        retry: false,
        notes: [`${action.previousTitle} reemplazado por ${action.nextTitle}.`],
        attempt,
        reason: issue.reason,
        dayIndex: replacement.dayIndex,
        slot: previous.slot,
        actionCount: 1,
      })
      changed = true
    }
    if (!changed) break
  }

  const issuesAfter = evaluateWeekRecipeSelection(days, targets)
  return {
    attempted: true,
    maxAttempts,
    issuesBefore,
    repairRequests,
    repairResults,
    actions,
    issuesAfter,
    repaired: issuesAfter.length === 0,
  }
}

function repairRequestFromIssue(issue: WeekRepairIssue, attempt: number, maxAttempts: number): WeekRepairRequest {
  return {
    reason: issue.reason,
    message: issue.message,
    attempt,
    maxAttempts,
    dayIndex: issue.dayIndex,
    slot: issue.slot,
    title: issue.title,
  }
}

function findRepairReplacement(
  days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>,
  pools: Map<MealSlot, RecipePoolResult>,
  targets: MacroTargets,
  issue: WeekRepairIssue,
): { dayIndex: number; mealIndex: number; candidate: GeneratedScoredRecipe } | null {
  const beforePenalty = weekPlanPenalty(days, targets)
  const usedTitles = titleCountsForDays(days)
  const candidates: Array<{ dayIndex: number; mealIndex: number; candidate: GeneratedScoredRecipe; penalty: number; score: number }> = []
  for (const [dayIndex, day] of days.entries()) {
    if (issue.dayIndex !== undefined && issue.dayIndex !== dayIndex) continue
    for (const [mealIndex, meal] of day.entries()) {
      if (issue.slot && issue.slot !== meal.slot) continue
      if (issue.title && normalizeIngredientName(meal.recipe.title) !== normalizeIngredientName(issue.title)) continue
      const pool = pools.get(meal.slot)
      if (!pool) continue
      for (const candidate of pool.recipes) {
        const currentTitle = normalizeIngredientName(meal.recipe.title)
        const nextTitle = normalizeIngredientName(candidate.recipe.title)
        if (!nextTitle || nextTitle === currentTitle) continue
        if ((usedTitles.get(nextTitle) ?? 0) >= 2) continue
        const clone = days.map((items) => items.slice())
        clone[dayIndex]![mealIndex] = { slot: meal.slot, recipe: candidate.recipe }
        const penalty = weekPlanPenalty(clone, targets)
        if (penalty >= beforePenalty) continue
        candidates.push({
          dayIndex,
          mealIndex,
          candidate,
          penalty,
          score: beforePenalty - penalty + (candidate.source === 'llm' ? 3 : 0),
        })
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0] ?? null
}

export function evaluateWeekRecipeSelection(
  days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>,
  targets: MacroTargets,
): WeekRepairIssue[] {
  const issues: WeekRepairIssue[] = []
  const titleOccurrences = new Map<string, Array<{ dayIndex: number; slot: MealSlot; title: string }>>()
  for (const [dayIndex, day] of days.entries()) {
    for (const meal of day) {
      const key = normalizeIngredientName(meal.recipe.title)
      const current = titleOccurrences.get(key) ?? []
      current.push({ dayIndex, slot: meal.slot, title: meal.recipe.title })
      titleOccurrences.set(key, current)
    }
  }
  for (const occurrences of titleOccurrences.values()) {
    if (occurrences.length <= 2) continue
    const extra = occurrences.slice(2)
    for (const occurrence of extra) {
      issues.push({
        reason: 'repetition_conflict',
        dayIndex: occurrence.dayIndex,
        slot: occurrence.slot,
        title: occurrence.title,
        message: `${occurrence.title} aparece ${occurrences.length} veces en la semana.`,
      })
    }
  }

  for (const [dayIndex, day] of days.entries()) {
    const dayNutrition = sumNutrition(day.map((meal) => meal.recipe.nutrition))
    if (dayNutrition.calories < targets.calories * 0.72 || dayNutrition.calories > targets.calories * 1.28) {
      const slot = day
        .map((meal) => ({ slot: meal.slot, drift: Math.abs(meal.recipe.nutrition.calories - targetNutritionForSlot(targets, meal.slot).calories) }))
        .sort((left, right) => right.drift - left.drift)[0]?.slot
      issues.push({
        reason: 'daily_calorie_drift',
        dayIndex,
        slot,
        message: `${dayName(dayIndex)} queda demasiado lejos del objetivo diario (${round(dayNutrition.calories)} kcal vs ${targets.calories}).`,
      })
    }
  }

  const weeklyNutrition = sumNutrition(days.flatMap((day) => day.map((meal) => meal.recipe.nutrition)))
  if (weeklyNutrition.proteinG < targets.proteinG * 7 * 0.9) {
    issues.push({
      reason: 'weekly_protein_low',
      message: `La proteína semanal queda baja (${round(weeklyNutrition.proteinG)} g vs objetivo ${round(targets.proteinG * 7)} g).`,
    })
  }
  return issues.slice(0, 12)
}

function weekPlanPenalty(days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>, targets: MacroTargets): number {
  let penalty = 0
  const weeklyNutrition = sumNutrition(days.flatMap((day) => day.map((meal) => meal.recipe.nutrition)))
  penalty += Math.abs(weeklyNutrition.calories - targets.calories * 7) / Math.max(targets.calories * 7, 1) * 180
  penalty += Math.max(0, targets.proteinG * 7 - weeklyNutrition.proteinG) / Math.max(targets.proteinG * 7, 1) * 160
  for (const [dayIndex, day] of days.entries()) {
    const dayNutrition = sumNutrition(day.map((meal) => meal.recipe.nutrition))
    penalty += Math.abs(dayNutrition.calories - targets.calories) / Math.max(targets.calories, 1) * 35
    for (const meal of day) {
      penalty += Math.max(0, targetNutritionForSlot(targets, meal.slot).proteinG - meal.recipe.nutrition.proteinG) * 0.6
    }
    const dayTitles = new Set<string>()
    for (const meal of day) {
      const title = normalizeIngredientName(meal.recipe.title)
      if (dayTitles.has(title)) penalty += 160
      dayTitles.add(title)
    }
    if (dayIndex > 0) {
      for (const meal of day) {
        const previousDaySameSlot = days[dayIndex - 1]?.find((previous) => previous.slot === meal.slot)
        if (previousDaySameSlot && normalizeIngredientName(previousDaySameSlot.recipe.title) === normalizeIngredientName(meal.recipe.title)) {
          penalty += 45
        }
      }
    }
  }
  for (const count of titleCountsForDays(days).values()) {
    if (count > 2) penalty += (count - 2) * 130
  }
  return penalty
}

function titleCountsForDays(days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const day of days) {
    for (const meal of day) {
      const title = normalizeIngredientName(meal.recipe.title)
      counts.set(title, (counts.get(title) ?? 0) + 1)
    }
  }
  return counts
}

function skeletonFitScore(recipe: ReturnType<typeof scoreRecipe>, skeleton?: WeekSkeletonMeal): number {
  if (!skeleton) return 0
  const haystack = normalizeIngredientName([
    recipe.title,
    recipe.description,
    recipe.cuisine,
    recipe.flavorProfile,
    ...recipe.tags,
    ...recipe.ingredients.map((ingredient) => ingredient.name),
  ].join(' '))
  const intentTokens = skeleton.intent
    .split(/[\s,.;:()]+/)
    .map(normalizeIngredientName)
    .filter((token) => token.length >= 4)
  const positive = new Set(intentTokens.filter((token) => haystack.includes(token)))
  const avoidHits = skeleton.avoidRepeating
    .map(normalizeIngredientName)
    .filter((token) => token.length >= 4 && haystack.includes(token)).length
  return positive.size * 3 - avoidHits * 9
}

function chooseReplacementCandidate(
  input: GeneratedScoredRecipe[],
  menu: WeeklyMenuView,
  day: DayPlanView,
  meal: MenuMealView,
  target: MacroTargets,
): GeneratedScoredRecipe | null {
  const existingTitles = new Map<string, number>()
  for (const currentDay of menu.days) {
    for (const currentMeal of currentDay.meals) {
      if (currentMeal.id === meal.id) continue
      const title = normalizeIngredientName(currentMeal.recipe.title)
      existingTitles.set(title, (existingTitles.get(title) ?? 0) + 1)
    }
  }
  return input.map((item) => {
    const title = normalizeIngredientName(item.recipe.title)
    const sameDay = day.meals.some((currentMeal) => currentMeal.id !== meal.id && normalizeIngredientName(currentMeal.recipe.title) === title)
    const weeklyAfter = diffNutrition(sumNutrition([menu.nutrition, item.recipe.nutrition, negateNutrition(meal.nutrition)]), weeklyTarget(target))
    const score = recipeFitScore(item.recipe.nutrition, targetNutritionForSlot(target, meal.slot)) -
      (existingTitles.get(title) ?? 0) * 25 -
      (sameDay ? 120 : 0) -
      Math.abs(weeklyAfter.calories) / Math.max(target.calories * 7, 1) * 60 +
      (item.source === 'llm' ? 10 : 0)
    return { item, score }
  }).sort((left, right) => right.score - left.score)[0]?.item ?? null
}

function targetNutritionForSlot(target: MacroTargets, slot: MealSlot): NutritionTotals {
  const share = replacementSlotShares[slot]
  return {
    calories: round(target.calories * share),
    proteinG: round(target.proteinG * share),
    carbsG: round(target.carbsG * share),
    fatG: round(target.fatG * share),
    confidence: target.confidence,
  }
}

function recipeFitScore(nutrition: NutritionTotals, target: NutritionTotals): number {
  return 120 -
    Math.abs(nutrition.calories - target.calories) / Math.max(target.calories, 1) * 80 -
    Math.max(0, target.proteinG - nutrition.proteinG) / Math.max(target.proteinG, 1) * 70 -
    Math.abs(nutrition.fatG - target.fatG) / Math.max(target.fatG, 1) * 20 -
    Math.abs(nutrition.carbsG - target.carbsG) / Math.max(target.carbsG, 1) * 18
}

function hasUnknownIngredients(recipe: ReturnType<typeof scoreRecipe>): boolean {
  return recipe.matchedIngredients.some((ingredient) => ingredient.confidence === 'unknown')
}

function compactMenuForGeneration(menu: WeeklyMenuView): unknown {
  return {
    target: menu.target,
    days: menu.days.map((day) => ({
      dayIndex: day.dayIndex,
      locked: day.locked,
      meals: day.meals.map((meal) => ({
        slot: meal.slot,
        locked: meal.locked,
        title: meal.recipe.title,
        ingredients: meal.recipe.ingredients.map((ingredient) => ingredient.name),
        nutrition: meal.nutrition,
      })),
    })),
  }
}

function compactMenuForPlannerCache(menu: unknown): unknown {
  if (!menu || typeof menu !== 'object') return null
  const current = menu as Partial<WeeklyMenuView>
  return {
    id: current.id,
    profileId: current.profileId,
    days: current.days?.map((day) => ({
      id: day.id,
      dayIndex: day.dayIndex,
      locked: day.locked,
      meals: day.meals.map((meal) => ({
        id: meal.id,
        slot: meal.slot,
        locked: meal.locked,
        title: meal.recipe.title,
        ingredients: meal.recipe.ingredients?.map((ingredient) => ingredient.name) ?? [],
      })),
    })) ?? [],
  }
}

function compactMenuForChatCache(menu: unknown): unknown {
  if (!menu || typeof menu !== 'object') return null
  const current = menu as Partial<WeeklyMenuView>
  return {
    id: current.id,
    profileId: current.profileId,
    weekStart: current.weekStart,
    target: current.target,
    nutrition: current.nutrition,
    generationSettings: current.generationSettings,
    days: current.days?.map((day) => ({
      dayIndex: day.dayIndex,
      locked: day.locked,
      meals: day.meals.map((meal) => ({
        id: meal.id,
        slot: meal.slot,
        locked: meal.locked,
        title: meal.recipe.title,
        ingredients: meal.recipe.ingredients?.map((ingredient) => ({
          name: ingredient.name,
          amount: ingredient.amount,
          unit: ingredient.unit,
          confidence: ingredient.confidence,
        })) ?? [],
        nutrition: meal.nutrition,
      })),
    })) ?? [],
  }
}

function compactGenerationSummaryInput(input: GenerationSummaryInput): GenerationSummaryInput {
  return {
    ...input,
    target: {
      ...input.target,
      notes: [],
    },
    weeklyNutrition: input.weeklyNutrition ? compactNutrition(input.weeklyNutrition) : null,
    repair: compactRepairTrace(input.repair),
    logs: input.logs.slice(-12),
    error: input.error ? input.error.slice(0, 500) : null,
  }
}

function compactRepairTrace(repair: unknown): unknown {
  if (!repair || typeof repair !== 'object') return null
  const current = repair as {
    attempted?: boolean
    repaired?: boolean
    maxAttempts?: number
    issuesBefore?: WeekRepairIssue[]
    issuesAfter?: WeekRepairIssue[]
    actions?: WeekRepairAction[]
    repairRequests?: WeekRepairRequest[]
    repairResults?: WeekRepairResult[]
  }
  return {
    attempted: Boolean(current.attempted),
    repaired: Boolean(current.repaired),
    maxAttempts: current.maxAttempts,
    issuesBefore: current.issuesBefore?.map(compactRepairIssue) ?? [],
    issuesAfter: current.issuesAfter?.map(compactRepairIssue) ?? [],
    actions: current.actions?.map((action) => ({
      attempt: action.attempt,
      reason: action.reason,
      dayIndex: action.dayIndex,
      slot: action.slot,
      previousTitle: action.previousTitle,
      nextTitle: action.nextTitle,
      delta: compactNutrition(action.delta),
    })) ?? [],
    repairRequests: current.repairRequests?.map(compactRepairRequest) ?? [],
    repairResults: current.repairResults?.map((result) => ({
      repaired: result.repaired,
      retry: result.retry,
      attempt: result.attempt,
      reason: result.reason,
      dayIndex: result.dayIndex,
      slot: result.slot,
      actionCount: result.actionCount,
      notes: result.notes,
    })) ?? [],
  }
}

function compactRepairIssue(issue: WeekRepairIssue): Record<string, unknown> {
  return {
    reason: issue.reason,
    dayIndex: issue.dayIndex,
    slot: issue.slot,
    title: issue.title,
    message: issue.message,
  }
}

function compactRepairRequest(request: WeekRepairRequest): Record<string, unknown> {
  return {
    reason: request.reason,
    message: request.message,
    attempt: request.attempt,
    maxAttempts: request.maxAttempts,
    dayIndex: request.dayIndex,
    slot: request.slot,
    title: request.title,
  }
}

function compactNutrition(nutrition: NutritionTotals): NutritionTotals {
  return {
    calories: round(nutrition.calories),
    proteinG: round(nutrition.proteinG),
    carbsG: round(nutrition.carbsG),
    fatG: round(nutrition.fatG),
    fiberG: round(nutrition.fiberG ?? 0),
    confidence: nutrition.confidence,
  }
}

function slotLabel(slot: MealSlot): string {
  if (slot === 'breakfast') return 'desayuno'
  if (slot === 'lunch') return 'comida'
  if (slot === 'dinner') return 'cena'
  return 'snack'
}

function dayName(dayIndex: number): string {
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][dayIndex] ?? `Día ${dayIndex + 1}`
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${round(value)}`
}

function scaleRecipe(recipe: RecipeCandidate, factor: number): RecipeCandidate {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      amount: Math.round(ingredient.amount * factor),
    })),
  }
}

async function persistRecipe(recipe: ReturnType<typeof scoreRecipe>, source: string): Promise<string> {
  const sql = sqlClient()
  const [row] = await sql<[{ id: string }]>`
    insert into recipes (
      user_id, title, locale, description, servings, prep_time_minutes, cuisine, flavor_profile,
      tags, steps, source, nutrition_snapshot
    )
    values (
      ${localUserId()}, ${recipe.title}, ${recipe.locale}, ${recipe.description}, ${recipe.servings},
      ${recipe.prepTimeMinutes}, ${recipe.cuisine}, ${recipe.flavorProfile}, ${sql.json(recipe.tags as any)},
      ${sql.json(recipe.steps as any)}, ${source}, ${sql.json(recipe.nutrition as any)}
    )
    returning id
  `
  if (!row) throw new Error('No se pudo guardar la receta.')

  for (const [index, ingredient] of recipe.matchedIngredients.entries()) {
    const [ingredientRow] = await sql<[{ id: string }]>`
      insert into recipe_ingredients (
        user_id, recipe_id, position, name, amount, unit, preparation, normalized_amount, normalized_unit,
        food_id, source_id, confidence, nutrition_snapshot, notes
      )
      values (
        ${localUserId()}, ${row.id}, ${index}, ${ingredient.name}, ${ingredient.amount}, ${ingredient.unit},
        ${ingredient.preparation ?? null}, ${ingredient.normalizedAmount}, ${ingredient.normalizedUnit},
        ${ingredient.foodId ?? null}, ${ingredient.sourceId ?? null}, ${ingredient.confidence},
        ${sql.json(ingredient.nutrition as any)}, ${sql.json(ingredient.notes as any)}
      )
      returning id
    `
    if (ingredientRow) {
      await sql`
        insert into ingredient_matches (user_id, recipe_ingredient_id, food_id, source_id, confidence, notes)
        values (
          ${localUserId()}, ${ingredientRow.id}, ${ingredient.foodId ?? null}, ${ingredient.sourceId ?? null},
          ${ingredient.confidence}, ${sql.json(ingredient.notes as any)}
        )
      `
    }
  }

  await sql`
    insert into nutrition_estimates (user_id, entity_type, entity_id, nutrition_snapshot, confidence, source_notes)
    values (${localUserId()}, 'recipe', ${row.id}, ${sql.json(recipe.nutrition as any)}, ${recipe.nutrition.confidence}, '[]')
  `
  return row.id
}

async function recipeFromRow(row: any): Promise<RecipeView> {
  const sql = sqlClient()
  const ingredientRows = await sql`
    select * from recipe_ingredients
    where recipe_id = ${row.id} and user_id = ${localUserId()}
    order by position asc
  `
  return {
    id: row.id,
    title: row.title,
    locale: row.locale,
    description: row.description,
    servings: Number(row.servings),
    prepTimeMinutes: Number(row.prep_time_minutes),
    cuisine: row.cuisine,
    flavorProfile: row.flavor_profile,
    tags: row.tags ?? [],
    steps: row.steps ?? [],
    source: row.source,
    nutrition: row.nutrition_snapshot,
    ingredients: ingredientRows.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      amount: Number(ingredient.amount),
      unit: ingredient.unit,
      preparation: ingredient.preparation,
      normalizedAmount: Number(ingredient.normalized_amount),
      normalizedUnit: ingredient.normalized_unit,
      foodId: ingredient.food_id,
      sourceId: ingredient.source_id,
      confidence: ingredient.confidence,
      nutrition: ingredient.nutrition_snapshot,
      notes: ingredient.notes ?? [],
    })),
  }
}

function profileFromRow(row: any): ProfileRow {
  const latestTarget = row.target_id ? targetFromRow(row) : undefined
  return {
    id: row.id,
    name: row.name,
    locale: row.locale,
    unitSystem: row.unit_system,
    weightKg: Number(row.weight_kg),
    targetWeightKg: Number(row.target_weight_kg),
    proteinCalculationWeightKg: Number(row.protein_calculation_weight_kg),
    heightCm: Number(row.height_cm),
    age: row.age === null ? null : Number(row.age),
    sex: row.sex,
    activityLevel: row.activity_level,
    goal: row.goal,
    macroMode: row.macro_mode,
    likes: row.likes ?? [],
    dislikes: row.dislikes ?? [],
    bannedFoods: row.banned_foods ?? [],
    latestTarget,
  }
}

function generationJobFromRow(row: any): GenerationJobView {
  const result = row.result && typeof row.result === 'object' && !Array.isArray(row.result) ? row.result : {}
  return {
    id: row.id,
    profileId: row.profile_id ?? null,
    weeklyMenuId: row.weekly_menu_id ?? null,
    status: row.status,
    kind: row.kind,
    failureCode: row.failure_code ?? null,
    logs: Array.isArray(row.logs) ? row.logs.map(String) : [],
    result,
    remediation: generationRemediationFromResult(result),
    error: row.error ?? null,
    retryCount: Number(row.retry_count ?? 0),
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  }
}

function generationRemediationFromResult(result: Record<string, unknown>): GenerationRemediationPlan | null {
  const value = result.remediation
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as GenerationRemediationPlan
  const repairValue = result.repairRemediation
  if (Array.isArray(repairValue) && repairValue.length > 0 && repairValue[0] && typeof repairValue[0] === 'object') {
    return repairValue[0] as GenerationRemediationPlan
  }
  return null
}

function targetFromRow(row: any): MacroTargets {
  return {
    calories: Number(row.calories),
    proteinG: Number(row.protein_g),
    carbsG: Number(row.carbs_g),
    fatG: Number(row.fat_g),
    confidence: row.confidence,
    formulaVersion: row.formula_version,
    goal: row.goal,
    macroMode: row.macro_mode,
    preset: row.preset,
    maintenanceCalories: Number(row.maintenance_calories),
    proteinCalculationWeightKg: Number(row.protein_calculation_weight_kg ?? row.target_protein_weight),
    notes: row.notes ?? [],
  }
}

function currentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().slice(0, 10)
}

function retargetCalories(target: MacroTargets, calories: number): MacroTargets {
  const requiredCalories = target.proteinG * 4 + target.fatG * 9
  const carbsG = requiredCalories >= calories ? 0 : roundToNearest((calories - requiredCalories) / 4, 5)
  return {
    ...target,
    calories,
    carbsG,
    macroMode: 'manual',
    preset: target.preset,
    notes: unique([...target.notes, 'Objetivo calórico ajustado manualmente desde el chat.']),
  }
}

async function recalculateMenuNutrition(menuId: string): Promise<void> {
  const menu = await getWeeklyMenu(menuId)
  const nutrition = sumNutrition(menu.days.flatMap((day) => day.meals.map((meal) => meal.nutrition)))
  const sql = sqlClient()
  await sql`update weekly_menus set nutrition_snapshot = ${sql.json(nutrition as any)} where id = ${menuId} and user_id = ${localUserId()}`
}

async function menuForMeal(menuMealId: string): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const [row] = await sql`
    select dp.weekly_menu_id
    from menu_meals mm
    join day_plans dp on dp.id = mm.day_plan_id
    where mm.id = ${menuMealId} and mm.user_id = ${localUserId()}
  `
  if (!row) throw new Error('Comida no encontrada.')
  return getWeeklyMenu(row.weekly_menu_id)
}

async function menuForDay(dayPlanId: string): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const [row] = await sql`
    select weekly_menu_id
    from day_plans
    where id = ${dayPlanId} and user_id = ${localUserId()}
  `
  if (!row) throw new Error('Día no encontrado.')
  return getWeeklyMenu(row.weekly_menu_id)
}

async function profileForMenu(menu: WeeklyMenuView): Promise<ProfileRow> {
  const profile = (await listProfiles()).find((item) => item.id === menu.profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  return profile
}

function parseReplacementRequest(request: string, menu: WeeklyMenuView, meal: MenuMealView): ReplacementRequestFeatures {
  const normalized = normalizeIngredientName(request)
  return {
    avoidedFoods: inferAvoidedFoods(request, menu, meal),
    wantsMoreProtein: /\b(mas proteina|alta proteina|sube proteina|proteico|proteinico)\b/.test(normalized),
    wantsLowerCalories: /\b(menos calorias|baja calorias|mas ligero|ligero|menos kcal)\b/.test(normalized),
    wantsLowerFat: /\b(menos grasa|baja grasa|sin grasa|poca grasa)\b/.test(normalized),
  }
}

function inferAvoidedFoods(request: string, menu: WeeklyMenuView, meal: MenuMealView): string[] {
  const normalized = normalizeIngredientName(request)
  const hasNegativeIntent = /\b(no me gusta|no quiero|quita|quitar|sin|evita|evitar|cambia|saca|odio|prohibe|no uses)\b/.test(normalized)
  if (!hasNegativeIntent) return []

  const ingredientNames = unique([
    ...meal.recipe.ingredients.map((item) => item.name),
    ...menu.days.flatMap((day) => day.meals.flatMap((item) => item.recipe.ingredients.map((ingredient) => ingredient.name))),
  ])
  const matched = ingredientNames.filter((ingredient) => {
    const item = normalizeIngredientName(ingredient)
    return normalized.includes(item) || item.split(' ').some((token) => token.length > 3 && normalized.includes(token))
  })
  if (matched.length > 0) return matched

  const freeformMatch = normalized.match(/\b(?:no me gusta|no quiero|quita|quitar|sin|evita|evitar|cambia|saca|odio|prohibe|no uses)\s+(.+?)(?:\s+en\b|\s+del\b|\s+de la\b|\s+por\b|$)/)
  const value = freeformMatch?.[1]
    ?.replace(/\b(el|la|los|las|un|una|este|esta|plato|receta|comida)\b/g, '')
    .trim()
  return value ? [value] : []
}

async function rankReplacementCandidates(input: {
  menu: WeeklyMenuView
  day: DayPlanView
  meal: MenuMealView
  profile: ProfileRow
  avoidedFoods: string[]
  requestFeatures: ReplacementRequestFeatures
}): Promise<ReplacementRankedCandidate[]> {
  const titleCounts = new Map<string, number>()
  for (const day of input.menu.days) {
    for (const meal of day.meals) {
      if (meal.id === input.meal.id) continue
      const title = normalizeIngredientName(meal.recipe.title)
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
    }
  }
  const sameDayTitles = new Set(input.day.meals
    .filter((meal) => meal.id !== input.meal.id)
    .map((meal) => normalizeIngredientName(meal.recipe.title)))
  const selected = new Map<string, ReplacementRankedCandidate>()
  const pool = await recipePoolForSlot({
    profile: input.profile,
    slot: input.meal.slot,
    count: 10,
    avoidFoods: input.avoidedFoods,
    avoidTitles: [input.meal.recipe.title],
    targetNutrition: targetNutritionForSlot(input.menu.target, input.meal.slot),
    userRequest: input.requestFeatures.avoidedFoods.length > 0
      ? `El usuario pidió cambiar este plato evitando: ${input.requestFeatures.avoidedFoods.join(', ')}. Genera recetas nuevas, no variantes con esos ingredientes.`
      : 'Genera reemplazos nuevos y variados para este plato.',
    menuContext: compactMenuForGeneration(input.menu),
  })
  const rawCandidates = pool.recipes.map((item) => item.recipe)

  for (const candidate of rawCandidates) {
    const title = normalizeIngredientName(candidate.title)
    if (title === normalizeIngredientName(input.meal.recipe.title)) continue
    if (selected.has(title)) continue
    if (recipeIncludesAny(candidate, input.avoidedFoods)) continue

    const raw = scoreRecipe(candidate, input.avoidedFoods)
    if (raw.nutrition.confidence === 'unknown') continue
    const currentTargetCalories = input.meal.nutrition.calories
    const slotTargetCalories = input.menu.target.calories * replacementSlotShares[input.meal.slot]
    const targetCalories = currentTargetCalories * 0.72 + slotTargetCalories * 0.28
    const factor = clamp(targetCalories / Math.max(raw.nutrition.calories, 1), 0.72, 1.28)
    const recipe = scaleRecipe(candidate, factor)
    const scored = scoreRecipe(recipe, input.avoidedFoods)
    if (scored.nutrition.confidence === 'unknown') continue
    if (recipeIncludesAny(scored, input.avoidedFoods)) continue

    const weeklyAfter = diffNutrition(sumNutrition([
      input.menu.nutrition,
      scored.nutrition,
      negateNutrition(input.meal.nutrition),
    ]), weeklyTarget(input.menu.target))
    const dayNutrition = sumNutrition(input.day.meals.map((meal) => meal.nutrition))
    const dayAfter = diffNutrition(sumNutrition([dayNutrition, scored.nutrition, negateNutrition(input.meal.nutrition)]), dailyTarget(input.menu.target))
    const macroDistanceToCurrent = nutritionDistance(scored.nutrition, input.meal.nutrition)
    const macroDistanceToTargets = Math.abs(weeklyAfter.calories) / Math.max(input.menu.target.calories * 7, 1) * 110 +
      Math.max(0, -weeklyAfter.proteinG) / Math.max(input.menu.target.proteinG * 7, 1) * 95 +
      Math.abs(dayAfter.calories) / Math.max(input.menu.target.calories, 1) * 55 +
      Math.max(0, -dayAfter.proteinG) / Math.max(input.menu.target.proteinG, 1) * 45
    const sameDayPenalty = sameDayTitles.has(title) ? 80 : 0
    const weeklyRepeatPenalty = (titleCounts.get(title) ?? 0) * 12
    const requestScore = replacementRequestScore(scored.nutrition, input.meal.nutrition, input.requestFeatures)
    const satiety = replacementSatietyScore(scored)
    const closestScore = 120 - macroDistanceToCurrent - sameDayPenalty - weeklyRepeatPenalty + requestScore * 0.35
    const creativeScore = 100 + satiety + requestScore - sameDayPenalty - weeklyRepeatPenalty * 1.8 - macroDistanceToCurrent * 0.22
    const macroScore = 120 - macroDistanceToTargets - sameDayPenalty - weeklyRepeatPenalty * 0.7 + requestScore * 0.5
    selected.set(title, {
      recipe: scored,
      nutrition: scored.nutrition,
      macroImpact: diffNutrition(scored.nutrition, input.meal.nutrition),
      closestScore: round(closestScore),
      creativeScore: round(creativeScore),
      macroScore: round(macroScore),
      overallScore: round(closestScore * 0.28 + creativeScore * 0.26 + macroScore * 0.46),
    })
  }

  return [...selected.values()].sort((left, right) => right.overallScore - left.overallScore)
}

function selectReplacementOptions(candidates: ReplacementRankedCandidate[]): ReplacementProposal['options'] {
  const selected = new Set<string>()
  const result: ReplacementProposal['options'] = []
  const pick = (kind: ReplacementOptionKind, scoreKey: keyof Pick<ReplacementRankedCandidate, 'closestScore' | 'creativeScore' | 'macroScore'>) => {
    const option = [...candidates]
      .filter((candidate) => !selected.has(normalizeIngredientName(candidate.recipe.title)))
      .sort((left, right) => right[scoreKey] - left[scoreKey])[0]
    if (!option) return
    selected.add(normalizeIngredientName(option.recipe.title))
    result.push({
      kind,
      recipe: option.recipe,
      nutrition: option.nutrition,
      macroImpact: option.macroImpact,
    })
  }

  pick('closest_nutrition', 'closestScore')
  pick('creative_delicious', 'creativeScore')
  pick('macro_optimized', 'macroScore')
  for (const candidate of candidates) {
    if (result.length >= 3) break
    const title = normalizeIngredientName(candidate.recipe.title)
    if (selected.has(title)) continue
    selected.add(title)
    result.push({
      kind: ['closest_nutrition', 'creative_delicious', 'macro_optimized'][result.length] as ReplacementOptionKind,
      recipe: candidate.recipe,
      nutrition: candidate.nutrition,
      macroImpact: candidate.macroImpact,
    })
  }
  return result
}

function recipeIncludes(recipe: { ingredients: Array<{ name: string }> }, ingredient: string): boolean {
  const normalized = normalizeIngredientName(ingredient)
  return recipe.ingredients.some((item) => {
    const candidate = normalizeIngredientName(item.name)
    return candidate.includes(normalized) || normalized.includes(candidate)
  })
}

function recipeIncludesAny(recipe: { ingredients: Array<{ name: string }> }, avoidedFoods: string[]): boolean {
  return avoidedFoods.some((food) => recipeIncludes(recipe, food))
}

function replacementRequestScore(next: NutritionTotals, previous: NutritionTotals, request: ReplacementRequestFeatures): number {
  let score = 0
  if (request.wantsMoreProtein) score += (next.proteinG - previous.proteinG) * 1.8
  if (request.wantsLowerCalories) score += (previous.calories - next.calories) * 0.16
  if (request.wantsLowerFat) score += (previous.fatG - next.fatG) * 2.4
  return score
}

function replacementSatietyScore(recipe: RecipeCandidate & { nutrition: NutritionTotals }): number {
  const grams = recipe.ingredients.reduce((total, ingredient) => total + normalizedApproxGrams(ingredient.amount, ingredient.unit), 0)
  const fiber = recipe.nutrition.fiberG ?? 0
  const density = recipe.nutrition.calories / Math.max(grams, 1)
  return Math.min(35, grams / 12) + Math.min(30, recipe.nutrition.proteinG * 0.8) + Math.min(18, fiber * 3) + (density <= 1.5 ? 14 : density <= 2.2 ? 8 : 2)
}

function nutritionDistance(next: NutritionTotals, previous: NutritionTotals): number {
  return Math.abs(next.calories - previous.calories) / Math.max(previous.calories, 1) * 80 +
    Math.abs(next.proteinG - previous.proteinG) / Math.max(previous.proteinG, 1) * 45 +
    Math.abs(next.fatG - previous.fatG) / Math.max(previous.fatG, 1) * 20 +
    Math.abs(next.carbsG - previous.carbsG) / Math.max(previous.carbsG, 1) * 20
}

function weeklyTarget(target: MacroTargets): NutritionTotals {
  return {
    calories: target.calories * 7,
    proteinG: target.proteinG * 7,
    carbsG: target.carbsG * 7,
    fatG: target.fatG * 7,
    confidence: target.confidence,
  }
}

function dailyTarget(target: MacroTargets): NutritionTotals {
  return {
    calories: target.calories,
    proteinG: target.proteinG,
    carbsG: target.carbsG,
    fatG: target.fatG,
    confidence: target.confidence,
  }
}

function negateNutrition(nutrition: NutritionTotals): NutritionTotals {
  return {
    calories: -nutrition.calories,
    proteinG: -nutrition.proteinG,
    carbsG: -nutrition.carbsG,
    fatG: -nutrition.fatG,
    fiberG: -(nutrition.fiberG ?? 0),
    confidence: nutrition.confidence,
  }
}

function normalizedApproxGrams(amount: number, unit: string): number {
  const normalized = normalizeIngredientName(unit)
  if (normalized === 'kg') return amount * 1000
  if (normalized === 'cucharada' || normalized === 'cucharadas' || normalized === 'tbsp') return amount * 13.5
  if (normalized === 'cucharadita' || normalized === 'cucharaditas' || normalized === 'tsp') return amount * 4.5
  return amount
}

function diffNutrition(next: NutritionTotals, previous: NutritionTotals): NutritionTotals {
  return {
    calories: round(next.calories - previous.calories),
    proteinG: round(next.proteinG - previous.proteinG),
    carbsG: round(next.carbsG - previous.carbsG),
    fatG: round(next.fatG - previous.fatG),
    fiberG: round((next.fiberG ?? 0) - (previous.fiberG ?? 0)),
    confidence: next.confidence,
  }
}

function toPlannerMenu(menu: WeeklyMenuView): CaloriePlannerMenu {
  return {
    id: menu.id,
    profileId: menu.profileId,
    weekStart: menu.weekStart,
    locale: menu.locale,
    nutrition: menu.nutrition,
    target: menu.target,
    days: menu.days.map((day) => ({
      id: day.id,
      dayIndex: day.dayIndex,
      locked: day.locked,
      meals: day.meals.map((meal) => ({
        id: meal.id,
        slot: meal.slot,
        locked: meal.locked,
        nutrition: meal.nutrition,
        recipe: {
          id: meal.recipe.id,
          title: meal.recipe.title,
          locale: meal.recipe.locale === 'en' ? 'en' : 'es',
          description: meal.recipe.description,
          servings: 1,
          prepTimeMinutes: meal.recipe.prepTimeMinutes,
          cuisine: meal.recipe.cuisine,
          flavorProfile: meal.recipe.flavorProfile,
          tags: meal.recipe.tags,
          ingredients: meal.recipe.ingredients.map((ingredient) => ({
            name: ingredient.name,
            amount: ingredient.amount,
            unit: ingredient.unit,
            preparation: ingredient.preparation ?? undefined,
          })),
          steps: meal.recipe.steps,
          nutrition: meal.recipe.nutrition,
        },
      })),
    })),
  }
}

function appliedSummaryFromPlan(plan: CalorieAdjustmentPlan): string {
  return plan.summaryMarkdown
    .replace('Preparé un reajuste', 'Apliqué un reajuste')
    .replace('Todavía no he cambiado el menú.', 'El menú ya quedó actualizado.')
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function selectedExistingValues(existing: string[], selected: string[]): string[] {
  const selectedKeys = new Set(selected.map(normalizeIngredientName).filter(Boolean))
  return existing.filter((item) => selectedKeys.has(normalizeIngredientName(item)))
}

function removeSelectedValues(existing: string[], selected: string[]): string[] {
  const selectedKeys = new Set(selected.map(normalizeIngredientName).filter(Boolean))
  return existing.filter((item) => !selectedKeys.has(normalizeIngredientName(item)))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function profileAvoidedFoods(profile: Pick<ProfileRow, 'bannedFoods' | 'dislikes'>): string[] {
  return unique([...profile.bannedFoods, ...profile.dislikes])
}

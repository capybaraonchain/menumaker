import {
  generateRecipeCandidates,
  type RecipeGenerationResult,
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
} from '@menumaker/core'
import { normalizeIngredientName, scoreRecipe, seedFoods, sumNutrition, templatesForSlot } from '@menumaker/nutrition'
import {
  buildCalorieAdjustmentPlan,
  currentMenuHash,
  type CalorieAdjustmentPlan,
  type CaloriePlannerMenu,
} from './caloriePlanner'
import { closeDb, sqlClient } from './client'
import { localUserId } from './env'

export interface AppState {
  provider?: unknown
  profiles: ProfileRow[]
  activeProfile: ProfileRow | null
  currentMenu: WeeklyMenuView | null
  savedRecipes: SavedRecipeView[]
  history: MenuHistoryItem[]
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
}

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
  const sql = sqlClient()
  const profile = (await listProfiles()).find((item) => item.id === profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const target = targets ?? profile.latestTarget
  if (!target) throw new Error('El perfil no tiene objetivos de macros.')
  const macroTargetId = targetId ?? (await saveMacroTarget(profileId, target))

  const [job] = await sql<[{ id: string }]>`
    insert into generation_jobs (user_id, profile_id, status, kind, logs, result)
    values (${localUserId()}, ${profileId}, 'running', ${kind}, ${sql.json(['Construyendo semana'] as any)}, '{}')
    returning id
  `

  const [menu] = await sql<[{ id: string }]>`
    insert into weekly_menus (user_id, profile_id, macro_target_id, week_start, locale, status, generation_settings, nutrition_snapshot)
    values (${localUserId()}, ${profileId}, ${macroTargetId}, ${currentWeekStart()}, ${profile.locale}, 'completed', ${sql.json({ kind } as any)}, '{}')
    returning id
  `
  if (!menu) throw new Error('No se pudo crear el menú.')

  const weekRecipes = await buildRecipesForWeek(profile, target)
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
  await sql`update weekly_menus set nutrition_snapshot = ${sql.json(weeklyNutrition as any)} where id = ${menu.id}`
  await sql`
    update weekly_menus set generation_settings = ${sql.json({
      kind,
      recipeSource: weekRecipes.source,
      fallbackSlots: weekRecipes.fallbackSlots,
    } as any)}
    where id = ${menu.id}
  `
  if (job) {
    await sql`
      update generation_jobs set status = 'completed', weekly_menu_id = ${menu.id},
        logs = ${sql.json([
          'Construyendo semana',
          weekRecipes.source === 'template' ? 'Usando fallback determinístico de recetas' : 'Generando candidatos con LLM',
          'Calculando nutrición',
          'Finalizando',
        ] as any)},
        result = ${sql.json({ menuId: menu.id } as any)}, updated_at = now()
      where id = ${job.id}
    `
  }
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
  const current = await getWeeklyMenu(menuId)
  const { locked, lockedDays } = lockedItemsFromMenu(current)
  const regenerated = await createWeeklyMenu(current.profileId, undefined, current.target, 'regenerate_week')
  await applyLockedMeals(regenerated, locked, lockedDays)
  return getWeeklyMenu(regenerated.id)
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
  const sql = sqlClient()
  const [day] = await sql`select * from day_plans where id = ${dayPlanId} and user_id = ${localUserId()}`
  if (!day) throw new Error('Día no encontrado.')
  if (day.locked) return getWeeklyMenu(day.weekly_menu_id)
  const menu = await getWeeklyMenu(day.weekly_menu_id)
  const profile = (await listProfiles()).find((item) => item.id === menu.profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const unlockedMeals = menu.days.find((item) => item.id === dayPlanId)?.meals.filter((meal) => !meal.locked) ?? []
  for (const meal of unlockedMeals) await replaceMealWithGenerated(meal.id, profile, menu.target, day.day_index)
  await recalculateMenuNutrition(menu.id)
  return getWeeklyMenu(menu.id)
}

export async function regenerateMeal(menuMealId: string): Promise<WeeklyMenuView> {
  const sql = sqlClient()
  const [row] = await sql`
    select mm.*, dp.weekly_menu_id, dp.day_index, wm.profile_id
    from menu_meals mm
    join day_plans dp on dp.id = mm.day_plan_id
    join weekly_menus wm on wm.id = dp.weekly_menu_id
    where mm.id = ${menuMealId} and mm.user_id = ${localUserId()}
  `
  if (!row) throw new Error('Comida no encontrada.')
  if (row.locked) return getWeeklyMenu(row.weekly_menu_id)
  const menu = await getWeeklyMenu(row.weekly_menu_id)
  const profile = (await listProfiles()).find((item) => item.id === row.profile_id)
  if (!profile) throw new Error('Perfil no encontrado.')
  await replaceMealWithGenerated(menuMealId, profile, menu.target, row.day_index)
  await recalculateMenuNutrition(menu.id)
  return getWeeklyMenu(menu.id)
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
      insert into day_plans (user_id, weekly_menu_id, day_index, locked, nutrition_snapshot)
      values (
        ${localUserId()}, ${menu.id}, ${dayIndex}, ${dayDecisions.some((decision) => decision.dayLocked)},
        ${sql.json(sumNutrition(dayDecisions.map((decision) => decision.nutrition)) as any)}
      )
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

async function buildRecipesForWeek(profile: ProfileRow, targets: MacroTargets): Promise<{
  days: Array<Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }>>
  source: 'llm' | 'template' | 'mixed'
  fallbackSlots: MealSlot[]
}> {
  const pools = new Map<MealSlot, RecipePoolResult>()
  for (const slot of mealSlots) {
    pools.set(slot, await recipePoolForSlot({
      profile,
      slot,
      count: 12,
      avoidFoods: profileAvoidedFoods(profile),
      avoidTitles: [],
      targetNutrition: targetNutritionForSlot(targets, slot),
      userRequest: `Genera opciones variadas para ${slotLabel(slot)} de una semana completa.`,
      menuContext: {
        target: targets,
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
      })
      dayItems.push({ slot, recipe })
      const title = normalizeIngredientName(recipe.title)
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
    }
    days.push(dayItems)
  }

  const fallbackSlots = mealSlots.filter((slot) => pools.get(slot)?.source !== 'llm')
  return {
    days,
    source: fallbackSlots.length === 0 ? 'llm' : fallbackSlots.length === mealSlots.length ? 'template' : 'mixed',
    fallbackSlots,
  }
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
  const llmResult = await generateRecipeCandidates({
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
  })
  const llmRecipes = scoreGeneratedCandidates({
    candidates: llmResult.recipes,
    avoidedFoods: avoidFoods,
    avoidTitles: input.avoidTitles,
    targetNutrition: input.targetNutrition,
    source: 'llm',
    limit: input.count,
  })
  if (llmRecipes.length >= Math.min(input.count, 3)) {
    return { recipes: llmRecipes, source: 'llm', llmResult }
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
  return {
    recipes: merged,
    source: llmRecipes.length > 0 ? 'mixed' : 'template',
    llmResult,
  }
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
}): ReturnType<typeof scoreRecipe> {
  const scored = input.map((item) => {
    const title = normalizeIngredientName(item.recipe.title)
    const repeatCount = context.titleCounts.get(title) ?? 0
    const sameDay = context.dayItems.some((existing) => normalizeIngredientName(existing.recipe.title) === title)
    const score = recipeFitScore(item.recipe.nutrition, context.target) -
      repeatCount * 45 -
      (sameDay ? 120 : 0) +
      (item.source === 'llm' ? 8 : 0) -
      Math.abs((context.dayIndex % 3) - (title.length % 3)) * 0.5
    return { item, score }
  })
  return scored.sort((left, right) => right.score - left.score)[0]?.item.recipe ?? input[0]!.recipe
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

function slotLabel(slot: MealSlot): string {
  if (slot === 'breakfast') return 'desayuno'
  if (slot === 'lunch') return 'comida'
  if (slot === 'dinner') return 'cena'
  return 'snack'
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

async function applyLockedMeals(menu: WeeklyMenuView, locked: Map<string, MenuMealView>, lockedDays: Set<number>): Promise<void> {
  const sql = sqlClient()
  for (const day of menu.days) {
    if (lockedDays.has(day.dayIndex)) {
      await sql`update day_plans set locked = true where id = ${day.id} and user_id = ${localUserId()}`
    }
    for (const meal of day.meals) {
      const previous = locked.get(`${day.dayIndex}:${meal.slot}`)
      if (!previous) continue
      await sql`
        update menu_meals
        set recipe_id = ${previous.recipe.id}, locked = ${previous.locked}, nutrition_snapshot = ${sql.json(previous.nutrition as any)}
        where id = ${meal.id} and user_id = ${localUserId()}
      `
    }
  }
  await recalculateMenuNutrition(menu.id)
}

function lockedItemsFromMenu(menu: WeeklyMenuView): { locked: Map<string, MenuMealView>; lockedDays: Set<number> } {
  const locked = new Map<string, MenuMealView>()
  const lockedDays = new Set<number>()
  for (const day of menu.days) {
    if (day.locked) lockedDays.add(day.dayIndex)
    for (const meal of day.meals) {
      if (day.locked || meal.locked) locked.set(`${day.dayIndex}:${meal.slot}`, meal)
    }
  }
  return { locked, lockedDays }
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

async function replaceMealWithGenerated(menuMealId: string, profile: ProfileRow, target: MacroTargets, dayIndex: number): Promise<void> {
  const menu = await menuForMeal(menuMealId)
  const day = menu.days.find((item) => item.meals.some((meal) => meal.id === menuMealId))
  const meal = day?.meals.find((item) => item.id === menuMealId)
  if (!day || !meal) return
  const avoidTitles = [
    meal.recipe.title,
    ...day.meals.filter((item) => item.id !== meal.id).map((item) => item.recipe.title),
  ]
  const pool = await recipePoolForSlot({
    profile,
    slot: meal.slot,
    count: 8,
    avoidFoods: profileAvoidedFoods(profile),
    avoidTitles,
    targetNutrition: targetNutritionForSlot(target, meal.slot),
    userRequest: `Regenera ${slotLabel(meal.slot)} con una receta nueva, rica y coherente con el menú semanal.`,
    menuContext: compactMenuForGeneration(menu),
  })
  const candidate = chooseReplacementCandidate(pool.recipes, menu, day, meal, target)
  if (!candidate) return
  const recipeId = await persistRecipe(candidate.recipe, candidate.source === 'llm' ? 'llm_regenerated' : 'template_regenerated')
  const sql = sqlClient()
  await sql`
    update menu_meals set recipe_id = ${recipeId}, nutrition_snapshot = ${sql.json(candidate.recipe.nutrition as any)}
    where id = ${menuMealId} and user_id = ${localUserId()}
  `
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function profileAvoidedFoods(profile: Pick<ProfileRow, 'bannedFoods' | 'dislikes'>): string[] {
  return unique([...profile.bannedFoods, ...profile.dislikes])
}

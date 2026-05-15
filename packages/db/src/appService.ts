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
import { scoreRecipe, sumNutrition, templatesForSlot } from '@menumaker/nutrition'
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

  const dayNutrition: NutritionTotals[] = []
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const [day] = await sql<[{ id: string }]>`
      insert into day_plans (user_id, weekly_menu_id, day_index, locked)
      values (${localUserId()}, ${menu.id}, ${dayIndex}, false)
      returning id
    `
    if (!day) throw new Error('No se pudo crear el día.')
    const dayRecipes = buildRecipesForDay(profile, dayIndex, target)
    for (const item of dayRecipes) {
      const recipeId = await persistRecipe(item.recipe, 'generated')
      await sql`
        insert into menu_meals (user_id, day_plan_id, recipe_id, slot, locked, nutrition_snapshot)
        values (${localUserId()}, ${day.id}, ${recipeId}, ${item.slot}, false, ${sql.json(item.recipe.nutrition as any)})
      `
    }
    dayNutrition.push(sumNutrition(dayRecipes.map((item) => item.recipe.nutrition)))
  }

  const weeklyNutrition = sumNutrition(dayNutrition)
  await sql`update weekly_menus set nutrition_snapshot = ${sql.json(weeklyNutrition as any)} where id = ${menu.id}`
  if (job) {
    await sql`
      update generation_jobs set status = 'completed', weekly_menu_id = ${menu.id},
        logs = ${sql.json(['Construyendo semana', 'Generando recetas', 'Calculando nutrición', 'Finalizando'] as any)},
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

export async function adjustCaloriesAndRegenerateWeek(profileId: string, calories: number): Promise<WeeklyMenuView> {
  const current = await getCurrentMenu(profileId)
  if (!current) throw new Error('Menú no encontrado.')
  if (!Number.isFinite(calories) || calories < 900 || calories > 5000) {
    throw new Error('El objetivo calórico debe estar entre 900 y 5000 kcal/día.')
  }

  const target = retargetCalories(current.target, Math.round(calories))
  const conflict = impossibleTargetConflict(target)
  if (conflict.impossible) throw new Error(conflict.messageEs)

  const targetId = await saveMacroTarget(profileId, target)
  const { locked, lockedDays } = lockedItemsFromMenu(current)
  const regenerated = await createWeeklyMenu(profileId, targetId, target, 'chat_calorie_target_adjustment')
  await applyLockedMeals(regenerated, locked, lockedDays)
  return getWeeklyMenu(regenerated.id)
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
  const meal = menu.days.flatMap((day) => day.meals).find((item) => item.id === menuMealId)
  if (!meal) throw new Error('Comida no encontrada.')
  const profile = (await listProfiles()).find((item) => item.id === menu.profileId)
  if (!profile) throw new Error('Perfil no encontrado.')
  const inferredIngredient = inferIngredientFromRequest(request)
  const avoidedFoods = profileAvoidedFoods(profile)
  const banned = inferredIngredient ? unique([...avoidedFoods, inferredIngredient]) : avoidedFoods
  const candidates = templatesForSlot(meal.slot, banned, profile.locale).slice(0, 3)
  const scored = candidates.map((candidate) => scoreRecipe(candidate, banned))
  const kinds: ReplacementProposal['options'][number]['kind'][] = ['closest_nutrition', 'creative_delicious', 'macro_optimized']
  const affectedMeals = inferredIngredient
    ? menu.days.flatMap((day) => day.meals).filter((item) => recipeIncludes(item.recipe, inferredIngredient)).map((item) => item.id)
    : [menuMealId]
  return {
    proposalId: crypto.randomUUID(),
    inferredIngredient,
    affectedMeals,
    options: scored.map((recipe, index) => ({
      kind: kinds[index] ?? 'creative_delicious',
      recipe,
      nutrition: recipe.nutrition,
      macroImpact: diffNutrition(recipe.nutrition, meal.nutrition),
    })),
  }
}

export async function replaceMeal(menuMealId: string, recipe: RecipeCandidate): Promise<WeeklyMenuView> {
  const menu = await menuForMeal(menuMealId)
  const day = menu.days.find((item) => item.meals.some((meal) => meal.id === menuMealId))
  const meal = day?.meals.find((item) => item.id === menuMealId)
  if (!day || !meal) throw new Error('Comida no encontrada.')
  if (day.locked || meal.locked) throw new Error('Este plato está bloqueado. Desbloquéalo antes de cambiarlo.')
  const scored = scoreRecipe(recipe)
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

function buildRecipesForDay(profile: ProfileRow, dayIndex: number, targets: MacroTargets): Array<{ slot: MealSlot; recipe: ReturnType<typeof scoreRecipe> }> {
  const avoidedFoods = profileAvoidedFoods(profile)
  const base = mealSlots.map((slot, slotIndex) => {
    const options = templatesForSlot(slot, avoidedFoods, profile.locale)
    const selected = options[(dayIndex + slotIndex) % options.length] ?? options[0]
    if (!selected) throw new Error(`No hay receta disponible para ${slot}.`)
    return { slot, recipe: scoreRecipe(selected, avoidedFoods) }
  })
  const total = sumNutrition(base.map((item) => item.recipe.nutrition))
  const factor = Math.max(0.75, Math.min(1.35, targets.calories / Math.max(total.calories, 1)))
  return base.map((item) => ({ ...item, recipe: scoreRecipe(scaleRecipe(item.recipe, factor), profile.bannedFoods) }))
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
  const sql = sqlClient()
  const [meal] = await sql`select slot from menu_meals where id = ${menuMealId} and user_id = ${localUserId()}`
  if (!meal) return
  const candidate = buildRecipesForDay(profile, dayIndex + 1, target).find((item) => item.slot === meal.slot)
  if (!candidate) return
  const recipeId = await persistRecipe(candidate.recipe, 'regenerated')
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

function inferIngredientFromRequest(request: string): string | null {
  const normalized = request.toLowerCase()
  const candidates = ['brócoli', 'brocoli', 'pollo', 'arroz', 'huevo', 'atún', 'atun', 'salmón', 'salmon', 'yogur']
  return candidates.find((candidate) => normalized.includes(candidate)) ?? null
}

function recipeIncludes(recipe: RecipeView, ingredient: string): boolean {
  const normalized = ingredient.toLowerCase()
  return recipe.ingredients.some((item) => item.name.toLowerCase().includes(normalized))
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

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function profileAvoidedFoods(profile: Pick<ProfileRow, 'bannedFoods' | 'dislikes'>): string[] {
  return unique([...profile.bannedFoods, ...profile.dislikes])
}

import { createHash, randomUUID } from 'node:crypto'
import {
  mealSlotLabels,
  type Locale,
  type MacroTargets,
  type MealSlot,
  type NutritionTotals,
  type RecipeCandidate,
} from '@menumaker/core'
import { normalizeIngredientName, scoreRecipe, sumNutrition, templatesForSlot } from '@menumaker/nutrition'

export type CalorieAdjustmentDecisionKind =
  | 'portion_resize'
  | 'ingredient_rebalance'
  | 'recipe_replacement'
  | 'preserve_locked'

export interface CaloriePlannerProfile {
  id: string
  locale: Locale
  likes: string[]
  dislikes: string[]
  bannedFoods: string[]
}

export interface CaloriePlannerMenu {
  id: string
  profileId: string
  weekStart: string
  locale: Locale
  nutrition: NutritionTotals
  target: MacroTargets
  days: Array<{
    id: string
    dayIndex: number
    locked: boolean
    meals: CaloriePlannerMeal[]
  }>
}

export interface CaloriePlannerMeal {
  id: string
  slot: MealSlot
  locked: boolean
  nutrition: NutritionTotals
  recipe: RecipeCandidate & {
    id: string
    nutrition: NutritionTotals
  }
}

export interface CalorieAdjustmentDecision {
  dayIndex: number
  dayId: string
  dayLocked: boolean
  slot: MealSlot
  menuMealId: string
  locked: boolean
  kind: CalorieAdjustmentDecisionKind
  reason: string
  previousRecipeId: string
  previousTitle: string
  nextTitle: string
  existingRecipeId?: string
  recipe: RecipeCandidate
  nutrition: NutritionTotals
  previousNutrition: NutritionTotals
  delta: NutritionTotals
  satietyScore: number
  score: number
}

export interface CalorieAdjustmentDayImpact {
  dayIndex: number
  calories: number
  targetCalories: number
  deltaFromTarget: number
  proteinG: number
  targetProteinG: number
}

export interface CalorieAdjustmentPlan {
  planId: string
  profileId: string
  baseMenuId: string
  baseMenuHash: string
  baseCalories: number
  targetCalories: number
  baseWeeklyNutrition: NutritionTotals
  targetWeeklyNutrition: NutritionTotals
  plannedWeeklyNutrition: NutritionTotals
  weeklyImpact: NutritionTotals
  dailyImpacts: CalorieAdjustmentDayImpact[]
  decisionCounts: Record<CalorieAdjustmentDecisionKind, number>
  affectedMealIds: string[]
  decisions: CalorieAdjustmentDecision[]
  warnings: string[]
  summaryMarkdown: string
  confirmationMarkdown: string
}

interface Candidate {
  kind: CalorieAdjustmentDecisionKind
  reason: string
  recipe: RecipeCandidate
  nutrition: NutritionTotals
  existingRecipeId?: string
  score: number
  satietyScore: number
}

interface CandidateBucket {
  dayId: string
  dayIndex: number
  dayLocked: boolean
  meal: CaloriePlannerMeal
  locked: boolean
  candidates: Candidate[]
}

const slotShares: Record<MealSlot, number> = {
  breakfast: 0.23,
  lunch: 0.32,
  dinner: 0.32,
  snack: 0.13,
}

const slotMinimumVolume: Record<MealSlot, number> = {
  breakfast: 230,
  lunch: 420,
  dinner: 400,
  snack: 150,
}

export function buildCalorieAdjustmentPlan(input: {
  profile: CaloriePlannerProfile
  currentMenu: CaloriePlannerMenu
  target: MacroTargets
  savedRecipeIds?: string[]
}): CalorieAdjustmentPlan {
  const saved = new Set(input.savedRecipeIds ?? [])
  const buckets: CandidateBucket[] = []

  for (const day of input.currentMenu.days) {
    for (const meal of day.meals) {
      const targetCalories = input.target.calories * slotShares[meal.slot]
      const targetProtein = input.target.proteinG * slotShares[meal.slot]
      const locked = day.locked || meal.locked
      const candidates = locked
        ? [preserveLockedCandidate(meal)]
        : candidateOptions({
            profile: input.profile,
            meal,
            targetCalories,
            targetProtein,
            savedRecipeIds: saved,
            dayIndex: day.dayIndex,
          })

      buckets.push({
        dayIndex: day.dayIndex,
        dayId: day.id,
        dayLocked: day.locked,
        locked,
        meal,
        candidates,
      })
    }
  }

  const selectedCandidates = optimizeMenuCandidates(buckets, input.target)
  const decisions = buckets.map((bucket, index) => {
    const candidate = selectedCandidates[index] ?? preferredCandidate(bucket.candidates) ?? preserveLockedCandidate(bucket.meal)
    return {
      dayIndex: bucket.dayIndex,
      dayId: bucket.dayId,
      dayLocked: bucket.dayLocked,
      slot: bucket.meal.slot,
      menuMealId: bucket.meal.id,
      locked: bucket.locked,
      kind: candidate.kind,
      reason: candidate.reason,
      previousRecipeId: bucket.meal.recipe.id,
      previousTitle: bucket.meal.recipe.title,
      nextTitle: candidate.recipe.title,
      existingRecipeId: candidate.existingRecipeId,
      recipe: candidate.recipe,
      nutrition: candidate.nutrition,
      previousNutrition: bucket.meal.nutrition,
      delta: diffNutrition(candidate.nutrition, bucket.meal.nutrition),
      satietyScore: candidate.satietyScore,
      score: candidate.score,
    }
  })

  const plannedWeeklyNutrition = sumNutrition(decisions.map((decision) => decision.nutrition))
  const targetWeeklyNutrition: NutritionTotals = {
    calories: round(input.target.calories * 7),
    proteinG: round(input.target.proteinG * 7),
    carbsG: round(input.target.carbsG * 7),
    fatG: round(input.target.fatG * 7),
    confidence: plannedWeeklyNutrition.confidence,
  }
  const dailyImpacts = buildDailyImpacts(decisions, input.target)
  const decisionCounts = countDecisions(decisions)
  const warnings = buildWarnings(input.currentMenu, input.target, decisions, dailyImpacts)
  const summaryMarkdown = buildPlanSummary({
    baseCalories: input.currentMenu.target.calories,
    targetCalories: input.target.calories,
    decisionCounts,
    weeklyImpact: diffNutrition(plannedWeeklyNutrition, input.currentMenu.nutrition),
    dailyImpacts,
    decisions,
    warnings,
  })

  return {
    planId: randomUUID(),
    profileId: input.profile.id,
    baseMenuId: input.currentMenu.id,
    baseMenuHash: currentMenuHash(input.currentMenu),
    baseCalories: input.currentMenu.target.calories,
    targetCalories: input.target.calories,
    baseWeeklyNutrition: input.currentMenu.nutrition,
    targetWeeklyNutrition,
    plannedWeeklyNutrition,
    weeklyImpact: diffNutrition(plannedWeeklyNutrition, input.currentMenu.nutrition),
    dailyImpacts,
    decisionCounts,
    affectedMealIds: decisions.filter((decision) => decision.kind !== 'preserve_locked').map((decision) => decision.menuMealId),
    decisions,
    warnings,
    summaryMarkdown,
    confirmationMarkdown: `${summaryMarkdown}\n\n¿Aplicar este reajuste?`,
  }
}

export function currentMenuHash(menu: CaloriePlannerMenu): string {
  const payload = {
    id: menu.id,
    targetCalories: menu.target.calories,
    days: menu.days.map((day) => ({
      id: day.id,
      dayIndex: day.dayIndex,
      locked: day.locked,
      meals: day.meals.map((meal) => ({
        id: meal.id,
        slot: meal.slot,
        locked: meal.locked,
        recipeId: meal.recipe.id,
        title: meal.recipe.title,
        nutrition: meal.nutrition,
        ingredients: meal.recipe.ingredients.map((ingredient) => ({
          name: ingredient.name,
          amount: ingredient.amount,
          unit: ingredient.unit,
        })),
      })),
    })),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24)
}

function candidateOptions(input: {
  profile: CaloriePlannerProfile
  meal: CaloriePlannerMeal
  targetCalories: number
  targetProtein: number
  savedRecipeIds: Set<string>
  dayIndex: number
}): Candidate[] {
  const candidates = [
    resizeCandidate(input),
    rebalanceCandidate(input),
    ...replacementCandidates(input),
  ].filter((candidate) => isFinite(candidate.score))

  return candidates.length > 0 ? candidates.sort((left, right) => right.score - left.score) : [resizeCandidate(input)]
}

function preferredCandidate(candidates: Candidate[]): Candidate | undefined {
  const sorted = [...candidates].sort((left, right) => right.score - left.score)
  const bestNonReplacement = sorted.find((candidate) => candidate.kind !== 'recipe_replacement')
  const bestReplacement = sorted.find((candidate) => candidate.kind === 'recipe_replacement')
  if (bestReplacement && bestNonReplacement && bestReplacement.score - bestNonReplacement.score < 16) return bestNonReplacement
  return sorted[0]
}

function optimizeMenuCandidates(buckets: CandidateBucket[], target: MacroTargets): Candidate[] {
  const selected = buckets.map((bucket) => preferredCandidate(bucket.candidates) ?? preserveLockedCandidate(bucket.meal))
  let bestScore = menuScore(buckets, selected, target)

  for (let pass = 0; pass < 3; pass += 1) {
    let improved = false
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]
      if (!bucket || bucket.locked) continue
      let bestCandidate = selected[index]!
      let candidateScore = bestScore
      for (const candidate of bucket.candidates) {
        if (candidate === selected[index]) continue
        const trial = [...selected]
        trial[index] = candidate
        const trialScore = menuScore(buckets, trial, target)
        if (trialScore > candidateScore + 0.25) {
          bestCandidate = candidate
          candidateScore = trialScore
        }
      }
      if (bestCandidate !== selected[index]) {
        selected[index] = bestCandidate
        bestScore = candidateScore
        improved = true
      }
    }
    if (!improved) break
  }

  return selected
}

function menuScore(buckets: CandidateBucket[], selected: Candidate[], target: MacroTargets): number {
  const nutrition = sumNutrition(selected.map((candidate) => candidate.nutrition))
  const weeklyCalories = target.calories * 7
  const weeklyProtein = target.proteinG * 7
  const weeklyCarbs = target.carbsG * 7
  const weeklyFat = target.fatG * 7
  const weeklyPenalty =
    relativeError(nutrition.calories, weeklyCalories) * 280 +
    Math.max(0, (weeklyProtein - nutrition.proteinG) / Math.max(weeklyProtein, 1)) * 180 +
    Math.max(0, (weeklyFat * 0.82 - nutrition.fatG) / Math.max(weeklyFat, 1)) * 120 +
    relativeError(nutrition.carbsG, weeklyCarbs) * 55

  let dailyPenalty = 0
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayNutrition = sumNutrition(selected
      .filter((_, index) => buckets[index]?.dayIndex === dayIndex)
      .map((candidate) => candidate.nutrition))
    const calorieError = Math.abs(dayNutrition.calories - target.calories) / Math.max(target.calories, 1)
    dailyPenalty += calorieError > 0.2 ? calorieError * 90 : calorieError * 35
    dailyPenalty += Math.max(0, (target.proteinG * 0.85 - dayNutrition.proteinG) / Math.max(target.proteinG, 1)) * 60
  }

  const duplicateTitles = selected.length - new Set(selected.map((candidate) => candidate.recipe.title)).size
  const changePenalty = selected.reduce((total, candidate) => {
    if (candidate.kind === 'preserve_locked') return total
    if (candidate.kind === 'ingredient_rebalance') return total + 1.5
    if (candidate.kind === 'portion_resize') return total + 2.5
    return total + 9
  }, 0)
  const hardPenalty = selected.reduce((total, candidate) => {
    const prepPenalty = candidate.recipe.prepTimeMinutes > 120 ? 500 : 0
    const confidencePenalty = candidate.nutrition.confidence === 'unknown' ? 500 : 0
    return total + prepPenalty + confidencePenalty
  }, 0)
  const candidateFit = selected.reduce((total, candidate) => total + candidate.score, 0) / Math.max(selected.length, 1)
  const satiety = selected.reduce((total, candidate) => total + candidate.satietyScore, 0) / Math.max(selected.length, 1)

  return round(candidateFit + satiety * 0.25 - weeklyPenalty - dailyPenalty - duplicateTitles * 5 - changePenalty - hardPenalty)
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(expected, 1)
}

function preserveLockedCandidate(meal: CaloriePlannerMeal): Candidate {
  return {
    kind: 'preserve_locked',
    reason: 'La comida o el día están bloqueados; se conserva exactamente.',
    recipe: toRecipeCandidate(meal.recipe),
    nutrition: meal.nutrition,
    existingRecipeId: meal.recipe.id,
    score: 1000,
    satietyScore: satietyScore(toRecipeCandidate(meal.recipe), meal.nutrition, meal.slot),
  }
}

function resizeCandidate(input: {
  profile: CaloriePlannerProfile
  meal: CaloriePlannerMeal
  targetCalories: number
  targetProtein: number
  savedRecipeIds: Set<string>
}): Candidate {
  const ratio = input.targetCalories / Math.max(input.meal.nutrition.calories, 1)
  const recipe = scaleRecipe(toRecipeCandidate(input.meal.recipe), clamp(ratio, 0.68, 1.28))
  const nutrition = scoreRecipe(recipe, input.profile.bannedFoods).nutrition
  return scoredCandidate({
    kind: 'portion_resize',
    reason: 'Misma receta con porciones ajustadas de forma uniforme.',
    recipe,
    nutrition,
    meal: input.meal,
    profile: input.profile,
    targetCalories: input.targetCalories,
    targetProtein: input.targetProtein,
    savedRecipeIds: input.savedRecipeIds,
  })
}

function rebalanceCandidate(input: {
  profile: CaloriePlannerProfile
  meal: CaloriePlannerMeal
  targetCalories: number
  targetProtein: number
  savedRecipeIds: Set<string>
}): Candidate {
  const current = input.meal.nutrition.calories
  const ratio = input.targetCalories / Math.max(current, 1)
  const direction = ratio >= 1 ? 'up' : 'down'
  const recipe = {
    ...toRecipeCandidate(input.meal.recipe),
    ingredients: input.meal.recipe.ingredients.map((ingredient) => {
      const kind = ingredientRole(ingredient.name)
      const factor = ingredientFactor(kind, direction, ratio)
      return {
        ...ingredient,
        amount: roundAmount(Math.max(minimumAmount(kind, ingredient.amount), ingredient.amount * factor)),
      }
    }),
  }
  const calibrated = calibrateFlexibleIngredients(recipe, input.targetCalories)
  const nutrition = scoreRecipe(calibrated, input.profile.bannedFoods).nutrition
  return scoredCandidate({
    kind: 'ingredient_rebalance',
    reason: direction === 'down'
      ? 'Mismo plato reequilibrado: protege proteína/volumen y recorta ingredientes densos.'
      : 'Mismo plato reequilibrado: añade energía con ingredientes compatibles antes de reemplazar.',
    recipe: calibrated,
    nutrition,
    meal: input.meal,
    profile: input.profile,
    targetCalories: input.targetCalories,
    targetProtein: input.targetProtein,
    savedRecipeIds: input.savedRecipeIds,
  })
}

function replacementCandidates(input: {
  profile: CaloriePlannerProfile
  meal: CaloriePlannerMeal
  targetCalories: number
  targetProtein: number
  savedRecipeIds: Set<string>
  dayIndex: number
}): Candidate[] {
  return templatesForSlot(input.meal.slot, [...input.profile.bannedFoods, ...input.profile.dislikes], input.profile.locale)
    .filter((recipe) => recipe.title !== input.meal.recipe.title)
    .slice(0, 5)
    .map((recipe, index) => {
      const calibrated = calibrateFlexibleIngredients(scaleRecipe(recipe, clamp(input.targetCalories / Math.max(scoreRecipe(recipe).nutrition.calories, 1), 0.72, 1.32)), input.targetCalories)
      const nutrition = scoreRecipe(calibrated, input.profile.bannedFoods).nutrition
      return scoredCandidate({
        kind: 'recipe_replacement',
        reason: `Receta alternativa validada contra el objetivo del ${slotLabel(input.meal.slot, input.profile.locale)} y el menú semanal.`,
        recipe: {
          ...calibrated,
          tags: [...new Set([...calibrated.tags, `alternativa-${input.dayIndex}-${index}`])],
        },
        nutrition,
        meal: input.meal,
        profile: input.profile,
        targetCalories: input.targetCalories,
        targetProtein: input.targetProtein,
        savedRecipeIds: input.savedRecipeIds,
      })
    })
}

function scoredCandidate(input: {
  kind: CalorieAdjustmentDecisionKind
  reason: string
  recipe: RecipeCandidate
  nutrition: NutritionTotals
  meal: CaloriePlannerMeal
  profile: CaloriePlannerProfile
  targetCalories: number
  targetProtein: number
  savedRecipeIds: Set<string>
}): Candidate {
  const satiety = satietyScore(input.recipe, input.nutrition, input.meal.slot)
  const calorieError = Math.abs(input.nutrition.calories - input.targetCalories) / Math.max(input.targetCalories, 1)
  const proteinError = Math.max(0, input.targetProtein - input.nutrition.proteinG) / Math.max(input.targetProtein, 1)
  const confidencePenalty = input.nutrition.confidence === 'unknown' ? 100 : input.nutrition.confidence === 'estimated' ? 25 : 0
  const prepPenalty = input.recipe.prepTimeMinutes > 120 ? 100 : 0
  const savedPenalty = input.savedRecipeIds.has(input.meal.recipe.id) && input.kind === 'recipe_replacement' ? 8 : 0
  const changeCost = input.kind === 'portion_resize' ? 5 : input.kind === 'ingredient_rebalance' ? 3 : 22
  const integrityPenalty = culinaryIntegrityPenalty(input.recipe, input.nutrition, input.meal.slot)
  const preferenceScore = preferenceAdjustment(input.recipe, input.profile)
  return {
    kind: input.kind,
    reason: input.reason,
    recipe: input.recipe,
    nutrition: input.nutrition,
    satietyScore: round(satiety),
    score: round(120 - calorieError * 90 - proteinError * 55 + satiety * 0.35 + preferenceScore - confidencePenalty - prepPenalty - savedPenalty - changeCost - integrityPenalty),
  }
}

function preferenceAdjustment(recipe: RecipeCandidate, profile: CaloriePlannerProfile): number {
  const haystack = normalizeIngredientName([
    recipe.title,
    recipe.cuisine,
    recipe.flavorProfile,
    ...recipe.tags,
    ...recipe.ingredients.map((ingredient) => ingredient.name),
  ].join(' '))
  const liked = profile.likes.filter((item) => haystack.includes(normalizeIngredientName(item))).length
  const disliked = profile.dislikes.filter((item) => haystack.includes(normalizeIngredientName(item))).length
  const banned = profile.bannedFoods.filter((item) => haystack.includes(normalizeIngredientName(item))).length
  return Math.min(liked, 3) * 4 - disliked * 12 - banned * 120
}

function satietyScore(recipe: RecipeCandidate, nutrition: NutritionTotals, slot: MealSlot): number {
  const grams = recipe.ingredients.reduce((total, ingredient) => total + normalizedApproxGrams(ingredient.amount, ingredient.unit), 0)
  const density = nutrition.calories / Math.max(grams, 1)
  const fiber = nutrition.fiberG ?? 0
  const vegFruitGrams = recipe.ingredients
    .filter((ingredient) => ['tomate', 'brocoli', 'brócoli', 'espinacas', 'platano', 'plátano'].some((item) => normalizeIngredientName(ingredient.name).includes(normalizeIngredientName(item))))
    .reduce((total, ingredient) => total + normalizedApproxGrams(ingredient.amount, ingredient.unit), 0)
  const volumeScore = clamp((grams / slotMinimumVolume[slot]) * 35, 0, 35)
  const proteinScore = clamp(nutrition.proteinG * 0.9, 0, 28)
  const fiberScore = clamp(fiber * 3.5, 0, 18)
  const vegScore = clamp((vegFruitGrams / 180) * 14, 0, 14)
  const densityScore = density <= 1.4 ? 18 : density <= 2.1 ? 10 : 2
  return volumeScore + proteinScore + fiberScore + vegScore + densityScore
}

function culinaryIntegrityPenalty(recipe: RecipeCandidate, nutrition: NutritionTotals, slot: MealSlot): number {
  const grams = recipe.ingredients.reduce((total, ingredient) => total + normalizedApproxGrams(ingredient.amount, ingredient.unit), 0)
  let penalty = grams < slotMinimumVolume[slot] * 0.78 ? 18 : 0
  if (nutrition.proteinG < (slot === 'snack' ? 12 : 24)) penalty += 10
  for (const ingredient of recipe.ingredients) {
    const role = ingredientRole(ingredient.name)
    if (normalizedApproxGrams(ingredient.amount, ingredient.unit) < minimumAmount(role, ingredient.amount) * 0.95) penalty += 4
  }
  return penalty
}

function calibrateFlexibleIngredients(recipe: RecipeCandidate, targetCalories: number): RecipeCandidate {
  let calibrated = recipe
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nutrition = scoreRecipe(calibrated).nutrition
    const delta = targetCalories - nutrition.calories
    if (Math.abs(delta) < targetCalories * 0.06) return calibrated
    const direction = delta >= 0 ? 1 : -1
    const magnitude = clamp(Math.abs(delta) / Math.max(targetCalories, 1), 0.04, 0.18)
    calibrated = {
      ...calibrated,
      ingredients: calibrated.ingredients.map((ingredient) => {
        const role = ingredientRole(ingredient.name)
        if (!isFlexibleRole(role)) return ingredient
        const factor = 1 + direction * magnitude * (role === 'fat' ? 0.65 : role === 'carb' ? 1 : 0.4)
        return {
          ...ingredient,
          amount: roundAmount(Math.max(minimumAmount(role, ingredient.amount), ingredient.amount * factor)),
        }
      }),
    }
  }
  return calibrated
}

function buildDailyImpacts(decisions: CalorieAdjustmentDecision[], target: MacroTargets): CalorieAdjustmentDayImpact[] {
  const result: CalorieAdjustmentDayImpact[] = []
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayDecisions = decisions.filter((decision) => decision.dayIndex === dayIndex)
    const nutrition = sumNutrition(dayDecisions.map((decision) => decision.nutrition))
    result.push({
      dayIndex,
      calories: nutrition.calories,
      targetCalories: target.calories,
      deltaFromTarget: round(nutrition.calories - target.calories),
      proteinG: nutrition.proteinG,
      targetProteinG: target.proteinG,
    })
  }
  return result
}

function buildWarnings(
  menu: CaloriePlannerMenu,
  target: MacroTargets,
  decisions: CalorieAdjustmentDecision[],
  dailyImpacts: CalorieAdjustmentDayImpact[],
): string[] {
  const warnings: string[] = []
  const lockedCount = decisions.filter((decision) => decision.kind === 'preserve_locked').length
  if (lockedCount > 0) warnings.push(`${lockedCount} comida(s) bloqueadas se conservan y pueden limitar el ajuste.`)
  const lowSatiety = decisions.filter((decision) => decision.kind !== 'preserve_locked' && decision.satietyScore < 45)
  if (lowSatiety.length > 0) warnings.push(`${lowSatiety.length} comida(s) quedan con saciedad estimada baja; se priorizaron macros y locks.`)
  const lowProteinDays = dailyImpacts.filter((day) => day.proteinG < target.proteinG * 0.88)
  if (lowProteinDays.length > 0) warnings.push(`${lowProteinDays.length} día(s) quedan bajos de proteína frente al objetivo.`)
  const unevenDays = dailyImpacts.filter((day) => Math.abs(day.deltaFromTarget) > target.calories * 0.18)
  if (unevenDays.length > 0) warnings.push(`${unevenDays.length} día(s) quedan lejos del objetivo diario; el promedio semanal se prioriza.`)
  if (menu.nutrition.confidence === 'unknown' || menu.nutrition.confidence === 'estimated') warnings.push('El menú base tiene confianza nutricional limitada.')
  return warnings
}

function buildPlanSummary(input: {
  baseCalories: number
  targetCalories: number
  decisionCounts: Record<CalorieAdjustmentDecisionKind, number>
  weeklyImpact: NutritionTotals
  dailyImpacts: CalorieAdjustmentDayImpact[]
  decisions: CalorieAdjustmentDecision[]
  warnings: string[]
}): string {
  const counts = input.decisionCounts
  const biggestChanges = [...input.decisions]
    .filter((decision) => decision.kind !== 'preserve_locked')
    .sort((left, right) => Math.abs(right.delta.calories) - Math.abs(left.delta.calories))
    .slice(0, 4)
    .map((decision) => `- ${dayName(decision.dayIndex)} ${slotLabel(decision.slot, 'es')}: ${decision.previousTitle}${decision.previousTitle === decision.nextTitle ? '' : ` -> ${decision.nextTitle}`} (${formatSigned(decision.delta.calories)} kcal, ${kindLabel(decision.kind)})`)
  return [
    `Preparé un reajuste de **${input.baseCalories}** a **${input.targetCalories} kcal/día**. Todavía no he cambiado el menú.`,
    `**Plan:** ${counts.portion_resize} porción(es), ${counts.ingredient_rebalance} rebalanceo(s), ${counts.recipe_replacement} reemplazo(s), ${counts.preserve_locked} bloqueada(s) preservada(s).`,
    `**Impacto semanal previsto:** ${formatSigned(input.weeklyImpact.calories)} kcal, ${formatSigned(input.weeklyImpact.proteinG)} g proteína, ${formatSigned(input.weeklyImpact.carbsG)} g carbos, ${formatSigned(input.weeklyImpact.fatG)} g grasa.`,
    biggestChanges.length > 0 ? `**Cambios principales:**\n${biggestChanges.join('\n')}` : '',
    input.warnings.length > 0 ? `**Avisos:**\n${input.warnings.map((warning) => `- ${warning}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

function countDecisions(decisions: CalorieAdjustmentDecision[]): Record<CalorieAdjustmentDecisionKind, number> {
  return {
    portion_resize: decisions.filter((decision) => decision.kind === 'portion_resize').length,
    ingredient_rebalance: decisions.filter((decision) => decision.kind === 'ingredient_rebalance').length,
    recipe_replacement: decisions.filter((decision) => decision.kind === 'recipe_replacement').length,
    preserve_locked: decisions.filter((decision) => decision.kind === 'preserve_locked').length,
  }
}

type IngredientRole = 'protein' | 'carb' | 'fat' | 'veg' | 'fruit' | 'mixed'

function ingredientRole(name: string): IngredientRole {
  const normalized = normalizeIngredientName(name)
  if (/(aceite|aguacate|nuez|almendra|queso)/.test(normalized)) return 'fat'
  if (/(arroz|patata|avena|pan|pasta|platano)/.test(normalized)) return normalized.includes('platano') ? 'fruit' : 'carb'
  if (/(pollo|atun|atún|salmon|salmón|huevo|yogur|merluza|pavo)/.test(normalized)) return 'protein'
  if (/(tomate|brocoli|brócoli|espinaca|verdura|lechuga)/.test(normalized)) return 'veg'
  if (/(lenteja|garbanzo|alubia)/.test(normalized)) return 'mixed'
  return 'mixed'
}

function ingredientFactor(role: IngredientRole, direction: 'up' | 'down', ratio: number): number {
  if (direction === 'up') {
    if (role === 'carb') return clamp(1 + (ratio - 1) * 1.15, 1, 1.55)
    if (role === 'protein') return clamp(1 + (ratio - 1) * 0.45, 1, 1.22)
    if (role === 'fat') return clamp(1 + (ratio - 1) * 0.45, 1, 1.18)
    if (role === 'veg' || role === 'fruit') return clamp(1 + (ratio - 1) * 0.3, 1, 1.22)
    return clamp(1 + (ratio - 1) * 0.75, 1, 1.35)
  }
  if (role === 'fat') return clamp(0.5 + ratio * 0.35, 0.45, 0.92)
  if (role === 'carb') return clamp(0.62 + ratio * 0.28, 0.58, 0.96)
  if (role === 'protein') return clamp(0.82 + ratio * 0.13, 0.8, 0.98)
  if (role === 'veg') return ratio < 0.86 ? 1.12 : 1
  if (role === 'fruit') return clamp(0.78 + ratio * 0.18, 0.72, 0.98)
  return clamp(0.72 + ratio * 0.22, 0.68, 0.96)
}

function isFlexibleRole(role: IngredientRole): boolean {
  return role === 'carb' || role === 'fat' || role === 'mixed' || role === 'fruit'
}

function minimumAmount(role: IngredientRole, current: number): number {
  if (role === 'fat') return Math.min(current, 3)
  if (role === 'carb') return Math.min(current, 35)
  if (role === 'protein') return Math.min(current, 80)
  if (role === 'veg') return Math.min(current, 60)
  if (role === 'fruit') return Math.min(current, 45)
  return Math.min(current, 50)
}

function toRecipeCandidate(recipe: CaloriePlannerMeal['recipe']): RecipeCandidate {
  return {
    title: recipe.title,
    locale: recipe.locale,
    description: recipe.description,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cuisine: recipe.cuisine,
    flavorProfile: recipe.flavorProfile,
    tags: recipe.tags,
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      amount: ingredient.amount,
      unit: ingredient.unit,
      preparation: ingredient.preparation,
    })),
    steps: recipe.steps,
  }
}

function scaleRecipe(recipe: RecipeCandidate, factor: number): RecipeCandidate {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      amount: roundAmount(ingredient.amount * factor),
    })),
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

function dayName(dayIndex: number): string {
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][dayIndex] ?? `Día ${dayIndex + 1}`
}

function slotLabel(slot: MealSlot, locale: Locale): string {
  return mealSlotLabels[locale][slot].toLowerCase()
}

function kindLabel(kind: CalorieAdjustmentDecisionKind): string {
  if (kind === 'portion_resize') return 'porción'
  if (kind === 'ingredient_rebalance') return 'rebalanceo'
  if (kind === 'recipe_replacement') return 'reemplazo'
  return 'bloqueado'
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${round(value)}`
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function roundAmount(value: number): number {
  return Math.max(1, Math.round(value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

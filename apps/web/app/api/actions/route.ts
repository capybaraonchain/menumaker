import {
  adjustCaloriesAndRegenerateWeek,
  applySimilarIngredientReplacements,
  getAppState,
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
} from '@menumaker/db'
import { codexStatus } from '@menumaker/ai'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    let result: unknown
    if (body.action === 'lockMeal') result = await lockMeal(body.menuMealId, body.locked)
    else if (body.action === 'lockDay') result = await lockDay(body.dayPlanId, body.locked)
    else if (body.action === 'adjustCaloriesAndRegenerateWeek') {
      result = await adjustCaloriesAndRegenerateWeek(body.profileId, Number(body.calories))
    }
    else if (body.action === 'regenerateWeek') result = await regenerateWeek(body.menuId)
    else if (body.action === 'regenerateDay') result = await regenerateDay(body.dayPlanId)
    else if (body.action === 'regenerateMeal') result = await regenerateMeal(body.menuMealId)
    else if (body.action === 'suggestReplacements') result = await suggestMealReplacements(body.menuMealId, body.request)
    else if (body.action === 'replaceMeal') result = await replaceMeal(body.menuMealId, body.recipe)
    else if (body.action === 'applySimilarReplacements') {
      result = await applySimilarIngredientReplacements(body.profileId, body.menuMealIds ?? [], body.ingredient)
    } else if (body.action === 'savePreference') {
      await saveProfilePreference(body.profileId, body.value, body.kind ?? 'dislike', body.scope ?? 'profile')
      result = { changed: true }
    } else if (body.action === 'starRecipe') {
      await starRecipe(body.profileId, body.recipeId)
      result = { changed: true }
    } else if (body.action === 'unstarRecipe') {
      await unstarRecipe(body.savedRecipeId)
      result = { changed: true }
    } else {
      return NextResponse.json({ error: 'Acción no soportada.' }, { status: 400 })
    }
    const state = body.profileId ? { ...(await getAppState(body.profileId)), provider: codexStatus() } : undefined
    return NextResponse.json({ result, state })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error de acción.' }, { status: 400 })
  }
}

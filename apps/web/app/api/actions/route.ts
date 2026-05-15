import { appActionRegistry, executeAppAction, getAppState, type AppActionName } from '@menumaker/db'
import { codexStatus } from '@menumaker/ai'
import { NextResponse } from 'next/server'

const legacyActionNames: Record<string, AppActionName> = {
  adjustCaloriesAndRegenerateWeek: 'applyCalorieTargetChange',
  applySimilarReplacements: 'applySimilarReplacements',
  lockDay: 'lockDay',
  lockMeal: 'lockMeal',
  regenerateDay: 'regenerateDay',
  regenerateMeal: 'regenerateMeal',
  regenerateWeek: 'regenerateWeek',
  replaceMeal: 'replaceMeal',
  savePreference: 'savePreference',
  starRecipe: 'starRecipe',
  suggestReplacements: 'suggestMealReplacement',
  unstarRecipe: 'unstarRecipe',
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const actionName = legacyActionNames[String(body.action)] ?? body.action
    if (!Object.prototype.hasOwnProperty.call(appActionRegistry, actionName)) {
      return NextResponse.json({ error: 'Acción no soportada.' }, { status: 400 })
    }
    const result = await executeAppAction(actionName, body)
    const state = body.profileId ? { ...(await getAppState(body.profileId)), provider: codexStatus() } : undefined
    return NextResponse.json({ result, state })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error de acción.' }, { status: 400 })
  }
}

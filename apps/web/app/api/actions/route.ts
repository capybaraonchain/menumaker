import {
  appActionRegistry,
  cancelPendingAction,
  confirmPendingAction,
  executeAppAction,
  getAppState,
  type AppActionName,
} from '@menumaker/db'
import { codexStatus } from '@menumaker/ai'
import { NextResponse } from 'next/server'

const legacyActionNames: Record<string, AppActionName> = {
  adjustCaloriesAndRegenerateWeek: 'applyCalorieTargetChange',
  applySimilarReplacements: 'applySimilarReplacements',
  cancelGenerationJob: 'cancelGenerationJob',
  deleteProfile: 'deleteProfile',
  enqueuePreviewGenerationJob: 'enqueuePreviewGenerationJob',
  lockDay: 'lockDay',
  lockMeal: 'lockMeal',
  regenerateDay: 'regenerateDay',
  regenerateMeal: 'regenerateMeal',
  regenerateWeek: 'regenerateWeek',
  replaceMeal: 'replaceMeal',
  resetLocalData: 'resetLocalData',
  relaxProfilePreferences: 'relaxProfilePreferences',
  retryGenerationJob: 'retryGenerationJob',
  runPreviewGenerationJob: 'runPreviewGenerationJob',
  runGenerationJob: 'runGenerationJob',
  savePreference: 'savePreference',
  saveIngredientMapping: 'saveIngredientMapping',
  setFallbackPolicy: 'setFallbackPolicy',
  startWeeklyMenuGeneration: 'startWeeklyMenuGeneration',
  starRecipe: 'starRecipe',
  suggestReplacements: 'suggestMealReplacement',
  unstarRecipe: 'unstarRecipe',
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (body.action === 'confirmPendingAction') {
      const result = await confirmPendingAction(String(body.pendingActionId))
      const state = result.state && typeof result.state === 'object' ? { ...result.state, provider: codexStatus() } : undefined
      return NextResponse.json({ result, state })
    }
    if (body.action === 'cancelPendingAction') {
      const result = await cancelPendingAction(String(body.pendingActionId))
      return NextResponse.json({ result })
    }

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

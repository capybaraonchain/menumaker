import {
  chatWithMenuContextCached,
  createPendingAction,
  getAppState,
  planChatCommandCached,
  type AppChatResponse,
  type PendingActionView,
  type WeeklyMenuView,
} from '@menumaker/db'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const message = String(body.message ?? '')
    const state = await getAppState(body.profileId)
    const deterministicResponse = await deterministicChatResponse(message, body, state)
    if (deterministicResponse) return NextResponse.json(deterministicResponse)

    if (extractRequestedCalories(message) && !state.currentMenu) {
      const markdown = 'Necesitas tener un menú semanal activo antes de reajustar el objetivo calórico.'
      const response: AppChatResponse = { type: 'message', markdown, text: markdown, actions: [] }
      return NextResponse.json(response)
    }

    if (looksActionable(message)) {
      const plannedResponse = await plannedCommandResponse(message, state)
      if (plannedResponse) return NextResponse.json(plannedResponse)
    }

    const response = await chatWithMenuContextCached({
      message,
      locale: state.activeProfile?.locale ?? 'es',
      profileName: state.activeProfile?.name,
      menuContext: state.currentMenu,
    })
    const chatResponse: AppChatResponse = {
      type: 'message',
      markdown: response.text,
      text: response.text,
      actions: [],
    }
    return NextResponse.json({ ...response, ...chatResponse })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error de chat.' }, { status: 400 })
  }
}

async function plannedCommandResponse(
  message: string,
  state: Awaited<ReturnType<typeof getAppState>>,
): Promise<AppChatResponse | null> {
  if (!state.activeProfile || !state.currentMenu) return null
  const plan = await planChatCommandCached({
    message,
    locale: state.activeProfile.locale,
    profileId: state.activeProfile.id,
    menuContext: state.currentMenu,
  })
  if (!plan || plan.confidence < 0.72) return null
  if (plan.intent === 'clarify') {
    return messageResponse(plan.clarification ?? 'Necesito un poco más de detalle para saber qué acción aplicar.')
  }
  if (!plan.action) return null
  if (plan.intent === 'regenerateWeek' && plan.action.menuId) {
    return pendingResponse(await createPendingAction('regenerateWeek', {
      profileId: state.activeProfile.id,
      menuId: plan.action.menuId,
    }, 'chat:planner'))
  }
  if (plan.intent === 'regenerateDay' && plan.action.dayPlanId) {
    return pendingResponse(await createPendingAction('regenerateDay', {
      profileId: state.activeProfile.id,
      dayPlanId: plan.action.dayPlanId,
    }, 'chat:planner'))
  }
  if (plan.intent === 'regenerateMeal' && plan.action.menuMealId) {
    return pendingResponse(await createPendingAction('regenerateMeal', {
      profileId: state.activeProfile.id,
      menuMealId: plan.action.menuMealId,
    }, 'chat:planner'))
  }
  if (plan.intent === 'savePreference' && plan.action.value && plan.action.kind) {
    return pendingResponse(await createPendingAction('savePreference', {
      profileId: state.activeProfile.id,
      value: plan.action.value,
      kind: plan.action.kind,
      scope: 'profile',
    }, 'chat:planner'))
  }
  return null
}

async function deterministicChatResponse(
  message: string,
  body: Record<string, unknown>,
  state: Awaited<ReturnType<typeof getAppState>>,
): Promise<AppChatResponse | null> {
  if (!state.activeProfile || !state.currentMenu) return null

  const requestedCalories = extractRequestedCalories(message)
  if (requestedCalories) {
    const currentCalories = state.currentMenu.target.calories
    if (currentCalories === requestedCalories) {
      return messageResponse(`Tu objetivo calórico diario ya está en **${requestedCalories} kcal/día**.`)
    }
    const pending = await createPendingAction('applyCalorieTargetChange', {
      profileId: state.activeProfile.id,
      calories: requestedCalories,
    }, 'chat')
    return pendingResponse(pending)
  }

  const regenerationIntent = extractRegenerationIntent(message)
  if (regenerationIntent?.kind === 'week') {
    return pendingResponse(await createPendingAction('regenerateWeek', {
      profileId: state.activeProfile.id,
      menuId: state.currentMenu.id,
    }, 'chat'))
  }
  if (regenerationIntent?.kind === 'day') {
    const day = state.currentMenu.days.find((item) => item.dayIndex === regenerationIntent.dayIndex)
    if (!day) return messageResponse('No encuentro ese día en el menú actual.')
    if (day.locked) return messageResponse('Ese día está bloqueado. Desbloquéalo antes de regenerarlo.')
    return pendingResponse(await createPendingAction('regenerateDay', {
      profileId: state.activeProfile.id,
      dayPlanId: day.id,
    }, 'chat'))
  }
  if (regenerationIntent?.kind === 'meal') {
    const mealId = typeof body.menuMealId === 'string'
      ? body.menuMealId
      : findMealId(state.currentMenu, regenerationIntent.dayIndex, regenerationIntent.slot)
    if (!mealId) return messageResponse('Dime qué comida quieres regenerar, por ejemplo: "regenera la cena del martes".')
    return pendingResponse(await createPendingAction('regenerateMeal', {
      profileId: state.activeProfile.id,
      menuMealId: mealId,
    }, 'chat'))
  }

  const preference = extractPreferenceIntent(message, state.currentMenu)
  if (preference) {
    if ((preference.kind === 'ban' || preference.kind === 'dislike') && preference.affectedMealIds.length > 0) {
      return pendingResponse(await createPendingAction('applySimilarReplacements', {
        profileId: state.activeProfile.id,
        ingredient: preference.value,
        menuMealIds: preference.affectedMealIds,
      }, 'chat'))
    }
    return pendingResponse(await createPendingAction('savePreference', {
      profileId: state.activeProfile.id,
      value: preference.value,
      kind: preference.kind,
      scope: 'profile',
    }, 'chat'))
  }

  return null
}

function pendingResponse(pending: PendingActionView): AppChatResponse {
  return {
    type: 'confirmation_required',
    markdown: pending.confirmationMarkdown,
    text: pending.confirmationMarkdown,
    action: pending.action,
    actions: [pending.action],
  }
}

function messageResponse(markdown: string): AppChatResponse {
  return { type: 'message', markdown, text: markdown, actions: [] }
}

type RegenerationIntent =
  | { kind: 'week' }
  | { kind: 'day'; dayIndex: number }
  | { kind: 'meal'; dayIndex: number | null; slot: string | null }

function extractRegenerationIntent(message: string): RegenerationIntent | null {
  const normalized = message.toLowerCase()
  if (!/(regenera|regenerar|rehaz|recrear|nuevo|cambia|reemplaza)/.test(normalized)) return null
  if (/(semana|men[uú])/.test(normalized)) return { kind: 'week' }
  const dayIndex = extractDayIndex(normalized)
  const slot = extractSlot(normalized)
  if (dayIndex !== null && !slot) return { kind: 'day', dayIndex }
  if (slot || /\b(plato|comida|desayuno|cena|snack)\b/.test(normalized)) return { kind: 'meal', dayIndex, slot }
  return null
}

function extractRequestedCalories(message: string): number | null {
  const normalized = message.toLowerCase()
  if (!/(kcal|calor[ií]as|cal[oó]rico|calorico|objetivo)/.test(normalized)) return null
  const match = normalized.match(/\b([1-4]\d{3}|5000|9\d{2})\b/)
  if (!match) return null
  return Number(match[1])
}

function looksActionable(message: string): boolean {
  return /\b(regenera|regenerar|rehaz|recrear|cambia|reemplaza|guarda|guardar|recuerda|no quiero|quita|sin|no me gusta|evita|prohibe|prohibir|me gusta|me encanta|prefiero)\b/i.test(message)
}

function extractPreferenceIntent(message: string, menu: WeeklyMenuView): { kind: 'like' | 'dislike' | 'ban'; value: string; affectedMealIds: string[] } | null {
  const normalized = normalizeText(message)
  const kind = /\b(prohibe|prohibir|bane?a|no uses|nunca)\b/.test(normalized)
    ? 'ban'
    : /\b(me gusta|me encanta|prefiero)\b/.test(normalized)
      ? 'like'
      : /\b(no quiero|quita|quitar|sin|no me gusta|evita|cambia)\b/.test(normalized)
        ? 'dislike'
        : null
  if (!kind) return null

  const value = findMentionedIngredient(message, menu) ?? extractFreeformPreferenceValue(message)
  if (!value) return null
  return { kind, value, affectedMealIds: findMealsWithIngredient(menu, value) }
}

function extractFreeformPreferenceValue(message: string): string | null {
  const patterns = [
    /\b(?:no quiero|quita|quitar|sin|no me gusta|evita|prohibe|prohibir|banea|no uses|me gusta|me encanta|prefiero)\s+(.+?)(?:\s+en\b|\s+del\b|\s+de la\b|\.|,|$)/i,
  ]
  for (const pattern of patterns) {
    const match = message.match(pattern)
    const value = match?.[1]?.replace(/\b(el|la|los|las|un|una|este|esta)\b/gi, '').trim()
    if (value && value.length <= 40) return value
  }
  return null
}

function findMentionedIngredient(message: string, menu: WeeklyMenuView): string | null {
  const normalizedMessage = normalizeText(message)
  const candidates = new Map<string, string>()
  for (const day of menu.days) {
    for (const meal of day.meals) {
      for (const ingredient of meal.recipe.ingredients) {
        candidates.set(normalizeText(ingredient.name), ingredient.name)
      }
    }
  }
  return [...candidates.entries()]
    .filter(([normalized]) => normalized.length > 2 && normalizedMessage.includes(normalized))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null
}

function findMealsWithIngredient(menu: WeeklyMenuView, ingredient: string): string[] {
  const normalized = normalizeText(ingredient)
  return menu.days.flatMap((day) =>
    day.meals
      .filter((meal) => meal.recipe.ingredients.some((item) => normalizeText(item.name).includes(normalized)))
      .map((meal) => meal.id),
  )
}

function findMealId(menu: WeeklyMenuView, dayIndex: number | null, slot: string | null): string | null {
  const days = dayIndex === null ? menu.days : menu.days.filter((day) => day.dayIndex === dayIndex)
  const meals = days.flatMap((day) => day.meals)
  if (slot) return meals.find((meal) => meal.slot === slot)?.id ?? null
  return meals.length === 1 ? meals[0]?.id ?? null : null
}

function extractDayIndex(message: string): number | null {
  const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
  const normalized = normalizeText(message)
  const index = days.findIndex((day) => normalized.includes(day))
  return index >= 0 ? index : null
}

function extractSlot(message: string): string | null {
  const normalized = normalizeText(message)
  if (/\bdesayuno\b/.test(normalized)) return 'breakfast'
  if (/\b(comida|almuerzo)\b/.test(normalized)) return 'lunch'
  if (/\bcena\b/.test(normalized)) return 'dinner'
  if (/\b(snack|merienda|tentempie)\b/.test(normalized)) return 'snack'
  return null
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

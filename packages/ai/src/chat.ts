import type { WeeklyMenuPlan } from '@menumaker/core'
import { codexStatus, completeStructured, completeText } from './provider'

export interface PlannedChatCommand {
  intent: 'none' | 'clarify' | 'savePreference' | 'regenerateWeek' | 'regenerateDay' | 'regenerateMeal'
  confidence: number
  clarification: string | null
  action: {
    profileId: string | null
    menuId: string | null
    dayPlanId: string | null
    menuMealId: string | null
    value: string | null
    kind: 'like' | 'dislike' | 'ban' | null
    scope: 'profile' | null
  } | null
}

export async function chatWithMenuContext(input: {
  message: string
  locale: 'es' | 'en'
  profileName?: string
  menuContext?: unknown
}): Promise<{ text: string; providerConfigured: boolean }> {
  const status = codexStatus()
  const system =
    input.locale === 'es'
      ? 'Eres el asistente de MenuMaker. Responde en español con markdown sencillo y en 1-3 frases salvo que el usuario pida detalle. Puedes explicar menús, macros y cambios, pero no afirmes calorías exactas sin nutrición determinista. No digas que has cambiado, regenerado o guardado nada: los cambios duraderos solo los ejecuta la app mediante acciones confirmadas.'
      : 'You are the MenuMaker assistant. Use simple markdown and answer in 1-3 sentences unless the user asks for detail. Explain menus, macros, and changes, but do not claim exact nutrition without deterministic data. Never say you changed, regenerated, or saved anything: durable changes are only executed by confirmed app actions.'

  if (!status.configured) {
    return {
      providerConfigured: false,
      text:
        input.locale === 'es'
          ? 'Codex OAuth no está configurado. Puedo mostrar el menú y las macros calculadas, pero el chat LLM necesita el perfil de autenticación local.'
          : 'Codex OAuth is not configured. The app can show deterministic menu data, but LLM chat needs the local auth profile.',
    }
  }

  const user = JSON.stringify(
    {
      profileName: input.profileName,
      message: input.message,
      menuContext: input.menuContext,
    },
    null,
    2,
  )
  const text = await completeText({ system, user, timeoutMs: 90_000 })
  return { text, providerConfigured: true }
}

export async function planChatCommand(input: {
  message: string
  locale: 'es' | 'en'
  profileId?: string
  menuContext?: unknown
}): Promise<PlannedChatCommand | null> {
  const status = codexStatus()
  if (!status.configured) return null

  const system =
    input.locale === 'es'
      ? [
          'Eres el planificador de herramientas de MenuMaker.',
          'Devuelve solo una intención estructurada. No escribas respuesta conversacional.',
          'Solo elige una acción si el usuario está pidiendo claramente guardar una preferencia o regenerar una semana, día o comida.',
          'Usa únicamente IDs presentes en el contexto. Si falta el día o la comida exacta, usa intent "clarify".',
          'No ejecutes acciones. La app creará una confirmación antes de cualquier mutación.',
        ].join(' ')
      : [
          'You are the MenuMaker tool planner.',
          'Return only one structured intent. Do not write conversational prose.',
          'Only choose an action when the user clearly asks to save a preference or regenerate a week, day, or meal.',
          'Use only IDs present in context. If the exact day or meal is missing, use intent "clarify".',
          'Do not execute actions. The app will create confirmation before mutations.',
        ].join(' ')

  try {
    return await completeStructured<PlannedChatCommand>({
      schemaName: 'menumaker_chat_command',
      schema: plannedCommandSchema,
      system,
      user: JSON.stringify({
        profileId: input.profileId,
        message: input.message,
        menu: compactMenuForPlanner(input.menuContext),
      }, null, 2),
      timeoutMs: 90_000,
    })
  } catch {
    return null
  }
}

export function summarizeMenuForChat(menu: unknown): unknown {
  if (!menu || typeof menu !== 'object') return menu
  return menu as WeeklyMenuPlan | unknown
}

const plannedCommandSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['none', 'clarify', 'savePreference', 'regenerateWeek', 'regenerateDay', 'regenerateMeal'] },
    confidence: { type: 'number' },
    clarification: { type: ['string', 'null'] },
    action: {
      type: ['object', 'null'],
      properties: {
        profileId: { type: ['string', 'null'] },
        menuId: { type: ['string', 'null'] },
        dayPlanId: { type: ['string', 'null'] },
        menuMealId: { type: ['string', 'null'] },
        value: { type: ['string', 'null'] },
        kind: { enum: ['like', 'dislike', 'ban', null] },
        scope: { enum: ['profile', null] },
      },
    },
  },
}

function compactMenuForPlanner(menu: unknown): unknown {
  if (!menu || typeof menu !== 'object') return null
  const current = menu as {
    id?: string
    profileId?: string
    days?: Array<{
      id: string
      dayIndex: number
      locked: boolean
      meals: Array<{
        id: string
        slot: string
        locked: boolean
        recipe: { title: string; ingredients?: Array<{ name: string }> }
      }>
    }>
  }
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

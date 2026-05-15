import { chatWithMenuContext } from '@menumaker/ai'
import { executeAppAction, getAppState } from '@menumaker/db'
import { NextResponse } from 'next/server'

type ChatResponse =
  | { type: 'message'; markdown: string; text: string; actions: [] }
  | {
      type: 'confirmation_required'
      markdown: string
      text: string
      action: {
        id: string
        name: string
        type: string
        label: string
        payload: Record<string, unknown>
      }
      actions: Array<{
        id: string
        type: string
        label: string
        payload: Record<string, unknown>
      }>
    }

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const state = await getAppState(body.profileId)
    const regenerationIntent = extractRegenerationIntent(String(body.message ?? ''))
    if (regenerationIntent === 'week' && state.activeProfile && state.currentMenu) {
      const markdown =
        'Regenerar la semana creará un nuevo menú semanal y conservará los días o comidas bloqueadas. ' +
        'Las comidas no bloqueadas serán reemplazadas. ¿Continuar?'
      const action = {
        id: crypto.randomUUID(),
        name: 'regenerateWeek',
        type: 'regenerateWeek',
        label: 'Regenerar semana',
        payload: {
          profileId: state.activeProfile.id,
          menuId: state.currentMenu.id,
        },
      }
      const response: ChatResponse = {
        type: 'confirmation_required',
        markdown,
        text: markdown,
        action,
        actions: [action],
      }
      return NextResponse.json(response)
    }

    const requestedCalories = extractRequestedCalories(String(body.message ?? ''))
    if (requestedCalories && state.activeProfile && state.currentMenu) {
      const proposal = await executeAppAction('proposeCalorieTargetChange', {
        profileId: state.activeProfile.id,
        calories: requestedCalories,
      }) as { markdown: string; currentCalories?: number; requestedCalories: number }
      if (proposal.currentCalories === requestedCalories) {
        const response: ChatResponse = {
          type: 'message',
          markdown: proposal.markdown,
          text: proposal.markdown,
          actions: [],
        }
        return NextResponse.json(response)
      }

      const action = {
        id: crypto.randomUUID(),
        name: 'applyCalorieTargetChange' as const,
        type: 'adjustCaloriesAndRegenerateWeek' as const,
        label: `Reajustar a ${requestedCalories} kcal/día`,
        payload: {
          profileId: state.activeProfile.id,
          calories: requestedCalories,
        },
      }
      const response: ChatResponse = {
        type: 'confirmation_required',
        markdown: proposal.markdown,
        text: proposal.markdown,
        action,
        actions: [
          {
            id: action.id,
            type: action.type,
            label: action.label,
            payload: action.payload,
          },
        ],
      }
      return NextResponse.json(response)
    }

    if (requestedCalories && !state.currentMenu) {
      const response: ChatResponse = {
        type: 'message',
        markdown: 'Necesitas tener un menú semanal activo antes de reajustar el objetivo calórico.',
        text: 'Necesitas tener un menú semanal activo antes de reajustar el objetivo calórico.',
        actions: [],
      }
      return NextResponse.json(response)
    }

    const response = await chatWithMenuContext({
      message: body.message,
      locale: state.activeProfile?.locale ?? 'es',
      profileName: state.activeProfile?.name,
      menuContext: state.currentMenu,
    })
    const chatResponse: ChatResponse = {
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

function extractRegenerationIntent(message: string): 'week' | null {
  const normalized = message.toLowerCase()
  if (/(regenera|rehaz|recrear|nuevo).*(semana|men[uú])/.test(normalized)) return 'week'
  return null
}

function extractRequestedCalories(message: string): number | null {
  const normalized = message.toLowerCase()
  if (!/(kcal|calor[ií]as|cal[oó]rico|calorico|objetivo)/.test(normalized)) return null
  const match = normalized.match(/\b([1-4]\d{3}|5000|9\d{2})\b/)
  if (!match) return null
  return Number(match[1])
}

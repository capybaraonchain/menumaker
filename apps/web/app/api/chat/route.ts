import { chatWithMenuContext } from '@menumaker/ai'
import { getAppState } from '@menumaker/db'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const state = await getAppState(body.profileId)
    const requestedCalories = extractRequestedCalories(String(body.message ?? ''))
    if (requestedCalories && state.activeProfile && state.currentMenu) {
      const currentCalories = state.currentMenu.target.calories
      if (requestedCalories === currentCalories) {
        return NextResponse.json({
          text: `Tu objetivo calórico diario ya está en **${currentCalories} kcal/día**.`,
          actions: [],
        })
      }

      const direction = requestedCalories < currentCalories ? 'bajar' : 'subir'
      return NextResponse.json({
        text:
          `El objetivo calórico diario está en **${currentCalories} kcal/día**. ` +
          `Si deseas ${direction} el objetivo calórico a **${requestedCalories} kcal/día**, deberás reajustar el menú semanal. ` +
          'Cualquier comida que no esté bloqueada será regenerada; las recetas guardadas seguirán guardadas en Recetas. ¿Continuar?',
        actions: [
          {
            id: crypto.randomUUID(),
            type: 'adjustCaloriesAndRegenerateWeek',
            label: `Reajustar a ${requestedCalories} kcal/día`,
            payload: {
              profileId: state.activeProfile.id,
              menuId: state.currentMenu.id,
              calories: requestedCalories,
            },
          },
        ],
      })
    }

    if (requestedCalories && !state.currentMenu) {
      return NextResponse.json({
        text: 'Necesitas tener un menú semanal activo antes de reajustar el objetivo calórico.',
        actions: [],
      })
    }

    const response = await chatWithMenuContext({
      message: body.message,
      locale: state.activeProfile?.locale ?? 'es',
      profileName: state.activeProfile?.name,
      menuContext: state.currentMenu,
    })
    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error de chat.' }, { status: 400 })
  }
}

function extractRequestedCalories(message: string): number | null {
  const normalized = message.toLowerCase()
  if (!/(kcal|calor[ií]as|cal[oó]rico|calorico|objetivo)/.test(normalized)) return null
  const match = normalized.match(/\b([1-4]\d{3}|5000|9\d{2})\b/)
  if (!match) return null
  return Number(match[1])
}

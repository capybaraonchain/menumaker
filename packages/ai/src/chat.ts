import type { WeeklyMenuPlan } from '@menumaker/core'
import { codexStatus, completeText } from './codexOAuth'

export async function chatWithMenuContext(input: {
  message: string
  locale: 'es' | 'en'
  profileName?: string
  menuContext?: unknown
}): Promise<{ text: string; providerConfigured: boolean }> {
  const status = codexStatus()
  const system =
    input.locale === 'es'
      ? 'Eres el asistente de MenuMaker. Responde en español. Puedes explicar menús, macros y cambios, pero no afirmes calorías exactas sin nutrición determinista y no hagas cambios duraderos sin confirmación.'
      : 'You are the MenuMaker assistant. Explain menus, macros, and changes, but do not claim exact nutrition without deterministic data and do not make durable changes without confirmation.'

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

export function summarizeMenuForChat(menu: unknown): unknown {
  if (!menu || typeof menu !== 'object') return menu
  return menu as WeeklyMenuPlan | unknown
}


import { chatWithMenuContext } from '@menumaker/ai'
import { getAppState } from '@menumaker/db'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const state = await getAppState(body.profileId)
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


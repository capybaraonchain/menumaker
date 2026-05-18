import { onboardingSchema } from '@menumaker/core'
import { createProfileAndFirstMenu, FastInitialGenerationError } from '@menumaker/db'
import { codexStatus } from '@menumaker/ai'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = onboardingSchema.parse(await request.json())
    if ((!body.age || body.sex === 'skipped') && !body.acceptsRoughEstimate) {
      return NextResponse.json({ error: 'Acepta la estimación aproximada para omitir edad o sexo.' }, { status: 400 })
    }
    const state = await createProfileAndFirstMenu(body)
    return NextResponse.json({ ...state, provider: codexStatus() })
  } catch (error) {
    if (error instanceof FastInitialGenerationError) {
      return NextResponse.json({
        error: error.message,
        failureCode: error.failureCode,
        issues: error.issues,
      }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error de onboarding.' }, { status: 400 })
  }
}

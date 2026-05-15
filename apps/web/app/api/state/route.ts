import { codexStatus } from '@menumaker/ai'
import { getAppState } from '@menumaker/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get('profileId') ?? undefined
  const state = await getAppState(profileId)
  return NextResponse.json({ ...state, provider: codexStatus() })
}


import type { ProviderStatus } from '@menumaker/core'
import { codexStatus as rawCodexStatus, completeStructured as completeCodexStructured, completeText as completeCodexText, loadAiDotEnv } from './codexOAuth'
import { completeGeminiStructured, completeGeminiText, geminiStatus } from './gemini'

type JsonObject = Record<string, unknown>

export function codexStatus(): ProviderStatus {
  return providerStatus()
}

export function providerStatus(): ProviderStatus {
  const provider = selectedProvider()
  if (provider === 'gemini') return geminiStatus()
  const status = rawCodexStatus()
  return { ...status, provider: 'codex' }
}

export async function completeStructured<T>(input: {
  schemaName: string
  schema: JsonObject
  system: string
  user: string
  timeoutMs?: number
  reasoningEffort?: string
}): Promise<T> {
  if (selectedProvider() === 'gemini') return completeGeminiStructured<T>(input)
  return completeCodexStructured<T>(input)
}

export async function completeText(input: { system: string; user: string; timeoutMs?: number; reasoningEffort?: string }): Promise<string> {
  if (selectedProvider() === 'gemini') return completeGeminiText(input)
  return completeCodexText(input)
}

function selectedProvider(): 'codex' | 'gemini' {
  loadAiDotEnv()
  const raw = process.env.MENUMAKER_LLM_PROVIDER?.trim().toLowerCase()
  if (raw === 'gemini' || raw === 'google') return 'gemini'
  return 'codex'
}

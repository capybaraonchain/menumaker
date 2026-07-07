import type { ProviderStatus } from '@menumaker/core'
import { loadAiDotEnv } from './codexOAuth'

type JsonObject = Record<string, unknown>

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function geminiStatus(): ProviderStatus {
  loadAiDotEnv()
  const key = geminiApiKey()
  return {
    configured: Boolean(key),
    provider: 'gemini',
    path: 'GEMINI_API_KEY',
    shape: key ? 'gemini-api-key' : 'missing',
    model: geminiModel(),
    reasoningEffort: 'none',
    tokenPresent: Boolean(key),
    refreshTokenPresent: false,
    accountIdPresent: false,
    expires: null,
    stale: null,
  }
}

export async function completeGeminiStructured<T>(input: {
  schemaName: string
  schema: JsonObject
  system: string
  user: string
  timeoutMs?: number
}): Promise<T> {
  const text = await postGemini({
    system: input.system,
    user: input.user,
    timeoutMs: input.timeoutMs ?? 120_000,
    responseJsonSchema: geminiJsonSchema(input.schemaName, input.schema),
  })
  return JSON.parse(text) as T
}

export async function completeGeminiText(input: { system: string; user: string; timeoutMs?: number }): Promise<string> {
  return postGemini({
    system: input.system,
    user: input.user,
    timeoutMs: input.timeoutMs ?? 120_000,
  })
}

async function postGemini(input: {
  system: string
  user: string
  timeoutMs: number
  responseJsonSchema?: JsonObject
}): Promise<string> {
  const key = geminiApiKey()
  if (!key) throw new Error('GEMINI_API_KEY is not configured')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(geminiModel())}:generateContent?key=${encodeURIComponent(key)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'User-Agent': 'menumaker/0.1',
      },
      body: JSON.stringify(buildGeminiPayload(input)),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Gemini request failed with ${response.status}: ${redact(text)}`)
    return extractGeminiText(JSON.parse(text) as JsonObject)
  } finally {
    clearTimeout(timeout)
  }
}

function buildGeminiPayload(input: { system: string; user: string; responseJsonSchema?: JsonObject }): JsonObject {
  const generationConfig: JsonObject = {
    temperature: Number(process.env.GEMINI_TEMPERATURE ?? 0.4),
  }
  if (input.responseJsonSchema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseJsonSchema = input.responseJsonSchema
  }
  return {
    systemInstruction: {
      parts: [{ text: input.system }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: input.user }],
      },
    ],
    generationConfig,
  }
}

function extractGeminiText(response: JsonObject): string {
  const candidates = response.candidates
  if (!Array.isArray(candidates)) throw new Error(`Gemini response did not include candidates: ${redact(JSON.stringify(response))}`)
  const first = candidates[0] as JsonObject | undefined
  const content = first?.content as JsonObject | undefined
  const parts = content?.parts
  if (!Array.isArray(parts)) throw new Error(`Gemini response did not include content parts: ${redact(JSON.stringify(response))}`)
  const text = parts
    .map((part) => (isJsonObject(part) && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim()
  if (!text) throw new Error(`Gemini response text was empty: ${redact(JSON.stringify(response))}`)
  return stripJsonFence(text)
}

function geminiJsonSchema(schemaName: string, schema: JsonObject): JsonObject {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: schemaName,
    ...JSON.parse(JSON.stringify(schema)),
  }
}

function geminiApiKey(): string {
  loadAiDotEnv()
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
}

function geminiModel(): string {
  loadAiDotEnv()
  return process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redact(text: string): string {
  const key = geminiApiKey()
  return text
    .replace(key, '[REDACTED]')
    .replace(/"(GEMINI_API_KEY|GOOGLE_API_KEY|key)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"')
    .slice(-2000)
}

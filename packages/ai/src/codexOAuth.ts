import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { ProviderStatus } from '@menumaker/core'

const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const OPENAI_CODEX_ACCOUNT_CLAIM = 'https://api.openai.com/auth'
const STALE_BUFFER_SECONDS = 60

type JsonObject = Record<string, unknown>

interface LoadedProfile {
  path: string
  shape: 'direct' | 'codex-auth'
  raw: JsonObject
  access: string
  refresh: string
  expires: number
  accountId: string
  email?: string
  authMode?: string
}

interface CodexEvent {
  type?: string
  delta?: string
  item?: {
    content?: Array<{ type?: string; text?: string }>
  }
  response?: {
    id?: string
    usage?: JsonObject
  }
}

export function loadAiDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../../../.env'),
  ]
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const [key, ...valueParts] = trimmed.split('=')
      if (!key || process.env[key]) continue
      process.env[key] = valueParts.join('=').replace(/^['"]|['"]$/g, '')
    }
  }
}

export function codexStatus(): ProviderStatus {
  loadAiDotEnv()
  const path = resolveAuthPath()
  const model = codexModel()
  const reasoningEffort = codexReasoningEffort()

  if (!existsSync(path)) {
    return {
      configured: false,
      path,
      shape: 'missing',
      model,
      reasoningEffort,
      tokenPresent: false,
      refreshTokenPresent: false,
      accountIdPresent: false,
      expires: null,
      stale: null,
    }
  }

  try {
    const profile = readProfile(path)
    return {
      configured: true,
      path,
      shape: profile.shape,
      model,
      reasoningEffort,
      tokenPresent: Boolean(profile.access),
      refreshTokenPresent: Boolean(profile.refresh),
      accountIdPresent: Boolean(profile.accountId),
      expires: profile.expires,
      stale: !isFresh(profile),
    }
  } catch {
    return {
      configured: false,
      path,
      shape: 'invalid',
      model,
      reasoningEffort,
      tokenPresent: true,
      refreshTokenPresent: false,
      accountIdPresent: false,
      expires: null,
      stale: null,
    }
  }
}

export async function completeStructured<T>(input: {
  schemaName: string
  schema: JsonObject
  system: string
  user: string
  timeoutMs?: number
}): Promise<T> {
  const profile = await resolveFreshProfile()
  const payload = buildCodexPayload({
    model: codexModel(),
    reasoningEffort: codexReasoningEffort(),
    system: input.system,
    user: input.user,
    schemaName: input.schemaName,
    schema: input.schema,
  })
  const text = await postCodex(profile, payload, input.timeoutMs ?? 120_000)
  return JSON.parse(text) as T
}

export async function completeText(input: { system: string; user: string; timeoutMs?: number }): Promise<string> {
  const profile = await resolveFreshProfile()
  const payload = buildCodexLoosePayload({
    model: codexModel(),
    reasoningEffort: codexReasoningEffort(),
    system: input.system,
    user: input.user,
  })
  return postCodex(profile, payload, input.timeoutMs ?? 120_000)
}

async function postCodex(profile: LoadedProfile, payload: JsonObject, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.access}`,
        'chatgpt-account-id': profile.accountId,
        originator: 'menumaker',
        'User-Agent': 'menumaker/0.1',
        'OpenAI-Beta': 'responses=experimental',
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const text = await response.text()
    if (!response.ok) throw new Error(`Codex request failed with ${response.status}: ${redact(text)}`)
    return extractResponseText(parseSseEvents(text))
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveFreshProfile(): Promise<LoadedProfile> {
  const path = resolveAuthPath()
  let profile = readProfile(path)
  if (isFresh(profile)) return profile
  profile = await refreshProfile(profile)
  saveProfile(profile)
  return profile
}

function resolveAuthPath(): string {
  loadAiDotEnv()
  const configured = process.env.CODEX_AUTH_PROFILE
  if (configured) return expandPath(configured)
  return expandPath('~/.codex/auth.json')
}

function readProfile(path: string): LoadedProfile {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as JsonObject

  if (typeof raw.access === 'string' && typeof raw.refresh === 'string') {
    const expires = typeof raw.expires === 'number' ? raw.expires : decodeJwtExp(raw.access)
    const accountId = typeof raw.account_id === 'string' ? raw.account_id : extractAccountId(raw.access)
    return {
      path,
      shape: 'direct',
      raw,
      access: raw.access,
      refresh: raw.refresh,
      expires,
      accountId,
      email: typeof raw.email === 'string' ? raw.email : undefined,
      authMode: typeof raw.auth_mode === 'string' ? raw.auth_mode : undefined,
    }
  }

  const tokens = raw.tokens
  if (isJsonObject(tokens) && typeof tokens.access_token === 'string' && typeof tokens.refresh_token === 'string') {
    const expires = decodeJwtExp(tokens.access_token)
    const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : extractAccountId(tokens.access_token)
    return {
      path,
      shape: 'codex-auth',
      raw,
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires,
      accountId,
      authMode: typeof raw.auth_mode === 'string' ? raw.auth_mode : undefined,
    }
  }

  throw new Error(`Unsupported Codex auth profile shape at ${path}`)
}

async function refreshProfile(profile: LoadedProfile): Promise<LoadedProfile> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: profile.refresh,
    client_id: OPENAI_CODEX_CLIENT_ID,
  })
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Codex OAuth refresh failed with ${response.status}: ${redact(text)}`)
  const data = JSON.parse(text) as JsonObject
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new Error('Codex OAuth refresh response did not include access and refresh tokens')
  }
  return {
    ...profile,
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Math.floor(Date.now() / 1000) + (typeof data.expires_in === 'number' ? data.expires_in : 3600),
    accountId: extractAccountId(data.access_token),
  }
}

function saveProfile(profile: LoadedProfile): void {
  mkdirSync(dirname(profile.path), { recursive: true })
  if (profile.shape === 'direct') {
    writeFileSync(
      profile.path,
      `${JSON.stringify(
        {
          ...profile.raw,
          access: profile.access,
          refresh: profile.refresh,
          expires: profile.expires,
          account_id: profile.accountId,
          auth_mode: profile.authMode ?? 'chatgpt',
          updated_at: Math.floor(Date.now() / 1000),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )
    return
  }
  const tokens = isJsonObject(profile.raw.tokens) ? profile.raw.tokens : {}
  writeFileSync(
    profile.path,
    `${JSON.stringify(
      {
        ...profile.raw,
        tokens: {
          ...tokens,
          access_token: profile.access,
          refresh_token: profile.refresh,
          account_id: profile.accountId,
        },
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
}

function buildCodexPayload(input: {
  model: string
  reasoningEffort: string
  schemaName: string
  system: string
  user: string
  schema: JsonObject
}): JsonObject {
  return {
    model: input.model,
    instructions: input.system,
    input: [{ role: 'user', content: input.user }],
    stream: true,
    store: false,
    reasoning: { effort: input.reasoningEffort },
    text: {
      format: {
        type: 'json_schema',
        name: input.schemaName,
        schema: strictJsonSchema(input.schema),
        strict: true,
      },
    },
  }
}

function buildCodexLoosePayload(input: { model: string; reasoningEffort: string; system: string; user: string }): JsonObject {
  return {
    model: input.model,
    instructions: input.system,
    input: [{ role: 'user', content: input.user }],
    stream: true,
    store: false,
    reasoning: { effort: input.reasoningEffort },
  }
}

function strictJsonSchema(schema: JsonObject): JsonObject {
  const normalized = JSON.parse(JSON.stringify(schema)) as JsonObject
  normalizeSchemaNode(normalized)
  return normalized
}

function normalizeSchemaNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeSchemaNode(item)
    return
  }
  if (!isJsonObject(node)) return
  const properties = node.properties
  if (node.type === 'object' || isJsonObject(properties)) {
    const props = isJsonObject(properties) ? properties : {}
    node.properties = props
    node.additionalProperties = false
    node.required = Object.keys(props)
  }
  for (const value of Object.values(node)) normalizeSchemaNode(value)
}

function parseSseEvents(text: string): CodexEvent[] {
  const events: CodexEvent[] = []
  let buffer: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      consumeSseEvent(buffer, events)
      buffer = []
    } else {
      buffer.push(line)
    }
  }
  consumeSseEvent(buffer, events)
  return events
}

function consumeSseEvent(lines: string[], events: CodexEvent[]): void {
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
    .trim()
  if (!data || data === '[DONE]') return
  const event = JSON.parse(data) as CodexEvent
  if (event.type === 'response.done' || event.type === 'response.incomplete') event.type = 'response.completed'
  events.push(event)
}

function extractResponseText(events: CodexEvent[]): string {
  const deltas: string[] = []
  let completed = false
  let outputText = ''
  for (const event of events) {
    if (event.type === 'response.output_text.delta') {
      deltas.push(event.delta ?? '')
    } else if (event.type === 'response.output_item.done') {
      outputText = (event.item?.content ?? [])
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
    } else if (event.type === 'response.completed') {
      completed = true
    } else if (event.type === 'response.failed' || event.type === 'error') {
      throw new Error(`Codex responses failed: ${redact(JSON.stringify(event))}`)
    }
  }
  if (!completed) throw new Error('Codex responses stream ended without response.completed')
  return deltas.join('') || outputText
}

function isFresh(profile: LoadedProfile): boolean {
  return Math.floor(Date.now() / 1000) < profile.expires - STALE_BUFFER_SECONDS
}

function codexModel(): string {
  loadAiDotEnv()
  return process.env.CODEX_MODEL || 'gpt-5.5'
}

function codexReasoningEffort(): string {
  loadAiDotEnv()
  return process.env.CODEX_REASONING_EFFORT || 'medium'
}

function expandPath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2))
  return resolve(value)
}

function decodeJwtPayload(token: string): JsonObject {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('Codex access token is not a JWT')
  const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  const parsed = JSON.parse(decoded) as unknown
  if (!isJsonObject(parsed)) throw new Error('Codex access token payload is not an object')
  return parsed
}

function decodeJwtExp(token: string): number {
  const exp = decodeJwtPayload(token).exp
  return typeof exp === 'number' ? exp : 0
}

function extractAccountId(token: string): string {
  const auth = decodeJwtPayload(token)[OPENAI_CODEX_ACCOUNT_CLAIM]
  if (isJsonObject(auth) && typeof auth.chatgpt_account_id === 'string') return auth.chatgpt_account_id
  throw new Error('Failed to extract OpenAI account id from Codex access token')
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"(access_token|refresh_token|id_token|access|refresh|OPENAI_API_KEY)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"')
    .slice(-2000)
}


import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadDotEnv(startDir = process.cwd()): void {
  const candidates = [
    resolve(startDir, '.env'),
    resolve(startDir, '../../.env'),
    resolve(startDir, '../../../.env'),
    resolve(process.cwd(), '.env'),
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

export function databaseUrl(): string {
  loadDotEnv()
  return process.env.DATABASE_URL || 'postgres://localhost:5432/menumaker'
}

export function localUserId(): string {
  loadDotEnv()
  return process.env.LOCAL_USER_ID || '00000000-0000-4000-8000-000000000001'
}


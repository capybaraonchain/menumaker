import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { databaseUrl } from './env'
import * as schema from './schema'

let client: postgres.Sql | null = null
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null

export function sqlClient(): postgres.Sql {
  if (!client) client = postgres(databaseUrl(), { max: 10 })
  return client
}

export function db() {
  if (!dbInstance) dbInstance = drizzle(sqlClient(), { schema })
  return dbInstance
}

export async function closeDb(): Promise<void> {
  if (client) await client.end()
  client = null
  dbInstance = null
}


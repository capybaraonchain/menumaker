import { closeDb } from './client'
import { runGenerationWorker } from './appService'

function argValue(name: string): string | undefined {
  const flag = `--${name}=`
  return process.argv.find((item) => item.startsWith(flag))?.slice(flag.length)
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

async function main(): Promise<void> {
  const once = !process.argv.includes('--watch')
  const limit = positiveInt(argValue('limit'), 1)
  const pollIntervalMs = positiveInt(argValue('poll-ms'), 5000)
  const result = await runGenerationWorker({ once, limit, pollIntervalMs })
  console.log(JSON.stringify(result, null, 2))
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
}).finally(async () => {
  if (!process.argv.includes('--watch')) await closeDb()
})

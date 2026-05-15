import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { normalizeIngredientName } from '@menumaker/nutrition'
import { closeDb, sqlClient } from './client'

const confidenceSchema = z.enum(['exact', 'barcode', 'database', 'generic', 'estimated', 'unknown'])

const sourceRecordSchema = z.object({
  foodId: z.string().min(1),
  canonicalName: z.string().min(1),
  category: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  source: z.string().min(1),
  sourceId: z.string().min(1),
  confidence: confidenceSchema.default('database'),
  per100g: z.object({
    calories: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    carbsG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
    fiberG: z.number().nonnegative().optional(),
  }),
  householdUnits: z.array(z.object({
    units: z.array(z.string().min(1)).min(1),
    grams: z.number().positive(),
    confidence: confidenceSchema.default('generic'),
    note: z.string().min(1),
  })).optional(),
  payload: z.record(z.unknown()).default({}),
})

const sourceFileSchema = z.union([
  z.array(sourceRecordSchema),
  z.object({ records: z.array(sourceRecordSchema) }).transform((value) => value.records),
])

export type NutritionSourceRecord = z.infer<typeof sourceRecordSchema>

export function parseNutritionSourceRecords(input: unknown): NutritionSourceRecord[] {
  const records = sourceFileSchema.parse(input)
  const seen = new Set<string>()
  return records.map((record) => {
    const foodId = normalizeFoodId(record.foodId)
    const key = `${record.source}:${record.sourceId}`
    if (seen.has(key)) throw new Error(`Registro nutricional duplicado para ${key}.`)
    seen.add(key)
    return {
      ...record,
      foodId,
      aliases: [...new Set([record.canonicalName, ...record.aliases].map((item) => item.trim()).filter(Boolean))],
      sourceId: record.sourceId.includes(':') ? record.sourceId : `${record.source}:${record.sourceId}`,
    }
  })
}

export async function importNutritionSourceRecords(records: NutritionSourceRecord[]): Promise<{ imported: number; sources: string[] }> {
  const sql = sqlClient()
  const sources = new Set<string>()
  await sql.begin(async (tx) => {
    for (const record of records) {
      sources.add(record.source)
      await tx`
        insert into food_items (id, canonical_name, category)
        values (${record.foodId}, ${record.canonicalName}, ${record.category})
        on conflict (id) do update set
          canonical_name = excluded.canonical_name,
          category = excluded.category
      `
      await tx`
        insert into source_foods (id, source, payload)
        values (${record.sourceId}, ${record.source}, ${tx.json({
          ...record.payload,
          sourceFoodId: record.sourceId,
          householdUnits: record.householdUnits,
        } as any)})
        on conflict (id) do update set
          source = excluded.source,
          payload = excluded.payload
      `
      await tx`
        insert into nutrition_records (food_id, source_id, per_100g, confidence)
        values (${record.foodId}, ${record.sourceId}, ${tx.json(record.per100g as any)}, ${record.confidence})
        on conflict (food_id, source_id) do update set
          per_100g = excluded.per_100g,
          confidence = excluded.confidence
      `
      await tx`
        insert into food_mappings (food_id, source_id, confidence)
        values (${record.foodId}, ${record.sourceId}, ${record.confidence})
        on conflict (food_id, source_id) do update set confidence = excluded.confidence
      `
      for (const alias of record.aliases) {
        await tx`
          insert into food_aliases (food_id, alias, source)
          values (${record.foodId}, ${alias}, ${record.source})
          on conflict do nothing
        `
      }
    }
  })
  return { imported: records.length, sources: [...sources].sort() }
}

export async function importNutritionSourceFile(path: string): Promise<{ imported: number; sources: string[] }> {
  const raw = await readFile(path, 'utf8')
  return importNutritionSourceRecords(parseNutritionSourceRecords(JSON.parse(raw)))
}

function normalizeFoodId(value: string): string {
  return normalizeIngredientName(value).replace(/\s+/g, '_')
}

async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path) throw new Error('Uso: npm --workspace @menumaker/db run nutrition:import -- ./ruta/foods.json')
  const result = await importNutritionSourceFile(path)
  await closeDb()
  console.log(`Imported ${result.imported} nutrition records from ${result.sources.join(', ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => {
    console.error(error)
    await closeDb()
    process.exit(1)
  })
}

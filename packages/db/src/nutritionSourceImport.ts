import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
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

interface OpenFoodFactsProductResponse {
  status?: number
  code?: string
  product?: Record<string, any>
}

interface UsdaFoodDataCentralDownloadFood {
  fdcId?: number | string
  description?: string
  dataType?: string
  publicationDate?: string
  foodCategory?: string | { description?: string }
  foodNutrients?: Array<Record<string, any>>
  foodPortions?: Array<Record<string, any>>
}

export interface UsdaFoodDataCentralDownloadOptions {
  limit?: number
  includeFdcIds?: number[]
}

export function parseNutritionSourceRecords(input: unknown): NutritionSourceRecord[] {
  return normalizeNutritionSourceRecords(sourceFileSchema.parse(input))
}

export function normalizeNutritionSourceRecords(records: NutritionSourceRecord[]): NutritionSourceRecord[] {
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
  const normalizedRecords = normalizeNutritionSourceRecords(records)
  await sql.begin(async (tx) => {
    for (const record of normalizedRecords) {
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
  return { imported: normalizedRecords.length, sources: [...sources].sort() }
}

export async function importNutritionSourceFile(path: string): Promise<{ imported: number; sources: string[] }> {
  const raw = await readFile(path, 'utf8')
  return importNutritionSourceRecords(parseNutritionSourceRecords(JSON.parse(raw)))
}

export function parseUsdaFoodDataCentralDownload(
  input: unknown,
  options: UsdaFoodDataCentralDownloadOptions = {},
): NutritionSourceRecord[] {
  const foods = usdaDownloadFoods(input)
  const include = options.includeFdcIds?.length ? new Set(options.includeFdcIds) : null
  const records: NutritionSourceRecord[] = []

  for (const food of foods) {
    const fdcId = usdaFdcId(food)
    if (include && (!fdcId || !include.has(fdcId))) continue
    try {
      records.push(usdaFoodDataCentralDownloadFoodToRecord(food))
    } catch (error) {
      if (include) throw error
    }
    if (options.limit && records.length >= options.limit) break
  }

  return normalizeNutritionSourceRecords(records)
}

export function usdaFoodDataCentralDownloadFoodToRecord(food: UsdaFoodDataCentralDownloadFood): NutritionSourceRecord {
  const fdcId = usdaFdcId(food)
  if (!fdcId) throw new Error('USDA FoodData Central record without fdcId.')
  const canonicalName = firstText([food.description, `USDA FDC ${fdcId}`])
  const calories = usdaNutrientValue(food, ['1008', '208'])
  const proteinG = usdaNutrientValue(food, ['1003', '203', 'Protein'])
  const carbsG = usdaNutrientValue(food, ['1005', '205', 'Carbohydrate, by difference'])
  const fatG = usdaNutrientValue(food, ['1004', '204', 'Total lipid (fat)'])
  if (calories === null || proteinG === null || carbsG === null || fatG === null) {
    throw new Error(`USDA FoodData Central ${fdcId} no incluye macros por 100g suficientes.`)
  }

  const fiberG = usdaNutrientValue(food, ['1079', '291', 'Fiber, total dietary'])
  return {
    foodId: `usda fdc ${fdcId}`,
    canonicalName,
    category: usdaFoodCategory(food),
    aliases: [canonicalName],
    source: 'usda_fdc',
    sourceId: `usda_fdc:${fdcId}`,
    confidence: 'database',
    per100g: {
      calories,
      proteinG,
      carbsG,
      fatG,
      fiberG: fiberG ?? undefined,
    },
    householdUnits: usdaHouseholdUnits(food),
    payload: {
      fdcId,
      dataType: food.dataType,
      publicationDate: food.publicationDate,
      sourceDataset: 'FoodData Central downloadable JSON',
      importedAt: new Date().toISOString(),
    },
  }
}

export async function importUsdaFoodDataCentralDownloadFile(
  path: string,
  options: UsdaFoodDataCentralDownloadOptions = {},
): Promise<{ imported: number; sources: string[]; records: NutritionSourceRecord[] }> {
  const input = await readUsdaDownloadInput(path)
  const records = parseUsdaFoodDataCentralDownload(input, options)
  const result = await importNutritionSourceRecords(records)
  return { ...result, records }
}

export async function readUsdaDownloadInput(pathOrUrl: string): Promise<unknown> {
  const buffer = await readPathOrUrl(pathOrUrl)
  if (isZipBuffer(buffer)) return parseUsdaJsonFromZip(buffer)
  return JSON.parse(buffer.toString('utf8'))
}

export function openFoodFactsProductToRecord(input: OpenFoodFactsProductResponse): NutritionSourceRecord {
  const product = input.product
  const code = String(input.code ?? product?.code ?? '').trim()
  if (!code || !product || input.status === 0) throw new Error(`Open Food Facts no encontró el producto ${code || '(sin código)'}.`)

  const nutriments = product.nutriments ?? {}
  const calories = numberFrom(nutriments['energy-kcal_100g'])
    ?? (numberFrom(nutriments.energy_100g) === null ? null : round(Number(nutriments.energy_100g) / 4.184))
  const proteinG = numberFrom(nutriments.proteins_100g)
  const carbsG = numberFrom(nutriments.carbohydrates_100g)
  const fatG = numberFrom(nutriments.fat_100g)
  if (calories === null || proteinG === null || carbsG === null || fatG === null) {
    throw new Error(`Open Food Facts ${code} no incluye macros por 100g suficientes.`)
  }

  const canonicalName = firstText([
    product.product_name_es,
    product.product_name,
    product.generic_name_es,
    product.generic_name,
    `Producto ${code}`,
  ])
  const aliases = [
    product.product_name_es,
    product.product_name,
    product.generic_name_es,
    product.generic_name,
    product.brands,
  ].flatMap(splitAliasValue)
  const servingGrams = servingQuantity(product)
  return {
    foodId: `off ${code}`,
    canonicalName,
    category: openFoodFactsCategory(product),
    aliases,
    source: 'openfoodfacts',
    sourceId: `openfoodfacts:${code}`,
    confidence: 'barcode',
    per100g: {
      calories,
      proteinG,
      carbsG,
      fatG,
      fiberG: numberFrom(nutriments.fiber_100g) ?? undefined,
    },
    householdUnits: servingGrams
      ? [{
          units: ['ración', 'porcion', 'porción', 'serving'],
          grams: servingGrams,
          confidence: 'barcode',
          note: `Ración declarada en Open Food Facts para el código ${code}.`,
        }]
      : undefined,
    payload: {
      code,
      sourceUrl: `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`,
      productName: canonicalName,
      brands: product.brands,
      categories: product.categories,
      servingSize: product.serving_size,
      importedAt: new Date().toISOString(),
    },
  }
}

export async function fetchOpenFoodFactsProduct(barcode: string): Promise<OpenFoodFactsProductResponse> {
  const code = barcode.replace(/\D/g, '')
  if (!code) throw new Error('Código de barras inválido para Open Food Facts.')
  const fields = [
    'code',
    'product_name',
    'product_name_es',
    'generic_name',
    'generic_name_es',
    'brands',
    'categories',
    'categories_tags',
    'serving_size',
    'serving_quantity',
    'nutriments',
  ].join(',')
  const hosts = ['https://world.openfoodfacts.org', 'https://world.openfoodfacts.net']
  const failures: string[] = []
  for (const host of hosts) {
    const url = `${host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${encodeURIComponent(fields)}`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MenuMaker/0.1 local nutrition import (https://github.com/capybaraonchain/menumaker)',
        Accept: 'application/json',
      },
    })
    if (response.ok) return await response.json() as OpenFoodFactsProductResponse
    failures.push(`${host} ${response.status}`)
  }
  throw new Error(`Open Food Facts no respondió correctamente para ${code}: ${failures.join(', ')}.`)
}

export async function importOpenFoodFactsBarcodes(barcodes: string[]): Promise<{ imported: number; sources: string[]; records: NutritionSourceRecord[] }> {
  const records: NutritionSourceRecord[] = []
  for (const barcode of barcodes) {
    records.push(openFoodFactsProductToRecord(await fetchOpenFoodFactsProduct(barcode)))
  }
  const result = await importNutritionSourceRecords(records)
  return { ...result, records }
}

function normalizeFoodId(value: string): string {
  return normalizeIngredientName(value).replace(/\s+/g, '_')
}

async function readPathOrUrl(pathOrUrl: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const url = new URL(pathOrUrl)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('USDA solo acepta URLs HTTPS, salvo localhost para pruebas.')
    }
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MenuMaker/0.1 local USDA FoodData Central import (https://github.com/capybaraonchain/menumaker)',
        Accept: 'application/zip, application/json, */*',
      },
    })
    if (!response.ok) throw new Error(`USDA FoodData Central no respondió correctamente: ${response.status}.`)
    return Buffer.from(await response.arrayBuffer())
  }
  return readFile(pathOrUrl)
}

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
}

function parseUsdaJsonFromZip(buffer: Buffer): unknown {
  const jsonEntries = extractZipEntries(buffer)
    .filter((entry) => entry.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => b.data.length - a.data.length)

  for (const entry of jsonEntries) {
    try {
      const parsed = JSON.parse(entry.data.toString('utf8'))
      usdaDownloadFoods(parsed)
      return parsed
    } catch {
      // Official USDA archives may include documentation JSON in future releases.
      // Keep scanning until one entry has a supported FoodData Central root.
    }
  }

  throw new Error('El ZIP de USDA no contiene un JSON FoodData Central soportado.')
}

function extractZipEntries(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  const centralDirectoryOffset = findEndOfCentralDirectory(buffer)
  const entries: Array<{ name: string; data: Buffer }> = []
  let offset = centralDirectoryOffset

  while (offset + 46 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength)

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = compressionMethod === 0
      ? compressed
      : compressionMethod === 8
        ? inflateRawSync(compressed)
        : null

    if (data) entries.push({ name, data })
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return buffer.readUInt32LE(offset + 16)
  }
  throw new Error('ZIP inválido: no se encontró el directorio central.')
}

function numberFrom(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) && number >= 0 ? round(number) : null
}

function firstText(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return 'Producto sin nombre'
}

function splitAliasValue(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function openFoodFactsCategory(product: Record<string, any>): string {
  const tags = Array.isArray(product.categories_tags) ? product.categories_tags : []
  const lastTag = tags.at(-1)
  if (typeof lastTag === 'string' && lastTag.trim()) return lastTag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')
  return firstText([product.categories, 'packaged'])
}

function usdaDownloadFoods(input: unknown): UsdaFoodDataCentralDownloadFood[] {
  if (Array.isArray(input)) return input.filter(isUsdaFoodObject)
  if (!input || typeof input !== 'object') throw new Error('USDA FoodData Central download must be a JSON object or array.')
  const root = input as Record<string, unknown>
  const keys = ['FoundationFoods', 'SRLegacyFoods', 'SurveyFoods', 'BrandedFoods', 'foods', 'Foods']
  for (const key of keys) {
    const value = root[key]
    if (Array.isArray(value)) return value.filter(isUsdaFoodObject)
  }
  throw new Error('USDA FoodData Central JSON does not contain a supported food array.')
}

function usdaFdcId(food: UsdaFoodDataCentralDownloadFood): number | null {
  if (!food || typeof food !== 'object') return null
  const number = typeof food.fdcId === 'number' ? food.fdcId : typeof food.fdcId === 'string' ? Number(food.fdcId) : NaN
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null
}

function isUsdaFoodObject(value: unknown): value is UsdaFoodDataCentralDownloadFood {
  return Boolean(value && typeof value === 'object')
}

function usdaFoodCategory(food: UsdaFoodDataCentralDownloadFood): string {
  if (typeof food.foodCategory === 'string' && food.foodCategory.trim()) return food.foodCategory.trim()
  if (food.foodCategory && typeof food.foodCategory === 'object' && food.foodCategory.description?.trim()) {
    return food.foodCategory.description.trim()
  }
  return firstText([food.dataType, 'usda food'])
}

function usdaNutrientValue(food: UsdaFoodDataCentralDownloadFood, accepted: string[]): number | null {
  const normalizedAccepted = accepted.map((value) => value.toLowerCase())
  for (const item of food.foodNutrients ?? []) {
    const nutrient = item.nutrient && typeof item.nutrient === 'object' ? item.nutrient as Record<string, unknown> : {}
    const candidates = [
      item.nutrientId,
      item.nutrientNumber,
      item.nutrientName,
      item.name,
      nutrient.id,
      nutrient.number,
      nutrient.name,
    ].map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean)

    if (candidates.some((candidate) => normalizedAccepted.includes(candidate))) {
      return numberFrom(item.amount ?? item.value)
    }
  }
  return null
}

function usdaHouseholdUnits(food: UsdaFoodDataCentralDownloadFood): NutritionSourceRecord['householdUnits'] {
  const units = (food.foodPortions ?? []).flatMap((portion) => {
    const grams = numberFrom(portion.gramWeight)
    if (!grams) return []
    const measureUnit = portion.measureUnit && typeof portion.measureUnit === 'object'
      ? portion.measureUnit as Record<string, unknown>
      : {}
    const names = [
      measureUnit.name,
      measureUnit.abbreviation,
      portion.modifier,
      portion.portionDescription,
    ].flatMap(splitAliasValue)
    const uniqueNames = [...new Set(names.map((item) => item.trim()).filter(Boolean))]
    if (!uniqueNames.length) return []
    return [{
      units: uniqueNames,
      grams,
      confidence: 'database' as const,
      note: `Porción USDA FoodData Central para FDC ${food.fdcId}.`,
    }]
  })
  return units.length ? units : undefined
}

function servingQuantity(product: Record<string, any>): number | null {
  const direct = numberFrom(product.serving_quantity)
  if (direct) return direct
  if (typeof product.serving_size !== 'string') return null
  const match = product.serving_size.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(g|gr|gramos|ml)\b/i)
  return match?.[1] ? numberFrom(match[1]) : null
}

function round(value: number): number {
  return Math.round(value * 10) / 10
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

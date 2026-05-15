import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeNutritionSourceRecords, openFoodFactsProductToRecord, parseNutritionSourceRecords } from './nutritionSourceImport'

test('parses external nutrition records into source-scoped import rows', () => {
  const records = parseNutritionSourceRecords({
    records: [{
      foodId: 'Skyr Natural',
      canonicalName: 'skyr natural',
      category: 'protein',
      aliases: ['skyr', 'yogur islandés'],
      source: 'bedca',
      sourceId: '12345',
      confidence: 'database',
      per100g: { calories: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
      householdUnits: [{ units: ['vaso'], grams: 150, confidence: 'database', note: 'Vaso comercial.' }],
    }],
  })

  assert.equal(records.length, 1)
  assert.equal(records[0]?.foodId, 'skyr_natural')
  assert.equal(records[0]?.sourceId, 'bedca:12345')
  assert.deepEqual(records[0]?.aliases, ['skyr natural', 'skyr', 'yogur islandés'])
})

test('rejects duplicate source records before importing', () => {
  assert.throws(() => parseNutritionSourceRecords([
    {
      foodId: 'a',
      canonicalName: 'a',
      category: 'x',
      source: 'bedca',
      sourceId: '1',
      per100g: { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 },
    },
    {
      foodId: 'b',
      canonicalName: 'b',
      category: 'x',
      source: 'bedca',
      sourceId: '1',
      per100g: { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 },
    },
  ]), /duplicado/)
})

test('normalizes Open Food Facts barcode products into import records', () => {
  const record = openFoodFactsProductToRecord({
    status: 1,
    code: '3017620422003',
    product: {
      product_name_es: 'Crema de cacao y avellanas',
      product_name: 'Nutella',
      brands: 'Ferrero',
      categories_tags: ['en:spreads', 'en:chocolate-spreads'],
      serving_size: '15 g',
      nutriments: {
        'energy-kcal_100g': 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        fat_100g: 30.9,
        fiber_100g: 0,
      },
    },
  })

  assert.equal(record.foodId, 'off 3017620422003')
  assert.equal(record.source, 'openfoodfacts')
  assert.equal(record.sourceId, 'openfoodfacts:3017620422003')
  assert.equal(record.confidence, 'barcode')
  assert.equal(record.category, 'chocolate spreads')
  assert.deepEqual(record.per100g, { calories: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, fiberG: 0 })
  assert.equal(record.householdUnits?.[0]?.grams, 15)
  assert.ok(record.aliases.includes('Nutella'))
  assert.ok(record.aliases.includes('Ferrero'))
})

test('normalizes direct adapter records before DB import', () => {
  const [record] = normalizeNutritionSourceRecords([openFoodFactsProductToRecord({
    status: 1,
    code: '3017620422003',
    product: {
      product_name: 'Nutella',
      nutriments: {
        'energy-kcal_100g': 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        fat_100g: 30.9,
      },
    },
  })])

  assert.equal(record?.foodId, 'off_3017620422003')
  assert.equal(record?.sourceId, 'openfoodfacts:3017620422003')
})

test('rejects Open Food Facts products without complete per-100g macros', () => {
  assert.throws(() => openFoodFactsProductToRecord({
    status: 1,
    code: '123',
    product: {
      product_name: 'Incomplete product',
      nutriments: { 'energy-kcal_100g': 100, proteins_100g: 2 },
    },
  }), /macros por 100g/)
})

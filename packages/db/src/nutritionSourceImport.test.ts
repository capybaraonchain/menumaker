import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNutritionSourceRecords } from './nutritionSourceImport'

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

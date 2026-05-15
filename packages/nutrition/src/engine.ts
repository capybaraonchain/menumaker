import type { IngredientLine, MatchedIngredient, NutritionConfidence, NutritionTotals, RecipeCandidate, ScoredRecipe } from '@menumaker/core'
import { seedFoods, type SeedFood } from './seedFoods'

export interface NutritionFood extends Omit<SeedFood, 'source'> {
  source: string
  sourceId?: string
}

const genericUnitToGram: Record<string, { grams: number; confidence: NutritionConfidence; note: string }> = {
  g: { grams: 1, confidence: 'database', note: 'Gramos.' },
  gr: { grams: 1, confidence: 'database', note: 'Gramos.' },
  gram: { grams: 1, confidence: 'database', note: 'Gramos.' },
  grams: { grams: 1, confidence: 'database', note: 'Gramos.' },
  gramo: { grams: 1, confidence: 'database', note: 'Gramos.' },
  gramos: { grams: 1, confidence: 'database', note: 'Gramos.' },
  kg: { grams: 1000, confidence: 'database', note: 'Conversión exacta de kilogramos a gramos.' },
  ml: { grams: 1, confidence: 'database', note: 'Mililitros tratados como gramos para ingredientes de densidad cercana al agua.' },
  l: { grams: 1000, confidence: 'generic', note: 'Litros tratados como gramos aproximados.' },
  litro: { grams: 1000, confidence: 'generic', note: 'Litros tratados como gramos aproximados.' },
  litros: { grams: 1000, confidence: 'generic', note: 'Litros tratados como gramos aproximados.' },
  tbsp: { grams: 13.5, confidence: 'generic', note: 'Cucharada genérica aproximada.' },
  tablespoon: { grams: 13.5, confidence: 'generic', note: 'Cucharada genérica aproximada.' },
  cucharada: { grams: 13.5, confidence: 'generic', note: 'Cucharada genérica aproximada.' },
  cucharadas: { grams: 13.5, confidence: 'generic', note: 'Cucharada genérica aproximada.' },
  tsp: { grams: 4.5, confidence: 'generic', note: 'Cucharadita genérica aproximada.' },
  teaspoon: { grams: 4.5, confidence: 'generic', note: 'Cucharadita genérica aproximada.' },
  cucharadita: { grams: 4.5, confidence: 'generic', note: 'Cucharadita genérica aproximada.' },
  cucharaditas: { grams: 4.5, confidence: 'generic', note: 'Cucharadita genérica aproximada.' },
  taza: { grams: 180, confidence: 'estimated', note: 'Taza genérica; se usa solo si no hay conversión específica del alimento.' },
  cup: { grams: 180, confidence: 'estimated', note: 'Taza genérica; se usa solo si no hay conversión específica del alimento.' },
  unidad: { grams: 80, confidence: 'estimated', note: 'Unidad genérica; se usa solo si no hay conversión específica del alimento.' },
  unidades: { grams: 80, confidence: 'estimated', note: 'Unidad genérica; se usa solo si no hay conversión específica del alimento.' },
  pieza: { grams: 80, confidence: 'estimated', note: 'Pieza genérica; se usa solo si no hay conversión específica del alimento.' },
  piezas: { grams: 80, confidence: 'estimated', note: 'Pieza genérica; se usa solo si no hay conversión específica del alimento.' },
  rebanada: { grams: 30, confidence: 'estimated', note: 'Rebanada genérica; se usa solo si no hay conversión específica del alimento.' },
  rebanadas: { grams: 30, confidence: 'estimated', note: 'Rebanada genérica; se usa solo si no hay conversión específica del alimento.' },
}

export function normalizeIngredientName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchFood(name: string, bannedFoods: string[] = [], catalog: NutritionFood[] = seedFoods): NutritionFood | null {
  const normalized = normalizeIngredientName(name)
  const banned = bannedFoods.map(normalizeIngredientName)
  if (banned.some((item) => normalized.includes(item))) return null

  let best: { food: NutritionFood; score: number } | null = null
  for (const food of catalog) {
    for (const alias of food.aliases) {
      const normalizedAlias = normalizeIngredientName(alias)
      const score = normalized === normalizedAlias ? 100 : normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized) ? 80 : 0
      if (score > (best?.score ?? 0)) best = { food, score }
    }
  }
  return best && best.score >= 80 ? best.food : null
}

export function normalizeAmount(line: IngredientLine, food?: NutritionFood | null): { amount: number; unit: 'g' | 'ml'; confidence: NutritionConfidence; notes: string[] } {
  const unit = normalizeIngredientName(line.unit)
  const foodSpecific = foodSpecificUnitConversion(food, unit)
  if (foodSpecific) {
    return {
      amount: line.amount * foodSpecific.grams,
      unit: 'g',
      confidence: foodSpecific.confidence,
      notes: [`Conversión específica de ${line.unit} para ${food?.aliases[0] ?? food?.canonicalName}: ${foodSpecific.note}`],
    }
  }

  const conversion = genericUnitToGram[unit]
  if (!conversion) {
    return {
      amount: line.amount,
      unit: 'g',
      confidence: 'estimated',
      notes: [`Unidad no reconocida: ${line.unit}. Se trata como gramos aproximados.`],
    }
  }
  return {
    amount: line.amount * conversion.grams,
    unit: unit === 'ml' ? 'ml' : 'g',
    confidence: conversion.confidence,
    notes: conversion.grams === 1 && conversion.confidence === 'database' ? [] : [conversion.note],
  }
}

export function calculateIngredientNutrition(line: IngredientLine, bannedFoods: string[] = [], catalog: NutritionFood[] = seedFoods): MatchedIngredient {
  const food = matchFood(line.name, bannedFoods, catalog)
  const normalized = normalizeAmount(line, food)

  if (!food) {
    return {
      ...line,
      normalizedAmount: normalized.amount,
      normalizedUnit: normalized.unit,
      confidence: 'unknown',
      nutrition: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, confidence: 'unknown' },
      notes: [...normalized.notes, `No se pudo asociar "${line.name}" con un alimento determinista.`],
    }
  }

  const multiplier = normalized.amount / 100
  const confidence = lowerConfidence(food.confidence, normalized.confidence)
  return {
    ...line,
    normalizedAmount: round(normalized.amount),
    normalizedUnit: normalized.unit,
    foodId: food.id,
    sourceId: food.sourceId ?? `${food.source}:${food.id}`,
    confidence,
    nutrition: {
      calories: round(food.per100g.calories * multiplier),
      proteinG: round(food.per100g.proteinG * multiplier),
      carbsG: round(food.per100g.carbsG * multiplier),
      fatG: round(food.per100g.fatG * multiplier),
      fiberG: food.per100g.fiberG ? round(food.per100g.fiberG * multiplier) : undefined,
      confidence,
    },
    notes: normalized.notes,
  }
}

function foodSpecificUnitConversion(food: NutritionFood | null | undefined, normalizedUnit: string): { grams: number; confidence: NutritionConfidence; note: string } | null {
  if (!food?.householdUnits) return null
  for (const conversion of food.householdUnits) {
    if (conversion.units.map(normalizeIngredientName).includes(normalizedUnit)) {
      return {
        grams: conversion.grams,
        confidence: conversion.confidence,
        note: conversion.note,
      }
    }
  }
  return null
}

export function scoreRecipe(recipe: RecipeCandidate, bannedFoods: string[] = [], catalog: NutritionFood[] = seedFoods): ScoredRecipe {
  const matchedIngredients = recipe.ingredients.map((ingredient) => calculateIngredientNutrition(ingredient, bannedFoods, catalog))
  return {
    ...recipe,
    matchedIngredients,
    nutrition: sumNutrition(matchedIngredients.map((ingredient) => ingredient.nutrition)),
  }
}

export function sumNutrition(items: NutritionTotals[]): NutritionTotals {
  const confidence = aggregateConfidence(items)
  return {
    calories: round(items.reduce((total, item) => total + item.calories, 0)),
    proteinG: round(items.reduce((total, item) => total + item.proteinG, 0)),
    carbsG: round(items.reduce((total, item) => total + item.carbsG, 0)),
    fatG: round(items.reduce((total, item) => total + item.fatG, 0)),
    fiberG: round(items.reduce((total, item) => total + (item.fiberG ?? 0), 0)),
    confidence,
  }
}

function aggregateConfidence(items: NutritionTotals[]): NutritionConfidence {
  const meaningful = items.filter((item) => item.calories >= 25)
  const considered = meaningful.length > 0 ? meaningful : items
  if (considered.some((item) => item.confidence === 'unknown')) return 'unknown'
  if (considered.some((item) => item.confidence === 'estimated')) return 'estimated'
  if (considered.some((item) => item.confidence === 'generic')) return 'generic'
  if (considered.some((item) => item.confidence === 'database')) return 'database'
  if (considered.some((item) => item.confidence === 'barcode')) return 'barcode'
  return 'exact'
}

function lowerConfidence(a: NutritionConfidence, b: NutritionConfidence): NutritionConfidence {
  const order: NutritionConfidence[] = ['exact', 'barcode', 'database', 'generic', 'estimated', 'unknown']
  return order[Math.max(order.indexOf(a), order.indexOf(b))] ?? 'unknown'
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

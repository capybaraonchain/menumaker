import type { IngredientLine, MatchedIngredient, NutritionConfidence, NutritionTotals, RecipeCandidate, ScoredRecipe } from '@menumaker/core'
import { seedFoods, type SeedFood } from './seedFoods'

const unitToGram: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  gramo: 1,
  gramos: 1,
  kg: 1000,
  ml: 1,
  tbsp: 13.5,
  tablespoon: 13.5,
  cucharada: 13.5,
  cucharadas: 13.5,
  tsp: 4.5,
  teaspoon: 4.5,
  cucharadita: 4.5,
  unidad: 80,
  unidades: 80,
  pieza: 80,
  piezas: 80,
  rebanada: 30,
  rebanadas: 30,
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

export function matchFood(name: string, bannedFoods: string[] = []): SeedFood | null {
  const normalized = normalizeIngredientName(name)
  const banned = bannedFoods.map(normalizeIngredientName)
  if (banned.some((item) => normalized.includes(item))) return null

  let best: { food: SeedFood; score: number } | null = null
  for (const food of seedFoods) {
    for (const alias of food.aliases) {
      const normalizedAlias = normalizeIngredientName(alias)
      const score = normalized === normalizedAlias ? 100 : normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized) ? 80 : 0
      if (score > (best?.score ?? 0)) best = { food, score }
    }
  }
  return best && best.score >= 80 ? best.food : null
}

export function normalizeAmount(line: IngredientLine): { amount: number; unit: 'g' | 'ml'; confidence: NutritionConfidence; notes: string[] } {
  const unit = normalizeIngredientName(line.unit)
  const factor = unitToGram[unit]
  if (!factor) {
    return {
      amount: line.amount,
      unit: 'g',
      confidence: 'estimated',
      notes: [`Unidad no reconocida: ${line.unit}. Se trata como gramos aproximados.`],
    }
  }
  return {
    amount: line.amount * factor,
    unit: unit === 'ml' ? 'ml' : 'g',
    confidence: unit === 'ml' || factor === 1 ? 'database' : 'generic',
    notes: factor === 1 ? [] : [`Conversión aproximada de ${line.unit} a gramos.`],
  }
}

export function calculateIngredientNutrition(line: IngredientLine, bannedFoods: string[] = []): MatchedIngredient {
  const normalized = normalizeAmount(line)
  const food = matchFood(line.name, bannedFoods)

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
    sourceId: `seed:${food.id}`,
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

export function scoreRecipe(recipe: RecipeCandidate, bannedFoods: string[] = []): ScoredRecipe {
  const matchedIngredients = recipe.ingredients.map((ingredient) => calculateIngredientNutrition(ingredient, bannedFoods))
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


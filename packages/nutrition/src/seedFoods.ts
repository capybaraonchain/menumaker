import type { Locale, NutritionConfidence, NutritionTotals } from '@menumaker/core'

export interface SeedFood {
  id: string
  canonicalName: string
  aliases: string[]
  category: string
  source: 'seed'
  confidence: NutritionConfidence
  per100g: Omit<NutritionTotals, 'confidence'>
}

export const seedFoods: SeedFood[] = [
  {
    id: 'chicken_breast',
    canonicalName: 'chicken breast',
    aliases: ['pechuga de pollo', 'pollo', 'chicken breast', 'chicken'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  },
  {
    id: 'egg',
    canonicalName: 'egg',
    aliases: ['huevo', 'huevos', 'egg', 'eggs'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 143, proteinG: 13, carbsG: 1.1, fatG: 9.5 },
  },
  {
    id: 'greek_yogurt',
    canonicalName: 'greek yogurt',
    aliases: ['yogur griego', 'yogur griego natural', 'greek yogurt'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 },
  },
  {
    id: 'rice_cooked',
    canonicalName: 'cooked rice',
    aliases: ['arroz cocido', 'arroz', 'cooked rice', 'rice'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
  },
  {
    id: 'potato',
    canonicalName: 'potato',
    aliases: ['patata', 'patatas', 'potato', 'potatoes'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 77, proteinG: 2, carbsG: 17, fatG: 0.1, fiberG: 2.2 },
  },
  {
    id: 'oats',
    canonicalName: 'oats',
    aliases: ['avena', 'copos de avena', 'oats'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9, fiberG: 10.6 },
  },
  {
    id: 'lentils_cooked',
    canonicalName: 'cooked lentils',
    aliases: ['lentejas cocidas', 'lentejas', 'cooked lentils', 'lentils'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 116, proteinG: 9, carbsG: 20, fatG: 0.4, fiberG: 7.9 },
  },
  {
    id: 'olive_oil',
    canonicalName: 'olive oil',
    aliases: ['aceite de oliva', 'aove', 'olive oil'],
    category: 'fat',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 884, proteinG: 0, carbsG: 0, fatG: 100 },
  },
  {
    id: 'tomato',
    canonicalName: 'tomato',
    aliases: ['tomate', 'tomates', 'tomato'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2, fiberG: 1.2 },
  },
  {
    id: 'broccoli',
    canonicalName: 'broccoli',
    aliases: ['brócoli', 'brocoli', 'broccoli'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4, fiberG: 2.6 },
  },
  {
    id: 'banana',
    canonicalName: 'banana',
    aliases: ['plátano', 'platano', 'banana'],
    category: 'fruit',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6 },
  },
  {
    id: 'tuna',
    canonicalName: 'tuna',
    aliases: ['atún', 'atun', 'tuna'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 132, proteinG: 28, carbsG: 0, fatG: 1.3 },
  },
  {
    id: 'salmon',
    canonicalName: 'salmon',
    aliases: ['salmón', 'salmon'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 208, proteinG: 20, carbsG: 0, fatG: 13 },
  },
  {
    id: 'avocado',
    canonicalName: 'avocado',
    aliases: ['aguacate', 'avocado'],
    category: 'fat',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 160, proteinG: 2, carbsG: 8.5, fatG: 14.7, fiberG: 6.7 },
  },
  {
    id: 'spinach',
    canonicalName: 'spinach',
    aliases: ['espinacas', 'spinach'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4, fiberG: 2.2 },
  },
  {
    id: 'whole_wheat_bread',
    canonicalName: 'whole wheat bread',
    aliases: ['pan integral', 'whole wheat bread'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 247, proteinG: 13, carbsG: 41, fatG: 4.2, fiberG: 7 },
  },
]

export function localizedFoodName(foodId: string, locale: Locale): string {
  const food = seedFoods.find((item) => item.id === foodId)
  if (!food) return foodId
  if (locale === 'es') return food.aliases[0] ?? food.canonicalName
  return food.canonicalName
}


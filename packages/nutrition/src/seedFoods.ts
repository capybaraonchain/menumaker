import type { Locale, NutritionConfidence, NutritionTotals } from '@menumaker/core'

export interface SeedFood {
  id: string
  canonicalName: string
  aliases: string[]
  category: string
  source: 'seed'
  confidence: NutritionConfidence
  per100g: Omit<NutritionTotals, 'confidence'>
  householdUnits?: Array<{
    units: string[]
    grams: number
    confidence: NutritionConfidence
    note: string
  }>
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
    householdUnits: [
      { units: ['filete', 'filetes', 'unidad', 'pieza'], grams: 150, confidence: 'generic', note: 'Pieza media de pechuga de pollo.' },
    ],
  },
  {
    id: 'egg',
    canonicalName: 'egg',
    aliases: ['huevo', 'huevos', 'egg', 'eggs'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 143, proteinG: 13, carbsG: 1.1, fatG: 9.5 },
    householdUnits: [
      { units: ['huevo', 'huevos', 'unidad', 'unidades', 'pieza', 'piezas'], grams: 50, confidence: 'database', note: 'Huevo mediano sin cáscara.' },
    ],
  },
  {
    id: 'greek_yogurt',
    canonicalName: 'greek yogurt',
    aliases: ['yogur griego', 'yogur griego natural', 'greek yogurt'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 },
    householdUnits: [
      { units: ['vaso', 'vasito', 'unidad'], grams: 125, confidence: 'generic', note: 'Vaso individual de yogur.' },
    ],
  },
  {
    id: 'rice_cooked',
    canonicalName: 'cooked rice',
    aliases: ['arroz cocido', 'arroz', 'cooked rice', 'rice'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 158, confidence: 'generic', note: 'Taza de arroz cocido.' },
    ],
  },
  {
    id: 'potato',
    canonicalName: 'potato',
    aliases: ['patata', 'patatas', 'potato', 'potatoes'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 77, proteinG: 2, carbsG: 17, fatG: 0.1, fiberG: 2.2 },
    householdUnits: [
      { units: ['patata', 'unidad', 'pieza'], grams: 170, confidence: 'generic', note: 'Patata mediana.' },
    ],
  },
  {
    id: 'oats',
    canonicalName: 'oats',
    aliases: ['avena', 'copos de avena', 'oats'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9, fiberG: 10.6 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 80, confidence: 'generic', note: 'Taza de copos de avena.' },
    ],
  },
  {
    id: 'lentils_cooked',
    canonicalName: 'cooked lentils',
    aliases: ['lentejas cocidas', 'lentejas', 'cooked lentils', 'lentils'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 116, proteinG: 9, carbsG: 20, fatG: 0.4, fiberG: 7.9 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 198, confidence: 'generic', note: 'Taza de lentejas cocidas.' },
    ],
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
    householdUnits: [
      { units: ['tomate', 'unidad', 'pieza'], grams: 120, confidence: 'generic', note: 'Tomate mediano.' },
    ],
  },
  {
    id: 'broccoli',
    canonicalName: 'broccoli',
    aliases: ['brócoli', 'brocoli', 'broccoli'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4, fiberG: 2.6 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 90, confidence: 'generic', note: 'Taza de brócoli troceado.' },
    ],
  },
  {
    id: 'banana',
    canonicalName: 'banana',
    aliases: ['plátano', 'platano', 'banana'],
    category: 'fruit',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6 },
    householdUnits: [
      { units: ['platano', 'plátano', 'banana', 'unidad', 'pieza'], grams: 118, confidence: 'generic', note: 'Plátano mediano pelado.' },
    ],
  },
  {
    id: 'tuna',
    canonicalName: 'tuna',
    aliases: ['atún', 'atun', 'tuna'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 132, proteinG: 28, carbsG: 0, fatG: 1.3 },
    householdUnits: [
      { units: ['lata', 'unidad'], grams: 80, confidence: 'generic', note: 'Lata escurrida de atún.' },
    ],
  },
  {
    id: 'salmon',
    canonicalName: 'salmon',
    aliases: ['salmón', 'salmon'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 208, proteinG: 20, carbsG: 0, fatG: 13 },
    householdUnits: [
      { units: ['filete', 'unidad', 'pieza'], grams: 150, confidence: 'generic', note: 'Filete medio de salmón.' },
    ],
  },
  {
    id: 'avocado',
    canonicalName: 'avocado',
    aliases: ['aguacate', 'avocado'],
    category: 'fat',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 160, proteinG: 2, carbsG: 8.5, fatG: 14.7, fiberG: 6.7 },
    householdUnits: [
      { units: ['aguacate', 'unidad', 'pieza'], grams: 150, confidence: 'generic', note: 'Aguacate mediano sin piel ni hueso.' },
    ],
  },
  {
    id: 'spinach',
    canonicalName: 'spinach',
    aliases: ['espinacas', 'spinach'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4, fiberG: 2.2 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 30, confidence: 'generic', note: 'Taza de espinacas crudas.' },
    ],
  },
  {
    id: 'whole_wheat_bread',
    canonicalName: 'whole wheat bread',
    aliases: ['pan integral', 'whole wheat bread'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 247, proteinG: 13, carbsG: 41, fatG: 4.2, fiberG: 7 },
    householdUnits: [
      { units: ['rebanada', 'rebanadas', 'slice', 'slices'], grams: 35, confidence: 'generic', note: 'Rebanada media de pan integral.' },
    ],
  },
  {
    id: 'turkey_breast',
    canonicalName: 'turkey breast',
    aliases: ['pechuga de pavo', 'pavo', 'turkey breast', 'turkey'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 135, proteinG: 29, carbsG: 0, fatG: 1.7 },
  },
  {
    id: 'lean_beef',
    canonicalName: 'lean beef',
    aliases: ['ternera magra', 'carne magra', 'lean beef', 'beef'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 176, proteinG: 26, carbsG: 0, fatG: 7 },
  },
  {
    id: 'tofu',
    canonicalName: 'tofu',
    aliases: ['tofu', 'tofu firme', 'firm tofu'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 144, proteinG: 15.8, carbsG: 3.9, fatG: 8.7, fiberG: 2.3 },
  },
  {
    id: 'chickpeas_cooked',
    canonicalName: 'cooked chickpeas',
    aliases: ['garbanzos cocidos', 'garbanzos', 'cooked chickpeas', 'chickpeas'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 164, proteinG: 8.9, carbsG: 27.4, fatG: 2.6, fiberG: 7.6 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 164, confidence: 'generic', note: 'Taza de garbanzos cocidos.' },
    ],
  },
  {
    id: 'quinoa_cooked',
    canonicalName: 'cooked quinoa',
    aliases: ['quinoa cocida', 'quinoa', 'cooked quinoa'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 120, proteinG: 4.4, carbsG: 21.3, fatG: 1.9, fiberG: 2.8 },
    householdUnits: [
      { units: ['taza', 'cup'], grams: 185, confidence: 'generic', note: 'Taza de quinoa cocida.' },
    ],
  },
  {
    id: 'pasta_cooked',
    canonicalName: 'cooked pasta',
    aliases: ['pasta cocida', 'pasta', 'cooked pasta'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 158, proteinG: 5.8, carbsG: 30.9, fatG: 0.9, fiberG: 1.8 },
  },
  {
    id: 'sweet_potato',
    canonicalName: 'sweet potato',
    aliases: ['boniato', 'batata', 'sweet potato'],
    category: 'carb',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 86, proteinG: 1.6, carbsG: 20.1, fatG: 0.1, fiberG: 3 },
  },
  {
    id: 'zucchini',
    canonicalName: 'zucchini',
    aliases: ['calabacín', 'calabacin', 'zucchini'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 17, proteinG: 1.2, carbsG: 3.1, fatG: 0.3, fiberG: 1 },
  },
  {
    id: 'bell_pepper',
    canonicalName: 'bell pepper',
    aliases: ['pimiento', 'pimiento rojo', 'bell pepper'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 31, proteinG: 1, carbsG: 6, fatG: 0.3, fiberG: 2.1 },
  },
  {
    id: 'onion',
    canonicalName: 'onion',
    aliases: ['cebolla', 'onion'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 40, proteinG: 1.1, carbsG: 9.3, fatG: 0.1, fiberG: 1.7 },
  },
  {
    id: 'carrot',
    canonicalName: 'carrot',
    aliases: ['zanahoria', 'carrot'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 41, proteinG: 0.9, carbsG: 9.6, fatG: 0.2, fiberG: 2.8 },
  },
  {
    id: 'mushroom',
    canonicalName: 'mushroom',
    aliases: ['champiñones', 'champinones', 'mushroom'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 22, proteinG: 3.1, carbsG: 3.3, fatG: 0.3, fiberG: 1 },
  },
  {
    id: 'cucumber',
    canonicalName: 'cucumber',
    aliases: ['pepino', 'cucumber'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 15, proteinG: 0.7, carbsG: 3.6, fatG: 0.1, fiberG: 0.5 },
  },
  {
    id: 'lettuce',
    canonicalName: 'lettuce',
    aliases: ['lechuga', 'lettuce'],
    category: 'vegetable',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 15, proteinG: 1.4, carbsG: 2.9, fatG: 0.2, fiberG: 1.3 },
  },
  {
    id: 'apple',
    canonicalName: 'apple',
    aliases: ['manzana', 'apple'],
    category: 'fruit',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 52, proteinG: 0.3, carbsG: 13.8, fatG: 0.2, fiberG: 2.4 },
    householdUnits: [
      { units: ['manzana', 'unidad', 'pieza'], grams: 180, confidence: 'generic', note: 'Manzana mediana.' },
    ],
  },
  {
    id: 'berries',
    canonicalName: 'berries',
    aliases: ['frutos rojos', 'bayas', 'berries'],
    category: 'fruit',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 50, proteinG: 0.8, carbsG: 12, fatG: 0.3, fiberG: 4 },
  },
  {
    id: 'cottage_cheese',
    canonicalName: 'cottage cheese',
    aliases: ['queso cottage', 'cottage cheese', 'requesón'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 98, proteinG: 11.1, carbsG: 3.4, fatG: 4.3 },
  },
  {
    id: 'milk',
    canonicalName: 'milk',
    aliases: ['leche', 'milk'],
    category: 'protein',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 60, proteinG: 3.2, carbsG: 4.8, fatG: 3.3 },
  },
  {
    id: 'almonds',
    canonicalName: 'almonds',
    aliases: ['almendras', 'almonds'],
    category: 'fat',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 579, proteinG: 21.2, carbsG: 21.6, fatG: 49.9, fiberG: 12.5 },
  },
  {
    id: 'peanut_butter',
    canonicalName: 'peanut butter',
    aliases: ['crema de cacahuete', 'mantequilla de cacahuete', 'peanut butter'],
    category: 'fat',
    source: 'seed',
    confidence: 'database',
    per100g: { calories: 588, proteinG: 25, carbsG: 20, fatG: 50, fiberG: 6 },
  },
]

export function localizedFoodName(foodId: string, locale: Locale): string {
  const food = seedFoods.find((item) => item.id === foodId)
  if (!food) return foodId
  if (locale === 'es') return food.aliases[0] ?? food.canonicalName
  return food.canonicalName
}

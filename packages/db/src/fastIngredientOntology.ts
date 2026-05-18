import type { Locale, MealSlot } from '@menumaker/core'
import { normalizeIngredientName, type NutritionFood } from '@menumaker/nutrition'

export type FastIngredientRole = 'protein' | 'carb' | 'main_veg' | 'fruit' | 'fat' | 'aromatic' | 'mixed' | 'other'

export interface FastIngredientMetadata {
  id: string
  labelEs: string
  labelEn: string
  role: FastIngredientRole
  family: string
  tags: string[]
  repeatLimit?: number
  amountRanges?: Partial<Record<MealSlot | 'default', { min: number; max: number }>>
  defaultAmounts?: Partial<Record<MealSlot | 'default', number>>
  unit?: 'g' | 'ml'
}

export interface FastIngredientBankItem {
  id: string
  label: string
  role: Exclude<FastIngredientRole, 'mixed' | 'other'>
  family: string
  tags: string[]
}

const seedIngredientMetadata: Record<string, Omit<FastIngredientMetadata, 'id'>> = {
  chicken_breast: { labelEs: 'pechuga de pollo', labelEn: 'chicken breast', role: 'protein', family: 'poultry', tags: ['savory_protein', 'lean_meat'], repeatLimit: 4 },
  egg: { labelEs: 'huevo', labelEn: 'egg', role: 'protein', family: 'egg', tags: ['breakfast_protein', 'savory_protein'], repeatLimit: 4, defaultAmounts: { default: 120 }, amountRanges: { default: { min: 80, max: 180 } } },
  greek_yogurt: { labelEs: 'yogur griego', labelEn: 'greek yogurt', role: 'protein', family: 'dairy', tags: ['sweet_protein', 'dairy'], repeatLimit: 5, defaultAmounts: { snack: 180, default: 240 }, amountRanges: { default: { min: 120, max: 340 } } },
  rice_cooked: { labelEs: 'arroz cocido', labelEn: 'cooked rice', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  potato: { labelEs: 'patata', labelEn: 'potato', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  oats: { labelEs: 'avena', labelEn: 'oats', role: 'carb', family: 'starch', tags: ['sweet_carb', 'breakfast_carb'], repeatLimit: 4, defaultAmounts: { default: 55 }, amountRanges: { default: { min: 30, max: 85 } } },
  lentils_cooked: { labelEs: 'lentejas cocidas', labelEn: 'cooked lentils', role: 'mixed', family: 'legume', tags: ['legume', 'savory_protein', 'neutral_carb'], repeatLimit: 4 },
  olive_oil: { labelEs: 'aceite de oliva', labelEn: 'olive oil', role: 'fat', family: 'fat', tags: ['savory_fat', 'oil'], repeatLimit: 5, unit: 'ml', defaultAmounts: { default: 8 }, amountRanges: { default: { min: 3, max: 18 } } },
  tomato: { labelEs: 'tomate', labelEn: 'tomato', role: 'main_veg', family: 'veg', tags: ['fresh_veg', 'savory_veg'], repeatLimit: 8 },
  broccoli: { labelEs: 'brócoli', labelEn: 'broccoli', role: 'main_veg', family: 'veg', tags: ['savory_veg'], repeatLimit: 8 },
  banana: { labelEs: 'plátano', labelEn: 'banana', role: 'fruit', family: 'fruit', tags: ['sweet_fruit', 'banana'], repeatLimit: 5 },
  tuna: { labelEs: 'atún', labelEn: 'tuna', role: 'protein', family: 'fish', tags: ['fish', 'savory_protein'], repeatLimit: 4 },
  salmon: { labelEs: 'salmón', labelEn: 'salmon', role: 'protein', family: 'fish', tags: ['fish', 'savory_protein'], repeatLimit: 4 },
  avocado: { labelEs: 'aguacate', labelEn: 'avocado', role: 'fat', family: 'fat', tags: ['savory_fat'], repeatLimit: 5, defaultAmounts: { snack: 60, default: 80 }, amountRanges: { default: { min: 40, max: 130 } } },
  spinach: { labelEs: 'espinacas', labelEn: 'spinach', role: 'main_veg', family: 'veg', tags: ['leafy_veg', 'savory_veg'], repeatLimit: 8 },
  whole_wheat_bread: { labelEs: 'pan integral', labelEn: 'whole wheat bread', role: 'carb', family: 'starch', tags: ['neutral_carb', 'toast_base'], repeatLimit: 7, defaultAmounts: { default: 70 }, amountRanges: { default: { min: 35, max: 110 } } },
  turkey_breast: { labelEs: 'pechuga de pavo', labelEn: 'turkey breast', role: 'protein', family: 'poultry', tags: ['savory_protein', 'lean_meat'], repeatLimit: 4 },
  lean_beef: { labelEs: 'ternera magra', labelEn: 'lean beef', role: 'protein', family: 'red_meat', tags: ['savory_protein'], repeatLimit: 4 },
  tofu: { labelEs: 'tofu', labelEn: 'tofu', role: 'protein', family: 'plant_protein', tags: ['savory_protein'], repeatLimit: 4 },
  chickpeas_cooked: { labelEs: 'garbanzos cocidos', labelEn: 'cooked chickpeas', role: 'mixed', family: 'legume', tags: ['legume', 'savory_protein', 'neutral_carb'], repeatLimit: 4 },
  quinoa_cooked: { labelEs: 'quinoa cocida', labelEn: 'cooked quinoa', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  pasta_cooked: { labelEs: 'pasta cocida', labelEn: 'cooked pasta', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  sweet_potato: { labelEs: 'boniato', labelEn: 'sweet potato', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  couscous_cooked: { labelEs: 'cuscús cocido', labelEn: 'cooked couscous', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  bulgur_cooked: { labelEs: 'bulgur cocido', labelEn: 'cooked bulgur', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 7 },
  whole_wheat_tortilla: { labelEs: 'tortilla integral', labelEn: 'whole wheat tortilla', role: 'carb', family: 'starch', tags: ['neutral_carb', 'wrap_base'], repeatLimit: 7, defaultAmounts: { breakfast: 60, snack: 45, default: 90 }, amountRanges: { breakfast: { min: 40, max: 110 }, snack: { min: 30, max: 90 }, default: { min: 60, max: 150 } } },
  corn: { labelEs: 'maíz', labelEn: 'corn', role: 'carb', family: 'starch', tags: ['neutral_carb'], repeatLimit: 6 },
  peas: { labelEs: 'guisantes', labelEn: 'peas', role: 'carb', family: 'starch', tags: ['neutral_carb', 'savory_veg'], repeatLimit: 6 },
  black_beans_cooked: { labelEs: 'alubias negras cocidas', labelEn: 'cooked black beans', role: 'mixed', family: 'legume', tags: ['legume', 'savory_protein', 'neutral_carb'], repeatLimit: 4 },
  zucchini: { labelEs: 'calabacín', labelEn: 'zucchini', role: 'main_veg', family: 'veg', tags: ['savory_veg'], repeatLimit: 8 },
  bell_pepper: { labelEs: 'pimiento', labelEn: 'bell pepper', role: 'main_veg', family: 'veg', tags: ['savory_veg'], repeatLimit: 8 },
  onion: { labelEs: 'cebolla', labelEn: 'onion', role: 'main_veg', family: 'veg', tags: ['aromatic_veg', 'savory_veg'], repeatLimit: 8 },
  carrot: { labelEs: 'zanahoria', labelEn: 'carrot', role: 'main_veg', family: 'veg', tags: ['savory_veg'], repeatLimit: 8 },
  mushroom: { labelEs: 'champiñones', labelEn: 'mushrooms', role: 'main_veg', family: 'veg', tags: ['savory_veg'], repeatLimit: 8 },
  cucumber: { labelEs: 'pepino', labelEn: 'cucumber', role: 'main_veg', family: 'veg', tags: ['fresh_veg', 'savory_veg'], repeatLimit: 8 },
  lettuce: { labelEs: 'lechuga', labelEn: 'lettuce', role: 'main_veg', family: 'veg', tags: ['leafy_veg', 'fresh_veg'], repeatLimit: 8 },
  apple: { labelEs: 'manzana', labelEn: 'apple', role: 'fruit', family: 'fruit', tags: ['sweet_fruit'], repeatLimit: 5 },
  berries: { labelEs: 'frutos rojos', labelEn: 'berries', role: 'fruit', family: 'fruit', tags: ['sweet_fruit', 'berries'], repeatLimit: 5 },
  raisins: { labelEs: 'pasas', labelEn: 'raisins', role: 'fruit', family: 'dried_fruit', tags: ['sweet_fruit', 'dried_fruit'], repeatLimit: 3, defaultAmounts: { default: 25 }, amountRanges: { default: { min: 10, max: 45 } } },
  dates: { labelEs: 'dátiles', labelEn: 'dates', role: 'fruit', family: 'dried_fruit', tags: ['sweet_fruit', 'dried_fruit'], repeatLimit: 3, defaultAmounts: { default: 35 }, amountRanges: { default: { min: 15, max: 60 } } },
  granola: { labelEs: 'granola', labelEn: 'granola', role: 'carb', family: 'breakfast_cereal', tags: ['sweet_carb', 'breakfast_carb'], repeatLimit: 4, defaultAmounts: { default: 45 }, amountRanges: { default: { min: 20, max: 80 } } },
  muesli: { labelEs: 'muesli', labelEn: 'muesli', role: 'carb', family: 'breakfast_cereal', tags: ['sweet_carb', 'breakfast_carb'], repeatLimit: 4, defaultAmounts: { default: 55 }, amountRanges: { default: { min: 25, max: 90 } } },
  rice_cakes: { labelEs: 'tortitas de arroz', labelEn: 'rice cakes', role: 'carb', family: 'starch', tags: ['neutral_carb', 'snack_carb'], repeatLimit: 5, defaultAmounts: { snack: 27, default: 36 }, amountRanges: { default: { min: 18, max: 60 } } },
  cottage_cheese: { labelEs: 'requesón', labelEn: 'cottage cheese', role: 'protein', family: 'dairy', tags: ['sweet_protein', 'savory_cheese', 'dairy'], repeatLimit: 5, defaultAmounts: { snack: 180, default: 240 }, amountRanges: { default: { min: 120, max: 340 } } },
  milk: { labelEs: 'leche', labelEn: 'milk', role: 'protein', family: 'dairy', tags: ['sweet_protein', 'dairy'], repeatLimit: 5, unit: 'ml', defaultAmounts: { snack: 220, default: 250 }, amountRanges: { default: { min: 120, max: 340 } } },
  almonds: { labelEs: 'almendras', labelEn: 'almonds', role: 'fat', family: 'nuts', tags: ['nuts', 'sweet_fat'], repeatLimit: 4, defaultAmounts: { default: 22 }, amountRanges: { default: { min: 8, max: 40 } } },
  peanut_butter: { labelEs: 'crema de cacahuete', labelEn: 'peanut butter', role: 'fat', family: 'nuts', tags: ['nut_butter', 'sweet_fat'], repeatLimit: 4, defaultAmounts: { default: 20 }, amountRanges: { default: { min: 8, max: 40 } } },
  walnuts: { labelEs: 'nueces', labelEn: 'walnuts', role: 'fat', family: 'nuts', tags: ['nuts', 'sweet_fat'], repeatLimit: 4, defaultAmounts: { default: 20 }, amountRanges: { default: { min: 8, max: 40 } } },
  cashews: { labelEs: 'anacardos', labelEn: 'cashews', role: 'fat', family: 'nuts', tags: ['nuts', 'sweet_fat'], repeatLimit: 4, defaultAmounts: { default: 22 }, amountRanges: { default: { min: 8, max: 40 } } },
  chia_seeds: { labelEs: 'semillas de chía', labelEn: 'chia seeds', role: 'fat', family: 'seeds', tags: ['seeds', 'sweet_fat'], repeatLimit: 4, defaultAmounts: { default: 15 }, amountRanges: { default: { min: 5, max: 30 } } },
  tahini: { labelEs: 'tahini', labelEn: 'tahini', role: 'fat', family: 'seeds', tags: ['seeds', 'savory_fat'], repeatLimit: 4, defaultAmounts: { default: 18 }, amountRanges: { default: { min: 8, max: 35 } } },
  hummus: { labelEs: 'hummus', labelEn: 'hummus', role: 'mixed', family: 'legume', tags: ['legume', 'savory_protein', 'savory_fat'], repeatLimit: 4, defaultAmounts: { snack: 70, default: 100 }, amountRanges: { snack: { min: 40, max: 120 }, default: { min: 60, max: 160 } } },
  honey: { labelEs: 'miel', labelEn: 'honey', role: 'carb', family: 'sweetener', tags: ['sweet_carb', 'sweetener'], repeatLimit: 4, defaultAmounts: { default: 15 }, amountRanges: { default: { min: 5, max: 30 } } },
  jam: { labelEs: 'mermelada', labelEn: 'jam', role: 'carb', family: 'sweetener', tags: ['sweet_carb', 'sweetener'], repeatLimit: 4, defaultAmounts: { default: 20 }, amountRanges: { default: { min: 8, max: 35 } } },
  garlic: { labelEs: 'ajo', labelEn: 'garlic', role: 'aromatic', family: 'aromatic', tags: ['aromatic'], repeatLimit: 4, defaultAmounts: { default: 4 }, amountRanges: { default: { min: 1, max: 8 } } },
  lemon_juice: { labelEs: 'zumo de limón', labelEn: 'lemon juice', role: 'aromatic', family: 'aromatic', tags: ['aromatic'], repeatLimit: 4, unit: 'ml', defaultAmounts: { default: 8 }, amountRanges: { default: { min: 3, max: 18 } } },
}

export function fastIngredientMetadata(food: NutritionFood): FastIngredientMetadata {
  const known = seedIngredientMetadata[food.id]
  if (known) return { id: food.id, ...known }
  const inferred = inferImportedMetadata(food)
  return { id: food.id, ...inferred }
}

export function fastIngredientBankItem(food: NutritionFood, locale: Locale): FastIngredientBankItem | null {
  const meta = fastIngredientMetadata(food)
  if (meta.role === 'other') return null
  return {
    id: meta.id,
    label: locale === 'es' ? meta.labelEs : meta.labelEn,
    role: meta.role === 'mixed' ? 'protein' : meta.role,
    family: meta.family,
    tags: meta.tags.slice(0, 4),
  }
}

export function preferredFastIngredientName(food: NutritionFood, locale: Locale): string {
  const meta = fastIngredientMetadata(food)
  return locale === 'es' ? meta.labelEs : meta.labelEn
}

export function fastRoleForFood(food: NutritionFood): FastIngredientRole {
  return fastIngredientMetadata(food).role
}

export function fastFamilyForFood(food: NutritionFood): string {
  return fastIngredientMetadata(food).family
}

export function fastRepeatLimitForFood(food: NutritionFood): number {
  const meta = fastIngredientMetadata(food)
  if (meta.repeatLimit) return meta.repeatLimit
  if (meta.role === 'aromatic') return 4
  if (meta.role === 'fat') return meta.family === 'nuts' ? 4 : 5
  if (meta.role === 'protein' || meta.role === 'mixed') return meta.family === 'dairy' ? 5 : 4
  if (meta.role === 'carb') return meta.id === 'oats' ? 4 : 7
  if (meta.role === 'fruit') return 5
  if (meta.role === 'main_veg') return 8
  return 6
}

export function fastFamilyRepeatLimit(family: string): number {
  if (family === 'dairy') return 10
  if (family === 'nuts') return 7
  if (family === 'seeds') return 6
  if (family === 'sweetener') return 5
  if (family === 'dried_fruit') return 4
  if (family === 'breakfast_cereal') return 5
  if (family === 'fish') return 4
  if (family === 'poultry') return 5
  return 99
}

export function fastDefaultAmountForFood(food: NutritionFood, slot: MealSlot): number {
  const meta = fastIngredientMetadata(food)
  return meta.defaultAmounts?.[slot] ?? meta.defaultAmounts?.default ?? defaultAmountForRole(meta.role, slot)
}

export function fastAmountRangeForFood(food: NutritionFood, slot: MealSlot): { min: number; max: number } {
  const meta = fastIngredientMetadata(food)
  return meta.amountRanges?.[slot] ?? meta.amountRanges?.default ?? amountRangeForRole(meta.role, slot)
}

export function fastUnitForFood(food: NutritionFood): 'g' | 'ml' {
  return fastIngredientMetadata(food).unit ?? 'g'
}

export function fastCombinationIssue(foods: NutritionFood[], slot: MealSlot): string | null {
  const metas = foods.map(fastIngredientMetadata)
  const tags = new Set(metas.flatMap((meta) => meta.tags))
  const families = new Set(metas.map((meta) => meta.family))
  const hasSweetFruit = tags.has('sweet_fruit')
  const hasBanana = tags.has('banana')
  const hasFish = families.has('fish')
  const hasSavoryMeat = families.has('poultry') || families.has('red_meat')
  const hasNutButter = tags.has('nut_butter')
  const hasSavoryCheese = tags.has('savory_cheese')
  const hasDairy = families.has('dairy')
  const hasTuna = metas.some((meta) => meta.id === 'tuna')
  const hasSweetOnlyDairy = tags.has('sweet_protein') && !hasSavoryCheese
  const hasSavoryVegetable = tags.has('savory_veg') || tags.has('fresh_veg') || tags.has('leafy_veg')
  if (hasFish && (hasSweetFruit || hasNutButter)) return 'fish_with_sweet_or_nut'
  if ((slot === 'lunch' || slot === 'dinner') && hasSavoryMeat && hasSweetFruit) return 'meat_main_with_sweet_fruit'
  if (hasTuna && hasDairy) return 'tuna_with_dairy'
  if (hasSavoryCheese && hasBanana) return 'cheese_with_banana'
  if ((slot === 'breakfast' || slot === 'snack') && hasSweetOnlyDairy && hasSavoryVegetable) return 'sweet_dairy_with_savory_veg'
  return null
}

function inferImportedMetadata(food: NutritionFood): Omit<FastIngredientMetadata, 'id'> {
  const normalized = normalizeIngredientName([food.id, food.canonicalName, food.category, ...food.aliases].join(' '))
  const category = normalizeIngredientName(food.category)
  if (/(garlic|ajo|mustard|spice|herb|parsley|cilantro|oregano|paprika|pepper black|cumin|vinegar|vinagre|lemon juice|lime juice|zumo de limon|soy sauce|salsa de soja)/.test(normalized)) {
    return { labelEs: inferSpanishLabel(food, 'aromático'), labelEn: food.canonicalName, role: 'aromatic', family: 'aromatic', tags: ['aromatic'], repeatLimit: 4, amountRanges: { default: { min: 1, max: 18 } }, defaultAmounts: { default: normalized.includes('garlic') ? 4 : 7 }, unit: /(juice|vinegar|sauce)/.test(normalized) ? 'ml' : 'g' }
  }
  if (normalized.includes('kiwifruit')) return { labelEs: 'kiwi', labelEn: 'kiwi', role: 'fruit', family: 'fruit', tags: ['sweet_fruit'], repeatLimit: 5 }
  if (normalized.includes('melon') || normalized.includes('cantaloupe')) return { labelEs: 'melón', labelEn: 'melon', role: 'fruit', family: 'fruit', tags: ['sweet_fruit'], repeatLimit: 5 }
  if (normalized.includes('cottage cheese')) return { labelEs: 'requesón', labelEn: 'cottage cheese', role: 'protein', family: 'dairy', tags: ['sweet_protein', 'savory_cheese', 'dairy'], repeatLimit: 5, defaultAmounts: { snack: 180, default: 240 }, amountRanges: { default: { min: 120, max: 340 } } }
  if (normalized.includes('mozzarella')) return { labelEs: 'mozzarella', labelEn: 'mozzarella', role: 'protein', family: 'dairy', tags: ['savory_cheese', 'dairy'], repeatLimit: 5, defaultAmounts: { snack: 60, default: 90 }, amountRanges: { snack: { min: 35, max: 100 }, breakfast: { min: 35, max: 100 }, default: { min: 60, max: 140 } } }
  if (normalized.includes('cheddar')) return { labelEs: 'queso cheddar', labelEn: 'cheddar', role: 'protein', family: 'dairy', tags: ['savory_cheese', 'dairy'], repeatLimit: 5, defaultAmounts: { snack: 60, default: 90 }, amountRanges: { snack: { min: 35, max: 100 }, breakfast: { min: 35, max: 100 }, default: { min: 60, max: 140 } } }
  if (normalized.includes('yogurt') && normalized.includes('greek')) return { labelEs: normalized.includes('strawberry') ? 'yogur griego de fresa' : 'yogur griego', labelEn: food.canonicalName, role: 'protein', family: 'dairy', tags: ['sweet_protein', 'dairy'], repeatLimit: 5, defaultAmounts: { snack: 180, default: 240 }, amountRanges: { default: { min: 120, max: 340 } } }
  const bucket = inferRoleFromCategory(category, food)
  return {
    labelEs: inferSpanishLabel(food, food.canonicalName),
    labelEn: food.canonicalName || food.aliases[0] || food.id,
    role: bucket,
    family: familyFromRole(bucket),
    tags: tagsFromRole(bucket),
  }
}

function inferRoleFromCategory(category: string, food: NutritionFood): FastIngredientRole {
  if (category.includes('vegetable')) return 'main_veg'
  if (category.includes('fruit')) return 'fruit'
  if (category.includes('fat') || category.includes('oil') || category.includes('nut') || category.includes('seed')) return 'fat'
  if (category.includes('carb') || category.includes('cereal') || category.includes('grain') || category.includes('bread') || category.includes('pasta')) return 'carb'
  if (category.includes('protein') || category.includes('poultry') || category.includes('beef') || category.includes('fish') || category.includes('egg') || category.includes('legume')) {
    return food.per100g.carbsG >= 12 && food.per100g.proteinG >= 5 ? 'mixed' : 'protein'
  }
  return 'other'
}

function familyFromRole(role: FastIngredientRole): string {
  if (role === 'carb') return 'starch'
  if (role === 'main_veg') return 'veg'
  if (role === 'fat') return 'fat'
  if (role === 'mixed') return 'legume'
  return role
}

function tagsFromRole(role: FastIngredientRole): string[] {
  if (role === 'fruit') return ['sweet_fruit']
  if (role === 'main_veg') return ['savory_veg']
  if (role === 'carb') return ['neutral_carb']
  if (role === 'protein' || role === 'mixed') return ['savory_protein']
  if (role === 'fat') return ['savory_fat']
  if (role === 'aromatic') return ['aromatic']
  return []
}

function defaultAmountForRole(role: FastIngredientRole, slot: MealSlot): number {
  if (role === 'aromatic') return 6
  if (role === 'fat') return 18
  if (role === 'fruit') return slot === 'snack' || slot === 'breakfast' ? 110 : 90
  if (role === 'main_veg') return slot === 'snack' ? 100 : 140
  if (role === 'carb' || role === 'mixed') return slot === 'breakfast' || slot === 'snack' ? 90 : 190
  if (role === 'protein') return slot === 'breakfast' || slot === 'snack' ? 140 : 180
  return 80
}

function amountRangeForRole(role: FastIngredientRole, slot: MealSlot): { min: number; max: number } {
  if (role === 'fat') return { min: 8, max: 40 }
  if (role === 'fruit') return { min: 60, max: 190 }
  if (role === 'aromatic') return { min: 1, max: 18 }
  if (role === 'main_veg') return { min: slot === 'snack' ? 60 : 80, max: 240 }
  if (role === 'carb' || role === 'mixed') return { min: slot === 'breakfast' || slot === 'snack' ? 45 : 110, max: slot === 'breakfast' || slot === 'snack' ? 170 : 300 }
  if (role === 'protein') return { min: slot === 'breakfast' || slot === 'snack' ? 90 : 130, max: slot === 'breakfast' || slot === 'snack' ? 220 : 250 }
  return { min: 20, max: 180 }
}

function inferSpanishLabel(food: NutritionFood, fallback: string): string {
  const spanish = food.aliases.find((alias) => /[áéíóúñ]/i.test(alias))
  if (spanish) return spanish
  const normalized = normalizeIngredientName([food.id, food.canonicalName, ...food.aliases].join(' '))
  if (normalized.includes('mustard')) return 'mostaza'
  if (normalized.includes('garlic')) return 'ajo'
  if (normalized.includes('cottage cheese')) return 'requesón'
  if (normalized.includes('cheese')) return 'queso'
  return fallback
}

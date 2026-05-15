import type { Locale, MealSlot, RecipeCandidate } from '@menumaker/core'

interface RecipeTemplate extends RecipeCandidate {
  slots: MealSlot[]
}

export const recipeTemplates: RecipeTemplate[] = [
  {
    title: 'Bol de yogur griego con avena y plátano',
    locale: 'es',
    description: 'Cremoso, dulce y rápido, con proteína alta y carbohidrato estable para empezar el día.',
    servings: 1,
    prepTimeMinutes: 8,
    cuisine: 'mediterránea',
    flavorProfile: 'cremoso, dulce, fresco',
    tags: ['alto en proteína', 'rápido'],
    slots: ['breakfast', 'snack'],
    ingredients: [
      { name: 'yogur griego natural', amount: 250, unit: 'g' },
      { name: 'copos de avena', amount: 45, unit: 'g' },
      { name: 'plátano', amount: 90, unit: 'g' },
    ],
    steps: ['Mezcla el yogur con la avena.', 'Añade el plátano en rodajas justo antes de comer.'],
  },
  {
    title: 'Tostada integral con huevo y aguacate',
    locale: 'es',
    description: 'Crujiente y saciante, con grasa saludable y proteína sencilla.',
    servings: 1,
    prepTimeMinutes: 15,
    cuisine: 'casera',
    flavorProfile: 'tostado, cremoso, salado',
    tags: ['saciante', 'desayuno'],
    slots: ['breakfast', 'snack'],
    ingredients: [
      { name: 'pan integral', amount: 70, unit: 'g' },
      { name: 'huevos', amount: 100, unit: 'g' },
      { name: 'aguacate', amount: 60, unit: 'g' },
      { name: 'tomate', amount: 80, unit: 'g' },
    ],
    steps: ['Tuesta el pan integral.', 'Cocina los huevos a la plancha.', 'Monta con aguacate machacado y tomate.'],
  },
  {
    title: 'Pollo con arroz, tomate y espinacas',
    locale: 'es',
    description: 'Plato principal limpio y sabroso con proteína magra, arroz y verduras jugosas.',
    servings: 1,
    prepTimeMinutes: 35,
    cuisine: 'mediterránea',
    flavorProfile: 'salado, jugoso, herbáceo',
    tags: ['alto en proteína', 'equilibrado'],
    slots: ['lunch', 'dinner'],
    ingredients: [
      { name: 'pechuga de pollo', amount: 170, unit: 'g' },
      { name: 'arroz cocido', amount: 180, unit: 'g' },
      { name: 'tomate', amount: 120, unit: 'g' },
      { name: 'espinacas', amount: 80, unit: 'g' },
      { name: 'aceite de oliva', amount: 10, unit: 'g' },
    ],
    steps: ['Dora el pollo con el aceite.', 'Añade tomate y espinacas hasta que queden jugosos.', 'Sirve con arroz caliente.'],
  },
  {
    title: 'Salmón con patata y brócoli',
    locale: 'es',
    description: 'Cena completa con salmón dorado, patata tierna y verdura sencilla.',
    servings: 1,
    prepTimeMinutes: 40,
    cuisine: 'nórdica sencilla',
    flavorProfile: 'mantecoso, fresco, salado',
    tags: ['omega 3', 'saciante'],
    slots: ['lunch', 'dinner'],
    ingredients: [
      { name: 'salmón', amount: 160, unit: 'g' },
      { name: 'patata', amount: 260, unit: 'g' },
      { name: 'brócoli', amount: 150, unit: 'g' },
      { name: 'aceite de oliva', amount: 8, unit: 'g' },
    ],
    steps: ['Asa o marca el salmón.', 'Cuece la patata y el brócoli.', 'Termina con aceite de oliva y sal al gusto.'],
  },
  {
    title: 'Lentejas con arroz y tomate',
    locale: 'es',
    description: 'Plato vegetal completo, cálido y muy saciante sin repetir sabores de pollo.',
    servings: 1,
    prepTimeMinutes: 45,
    cuisine: 'tradicional',
    flavorProfile: 'cálido, especiado, reconfortante',
    tags: ['vegetal', 'fibra'],
    slots: ['lunch', 'dinner'],
    ingredients: [
      { name: 'lentejas cocidas', amount: 220, unit: 'g' },
      { name: 'arroz cocido', amount: 120, unit: 'g' },
      { name: 'tomate', amount: 140, unit: 'g' },
      { name: 'aceite de oliva', amount: 8, unit: 'g' },
    ],
    steps: ['Calienta las lentejas con tomate.', 'Añade arroz cocido.', 'Remata con aceite de oliva.'],
  },
  {
    title: 'Ensalada templada de atún, patata y huevo',
    locale: 'es',
    description: 'Fresca pero contundente, con proteína doble y carbohidrato suave.',
    servings: 1,
    prepTimeMinutes: 30,
    cuisine: 'mediterránea',
    flavorProfile: 'fresco, salado, suave',
    tags: ['alto en proteína', 'templado'],
    slots: ['lunch', 'dinner'],
    ingredients: [
      { name: 'atún', amount: 140, unit: 'g' },
      { name: 'patata', amount: 240, unit: 'g' },
      { name: 'huevos', amount: 80, unit: 'g' },
      { name: 'tomate', amount: 120, unit: 'g' },
      { name: 'aceite de oliva', amount: 8, unit: 'g' },
    ],
    steps: ['Cuece la patata y el huevo.', 'Mezcla con atún y tomate.', 'Aliña con aceite de oliva.'],
  },
  {
    title: 'Snack de yogur griego con avena',
    locale: 'es',
    description: 'Snack rápido con textura cremosa y proteína fácil.',
    servings: 1,
    prepTimeMinutes: 5,
    cuisine: 'casera',
    flavorProfile: 'cremoso, suave',
    tags: ['snack', 'rápido'],
    slots: ['snack', 'breakfast'],
    ingredients: [
      { name: 'yogur griego natural', amount: 180, unit: 'g' },
      { name: 'copos de avena', amount: 25, unit: 'g' },
    ],
    steps: ['Mezcla el yogur y la avena.', 'Deja reposar unos minutos si prefieres una textura más densa.'],
  },
  {
    title: 'Tostada de atún con tomate',
    locale: 'es',
    description: 'Snack salado y proteico para no depender siempre de lácteos.',
    servings: 1,
    prepTimeMinutes: 10,
    cuisine: 'mediterránea',
    flavorProfile: 'crujiente, salado, fresco',
    tags: ['snack', 'proteína'],
    slots: ['snack', 'breakfast'],
    ingredients: [
      { name: 'pan integral', amount: 55, unit: 'g' },
      { name: 'atún', amount: 80, unit: 'g' },
      { name: 'tomate', amount: 90, unit: 'g' },
      { name: 'aceite de oliva', amount: 5, unit: 'g' },
    ],
    steps: ['Tuesta el pan.', 'Añade tomate rallado y atún.', 'Termina con aceite de oliva.'],
  },
]

export function templatesForSlot(slot: MealSlot, bannedFoods: string[] = [], locale: Locale = 'es'): RecipeCandidate[] {
  const banned = bannedFoods.map((food) => food.toLowerCase())
  return recipeTemplates
    .filter((template) => template.slots.includes(slot))
    .filter((template) => !template.ingredients.some((ingredient) => banned.some((food) => ingredient.name.toLowerCase().includes(food))))
    .map(({ slots: _slots, ...recipe }) => ({
      ...recipe,
      locale,
    }))
}


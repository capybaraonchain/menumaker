import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('hosted-sync owned tables include direct user_id columns', () => {
  const schema = readFileSync(resolve(root, 'packages/db/src/schema.ts'), 'utf8')
  const ownedTables = [
    'profiles',
    'macroTargets',
    'weeklyMenus',
    'dayPlans',
    'recipes',
    'recipeIngredients',
    'menuMeals',
    'ingredientMatches',
    'nutritionEstimates',
    'profilePreferences',
    'savedRecipes',
    'generationJobs',
    'pendingActions',
    'actionEvents',
    'aiCache',
    'appSettings',
  ]

  for (const table of ownedTables) {
    const declaration = new RegExp(`export const ${table} = pgTable\\('[^']+', \\{([\\s\\S]*?)\\n\\}\\)`).exec(schema)?.[1] ?? ''
    assert.match(declaration, /userId:\s*uuid\('user_id'\)/, `${table} must carry direct user_id ownership`)
  }
})

test('ai cache is scoped by user in migration and service queries', () => {
  const migration = readFileSync(resolve(root, 'packages/db/src/migrate.ts'), 'utf8')
  const appService = readFileSync(resolve(root, 'packages/db/src/appService.ts'), 'utf8')

  assert.match(migration, /create table if not exists ai_cache \([\s\S]*user_id uuid not null references users\(id\)/)
  assert.match(migration, /unique\(user_id, input_hash, model, schema_version\)/)
  assert.match(appService, /select output from ai_cache[\s\S]*where user_id = \$\{localUserId\(\)\}/)
  assert.match(appService, /insert into ai_cache \(user_id, input_hash, model, schema_version, output\)/)
  assert.match(appService, /delete from ai_cache where user_id = \$\{localUserId\(\)\}/)
})

test('app scoring reads nutrition source tables before falling back to seed foods', () => {
  const appService = readFileSync(resolve(root, 'packages/db/src/appService.ts'), 'utf8')
  const seed = readFileSync(resolve(root, 'packages/db/src/seed.ts'), 'utf8')
  const migration = readFileSync(resolve(root, 'packages/db/src/migrate.ts'), 'utf8')

  assert.match(appService, /async function nutritionCatalogForScoring\(\)/)
  assert.match(appService, /join nutrition_records nr on nr\.food_id = fi\.id/)
  assert.match(appService, /join source_foods sf on sf\.id = nr\.source_id/)
  assert.match(appService, /scoreRecipe\(mappedCandidate, input\.avoidedFoods, input\.nutritionCatalog\)/)
  assert.match(seed, /on conflict \(food_id, source_id\) do update set/)
  assert.match(migration, /nutrition_records_food_source_idx/)
})

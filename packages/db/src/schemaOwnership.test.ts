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

test('Open Food Facts import is exposed through shared actions and MCP', () => {
  const appActions = readFileSync(resolve(root, 'packages/db/src/appActions.ts'), 'utf8')
  const mcp = readFileSync(resolve(root, 'apps/mcp/src/server.ts'), 'utf8')
  const apiRoute = readFileSync(resolve(root, 'apps/web/app/api/actions/route.ts'), 'utf8')

  assert.match(appActions, /importOpenFoodFactsProduct: z\.object/)
  assert.match(appActions, /importOpenFoodFactsBarcodes\(\[input\.barcode\]\)/)
  assert.match(appActions, /auditLabel: 'mutation\.import_open_food_facts_product'/)
  assert.match(mcp, /'import_open_food_facts_product'/)
  assert.match(mcp, /executeAppAction\('importOpenFoodFactsProduct'/)
  assert.match(apiRoute, /importOpenFoodFactsProduct: 'importOpenFoodFactsProduct'/)
})

test('USDA downloadable dataset import is keyless and exposed through shared actions and MCP', () => {
  const nutritionImport = readFileSync(resolve(root, 'packages/db/src/nutritionSourceImport.ts'), 'utf8')
  const packageJson = readFileSync(resolve(root, 'packages/db/package.json'), 'utf8')
  const appActions = readFileSync(resolve(root, 'packages/db/src/appActions.ts'), 'utf8')
  const mcp = readFileSync(resolve(root, 'apps/mcp/src/server.ts'), 'utf8')
  const apiRoute = readFileSync(resolve(root, 'apps/web/app/api/actions/route.ts'), 'utf8')

  assert.match(nutritionImport, /parseUsdaFoodDataCentralDownload/)
  assert.match(nutritionImport, /usdaFoodDataCentralDownloadFoodToRecord/)
  assert.match(packageJson, /nutrition:import:usda-download/)
  assert.match(appActions, /importUsdaFoodDataCentralDownload: z\.object/)
  assert.match(appActions, /importUsdaFoodDataCentralDownloadFile\(input\.path/)
  assert.match(appActions, /auditLabel: 'mutation\.import_usda_fdc_download'/)
  assert.match(mcp, /'import_usda_fdc_download'/)
  assert.match(mcp, /executeAppAction\('importUsdaFoodDataCentralDownload'/)
  assert.match(apiRoute, /importUsdaFoodDataCentralDownload: 'importUsdaFoodDataCentralDownload'/)
})

test('user nutrition foods are source-backed and exposed through actions and MCP', () => {
  const appService = readFileSync(resolve(root, 'packages/db/src/appService.ts'), 'utf8')
  const appActions = readFileSync(resolve(root, 'packages/db/src/appActions.ts'), 'utf8')
  const mcp = readFileSync(resolve(root, 'apps/mcp/src/server.ts'), 'utf8')
  const apiRoute = readFileSync(resolve(root, 'apps/web/app/api/actions/route.ts'), 'utf8')
  const webPage = readFileSync(resolve(root, 'apps/web/app/page.tsx'), 'utf8')

  assert.match(appService, /export async function createUserNutritionFood/)
  assert.match(appService, /importNutritionSourceRecords\(\[record\]\)/)
  assert.match(appService, /async function resolveMappableFood/)
  assert.match(appActions, /createUserNutritionFood: z\.object/)
  assert.match(appActions, /auditLabel: 'mutation\.create_user_nutrition_food'/)
  assert.match(mcp, /'create_user_nutrition_food'/)
  assert.match(apiRoute, /createUserNutritionFood: 'createUserNutritionFood'/)
  assert.match(webPage, /function NutritionSourcesPanel/)
  assert.match(webPage, /action: 'createUserNutritionFood'/)
  assert.match(webPage, /action: 'importUsdaFoodDataCentralDownload'/)
  assert.match(webPage, /action: 'importOpenFoodFactsProduct'/)
})

test('failure UI has guided fallback remediation instead of direct fallback mutation', () => {
  const webPage = readFileSync(resolve(root, 'apps/web/app/page.tsx'), 'utf8')

  assert.match(webPage, /function FallbackPolicyModal/)
  assert.match(webPage, /onFallbackPolicy\(\{ job, plan \}\)/)
  assert.match(webPage, /Guardar y reintentar este trabajo/)
  assert.match(webPage, /action: 'setFallbackPolicy'/)
})

test('target remediation saves revised macro targets through shared actions and MCP', () => {
  const appService = readFileSync(resolve(root, 'packages/db/src/appService.ts'), 'utf8')
  const appActions = readFileSync(resolve(root, 'packages/db/src/appActions.ts'), 'utf8')
  const mcp = readFileSync(resolve(root, 'apps/mcp/src/server.ts'), 'utf8')
  const apiRoute = readFileSync(resolve(root, 'apps/web/app/api/actions/route.ts'), 'utf8')
  const webPage = readFileSync(resolve(root, 'apps/web/app/page.tsx'), 'utf8')

  assert.match(appService, /export async function updateMacroTargetAndGenerate/)
  assert.match(appService, /saveMacroTarget\(profileId, target\)/)
  assert.match(appService, /enqueueWeeklyMenuGenerationJob\(profileId, targetId, target, 'target_remediation_generation'\)/)
  assert.match(appActions, /updateMacroTargetAndGenerate: z\.object/)
  assert.match(appActions, /auditLabel: 'mutation\.update_macro_target_and_generate'/)
  assert.match(mcp, /'update_macro_target_and_generate'/)
  assert.match(apiRoute, /updateMacroTargetAndGenerate: 'updateMacroTargetAndGenerate'/)
  assert.match(webPage, /function TargetEditModal/)
  assert.match(webPage, /action: 'updateMacroTargetAndGenerate'/)
  assert.match(webPage, /onAdjustTargets\(\{ job, plan \}\)/)
})

test('ingredient remediation searches source-backed nutrition foods through shared actions and MCP', () => {
  const appService = readFileSync(resolve(root, 'packages/db/src/appService.ts'), 'utf8')
  const appActions = readFileSync(resolve(root, 'packages/db/src/appActions.ts'), 'utf8')
  const mcp = readFileSync(resolve(root, 'apps/mcp/src/server.ts'), 'utf8')
  const apiRoute = readFileSync(resolve(root, 'apps/web/app/api/actions/route.ts'), 'utf8')
  const webPage = readFileSync(resolve(root, 'apps/web/app/page.tsx'), 'utf8')

  assert.match(appService, /export async function searchNutritionFoods/)
  assert.match(appService, /nutritionCatalogForScoring\(\)/)
  assert.match(appActions, /searchNutritionFoods: z\.object/)
  assert.match(appActions, /auditLabel: 'read\.search_nutrition_foods'/)
  assert.match(mcp, /'search_nutrition_foods'/)
  assert.match(apiRoute, /searchNutritionFoods: 'searchNutritionFoods'/)
  assert.match(webPage, /action: 'searchNutritionFoods'/)
  assert.match(webPage, /Buscar alimento determinístico/)
  assert.match(webPage, /Crear alimento local desde este problema/)
  assert.match(webPage, /action: 'createUserNutritionFood'/)
})

test('queued generation jobs have a local worker entrypoint', () => {
  const appService = readFileSync(resolve(root, 'packages/db/src/appService.ts'), 'utf8')
  const worker = readFileSync(resolve(root, 'packages/db/src/generationWorker.ts'), 'utf8')
  const webPage = readFileSync(resolve(root, 'apps/web/app/page.tsx'), 'utf8')
  const dbPackage = readFileSync(resolve(root, 'packages/db/package.json'), 'utf8')
  const rootPackage = readFileSync(resolve(root, 'package.json'), 'utf8')

  assert.match(appService, /export async function runQueuedGenerationJobs/)
  assert.match(appService, /runPreviewGenerationJob\(row\.id\)/)
  assert.match(appService, /runGenerationJob\(row\.id\)/)
  assert.match(worker, /runGenerationWorker/)
  assert.match(webPage, /Encolar semana/)
  assert.match(webPage, /runNow: false/)
  assert.match(webPage, /Ejecutar ahora/)
  assert.match(dbPackage, /"worker:generation": "tsx src\/generationWorker\.ts"/)
  assert.match(rootPackage, /"worker:generation": "npm --workspace @menumaker\/db run worker:generation"/)
})

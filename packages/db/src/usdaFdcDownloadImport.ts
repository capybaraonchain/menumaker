import { closeDb } from './client'
import { importUsdaFoodDataCentralDownloadFile, type UsdaFoodDataCentralDownloadOptions } from './nutritionSourceImport'

interface Args {
  path: string
  options: UsdaFoodDataCentralDownloadOptions
}

function parseArgs(argv: string[]): Args {
  const path = argv.find((arg) => !arg.startsWith('--'))
  if (!path) {
    throw new Error('Uso: npm --workspace @menumaker/db run nutrition:import:usda-download -- ./FoodData_Central_foundation_food_json_YYYY-MM-DD.zip [--limit=1000] [--fdc-id=321358]\nTambién acepta JSON extraído o URL HTTPS de fdc.nal.usda.gov/fdc-datasets/*.zip.')
  }

  const includeFdcIds = argv
    .filter((arg) => arg.startsWith('--fdc-id='))
    .map((arg) => Number(arg.slice('--fdc-id='.length)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.trunc(value))
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined
  return {
    path,
    options: {
      includeFdcIds: includeFdcIds.length ? includeFdcIds : undefined,
      limit: Number.isFinite(limit) && Number(limit) > 0 ? Math.trunc(Number(limit)) : undefined,
    },
  }
}

async function main(): Promise<void> {
  const { path, options } = parseArgs(process.argv.slice(2))
  const result = await importUsdaFoodDataCentralDownloadFile(path, options)
  await closeDb()
  console.log(`Imported ${result.imported} USDA FoodData Central records from ${path}`)
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})

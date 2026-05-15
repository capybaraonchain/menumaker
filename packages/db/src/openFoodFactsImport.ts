import { closeDb } from './client'
import { importOpenFoodFactsBarcodes } from './nutritionSourceImport'

async function main(): Promise<void> {
  const barcodes = process.argv.slice(2).map((item) => item.trim()).filter(Boolean)
  if (barcodes.length === 0) {
    throw new Error('Uso: npm --workspace @menumaker/db run nutrition:import:off -- 3017620422003 5449000000996')
  }
  const result = await importOpenFoodFactsBarcodes(barcodes)
  await closeDb()
  console.log(`Imported ${result.imported} Open Food Facts records: ${result.records.map((record) => record.canonicalName).join(', ')}`)
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})

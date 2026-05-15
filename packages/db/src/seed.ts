import { seedFoods } from '@menumaker/nutrition'
import { closeDb, sqlClient } from './client'
import { localUserId } from './env'

async function main(): Promise<void> {
  const sql = sqlClient()
  const userId = localUserId()

  await sql`
    insert into users (id, email)
    values (${userId}, 'local@menumaker.test')
    on conflict (id) do nothing
  `

  for (const food of seedFoods) {
    await sql`
      insert into food_items (id, canonical_name, category)
      values (${food.id}, ${food.canonicalName}, ${food.category})
      on conflict (id) do update set
        canonical_name = excluded.canonical_name,
        category = excluded.category
    `
    await sql`
      insert into source_foods (id, source, payload)
      values (${`seed:${food.id}`}, 'seed', ${sql.json(food as any)})
      on conflict (id) do update set payload = excluded.payload
    `
    await sql`
      insert into nutrition_records (food_id, source_id, per_100g, confidence)
      values (${food.id}, ${`seed:${food.id}`}, ${sql.json(food.per100g as any)}, ${food.confidence})
    `
    await sql`
      insert into food_mappings (food_id, source_id, confidence)
      values (${food.id}, ${`seed:${food.id}`}, ${food.confidence})
    `
    for (const alias of food.aliases) {
      await sql`
        insert into food_aliases (food_id, alias)
        values (${food.id}, ${alias})
      `
    }
  }

  const conversions = [
    ['g', 1, 'gramos exactos'],
    ['ml', 1, 'mililitros aproximados como gramos para v1'],
    ['cucharada', 13.5, 'conversión aproximada'],
    ['cucharadita', 4.5, 'conversión aproximada'],
    ['rebanada', 30, 'conversión aproximada'],
    ['unidad', 80, 'conversión aproximada'],
  ] as const
  for (const [unit, grams, notes] of conversions) {
    await sql`
      insert into unit_conversions (unit, grams, notes)
      values (${unit}, ${grams}, ${notes})
      on conflict (unit) do update set grams = excluded.grams, notes = excluded.notes
    `
  }

  await closeDb()
  console.log('Database seeded')
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})

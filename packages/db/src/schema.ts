import { boolean, date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  locale: text('locale').notNull(),
  unitSystem: text('unit_system').notNull(),
  weightKg: numeric('weight_kg').notNull(),
  targetWeightKg: numeric('target_weight_kg').notNull(),
  proteinCalculationWeightKg: numeric('protein_calculation_weight_kg').notNull(),
  heightCm: integer('height_cm').notNull(),
  age: integer('age'),
  sex: text('sex').notNull(),
  activityLevel: text('activity_level').notNull(),
  goal: text('goal').notNull(),
  macroMode: text('macro_mode').notNull(),
  likes: jsonb('likes').notNull(),
  dislikes: jsonb('dislikes').notNull(),
  bannedFoods: jsonb('banned_foods').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const macroTargets = pgTable('macro_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  calories: integer('calories').notNull(),
  proteinG: numeric('protein_g').notNull(),
  carbsG: numeric('carbs_g').notNull(),
  fatG: numeric('fat_g').notNull(),
  confidence: text('confidence').notNull(),
  formulaVersion: text('formula_version').notNull(),
  goal: text('goal').notNull(),
  macroMode: text('macro_mode').notNull(),
  preset: text('preset').notNull(),
  maintenanceCalories: integer('maintenance_calories').notNull(),
  proteinCalculationWeightKg: numeric('protein_calculation_weight_kg').notNull(),
  notes: jsonb('notes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const weeklyMenus = pgTable('weekly_menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  macroTargetId: uuid('macro_target_id').notNull().references(() => macroTargets.id),
  weekStart: date('week_start').notNull(),
  locale: text('locale').notNull(),
  status: text('status').notNull(),
  generationSettings: jsonb('generation_settings').notNull(),
  nutritionSnapshot: jsonb('nutrition_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dayPlans = pgTable('day_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  weeklyMenuId: uuid('weekly_menu_id').notNull().references(() => weeklyMenus.id),
  dayIndex: integer('day_index').notNull(),
  locked: boolean('locked').notNull().default(false),
})

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  locale: text('locale').notNull(),
  description: text('description').notNull(),
  servings: integer('servings').notNull(),
  prepTimeMinutes: integer('prep_time_minutes').notNull(),
  cuisine: text('cuisine').notNull(),
  flavorProfile: text('flavor_profile').notNull(),
  tags: jsonb('tags').notNull(),
  steps: jsonb('steps').notNull(),
  source: text('source').notNull(),
  nutritionSnapshot: jsonb('nutrition_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  amount: numeric('amount').notNull(),
  unit: text('unit').notNull(),
  preparation: text('preparation'),
  normalizedAmount: numeric('normalized_amount').notNull(),
  normalizedUnit: text('normalized_unit').notNull(),
  foodId: text('food_id'),
  sourceId: text('source_id'),
  confidence: text('confidence').notNull(),
  nutritionSnapshot: jsonb('nutrition_snapshot').notNull(),
  notes: jsonb('notes').notNull(),
})

export const menuMeals = pgTable('menu_meals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  dayPlanId: uuid('day_plan_id').notNull().references(() => dayPlans.id),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  slot: text('slot').notNull(),
  locked: boolean('locked').notNull().default(false),
  nutritionSnapshot: jsonb('nutrition_snapshot').notNull(),
})

export const foodItems = pgTable('food_items', {
  id: text('id').primaryKey(),
  canonicalName: text('canonical_name').notNull(),
  category: text('category').notNull(),
})

export const foodAliases = pgTable('food_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  foodId: text('food_id').notNull().references(() => foodItems.id),
  alias: text('alias').notNull(),
  userId: uuid('user_id').references(() => users.id),
  source: text('source').notNull().default('seed'),
})

export const sourceFoods = pgTable('source_foods', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  payload: jsonb('payload').notNull(),
})

export const nutritionRecords = pgTable('nutrition_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  foodId: text('food_id').notNull().references(() => foodItems.id),
  sourceId: text('source_id').notNull().references(() => sourceFoods.id),
  per100g: jsonb('per_100g').notNull(),
  confidence: text('confidence').notNull(),
})

export const foodMappings = pgTable('food_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  foodId: text('food_id').notNull().references(() => foodItems.id),
  sourceId: text('source_id').notNull().references(() => sourceFoods.id),
  confidence: text('confidence').notNull(),
})

export const unitConversions = pgTable('unit_conversions', {
  id: uuid('id').primaryKey().defaultRandom(),
  unit: text('unit').notNull(),
  grams: numeric('grams').notNull(),
  notes: text('notes'),
})

export const ingredientMatches = pgTable('ingredient_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  recipeIngredientId: uuid('recipe_ingredient_id').notNull().references(() => recipeIngredients.id),
  foodId: text('food_id'),
  sourceId: text('source_id'),
  confidence: text('confidence').notNull(),
  notes: jsonb('notes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const nutritionEstimates = pgTable('nutrition_estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  nutritionSnapshot: jsonb('nutrition_snapshot').notNull(),
  confidence: text('confidence').notNull(),
  sourceNotes: jsonb('source_notes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const profilePreferences = pgTable('profile_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  scope: text('scope').notNull(),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  strength: text('strength').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const savedRecipes = pgTable('saved_recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const generationJobs = pgTable('generation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').references(() => profiles.id),
  weeklyMenuId: uuid('weekly_menu_id').references(() => weeklyMenus.id),
  status: text('status').notNull(),
  kind: text('kind').notNull(),
  failureCode: text('failure_code'),
  logs: jsonb('logs').notNull(),
  result: jsonb('result').notNull(),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pendingActions = pgTable('pending_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').references(() => profiles.id),
  actionName: text('action_name').notNull(),
  params: jsonb('params').notNull(),
  confirmationMarkdown: text('confirmation_markdown').notNull(),
  status: text('status').notNull(),
  source: text('source').notNull(),
  result: jsonb('result').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export const actionEvents = pgTable('action_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').references(() => profiles.id),
  pendingActionId: uuid('pending_action_id').references(() => pendingActions.id),
  actionName: text('action_name').notNull(),
  auditLabel: text('audit_label').notNull(),
  status: text('status').notNull(),
  source: text('source').notNull(),
  input: jsonb('input').notNull(),
  output: jsonb('output').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const aiCache = pgTable('ai_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  inputHash: text('input_hash').notNull(),
  model: text('model').notNull(),
  schemaVersion: text('schema_version').notNull(),
  output: jsonb('output').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const appSettings = pgTable('app_settings', {
  userId: uuid('user_id').notNull().references(() => users.id),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

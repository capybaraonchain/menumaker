import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGenerationRemediationPlan,
  buildRepairRemediationPlans,
  classifyGenerationFailure,
} from './remediation'

test('generation exhausted remediation is code-specific and retryable', () => {
  const plan = buildGenerationRemediationPlan({
    code: 'generation_exhausted',
    error: 'No hay suficientes recetas LLM válidas para desayuno.',
  })

  assert.equal(plan.code, 'generation_exhausted')
  assert.equal(plan.severity, 'blocking')
  assert.ok(plan.steps.some((step) => step.includes('fallback')))
  assert.ok(plan.actions.some((action) => action.kind === 'retry_generation' && action.requiresConfirmation))
})

test('repair remediation keeps daily calorie drift context', () => {
  const [plan] = buildRepairRemediationPlans({
    issuesAfter: [{
      reason: 'daily_calorie_drift',
      message: 'Martes queda lejos del objetivo.',
      dayIndex: 1,
      slot: 'dinner',
    }],
  })

  assert.equal(plan?.code, 'daily_calorie_drift')
  assert.equal(plan?.context.dayIndex, 1)
  assert.equal(plan?.context.slot, 'dinner')
  assert.ok(plan?.actions.some((action) => action.kind === 'regenerate_day'))
})

test('failure classifier maps known messages to domain codes', () => {
  assert.equal(classifyGenerationFailure(new Error('La receta propuesta contiene un alimento prohibido.')), 'banned_item_conflict')
  assert.equal(classifyGenerationFailure(new Error('La receta propuesta tiene ingredientes sin nutrición determinista suficiente.')), 'low_nutrition_confidence')
  assert.equal(classifyGenerationFailure(new Error('Error desconocido del proveedor.')), 'generation_exhausted')
})

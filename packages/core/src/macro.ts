import type {
  ActivityLevel,
  CutBulkPreset,
  MacroInputs,
  MacroMode,
  MacroTargets,
  NutritionConfidence,
  Sex,
} from './types'

export const FORMULA_VERSION = 'macro-policy-v1'

export const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.4,
  lightly_active: 1.5,
  moderately_active: 1.6,
  active: 1.8,
  very_active: 2.0,
}

export const activityDescriptionsEs: Record<ActivityLevel, string> = {
  sedentary: 'Trabajo de escritorio y poco ejercicio.',
  lightly_active: 'Algo de caminar o 1-2 entrenamientos por semana.',
  moderately_active: '3-4 entrenamientos por semana.',
  active: '5-6 entrenamientos por semana o trabajo activo.',
  very_active: 'Entrenamiento duro diario o trabajo físico.',
}

const presetAdjustments: Record<CutBulkPreset, number> = {
  maintenance: 0,
  conservative_cut: -0.075,
  standard_cut: -0.125,
  aggressive_cut: -0.2,
  conservative_bulk: 0.04,
  standard_bulk: 0.075,
  aggressive_bulk: 0.125,
}

export function defaultPreset(goal: MacroInputs['goal']): CutBulkPreset {
  if (goal === 'cut') return 'standard_cut'
  if (goal === 'bulk') return 'standard_bulk'
  return 'maintenance'
}

export function mifflinStJeor(input: {
  weightKg: number
  heightCm: number
  age?: number | null
  sex?: Sex | null
}): { ree: number; confidence: NutritionConfidence; notes: string[] } {
  const notes: string[] = []
  const age = input.age ?? 35
  const sex = input.sex ?? 'skipped'

  if (!input.age) notes.push('Edad omitida: estimación aproximada para adulto.')
  if (sex === 'skipped') notes.push('Sexo biológico omitido: se usa el punto medio de la fórmula.')

  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * age
  if (sex === 'male') return { ree: base + 5, confidence: input.age ? 'database' : 'estimated', notes }
  if (sex === 'female') return { ree: base - 161, confidence: input.age ? 'database' : 'estimated', notes }

  return {
    ree: (base + 5 + base - 161) / 2,
    confidence: 'estimated',
    notes,
  }
}

export function proteinCalculationWeightKg(input: Pick<MacroInputs, 'goal' | 'weightKg' | 'targetWeightKg'>): number {
  if (input.goal === 'cut') return input.targetWeightKg + 0.25 * (input.weightKg - input.targetWeightKg)
  if (input.goal === 'bulk') return input.weightKg + 0.25 * (input.targetWeightKg - input.weightKg)
  return input.weightKg
}

export function validateAdultPolicy(input: MacroInputs): string[] {
  const errors: string[] = []
  if (input.age !== null && input.age !== undefined && input.age < 18) {
    errors.push('Las sugerencias automáticas son solo para perfiles adultos en v1.')
  }
  return errors
}

export function calculateMacroTargets(input: MacroInputs): MacroTargets {
  const adultErrors = validateAdultPolicy(input)
  if (adultErrors.length > 0) throw new Error(adultErrors.join(' '))

  const preset = input.preset ?? defaultPreset(input.goal)
  const ree = mifflinStJeor(input)
  const maintenanceCalories = roundToNearest(ree.ree * activityMultipliers[input.activityLevel], 25)
  const adjustedCalories = input.manualTargets?.calories
    ? input.manualTargets.calories
    : roundToNearest(maintenanceCalories * (1 + presetAdjustments[preset]), 25)

  const calcWeight = proteinCalculationWeightKg(input)
  const proteinPerKg = proteinGramsPerKg(input.macroMode, input.goal, preset)
  const proteinG = input.manualTargets?.proteinG ?? roundToNearest(calcWeight * proteinPerKg, 5)
  const fatFloorPerKg = preset === 'aggressive_cut' ? 0.5 : 0.6
  const fatFloorG = roundToNearest(calcWeight * fatFloorPerKg, 5)

  let fatG = input.manualTargets?.fatG ?? fatFloorG
  let carbsG = input.manualTargets?.carbsG ?? 0

  const hasManualCarbs = input.manualTargets?.carbsG !== undefined
  const hasManualFat = input.manualTargets?.fatG !== undefined
  if (!hasManualCarbs || !hasManualFat) {
    const remainingCalories = adjustedCalories - proteinG * 4 - fatG * 9
    if (remainingCalories < 0) {
      return {
        calories: adjustedCalories,
        proteinG,
        carbsG: 0,
        fatG,
        confidence: confidenceFrom(ree.confidence, input),
        formulaVersion: FORMULA_VERSION,
        goal: input.goal,
        macroMode: input.macroMode,
        preset,
        maintenanceCalories,
        proteinCalculationWeightKg: roundToNearest(calcWeight, 0.1),
        notes: [
          ...ree.notes,
          'Este objetivo no encaja: solo la proteína y la grasa mínima ya superan tus calorías diarias.',
        ],
      }
    }

    if (input.macroMode === 'lower_carb') {
      const carbCap = Math.min(Math.floor((adjustedCalories * 0.25) / 4), Math.floor(remainingCalories / 4))
      carbsG = roundToNearest(carbCap, 5)
      const caloriesAfterCarbs = adjustedCalories - proteinG * 4 - carbsG * 4
      fatG = roundToNearest(Math.max(fatFloorG, caloriesAfterCarbs / 9), 5)
    } else {
      carbsG = roundToNearest(remainingCalories / 4, 5)
    }
  }

  return {
    calories: roundToNearest(adjustedCalories, 25),
    proteinG,
    carbsG,
    fatG,
    confidence: confidenceFrom(ree.confidence, input),
    formulaVersion: FORMULA_VERSION,
    goal: input.goal,
    macroMode: input.macroMode,
    preset,
    maintenanceCalories,
    proteinCalculationWeightKg: roundToNearest(calcWeight, 0.1),
    notes: ree.notes,
  }
}

export function impossibleTargetConflict(targets: Pick<MacroTargets, 'calories' | 'proteinG' | 'fatG'>): {
  impossible: boolean
  requiredCalories: number
  surplusCalories: number
  messageEs: string
} {
  const requiredCalories = targets.proteinG * 4 + targets.fatG * 9
  const surplusCalories = requiredCalories - targets.calories
  return {
    impossible: requiredCalories > targets.calories,
    requiredCalories,
    surplusCalories,
    messageEs:
      'Este objetivo no encaja: solo la proteína y la grasa mínima ya superan tus calorías diarias. Sube las calorías, baja la proteína o reduce la grasa mínima.',
  }
}

function proteinGramsPerKg(mode: MacroMode, goal: MacroInputs['goal'], preset: CutBulkPreset): number {
  let base = 1.6
  if (goal === 'cut') base = preset === 'aggressive_cut' ? 2.0 : 1.8
  if (goal === 'bulk') base = 1.7
  if (mode === 'high_protein') base += 0.3
  return Math.min(base, 2.2)
}

function confidenceFrom(reeConfidence: NutritionConfidence, input: MacroInputs): NutritionConfidence {
  if (!input.age || !input.sex || input.sex === 'skipped') return 'estimated'
  return reeConfidence
}

export function roundToNearest(value: number, step: number): number {
  if (step === 0.1) return Math.round(value * 10) / 10
  return Math.round(value / step) * step
}

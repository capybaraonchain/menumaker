'use client'

import {
  AlertTriangle,
  Apple,
  Archive,
  Bot,
  CalendarDays,
  Check,
  ChevronRight,
  History,
  LoaderCircle,
  Lock,
  MessageCircle,
  RefreshCw,
  Save,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  UserRound,
  Utensils,
  X,
} from 'lucide-react'
import { FormEvent, Fragment, useEffect, useState } from 'react'

type Tab = 'semana' | 'recetas' | 'historial' | 'perfil'
type Nutrition = { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number; confidence: string }
type Ingredient = {
  id: string
  name: string
  amount: number
  unit: string
  normalizedAmount: number
  normalizedUnit: string
  confidence: string
  nutrition: Nutrition
  notes: string[]
}
type Recipe = {
  id: string
  title: string
  description: string
  prepTimeMinutes: number
  cuisine: string
  flavorProfile: string
  tags: string[]
  steps: string[]
  source: string
  nutrition: Nutrition
  ingredients: Ingredient[]
}
type Meal = { id: string; slot: string; locked: boolean; recipe: Recipe; nutrition: Nutrition }
type Day = { id: string; dayIndex: number; locked: boolean; meals: Meal[] }
type Profile = {
  id: string
  name: string
  locale: 'es' | 'en'
  weightKg: number
  targetWeightKg: number
  proteinCalculationWeightKg: number
  heightCm: number
  age: number | null
  sex: string
  activityLevel: string
  goal: string
  macroMode: string
  likes: string[]
  dislikes: string[]
  bannedFoods: string[]
  latestTarget?: any
}
type AppState = {
  profiles: Profile[]
  activeProfile: Profile | null
  currentMenu: null | {
    id: string
    profileId: string
    weekStart: string
    generationSettings?: Record<string, any>
    nutrition: Nutrition
    target: any
    days: Day[]
  }
  savedRecipes: Array<{ savedRecipeId: string; recipe: Recipe }>
  history: Array<{ id: string; weekStart: string; createdAt: string; nutrition: Nutrition }>
  generationJobs: GenerationJob[]
  mappableFoods: MappableFood[]
  runtimeSettings: RuntimeSettings
  provider?: any
}
type RuntimeSettings = {
  recipeTemplateFallbackAllowed: boolean
  weekSkeletonFallbackAllowed: boolean
  sources: {
    recipeTemplateFallback: string
    weekSkeletonFallback: string
  }
}
type MappableFood = { id: string; name: string; category: string; aliases: string[] }
type GenerationJob = {
  id: string
  profileId: string | null
  weeklyMenuId: string | null
  status: string
  kind: string
  failureCode: string | null
  logs: string[]
  result: Record<string, any>
  remediation: RemediationPlan | null
  error: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
}
type RemediationPlan = {
  code: string
  severity: 'info' | 'warning' | 'blocking'
  title: string
  summary: string
  steps: string[]
  actions: Array<{ kind: string; label: string; requiresConfirmation: boolean }>
  context?: Record<string, any>
}
type PreferenceRelaxationRequest = { job: GenerationJob; plan: RemediationPlan }
type IngredientMappingRequest = { job: GenerationJob; plan: RemediationPlan }
type ReplacementProposal = {
  proposalId: string
  affectedMeals: string[]
  inferredIngredient: string | null
  options: Array<{ kind: string; recipe: any; nutrition: Nutrition; macroImpact: Nutrition }>
}
type PendingReplacement = {
  option: ReplacementProposal['options'][number]
  proposal: ReplacementProposal
  ingredient: string
  relatedMealIds: string[]
}
type ChatAction = {
  id: string
  type: string
  label: string
  payload: Record<string, unknown>
}
type ChatMessage = { role: 'user' | 'assistant'; text: string; actions?: ChatAction[] }

const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const slotLabels: Record<string, string> = { breakfast: 'Desayuno', lunch: 'Comida', dinner: 'Cena', snack: 'Snack' }
const activityLabels: Record<string, string> = {
  sedentary: 'Sedentario · 1.4',
  lightly_active: 'Ligeramente activo · 1.5',
  moderately_active: 'Moderado · 1.6',
  active: 'Activo · 1.8',
  very_active: 'Muy activo · 2.0',
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('semana')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null)
  const [editMeal, setEditMeal] = useState<Meal | null>(null)
  const [proposal, setProposal] = useState<ReplacementProposal | null>(null)
  const [pendingReplacement, setPendingReplacement] = useState<PendingReplacement | null>(null)
  const [preferenceRelaxation, setPreferenceRelaxation] = useState<PreferenceRelaxationRequest | null>(null)
  const [ingredientMapping, setIngredientMapping] = useState<IngredientMappingRequest | null>(null)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [editRequest, setEditRequest] = useState('No quiero brócoli en este plato')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('¿Cómo ves los macros de esta semana?')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [pendingChatAction, setPendingChatAction] = useState<ChatAction | null>(null)
  const [chatBusy, setChatBusy] = useState<string | null>(null)
  const activeProfileId = state?.activeProfile?.id

  useEffect(() => {
    void loadState()
  }, [])

  async function loadState(profileId?: string) {
    setLoading(true)
    const res = await fetch(`/api/state${profileId ? `?profileId=${profileId}` : ''}`)
    setState(await res.json())
    setLoading(false)
  }

  async function postAction(payload: any) {
    setBusy(payload.action)
    const res = await fetch('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    setBusy(null)
    if (!res.ok) throw new Error(data.error ?? 'Error')
    if (data.state) setState(data.state)
    return data.result
  }

  async function runChatAction(action: ChatAction) {
    setChatBusy(action.id)
    const res = await fetch('/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: action.type, ...action.payload }),
    })
    const data = await res.json()
    setChatBusy(null)
    clearChatAction(action.id)
    if (!res.ok) {
      setChatMessages((items) => [...items, { role: 'assistant', text: data.error ?? 'No pude completar la acción.' }])
      return
    }
    if (data.state) setState(data.state)
    setPendingChatAction(null)
    const markdown = typeof data.result?.markdown === 'string' ? data.result.markdown : chatActionSuccessText(action)
    setChatMessages((items) => [
      ...items,
      {
        role: 'assistant',
        text: markdown,
      },
    ])
  }

  async function cancelChatAction(action: ChatAction) {
    setPendingChatAction(null)
    clearChatAction(action.id)
    if (!action.payload.pendingActionId) {
      setChatMessages((items) => [...items, { role: 'assistant', text: 'Cancelado. No cambio el menú.' }])
      return
    }
    const res = await fetch('/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancelPendingAction', pendingActionId: action.payload.pendingActionId }),
    })
    const data = await res.json()
    setChatMessages((items) => [...items, { role: 'assistant', text: data.result?.markdown ?? 'Cancelado. No cambio el menú.' }])
  }

  function clearChatAction(actionId: string) {
    setChatMessages((items) => items.map((message) => message.actions
      ? { ...message, actions: message.actions.filter((action) => action.id !== actionId) }
      : message))
  }

  if (loading) return <LoadingScreen />
  if (!state?.activeProfile) return <Onboarding onDone={setState} />

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="tiny">MenuMaker</p>
          <h1>{state.activeProfile.name}</h1>
        </div>
        <div className={`provider ${state.provider?.configured ? 'ready' : 'offline'}`}>
          <span />
          {state.provider?.configured ? `${state.provider.model} ${state.provider.reasoningEffort}` : 'Codex offline'}
        </div>
      </header>

      <section className="content">
        {tab === 'semana' && (
          <WeekScreen
            state={state}
            busy={busy}
            onSelectMeal={setSelectedMeal}
            onEditMeal={setEditMeal}
            onAction={postAction}
            onRelaxPreferences={setPreferenceRelaxation}
            onReviewIngredients={setIngredientMapping}
          />
        )}
        {tab === 'recetas' && <RecipesScreen state={state} onAction={postAction} />}
        {tab === 'historial' && <HistoryScreen state={state} />}
        {tab === 'perfil' && <ProfileScreen state={state} onSwitch={(id) => loadState(id)} onCreate={() => setCreatingProfile(true)} onAction={postAction} />}
      </section>

      <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Abrir chat">
        <MessageCircle size={22} />
      </button>

      <nav className="bottom-nav">
        <NavButton active={tab === 'semana'} icon={<CalendarDays />} label="Semana" onClick={() => setTab('semana')} />
        <NavButton active={tab === 'recetas'} icon={<Star />} label="Recetas" onClick={() => setTab('recetas')} />
        <NavButton active={tab === 'historial'} icon={<History />} label="Historial" onClick={() => setTab('historial')} />
        <NavButton active={tab === 'perfil'} icon={<UserRound />} label="Perfil" onClick={() => setTab('perfil')} />
      </nav>

      {selectedMeal && <MealModal meal={selectedMeal} profileId={activeProfileId!} onClose={() => setSelectedMeal(null)} onAction={postAction} onEdit={() => {
        setEditMeal(selectedMeal)
        setSelectedMeal(null)
      }} />}

      {editMeal && (
        <Modal title="Editar plato" onClose={() => {
          setEditMeal(null)
          setProposal(null)
          setPendingReplacement(null)
        }}>
          <div className="edit-flow">
            <p className="muted">Pide un cambio concreto. Primero verás opciones; los cambios de toda la semana requieren confirmación.</p>
            <textarea value={editRequest} onChange={(event) => setEditRequest(event.target.value)} />
            <button className="primary" onClick={async () => {
              const next = await postAction({ action: 'suggestReplacements', menuMealId: editMeal.id, request: editRequest, profileId: activeProfileId })
              setProposal(next)
            }}>
              <Sparkles size={18} /> Ver opciones
            </button>
            {proposal && (
              <div className="proposal-list">
                <div className="impact-note">
                  {proposal.inferredIngredient ? `Detectado: ${proposal.inferredIngredient}. Afecta ${proposal.affectedMeals.length} plato(s).` : 'Cambio solo para este plato.'}
                </div>
                {proposal.options.map((option) => (
                  <button key={option.kind} className="proposal-row" onClick={async () => {
                    const relatedMealIds = proposal.affectedMeals.filter((mealId) => mealId !== editMeal.id)
                    if (proposal.inferredIngredient && relatedMealIds.length > 0) {
                      setPendingReplacement({ option, proposal, ingredient: proposal.inferredIngredient, relatedMealIds })
                      return
                    }
                    await postAction({ action: 'replaceMeal', menuMealId: editMeal.id, recipe: option.recipe, profileId: activeProfileId })
                    setEditMeal(null)
                    setProposal(null)
                  }}>
                    <span>
                      <strong>{proposalLabel(option.kind)}</strong>
                      <small>{option.recipe.title}</small>
                    </span>
                    <NutritionDelta delta={option.macroImpact} />
                  </button>
                ))}
                {proposal.inferredIngredient && (
                  <button className="secondary" onClick={async () => {
                    await postAction({ action: 'savePreference', profileId: activeProfileId, value: proposal.inferredIngredient, kind: 'dislike', scope: 'profile' })
                  }}>
                    <Save size={16} /> Guardar como preferencia
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {pendingReplacement && editMeal && (
        <Modal title="Alcance del cambio" onClose={() => setPendingReplacement(null)}>
          <div className="confirm-flow">
            <p>
              La opción seleccionada reemplaza este plato. También hay {pendingReplacement.relatedMealIds.length} plato(s) más con{' '}
              {pendingReplacement.ingredient}. ¿Quieres quitarlo solo aquí o recalcular también los demás platos afectados y guardarlo como preferencia?
            </p>
            <button className="primary" onClick={async () => {
              await postAction({ action: 'replaceMeal', menuMealId: editMeal.id, recipe: pendingReplacement.option.recipe, profileId: activeProfileId })
              await postAction({
                action: 'applySimilarReplacements',
                profileId: activeProfileId,
                ingredient: pendingReplacement.ingredient,
                menuMealIds: pendingReplacement.relatedMealIds,
              })
              setPendingReplacement(null)
              setEditMeal(null)
              setProposal(null)
            }}>
              <Check size={18} /> Recalcular todos
            </button>
            <button className="secondary" onClick={async () => {
              await postAction({ action: 'replaceMeal', menuMealId: editMeal.id, recipe: pendingReplacement.option.recipe, profileId: activeProfileId })
              setPendingReplacement(null)
              setEditMeal(null)
              setProposal(null)
            }}>Solo este plato</button>
          </div>
        </Modal>
      )}

      {preferenceRelaxation && state.activeProfile && (
        <PreferenceRelaxationModal
          profile={state.activeProfile}
          job={preferenceRelaxation.job}
          plan={preferenceRelaxation.plan}
          onAction={postAction}
          onClose={() => setPreferenceRelaxation(null)}
        />
      )}

      {ingredientMapping && state.activeProfile && (
        <IngredientMappingModal
          profile={state.activeProfile}
          job={ingredientMapping.job}
          plan={ingredientMapping.plan}
          foods={state.mappableFoods}
          onAction={postAction}
          onClose={() => setIngredientMapping(null)}
        />
      )}

      {creatingProfile && (
        <Modal title="Nuevo perfil" onClose={() => setCreatingProfile(false)}>
          <Onboarding embedded onDone={(nextState) => {
            setState(nextState)
            setCreatingProfile(false)
            setTab('semana')
          }} />
        </Modal>
      )}

      {chatOpen && (
        <Modal title="Chat del menú" onClose={() => setChatOpen(false)}>
          <div className="chat-box">
            <div className="chat-messages">
              {chatMessages.length === 0 && <p className="muted">Pregunta por macros, cambios o la variedad de la semana. El chat propone; no cambia nada sin confirmación.</p>}
              {chatMessages.map((message, index) => (
                <article key={index} className={`chat-message ${message.role}`}>
                  <MarkdownText text={message.text} />
                  {message.actions && message.actions.length > 0 && (
                    <div className="chat-actions">
                      {message.actions.map((action) => (
                        <div key={action.id} className="chat-action-row">
                          <button className="primary" disabled={chatBusy === action.id} onClick={() => runChatAction(action)}>
                            <Check size={16} /> {chatBusy === action.id ? 'Ejecutando...' : action.label}
                          </button>
                          <button className="secondary" type="button" onClick={() => cancelChatAction(action)}>
                            <X size={16} /> Cancelar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
            <form onSubmit={async (event) => {
              event.preventDefault()
              const message = chatInput.trim()
              if (!message) return
              const activePendingAction = pendingChatAction ?? latestPendingChatAction(chatMessages)
              setChatMessages((items) => [...items, { role: 'user', text: message }])
              setChatInput('')
              if (activePendingAction && isAffirmative(message)) {
                await runChatAction(activePendingAction)
                return
              }
              if (activePendingAction && isNegative(message)) {
                await cancelChatAction(activePendingAction)
                return
              }
              const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: activeProfileId, message }) })
              const data = await res.json()
              const actions = Array.isArray(data.actions) ? data.actions : []
              setPendingChatAction(actions[0] ?? null)
              setChatMessages((items) => [...items, { role: 'assistant', text: data.text ?? data.error, actions }])
            }}>
              <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} />
              <button className="icon-button" aria-label="Enviar"><ChevronRight /></button>
            </form>
          </div>
        </Modal>
      )}
    </main>
  )
}

function Onboarding({ onDone, embedded = false }: { onDone: (state: AppState) => void; embedded?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [rough, setRough] = useState(true)
  const [macroMode, setMacroMode] = useState('balanced')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const selectedMacroMode = String(form.get('macroMode') || 'balanced')
    const payload = {
      name: String(form.get('name') || 'Perfil'),
      locale: 'es',
      weightKg: Number(form.get('weightKg')),
      targetWeightKg: Number(form.get('targetWeightKg')),
      heightCm: Number(form.get('heightCm')),
      age: form.get('age') ? Number(form.get('age')) : null,
      sex: String(form.get('sex') || 'skipped'),
      acceptsRoughEstimate: rough,
      activityLevel: String(form.get('activityLevel') || 'lightly_active'),
      goal: String(form.get('goal') || 'cut'),
      macroMode: selectedMacroMode,
      manualTargets: selectedMacroMode === 'manual' ? {
        calories: Number(form.get('manualCalories')),
        proteinG: Number(form.get('manualProteinG')),
        carbsG: Number(form.get('manualCarbsG')),
        fatG: Number(form.get('manualFatG')),
      } : null,
      likes: splitList(String(form.get('likes') || '')),
      dislikes: splitList(String(form.get('dislikes') || '')),
      bannedFoods: splitList(String(form.get('bannedFoods') || '')),
    }
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) setError(data.error)
    else onDone(data)
  }
  const content = (
      <section className={`onboarding-panel ${embedded ? 'embedded' : ''}`}>
        <div className="brand-mark"><Utensils /></div>
        <h1>Crea tu primera semana</h1>
        <p>Perfil en español, unidades métricas y macros editables antes de guardar.</p>
        <form onSubmit={submit}>
          <div className="field-grid">
            <label>Nombre<input name="name" defaultValue="Yo" required /></label>
            <label>Peso actual (kg)<input name="weightKg" type="number" defaultValue="78" required /></label>
            <label>Peso objetivo (kg)<input name="targetWeightKg" type="number" defaultValue="74" required /></label>
            <label>Altura (cm)<input name="heightCm" type="number" defaultValue="178" required /></label>
            <label>Edad opcional<input name="age" type="number" placeholder="Opcional" /></label>
            <label>Sexo opcional<select name="sex" defaultValue="skipped"><option value="skipped">Prefiero omitir</option><option value="male">Masculino</option><option value="female">Femenino</option></select></label>
            <label>Actividad<select name="activityLevel" defaultValue="lightly_active">{Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Objetivo<select name="goal" defaultValue="cut"><option value="maintain">Mantener</option><option value="cut">Cortar</option><option value="bulk">Volumen</option></select></label>
            <label>Modo macro<select name="macroMode" value={macroMode} onChange={(event) => setMacroMode(event.target.value)}><option value="balanced">Equilibrado sugerido</option><option value="high_protein">Alto en proteína sugerido</option><option value="lower_carb">Bajo en carbohidratos sugerido</option><option value="manual">Manual</option></select></label>
          </div>
          {macroMode === 'manual' && (
            <div className="field-grid manual-targets">
              <label>Calorías<input name="manualCalories" type="number" defaultValue="2150" required /></label>
              <label>Proteína (g)<input name="manualProteinG" type="number" defaultValue="135" required /></label>
              <label>Carbos (g)<input name="manualCarbsG" type="number" defaultValue="250" required /></label>
              <label>Grasa (g)<input name="manualFatG" type="number" defaultValue="70" required /></label>
            </div>
          )}
          <label>Me gusta<input name="likes" placeholder="salmón, arroz, yogur" /></label>
          <label>No me gusta<input name="dislikes" placeholder="brócoli, atún..." /></label>
          <label>Prohibidos<input name="bannedFoods" placeholder="ingredientes separados por coma" /></label>
          <label className="checkline"><input type="checkbox" checked={rough} onChange={(event) => setRough(event.target.checked)} /> Acepto estimaciones aproximadas si omito edad o sexo.</label>
          {error && <p className="error">{error}</p>}
          <button className="primary"><Sparkles /> Generar primera semana</button>
        </form>
      </section>
  )
  return embedded ? content : <main className="onboarding">{content}</main>
}

function WeekScreen({
  state,
  busy,
  onSelectMeal,
  onEditMeal,
  onAction,
  onRelaxPreferences,
  onReviewIngredients,
}: {
  state: AppState
  busy: string | null
  onSelectMeal: (meal: Meal) => void
  onEditMeal: (meal: Meal) => void
  onAction: (payload: any) => Promise<any>
  onRelaxPreferences: (request: PreferenceRelaxationRequest) => void
  onReviewIngredients: (request: IngredientMappingRequest) => void
}) {
  const menu = state.currentMenu
  if (!menu) {
    return (
      <div className="week-screen">
        <GenerationJobsPanel jobs={state.generationJobs} profile={state.activeProfile} profileId={state.activeProfile?.id} onAction={onAction} onRelaxPreferences={onRelaxPreferences} onReviewIngredients={onReviewIngredients} compact={false} />
        <EmptyState title="Sin menú" body="Cuando una generación termine correctamente, la semana aparecerá aquí." />
        {state.activeProfile?.latestTarget && (
          <button className="primary" onClick={() => onAction({ action: 'startWeeklyMenuGeneration', profileId: state.activeProfile?.id, runNow: true })}>
            <Sparkles /> Generar semana
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="week-screen">
      <section className="summary-band">
        <div>
          <p className="tiny">Semana desde {formatDate(menu.weekStart)}</p>
          <h2>{Math.round(menu.nutrition.calories / 7)} kcal/día</h2>
          <p>{Math.round(menu.nutrition.proteinG / 7)}g proteína · {Math.round(menu.nutrition.carbsG / 7)}g carbos · {Math.round(menu.nutrition.fatG / 7)}g grasa</p>
        </div>
        <button className="secondary" disabled={busy === 'regenerateWeek'} onClick={() => onAction({ action: 'regenerateWeek', menuId: menu.id, profileId: state.activeProfile?.id })}><RefreshCw /> Regenerar</button>
      </section>
      <section className="target-strip">
        <span>Objetivo: {menu.target.calories} kcal</span>
        <span>Proteína mín. {menu.target.proteinG}g</span>
        <span>Confianza {menu.target.confidence}</span>
      </section>
      <GenerationNotice menu={menu} />
      <GenerationJobsPanel jobs={state.generationJobs} profile={state.activeProfile} profileId={state.activeProfile?.id} onAction={onAction} onRelaxPreferences={onRelaxPreferences} onReviewIngredients={onReviewIngredients} compact />
      <div className="day-list">
        {menu.days.map((day) => (
          <section key={day.id} className="day-section">
            <div className="day-header">
              <h3>{dayNames[day.dayIndex]}</h3>
              <div>
                <button className="icon-button" onClick={() => onAction({ action: 'lockDay', dayPlanId: day.id, locked: !day.locked, profileId: state.activeProfile?.id })}>{day.locked ? <Lock /> : <Unlock />}</button>
                <button className="icon-button" onClick={() => onAction({ action: 'regenerateDay', dayPlanId: day.id, profileId: state.activeProfile?.id })}><RefreshCw /></button>
              </div>
            </div>
            <div className="meal-list">
              {day.meals.map((meal) => (
                <article key={meal.id} className="meal-row">
                  <button className="meal-main" onClick={() => onSelectMeal(meal)}>
                    <span className="slot">{slotLabels[meal.slot]}</span>
                    <strong>{meal.recipe.title}</strong>
                    <small>{meal.nutrition.calories} kcal · {meal.nutrition.proteinG}g P · {meal.recipe.prepTimeMinutes} min · {meal.nutrition.confidence}</small>
                  </button>
                  <div className="row-actions">
                    <button className="icon-button" onClick={() => onAction({ action: 'lockMeal', menuMealId: meal.id, locked: !meal.locked, profileId: state.activeProfile?.id })}>{meal.locked ? <Lock /> : <Unlock />}</button>
                    <button className="icon-button" onClick={() => onEditMeal(meal)}><Sparkles /></button>
                    <button className="icon-button" onClick={() => onAction({ action: 'regenerateMeal', menuMealId: meal.id, profileId: state.activeProfile?.id })}><RefreshCw /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function GenerationNotice({ menu }: { menu: NonNullable<AppState['currentMenu']> }) {
  const settings = menu.generationSettings ?? {}
  const fallbackSlots = Array.isArray(settings.fallbackSlots) ? settings.fallbackSlots : []
  const trace = settings.trace && typeof settings.trace === 'object' ? settings.trace as { slots?: Record<string, any> } : null
  const skeletonTrace = settings.weekSkeletonTrace && typeof settings.weekSkeletonTrace === 'object' ? settings.weekSkeletonTrace as Record<string, any> : null
  const repair = settings.repair && typeof settings.repair === 'object' ? settings.repair as { attempted?: boolean; actions?: unknown[]; repaired?: boolean } : null
  const generationSummary = generationSummaryText(settings.generationSummary)
  const repairRemediation = repairRemediationPlans(settings.repairRemediation)
  const slotTraces = Object.values(trace?.slots ?? {})
  const cacheHits = slotTraces.filter((item) => item?.cacheHit).length
  const source = String(settings.recipeSource ?? '')
  const skeletonFallback = Boolean(skeletonTrace?.fallbackUsed)
  const repairActions = Array.isArray(repair?.actions) ? repair.actions.length : 0
  if (fallbackSlots.length > 0 || skeletonFallback) {
    const details = [
      skeletonFallback ? 'esqueleto semanal determinístico' : null,
      fallbackSlots.length > 0 ? `plantillas en ${fallbackSlots.map((slot) => slotLabels[String(slot)] ?? String(slot)).join(', ')}` : null,
      repairActions > 0 ? `${repairActions} reparación(es) de selección` : null,
    ].filter(Boolean).join('; ')
    return (
      <div className="notice-stack">
        <section className="generation-notice warning">
          <strong>Fallback usado</strong>
          <span>{generationSummary ?? `${details}.`}</span>
        </section>
        {repairRemediation.map((item) => <RemediationNotice key={`${item.code}-${item.title}`} plan={item} />)}
      </div>
    )
  }
  if (source === 'llm' || cacheHits > 0 || skeletonTrace?.providerSource === 'llm') {
    const details = [
      skeletonTrace?.providerSource === 'llm' ? 'Esqueleto semanal LLM.' : null,
      cacheHits > 0 ? `${cacheHits} lote(s) salieron de caché AI.` : 'Nutrición calculada con datos determinísticos.',
      repairActions > 0 ? `${repairActions} reparación(es) de selección aplicadas.` : null,
    ].filter(Boolean).join(' ')
    return (
      <div className="notice-stack">
        <section className="generation-notice">
          <strong>Plan LLM validado</strong>
          <span>{generationSummary ?? details}</span>
        </section>
        {repairRemediation.map((item) => <RemediationNotice key={`${item.code}-${item.title}`} plan={item} />)}
      </div>
    )
  }
  if (repairRemediation.length > 0) {
    return <div className="notice-stack">{repairRemediation.map((item) => <RemediationNotice key={`${item.code}-${item.title}`} plan={item} />)}</div>
  }
  return (
    <section className="generation-notice legacy">
      <strong>Sin trazabilidad de generación</strong>
      <span>Este menú fue creado antes de registrar fuente, fallback y caché.</span>
    </section>
  )
}

function repairRemediationPlans(value: unknown): RemediationPlan[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is RemediationPlan => Boolean(item) && typeof item === 'object' && typeof item.title === 'string')
}

function RemediationNotice({ plan }: { plan: RemediationPlan }) {
  return (
    <section className={`generation-notice remediation ${plan.severity}`}>
      <strong>{plan.title}</strong>
      <span>{plan.summary}</span>
      {plan.steps.length > 0 && <span>Qué hacer: {plan.steps.slice(0, 2).join(' ')}</span>}
    </section>
  )
}

function generationSummaryText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const summary = String((value as { summary?: unknown }).summary ?? '').trim()
  return summary || null
}

function GenerationJobsPanel({
  jobs,
  profile,
  profileId,
  onAction,
  onRelaxPreferences,
  onReviewIngredients,
  compact = false,
}: {
  jobs: GenerationJob[]
  profile?: Profile | null
  profileId?: string
  onAction: (payload: any) => Promise<any>
  onRelaxPreferences: (request: PreferenceRelaxationRequest) => void
  onReviewIngredients: (request: IngredientMappingRequest) => void
  compact?: boolean
}) {
  const visibleJobs = jobs
    .filter((job) => job.status === 'failed' || job.status === 'running' || job.status === 'queued')
    .slice(0, compact ? 2 : 6)
  if (visibleJobs.length === 0) return null
  return (
    <section className="job-panel">
      <header>
        <span>{visibleJobs.some((job) => job.status === 'failed') ? <AlertTriangle /> : <LoaderCircle />}</span>
        <div>
          <strong>{visibleJobs.some((job) => job.status === 'failed') ? 'Generación necesita atención' : 'Generación en curso'}</strong>
          <small>Estado persistido del trabajo, no un mensaje genérico.</small>
        </div>
      </header>
      <div className="job-list">
        {visibleJobs.map((job) => (
          <article key={job.id} className={`job-row ${job.status}`}>
            <div>
              <span className="job-status">{jobStatusLabel(job.status)}</span>
              <strong>{jobKindLabel(job.kind)}</strong>
              <small>{jobFailureText(job)}</small>
              {generationSummaryText(job.result?.generationSummary) && <small>{generationSummaryText(job.result.generationSummary)}</small>}
              {job.logs.length > 0 && <small>Último paso: {job.logs[job.logs.length - 1]}</small>}
              {job.remediation && (
                <JobRemediation
                  job={job}
                  plan={job.remediation}
                  profile={profile}
                  compact={compact}
                  onAction={onAction}
                  onRelaxPreferences={onRelaxPreferences}
                  onReviewIngredients={onReviewIngredients}
                />
              )}
            </div>
            {job.status === 'failed' && !job.remediation && (
              <button className="secondary" disabled={!(profileId ?? job.profileId)} onClick={() => onAction({ action: 'retryGenerationJob', profileId: profileId ?? job.profileId, jobId: job.id })}>
                <RefreshCw /> Reintentar
              </button>
            )}
            {(job.status === 'queued' || job.status === 'running') && (
              <button className="secondary" disabled={!(profileId ?? job.profileId)} onClick={() => onAction({ action: 'cancelGenerationJob', profileId: profileId ?? job.profileId, jobId: job.id })}>
                <X /> Cancelar
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function JobRemediation({
  job,
  plan,
  profile,
  compact,
  onAction,
  onRelaxPreferences,
  onReviewIngredients,
}: {
  job: GenerationJob
  plan: RemediationPlan
  profile?: Profile | null
  compact: boolean
  onAction: (payload: any) => Promise<any>
  onRelaxPreferences: (request: PreferenceRelaxationRequest) => void
  onReviewIngredients: (request: IngredientMappingRequest) => void
}) {
  const hasPreferencesToRelax = Boolean(profile && (profile.dislikes.length > 0 || profile.bannedFoods.length > 0))
  return (
    <div className={`job-remediation ${plan.severity}`}>
      <strong>{plan.title}</strong>
      <small>{plan.summary}</small>
      {!compact && (
        <ul>
          {plan.steps.slice(0, 3).map((step) => <li key={step}>{step}</li>)}
        </ul>
      )}
      {plan.actions.length > 0 && (
        <div className="remediation-actions">
          {plan.actions.slice(0, 3).map((action) => {
            if (action.kind === 'retry_generation' && job.status === 'failed') {
              return (
                <button key={`${action.kind}-${action.label}`} type="button" onClick={() => onAction({ action: 'retryGenerationJob', profileId: profile?.id ?? job.profileId, jobId: job.id })}>
                  {action.label}
                </button>
              )
            }
            if (action.kind === 'relax_preferences' && hasPreferencesToRelax) {
              return (
                <button key={`${action.kind}-${action.label}`} type="button" onClick={() => onRelaxPreferences({ job, plan })}>
                  {action.label}
                </button>
              )
            }
            if (action.kind === 'review_ingredients') {
              return (
                <button key={`${action.kind}-${action.label}`} type="button" onClick={() => onReviewIngredients({ job, plan })}>
                  {action.label}
                </button>
              )
            }
            if (action.kind === 'enable_fallback') {
              return (
                <button key={`${action.kind}-${action.label}`} type="button" onClick={() => onAction({
                  action: 'setFallbackPolicy',
                  profileId: profile?.id ?? job.profileId ?? undefined,
                  recipeTemplateFallbackAllowed: true,
                  weekSkeletonFallbackAllowed: true,
                })}>
                  {action.label}
                </button>
              )
            }
            return <span key={`${action.kind}-${action.label}`}>{action.label}</span>
          })}
        </div>
      )}
    </div>
  )
}

function PreferenceRelaxationModal({
  profile,
  job,
  plan,
  onAction,
  onClose,
}: {
  profile: Profile
  job: GenerationJob
  plan: RemediationPlan
  onAction: (payload: any) => Promise<any>
  onClose: () => void
}) {
  const [removeDislikes, setRemoveDislikes] = useState<string[]>([])
  const [removeBannedFoods, setRemoveBannedFoods] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState<string | null>(null)
  const totalSelected = removeDislikes.length + removeBannedFoods.length

  async function apply(retry: boolean) {
    if (totalSelected === 0) {
      setError('Selecciona al menos una preferencia para relajar.')
      return
    }
    setError(null)
    setLocalBusy(retry ? 'retry' : 'save')
    try {
      await onAction({
        action: 'relaxProfilePreferences',
        profileId: profile.id,
        removeDislikes,
        removeBannedFoods,
      })
      if (retry && job.status === 'failed') {
        await onAction({ action: 'retryGenerationJob', profileId: profile.id, jobId: job.id })
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo aplicar la remediación.')
    } finally {
      setLocalBusy(null)
    }
  }

  return (
    <Modal title="Revisar preferencias" onClose={onClose}>
      <div className="remediation-modal">
        <p>{plan.summary}</p>
        <PreferenceChecklist title="No me gusta" values={profile.dislikes} selected={removeDislikes} onChange={setRemoveDislikes} />
        <PreferenceChecklist title="Prohibidos" values={profile.bannedFoods} selected={removeBannedFoods} onChange={setRemoveBannedFoods} />
        {profile.dislikes.length === 0 && profile.bannedFoods.length === 0 && <p className="muted">Este perfil no tiene dislikes ni prohibidos para relajar.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary" type="button" disabled={localBusy !== null || totalSelected === 0} onClick={() => apply(false)}>
            <Save size={16} /> {localBusy === 'save' ? 'Guardando...' : 'Guardar cambios'}
          </button>
          {job.status === 'failed' && (
            <button className="primary" type="button" disabled={localBusy !== null || totalSelected === 0} onClick={() => apply(true)}>
              <RefreshCw size={16} /> {localBusy === 'retry' ? 'Reintentando...' : 'Guardar y reintentar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function PreferenceChecklist({ title, values, selected, onChange }: { title: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  if (values.length === 0) return null
  return (
    <fieldset className="preference-checklist">
      <legend>{title}</legend>
      {values.map((value) => {
        const checked = selected.includes(value)
        return (
          <label key={value}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))}
            />
            <span>{value}</span>
          </label>
        )
      })}
    </fieldset>
  )
}

function IngredientMappingModal({
  profile,
  job,
  plan,
  foods,
  onAction,
  onClose,
}: {
  profile: Profile
  job: GenerationJob
  plan: RemediationPlan
  foods: MappableFood[]
  onAction: (payload: any) => Promise<any>
  onClose: () => void
}) {
  const [ingredientName, setIngredientName] = useState(ingredientNameFromRemediation(plan, job))
  const [canonicalFoodName, setCanonicalFoodName] = useState(foods[0]?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState<string | null>(null)

  async function apply(retry: boolean) {
    if (!ingredientName.trim() || !canonicalFoodName) {
      setError('Escribe el ingrediente y el alimento determinístico correcto.')
      return
    }
    setError(null)
    setLocalBusy(retry ? 'retry' : 'save')
    try {
      await onAction({
        action: 'saveIngredientMapping',
        profileId: profile.id,
        ingredientName,
        canonicalFoodName,
      })
      if (retry && job.status === 'failed') {
        await onAction({ action: 'retryGenerationJob', profileId: profile.id, jobId: job.id })
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el mapeo.')
    } finally {
      setLocalBusy(null)
    }
  }

  return (
    <Modal title="Revisar ingredientes" onClose={onClose}>
      <div className="remediation-modal">
        <p>{plan.summary}</p>
        <label>
          Ingrediente en la receta
          <input value={ingredientName} onChange={(event) => setIngredientName(event.target.value)} placeholder="ej. queso fresco batido" />
        </label>
        <label>
          Tratar como
          <select value={canonicalFoodName} onChange={(event) => setCanonicalFoodName(event.target.value)}>
            {foods.map((food) => (
              <option key={food.id} value={food.name}>{food.name} · {food.category}</option>
            ))}
          </select>
        </label>
        <p className="muted">Esto guarda un alias confirmado y el scorer lo usará en generaciones, reemplazos y análisis nutricional.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary" type="button" disabled={localBusy !== null} onClick={() => apply(false)}>
            <Save size={16} /> {localBusy === 'save' ? 'Guardando...' : 'Guardar mapeo'}
          </button>
          {job.status === 'failed' && (
            <button className="primary" type="button" disabled={localBusy !== null} onClick={() => apply(true)}>
              <RefreshCw size={16} /> {localBusy === 'retry' ? 'Reintentando...' : 'Guardar y reintentar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function MealModal({ meal, profileId, onClose, onAction, onEdit }: { meal: Meal; profileId: string; onClose: () => void; onAction: (payload: any) => Promise<any>; onEdit: () => void }) {
  return (
    <Modal title={meal.recipe.title} onClose={onClose}>
      <div className="meal-detail">
        <div className="macro-grid">
          <Metric label="kcal" value={meal.nutrition.calories} />
          <Metric label="proteína" value={`${meal.nutrition.proteinG}g`} />
          <Metric label="carbos" value={`${meal.nutrition.carbsG}g`} />
          <Metric label="grasa" value={`${meal.nutrition.fatG}g`} />
        </div>
        <p>{meal.recipe.description}</p>
        <div className="detail-actions">
          <button className="secondary" onClick={() => onAction({ action: 'starRecipe', profileId, recipeId: meal.recipe.id })}><Star /> Guardar</button>
          <button className="secondary" onClick={() => onAction({ action: 'lockMeal', profileId, menuMealId: meal.id, locked: !meal.locked })}>{meal.locked ? <Unlock /> : <Lock />} {meal.locked ? 'Desbloquear' : 'Bloquear'}</button>
          <button className="primary" onClick={onEdit}><Sparkles /> Editar</button>
        </div>
        <h3>Ingredientes</h3>
        <ul className="ingredient-list">{meal.recipe.ingredients.map((item) => <li key={item.id}><span>{item.name}</span><small>{item.amount} {item.unit} · {item.confidence}</small></li>)}</ul>
        <h3>Pasos</h3>
        <ol className="steps">{meal.recipe.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      </div>
    </Modal>
  )
}

function RecipesScreen({ state, onAction }: { state: AppState; onAction: (payload: any) => Promise<any> }) {
  if (state.savedRecipes.length === 0) return <EmptyState title="Sin recetas guardadas" body="Marca una receta con la estrella para verla aquí." />
  return <div className="simple-list">{state.savedRecipes.map((item) => <article key={item.savedRecipeId} className="saved-row"><Star /><span><strong>{item.recipe.title}</strong><small>{item.recipe.nutrition.calories} kcal · {item.recipe.prepTimeMinutes} min</small></span><button className="icon-button" onClick={() => onAction({ action: 'unstarRecipe', savedRecipeId: item.savedRecipeId, profileId: state.activeProfile?.id })}><X /></button></article>)}</div>
}

function HistoryScreen({ state }: { state: AppState }) {
  if (state.history.length === 0 && state.generationJobs.length === 0) return <EmptyState title="Sin historial" body="Los menús y trabajos de generación aparecerán aquí con sus snapshots." />
  return (
    <div className="history-screen">
      {state.history.length > 0 && (
        <section className="simple-list">
          <h2>Menús guardados</h2>
          {state.history.map((item) => <article key={item.id} className="history-row"><Archive /><span><strong>Semana {formatDate(item.weekStart)}</strong><small>{Math.round(item.nutrition.calories / 7)} kcal/día · snapshot preservado</small></span></article>)}
        </section>
      )}
      {state.generationJobs.length > 0 && (
        <section className="simple-list">
          <h2>Trabajos de generación</h2>
          {state.generationJobs.map((job) => (
            <article key={job.id} className={`history-row job-history ${job.status}`}>
              {job.status === 'failed' ? <AlertTriangle /> : job.status === 'completed' ? <Check /> : job.status === 'cancelled' ? <X /> : <LoaderCircle />}
              <span>
                <strong>{jobKindLabel(job.kind)} · {jobStatusLabel(job.status)}</strong>
                <small>{formatDateTime(job.updatedAt)} · {job.failureCode ? jobFailureLabel(job.failureCode) : `${job.logs.length} paso(s) registrados`}</small>
                {job.remediation && <small>{job.remediation.title}: {job.remediation.summary}</small>}
              </span>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function ProfileScreen({ state, onSwitch, onCreate, onAction }: { state: AppState; onSwitch: (id: string) => void; onCreate: () => void; onAction: (payload: any) => Promise<any> }) {
  const profile = state.activeProfile!
  const [deleteName, setDeleteName] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [resetPhrase, setResetPhrase] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [fallbackBusy, setFallbackBusy] = useState<string | null>(null)
  const settings = state.runtimeSettings
  async function updateFallback(key: 'recipeTemplateFallbackAllowed' | 'weekSkeletonFallbackAllowed', value: boolean) {
    setFallbackBusy(key)
    try {
      await onAction({ action: 'setFallbackPolicy', profileId: profile.id, [key]: value })
    } finally {
      setFallbackBusy(null)
    }
  }
  return (
    <section className="profile-screen">
      <h2>Perfil</h2>
      <div className="profile-switcher">
        {state.profiles.map((item) => <button key={item.id} className={item.id === profile.id ? 'selected' : ''} onClick={() => onSwitch(item.id)}>{item.name}</button>)}
        <button onClick={onCreate}>Nuevo perfil</button>
      </div>
      <div className="profile-facts">
        <Metric label="objetivo" value={profile.goal === 'cut' ? 'Corte' : profile.goal === 'bulk' ? 'Volumen' : 'Mantener'} />
        <Metric label="actividad" value={activityLabels[profile.activityLevel] ?? profile.activityLevel} />
        <Metric label="peso cálculo proteína" value={`${profile.proteinCalculationWeightKg} kg`} />
        <Metric label="idioma" value={profile.locale} />
      </div>
      <div className="preference-lines">
        <p><strong>Me gusta:</strong> {profile.likes.join(', ') || 'Sin datos'}</p>
        <p><strong>No me gusta:</strong> {profile.dislikes.join(', ') || 'Sin datos'}</p>
        <p><strong>Prohibidos:</strong> {profile.bannedFoods.join(', ') || 'Sin datos'}</p>
      </div>
      <section className="settings-panel">
        <div>
          <h3>Generación local</h3>
          <p>Controla si la app puede usar muletas determinísticas cuando el LLM no entrega suficientes candidatos válidos.</p>
        </div>
        <label className="settings-toggle">
          <span>
            <strong>Fallback de recetas</strong>
            <small>{settings.sources.recipeTemplateFallback === 'app_setting' ? 'Configurado en la app' : 'Por defecto/env'} · {settings.recipeTemplateFallbackAllowed ? 'habilitado' : 'deshabilitado'}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.recipeTemplateFallbackAllowed}
            disabled={fallbackBusy !== null}
            onChange={(event) => updateFallback('recipeTemplateFallbackAllowed', event.target.checked)}
          />
        </label>
        <label className="settings-toggle">
          <span>
            <strong>Fallback de esqueleto semanal</strong>
            <small>{settings.sources.weekSkeletonFallback === 'app_setting' ? 'Configurado en la app' : 'Por defecto/env'} · {settings.weekSkeletonFallbackAllowed ? 'habilitado' : 'deshabilitado'}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.weekSkeletonFallbackAllowed}
            disabled={fallbackBusy !== null}
            onChange={(event) => updateFallback('weekSkeletonFallbackAllowed', event.target.checked)}
          />
        </label>
      </section>
      <section className="danger-zone">
        <div>
          <h3>Zona de borrado</h3>
          <p>Elimina este perfil, sus menús, preferencias y enlaces a recetas guardadas. La acción devuelve un snapshot de exportación y no toca otros perfiles.</p>
        </div>
        <label>Escribe {profile.name}<input value={deleteName} onChange={(event) => {
          setDeleteName(event.target.value)
          setDeleteError(null)
        }} /></label>
        {deleteError && <p className="error">{deleteError}</p>}
        <button
          className="danger-button"
          disabled={deleteBusy || deleteName !== profile.name}
          onClick={async () => {
            setDeleteBusy(true)
            setDeleteError(null)
            try {
              await onAction({ action: 'deleteProfile', profileId: profile.id, expectedName: deleteName, exportBeforeDelete: true })
              setDeleteName('')
            } catch (error) {
              setDeleteError(error instanceof Error ? error.message : 'No se pudo eliminar el perfil.')
            } finally {
              setDeleteBusy(false)
            }
          }}
        >
          <Trash2 /> {deleteBusy ? 'Eliminando...' : 'Eliminar perfil'}
        </button>
        <hr />
        <div>
          <h3>Borrar todo local</h3>
          <p>Borra todos los perfiles, menús, recetas generadas, trabajos, preferencias, alias, ajustes locales y caché AI. La app queda lista para empezar desde cero.</p>
        </div>
        <label>Escribe BORRAR MENUMAKER LOCAL<input value={resetPhrase} onChange={(event) => {
          setResetPhrase(event.target.value)
          setResetError(null)
        }} /></label>
        {resetError && <p className="error">{resetError}</p>}
        <button
          className="danger-button"
          disabled={resetBusy || resetPhrase !== 'BORRAR MENUMAKER LOCAL'}
          onClick={async () => {
            setResetBusy(true)
            setResetError(null)
            try {
              await onAction({ action: 'resetLocalData', expectedPhrase: resetPhrase, exportBeforeDelete: true })
              setResetPhrase('')
            } catch (error) {
              setResetError(error instanceof Error ? error.message : 'No se pudo borrar el entorno local.')
            } finally {
              setResetBusy(false)
            }
          }}
        >
          <Trash2 /> {resetBusy ? 'Borrando...' : 'Borrar todo local'}
        </button>
      </section>
    </section>
  )
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop"><section className="modal"><header><h2>{title}</h2><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X /></button></header>{children}</section></div>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>
}

function NutritionDelta({ delta }: { delta: Nutrition }) {
  return <small className="delta">{delta.calories > 0 ? '+' : ''}{delta.calories} kcal · {delta.proteinG > 0 ? '+' : ''}{delta.proteinG}g P</small>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty"><Apple /><h2>{title}</h2><p>{body}</p></section>
}

function LoadingScreen() {
  return <main className="loading"><Sparkles /><p>Cargando MenuMaker...</p></main>
}

function MarkdownText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
        if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={blockIndex}>{lines.map((line, index) => <li key={index}><InlineMarkdown text={line.replace(/^[-*]\s+/, '')} /></li>)}</ul>
        }
        if (lines.length > 0 && lines.every((line) => /^\d+\.\s+/.test(line))) {
          return <ol key={blockIndex}>{lines.map((line, index) => <li key={index}><InlineMarkdown text={line.replace(/^\d+\.\s+/, '')} /></li>)}</ol>
        }
        return (
          <p key={blockIndex}>
            {lines.map((line, index) => (
              <Fragment key={line}>
                {index > 0 && <br />}
                <InlineMarkdown text={line} />
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}

function isAffirmative(value: string): boolean {
  return /^(si|confirmo|confirmar|ok|vale|dale|continua|continuar|hazlo|adelante)\b/i.test(normalizeChatInput(value))
}

function isNegative(value: string): boolean {
  return /^(no|cancelar|cancela|para|espera)\b/i.test(normalizeChatInput(value))
}

function normalizeChatInput(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function latestPendingChatAction(messages: ChatMessage[]): ChatAction | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const action = messages[index]?.actions?.[0]
    if (action) return action
  }
  return null
}

function chatActionSuccessText(action: ChatAction): string {
  if (action.type === 'adjustCaloriesAndRegenerateWeek') {
    return `Listo. Ajusté el objetivo a **${action.payload.calories} kcal/día** y regeneré la semana usando el proceso real de creación de menús, respetando los elementos bloqueados.`
  }
  if (action.type === 'regenerateWeek') return 'Listo. Regeneré la semana respetando los días y comidas bloqueadas.'
  if (action.type === 'regenerateDay') return 'Listo. Regeneré el día respetando las comidas bloqueadas.'
  if (action.type === 'regenerateMeal') return 'Listo. Regeneré la comida seleccionada.'
  return 'Listo. Acción aplicada.'
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(value))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function jobStatusLabel(status: string): string {
  if (status === 'queued') return 'En cola'
  if (status === 'running') return 'En curso'
  if (status === 'completed') return 'Completado'
  if (status === 'failed') return 'Falló'
  if (status === 'cancelled') return 'Cancelado'
  return status
}

function jobKindLabel(kind: string): string {
  if (kind === 'initial_generation') return 'Primera semana'
  if (kind === 'weekly_generation') return 'Semana nueva'
  if (kind === 'calorie_adjustment') return 'Reajuste calórico'
  if (kind === 'chat_calorie_target_adjustment') return 'Reajuste calórico desde chat'
  if (kind === 'regenerate_week') return 'Regeneración semanal'
  if (kind === 'regenerate_day') return 'Regeneración de día'
  if (kind === 'regenerate_meal') return 'Regeneración de comida'
  if (kind === 'preview_regenerate_week') return 'Preview regeneración semanal'
  if (kind === 'preview_regenerate_day') return 'Preview regeneración de día'
  if (kind === 'preview_regenerate_meal') return 'Preview regeneración de comida'
  if (kind === 'preview_calorie_adjustment') return 'Preview reajuste calórico'
  if (kind.startsWith('retry_')) return `Reintento de ${jobKindLabel(kind.replace(/^retry_/, ''))}`
  return kind.replace(/_/g, ' ')
}

function jobFailureLabel(code: string): string {
  if (code === 'low_nutrition_confidence') return 'Nutrición con baja confianza'
  if (code === 'ambiguous_ingredient') return 'Ingrediente ambiguo'
  if (code === 'banned_item_conflict') return 'Conflicto con alimento prohibido'
  if (code === 'repetition_conflict') return 'Conflicto de repetición'
  if (code === 'generation_exhausted') return 'Generación agotada'
  if (code === 'impossible_targets') return 'Objetivo imposible'
  return code.replace(/_/g, ' ')
}

function jobFailureText(job: GenerationJob): string {
  if (job.status === 'cancelled') return 'Cancelado por el usuario.'
  if (job.status !== 'failed') return job.logs.length > 0 ? `${job.logs.length} paso(s) registrados.` : 'Esperando actualización.'
  const label = job.failureCode ? jobFailureLabel(job.failureCode) : 'Error de generación'
  if (job.error) return `${label}: ${job.error}`
  return `${label}. Puedes reintentar después de ajustar proveedor, fallback, objetivos o preferencias.`
}

function ingredientNameFromRemediation(plan: RemediationPlan, job: GenerationJob): string {
  const values = [
    plan.context?.ingredientName,
    plan.context?.ingredient,
    job.result?.ingredientName,
    job.result?.ingredient,
  ]
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const text = [job.error, plan.summary, ...plan.steps].filter(Boolean).join(' ')
  const quoted = text.match(/["“”']([^"“”']{2,60})["“”']/)
  return quoted?.[1]?.trim() ?? ''
}

function proposalLabel(kind: string): string {
  if (kind === 'closest_nutrition') return 'Más parecido en macros'
  if (kind === 'macro_optimized') return 'Optimizado para macros'
  return 'Más creativo y rico'
}

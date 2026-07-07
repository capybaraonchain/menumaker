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
  Search,
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
type MappableFood = {
  id: string
  name: string
  category: string
  aliases: string[]
  sources?: string[]
  sourceId?: string
  confidence?: string
  per100g?: Nutrition
}
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
type FallbackPolicyRequest = { job: GenerationJob; plan: RemediationPlan }
type TargetEditRequest = { job: GenerationJob; plan: RemediationPlan }
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
  const [fallbackPolicyRequest, setFallbackPolicyRequest] = useState<FallbackPolicyRequest | null>(null)
  const [targetEditRequest, setTargetEditRequest] = useState<TargetEditRequest | null>(null)
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

  useEffect(() => {
    if (!activeProfileId) return
    const hasActiveJob = state?.generationJobs?.some((job) => job.status === 'queued' || job.status === 'running')
    if (!hasActiveJob) return
    const interval = window.setInterval(() => {
      void refreshState(activeProfileId)
    }, 4000)
    return () => window.clearInterval(interval)
  }, [activeProfileId, state?.generationJobs?.map((job) => `${job.id}:${job.status}`).join('|')])

  async function loadState(profileId?: string) {
    setLoading(true)
    const res = await fetch(`/api/state${profileId ? `?profileId=${profileId}` : ''}`)
    setState(await res.json())
    setLoading(false)
  }

  async function refreshState(profileId?: string) {
    const res = await fetch(`/api/state${profileId ? `?profileId=${profileId}` : ''}`)
    setState(await res.json())
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
          <h1>{displayProfileName(state.activeProfile.name)}</h1>
        </div>
        <div className={`provider ${state.provider?.configured ? 'ready' : 'offline'}`}>
          <span />
          {state.provider?.configured ? `${state.provider.provider ?? 'llm'} · ${state.provider.model}` : 'LLM offline'}
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
            onFallbackPolicy={setFallbackPolicyRequest}
            onAdjustTargets={setTargetEditRequest}
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

      {fallbackPolicyRequest && state.activeProfile && (
        <FallbackPolicyModal
          profile={state.activeProfile}
          job={fallbackPolicyRequest.job}
          plan={fallbackPolicyRequest.plan}
          settings={state.runtimeSettings}
          onAction={postAction}
          onClose={() => setFallbackPolicyRequest(null)}
        />
      )}

      {targetEditRequest && state.activeProfile && (
        <TargetEditModal
          profile={state.activeProfile}
          job={targetEditRequest.job}
          plan={targetEditRequest.plan}
          onAction={postAction}
          onClose={() => setTargetEditRequest(null)}
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
  const [submitting, setSubmitting] = useState(false)
  const [rough, setRough] = useState(true)
  const [macroMode, setMacroMode] = useState('balanced')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
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
      likes: [],
      dislikes: splitList(String(form.get('dislikes') || '')),
      bannedFoods: splitList(String(form.get('bannedFoods') || '')),
    }
    try {
      const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) setError(data?.error ?? 'Error de onboarding.')
      else onDone(data)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo completar el onboarding.')
    } finally {
      setSubmitting(false)
    }
  }
  const content = (
      <section className={`onboarding-panel ${embedded ? 'embedded' : ''}`}>
        <div className="brand-mark"><Utensils /></div>
        <h1>Crea tu primera semana</h1>
        <p>Perfil en español, unidades métricas y macros editables antes de guardar.</p>
        <form onSubmit={submit}>
          <div className="field-grid">
            <label>Nombre<input name="name" defaultValue="Usuario" required /></label>
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
          <label>Evitar<input name="dislikes" placeholder="brócoli, atún, cilantro..." /></label>
          <label>No puedo comer<input name="bannedFoods" placeholder="cacahuetes, marisco, gluten..." /></label>
          <label className="checkline"><input type="checkbox" checked={rough} onChange={(event) => setRough(event.target.checked)} /> Acepto estimaciones aproximadas si omito edad o sexo.</label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" disabled={submitting}>
            <Sparkles /> {submitting ? 'Generando...' : 'Generar primera semana'}
          </button>
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
  onFallbackPolicy,
  onAdjustTargets,
}: {
  state: AppState
  busy: string | null
  onSelectMeal: (meal: Meal) => void
  onEditMeal: (meal: Meal) => void
  onAction: (payload: any) => Promise<any>
  onRelaxPreferences: (request: PreferenceRelaxationRequest) => void
  onReviewIngredients: (request: IngredientMappingRequest) => void
  onFallbackPolicy: (request: FallbackPolicyRequest) => void
  onAdjustTargets: (request: TargetEditRequest) => void
}) {
  const menu = state.currentMenu
  if (!menu) {
    return (
      <div className="week-screen">
        <GenerationJobsPanel jobs={state.generationJobs} profile={state.activeProfile} profileId={state.activeProfile?.id} onAction={onAction} onRelaxPreferences={onRelaxPreferences} onReviewIngredients={onReviewIngredients} onFallbackPolicy={onFallbackPolicy} onAdjustTargets={onAdjustTargets} compact={false} />
        <EmptyState title="Sin menú" body="Cuando una generación termine correctamente, la semana aparecerá aquí." />
        {state.activeProfile?.latestTarget && (
          <div className="action-row">
            <button className="primary" onClick={() => onAction({ action: 'startWeeklyMenuGeneration', profileId: state.activeProfile?.id, runNow: false })}>
              <Sparkles /> Generar semana (en segundo plano)
            </button>
            <button className="secondary" onClick={() => onAction({ action: 'startWeeklyMenuGeneration', profileId: state.activeProfile?.id, runNow: true })}>
              <RefreshCw /> Generar semana ahora
            </button>
          </div>
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
        <button className="secondary" disabled={busy === 'enqueuePreviewGenerationJob'} onClick={() => onAction({ action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_week', menuId: menu.id, profileId: state.activeProfile?.id })}><RefreshCw /> Previsualizar</button>
      </section>
      <section className="target-strip">
        <span>Objetivo: {menu.target.calories} kcal</span>
        <span>Proteína mín. {menu.target.proteinG}g</span>
        <span>{Math.round(menu.target.carbsG)}g carbos · {Math.round(menu.target.fatG)}g grasa</span>
      </section>
      <GenerationNotice menu={menu} profileId={state.activeProfile?.id} onAction={onAction} />
      <GenerationJobsPanel jobs={state.generationJobs} profile={state.activeProfile} profileId={state.activeProfile?.id} onAction={onAction} onRelaxPreferences={onRelaxPreferences} onReviewIngredients={onReviewIngredients} onFallbackPolicy={onFallbackPolicy} onAdjustTargets={onAdjustTargets} compact />
      <div className="day-list">
        {menu.days.map((day) => (
          <section key={day.id} className="day-section">
            <div className="day-header">
              <h3>{dayNames[day.dayIndex]}</h3>
              <div>
                <button className="icon-button" onClick={() => onAction({ action: 'lockDay', dayPlanId: day.id, locked: !day.locked, profileId: state.activeProfile?.id })}>{day.locked ? <Lock /> : <Unlock />}</button>
                <button className="icon-button" onClick={() => onAction({ action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_day', dayPlanId: day.id, profileId: state.activeProfile?.id })}><RefreshCw /></button>
              </div>
            </div>
            <div className="meal-list">
              {day.meals.map((meal) => (
                <article key={meal.id} className="meal-row">
                  <button className="meal-main" onClick={() => onSelectMeal(meal)}>
                    <span className="slot">{slotLabels[meal.slot]}</span>
                    <strong>{displayFoodText(meal.recipe.title)}</strong>
                    <small>{meal.nutrition.calories} kcal · {meal.nutrition.proteinG}g P · {meal.recipe.prepTimeMinutes} min</small>
                  </button>
                  <div className="row-actions">
                    <button className="icon-button" onClick={() => onAction({ action: 'lockMeal', menuMealId: meal.id, locked: !meal.locked, profileId: state.activeProfile?.id })}>{meal.locked ? <Lock /> : <Unlock />}</button>
                    <button className="icon-button" onClick={() => onEditMeal(meal)}><Sparkles /></button>
                    <button className="icon-button" onClick={() => onAction({ action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_meal', menuMealId: meal.id, profileId: state.activeProfile?.id })}><RefreshCw /></button>
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

function GenerationNotice({
  menu,
  profileId,
  onAction,
}: {
  menu: NonNullable<AppState['currentMenu']>
  profileId?: string
  onAction: (payload: any) => Promise<any>
}) {
  const settings = menu.generationSettings ?? {}
  const fallbackSlots = Array.isArray(settings.fallbackSlots) ? settings.fallbackSlots : []
  const trace = settings.trace && typeof settings.trace === 'object' ? settings.trace as { mode?: string; slots?: Record<string, any>; fast?: { durationMs?: number; acceptedSelectedMealCount?: number; acceptedReserveMealCount?: number } } : null
  const skeletonTrace = settings.weekSkeletonTrace && typeof settings.weekSkeletonTrace === 'object' ? settings.weekSkeletonTrace as Record<string, any> : null
  const repair = settings.repair && typeof settings.repair === 'object' ? settings.repair as { attempted?: boolean; actions?: unknown[]; repaired?: boolean } : null
  const generationSummary = generationSummaryText(settings.generationSummary) ?? generationSummaryText(settings.fastSummary)
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
        {repairRemediation.map((item) => <RemediationNotice key={`${item.code}-${item.title}`} plan={item} menu={menu} profileId={profileId} onAction={onAction} />)}
      </div>
    )
  }
  if (source === 'llm' || cacheHits > 0 || skeletonTrace?.providerSource === 'llm') {
    const fastTrace = trace?.mode === 'fast_full_week' ? trace : null
    const fastTraceDetails = fastTrace?.fast ? [
      'Semana inicial rápida validada localmente.',
      typeof fastTrace.fast.acceptedSelectedMealCount === 'number' ? `${fastTrace.fast.acceptedSelectedMealCount} comidas aceptadas.` : null,
      typeof fastTrace.fast.acceptedReserveMealCount === 'number' ? `${fastTrace.fast.acceptedReserveMealCount} reservas aceptadas.` : null,
      typeof fastTrace.fast.durationMs === 'number' ? `${Math.round(fastTrace.fast.durationMs / 1000)}s.` : null,
    ].filter(Boolean).join(' ') : null
    const details = [
      fastTraceDetails,
      skeletonTrace?.providerSource === 'llm' ? 'Esqueleto semanal LLM.' : null,
      cacheHits > 0 ? `${cacheHits} lote(s) salieron de caché AI.` : 'Macros revisados con la tabla nutricional local.',
      repairActions > 0 ? `${repairActions} reparación(es) de selección aplicadas.` : null,
    ].filter(Boolean).join(' ')
    return (
      <div className="notice-stack">
        <section className="generation-notice">
          <strong>Plan LLM validado</strong>
          <span>{generationSummary ?? details}</span>
        </section>
        {repairRemediation.map((item) => <RemediationNotice key={`${item.code}-${item.title}`} plan={item} menu={menu} profileId={profileId} onAction={onAction} />)}
      </div>
    )
  }
  if (repairRemediation.length > 0) {
    return <div className="notice-stack">{repairRemediation.map((item) => <RemediationNotice key={`${item.code}-${item.title}`} plan={item} menu={menu} profileId={profileId} onAction={onAction} />)}</div>
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

function RemediationNotice({
  plan,
  menu,
  profileId,
  onAction,
}: {
  plan: RemediationPlan
  menu?: NonNullable<AppState['currentMenu']>
  profileId?: string
  onAction?: (payload: any) => Promise<any>
}) {
  const repairAction = menu && onAction ? repairActionPayload(plan, menu, profileId) : null
  return (
    <section className={`generation-notice remediation ${plan.severity}`}>
      <strong>{plan.title}</strong>
      <span>{plan.summary}</span>
      {plan.steps.length > 0 && <span>Qué hacer: {plan.steps.slice(0, 2).join(' ')}</span>}
      {repairAction && (
        <button className="secondary compact-action" type="button" onClick={() => onAction?.(repairAction.payload)}>
          <RefreshCw /> {repairAction.label}
        </button>
      )}
    </section>
  )
}

function repairActionPayload(plan: RemediationPlan, menu: NonNullable<AppState['currentMenu']>, profileId?: string): { label: string; payload: any } | null {
  const action = plan.actions.find((item) => item.kind === 'regenerate_meal' || item.kind === 'regenerate_day' || item.kind === 'regenerate_week')
  if (!action) return null
  if (action.kind === 'regenerate_week') {
    return { label: action.label, payload: { action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_week', menuId: menu.id, profileId } }
  }
  const dayIndex = typeof plan.context?.dayIndex === 'number' ? plan.context.dayIndex : null
  const day = dayIndex === null ? null : menu.days.find((item) => item.dayIndex === dayIndex)
  if (!day) return { label: 'Regenerar semana', payload: { action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_week', menuId: menu.id, profileId } }
  if (action.kind === 'regenerate_day') {
    return { label: action.label, payload: { action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_day', dayPlanId: day.id, profileId } }
  }
  const slot = typeof plan.context?.slot === 'string' ? plan.context.slot : null
  const meal = slot ? day.meals.find((item) => item.slot === slot) : null
  if (!meal) return { label: 'Regenerar día', payload: { action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_day', dayPlanId: day.id, profileId } }
  return { label: action.label, payload: { action: 'enqueuePreviewGenerationJob', kind: 'preview_regenerate_meal', menuMealId: meal.id, profileId } }
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
  onFallbackPolicy,
  onAdjustTargets,
  compact = false,
}: {
  jobs: GenerationJob[]
  profile?: Profile | null
  profileId?: string
  onAction: (payload: any) => Promise<any>
  onRelaxPreferences: (request: PreferenceRelaxationRequest) => void
  onReviewIngredients: (request: IngredientMappingRequest) => void
  onFallbackPolicy: (request: FallbackPolicyRequest) => void
  onAdjustTargets: (request: TargetEditRequest) => void
  compact?: boolean
}) {
  const visibleJobs = jobs
    .filter((job) => job.status === 'failed' || job.status === 'running' || job.status === 'queued' || hasCompletedPreviewPlan(job))
    .slice(0, compact ? 2 : 6)
  const queuedJobs = visibleJobs.filter((job) => job.status === 'queued')
  if (visibleJobs.length === 0) return null
  return (
    <section className="job-panel">
      <header>
        <span>{visibleJobs.some((job) => job.status === 'failed') ? <AlertTriangle /> : <LoaderCircle />}</span>
        <div>
          <strong>{visibleJobs.some((job) => job.status === 'failed')
              ? 'Plan necesita atención'
              : visibleJobs.some((job) => job.status === 'running')
                ? 'Plan actualizándose'
                : 'Cambios pendientes'}</strong>
          <small>{visibleJobs.some((job) => job.status === 'running')
              ? 'Estamos preparando una actualización del menú.'
              : visibleJobs.some((job) => job.status === 'queued')
                ? 'Hay un cambio esperando ejecución.'
                : 'Actividad reciente del menú.'}</small>
        </div>
        {queuedJobs.length > 0 && (
          <button className="secondary compact-action" type="button" onClick={() => onAction({ action: 'processQueuedGenerationJobs', profileId, limit: 1 })}>
            <RefreshCw /> Procesar cola
          </button>
        )}
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
                  onFallbackPolicy={onFallbackPolicy}
                  onAdjustTargets={onAdjustTargets}
                />
              )}
            </div>
            {job.status === 'failed' && !job.remediation && (
              <button className="secondary" disabled={!(profileId ?? job.profileId)} onClick={() => onAction({ action: 'retryGenerationJob', profileId: profileId ?? job.profileId, jobId: job.id })}>
                <RefreshCw /> Reintentar
              </button>
            )}
            {(job.status === 'queued' || job.status === 'running') && (
              <div className="job-actions">
                {job.status === 'queued' && (
                  <button className="secondary" disabled={!(profileId ?? job.profileId)} onClick={() => onAction(runQueuedJobAction(job, profileId))}>
                    <RefreshCw /> Ejecutar ahora
                  </button>
                )}
                <button className="secondary" disabled={!(profileId ?? job.profileId)} onClick={() => onAction({ action: 'cancelGenerationJob', profileId: profileId ?? job.profileId, jobId: job.id })}>
                  <X /> Cancelar
                </button>
              </div>
            )}
            {hasCompletedPreviewPlan(job) && previewApplyAction(job, profileId) && (
              <div className="job-actions">
                <button className="primary" disabled={!(profileId ?? job.profileId)} onClick={() => onAction(previewApplyAction(job, profileId))}>
                  <Sparkles /> Aplicar plan
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function isPreviewJob(job: GenerationJob): boolean {
  return job.kind.startsWith('preview_')
}

function hasCompletedPreviewPlan(job: GenerationJob): boolean {
  return isPreviewJob(job) && job.status === 'completed' && Boolean(job.result?.plan && job.result?.previewInput)
}

function runQueuedJobAction(job: GenerationJob, profileId?: string): Record<string, unknown> {
  return isPreviewJob(job)
    ? { action: 'runPreviewGenerationJob', profileId: profileId ?? job.profileId, jobId: job.id }
    : { action: 'runGenerationJob', profileId: profileId ?? job.profileId, jobId: job.id }
}

function previewApplyAction(job: GenerationJob, profileId?: string): Record<string, unknown> | null {
  const input = job.result?.previewInput
  const plan = job.result?.plan
  if (!input || !plan || typeof input !== 'object') return null
  if (input.kind === 'preview_regenerate_week' && typeof input.menuId === 'string') {
    return { action: 'regenerateWeek', profileId: profileId ?? job.profileId, menuId: input.menuId, plan }
  }
  if (input.kind === 'preview_regenerate_day' && typeof input.dayPlanId === 'string') {
    return { action: 'regenerateDay', profileId: profileId ?? job.profileId, dayPlanId: input.dayPlanId, plan }
  }
  if (input.kind === 'preview_regenerate_meal' && typeof input.menuMealId === 'string') {
    return { action: 'regenerateMeal', profileId: profileId ?? job.profileId, menuMealId: input.menuMealId, plan }
  }
  if (input.kind === 'preview_calorie_adjustment' && typeof input.profileId === 'string' && typeof input.calories === 'number') {
    return { action: 'applyCalorieTargetChange', profileId: input.profileId, calories: input.calories, plan }
  }
  return null
}

function JobRemediation({
  job,
  plan,
  profile,
  compact,
  onAction,
  onRelaxPreferences,
  onReviewIngredients,
  onFallbackPolicy,
  onAdjustTargets,
}: {
  job: GenerationJob
  plan: RemediationPlan
  profile?: Profile | null
  compact: boolean
  onAction: (payload: any) => Promise<any>
  onRelaxPreferences: (request: PreferenceRelaxationRequest) => void
  onReviewIngredients: (request: IngredientMappingRequest) => void
  onFallbackPolicy: (request: FallbackPolicyRequest) => void
  onAdjustTargets: (request: TargetEditRequest) => void
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
                <button key={`${action.kind}-${action.label}`} type="button" onClick={() => onFallbackPolicy({ job, plan })}>
                  {action.label}
                </button>
              )
            }
            if (action.kind === 'adjust_targets') {
              return (
                <button key={`${action.kind}-${action.label}`} type="button" onClick={() => onAdjustTargets({ job, plan })}>
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
        <PreferenceChecklist title="Evitar" values={profile.dislikes} selected={removeDislikes} onChange={setRemoveDislikes} />
        <PreferenceChecklist title="No puedo comer" values={profile.bannedFoods} selected={removeBannedFoods} onChange={setRemoveBannedFoods} />
        {profile.dislikes.length === 0 && profile.bannedFoods.length === 0 && <p className="muted">Este perfil no tiene preferencias ni restricciones para relajar.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary" type="button" disabled={localBusy !== null || totalSelected === 0} onClick={() => apply(false)}>
            <Save size={16} /> {localBusy === 'save' ? 'Guardando...' : 'Guardar cambios'}
          </button>
          {job.status === 'failed' && (
            <button className="primary" type="button" disabled={localBusy !== null || totalSelected === 0} onClick={() => apply(true)}>
              <RefreshCw size={16} /> {localBusy === 'retry' ? 'Encolando...' : 'Guardar y encolar reintento'}
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
  const [searchQuery, setSearchQuery] = useState(ingredientNameFromRemediation(plan, job))
  const [sourceFilter, setSourceFilter] = useState('')
  const [searchResults, setSearchResults] = useState<MappableFood[]>([])
  const [showCreateFood, setShowCreateFood] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [usdaPath, setUsdaPath] = useState('')
  const [usdaFdcIds, setUsdaFdcIds] = useState('')
  const [usdaLimit, setUsdaLimit] = useState('')
  const [customName, setCustomName] = useState(ingredientNameFromRemediation(plan, job))
  const [customCategory, setCustomCategory] = useState('custom')
  const [customCalories, setCustomCalories] = useState('')
  const [customProtein, setCustomProtein] = useState('')
  const [customCarbs, setCustomCarbs] = useState('')
  const [customFat, setCustomFat] = useState('')
  const [customFiber, setCustomFiber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sourceMessage, setSourceMessage] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState<string | null>(null)
  const currentOptions = searchResults.length > 0 ? searchResults : foods.slice(0, 25)
  const sourceOptions = Array.from(new Set(foods.flatMap((food) => food.sources ?? []))).sort()

  async function searchFoods(nextSourceFilter = sourceFilter, nextQuery?: string) {
    const query = nextQuery?.trim() || searchQuery.trim() || ingredientName.trim()
    if (query.length < 2) {
      setError('Escribe al menos 2 letras para buscar en las fuentes nutricionales.')
      return
    }
    setError(null)
    setLocalBusy('search')
    try {
      const result = await onAction({
        action: 'searchNutritionFoods',
        profileId: profile.id,
        query,
        limit: 12,
        source: nextSourceFilter || undefined,
      }) as { foods?: MappableFood[] }
      const nextResults = result.foods ?? []
      setSearchResults(nextResults)
      if (nextResults[0]) setCanonicalFoodName(nextResults[0].name)
      if (nextResults.length === 0) setError('No encontré alimentos para esa búsqueda. Importa una fuente o crea un alimento local.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo buscar en fuentes nutricionales.')
    } finally {
      setLocalBusy(null)
    }
  }

  async function importBarcodeProduct() {
    if (!/^\d{6,14}$/.test(barcode)) {
      setError('Escribe un código de barras válido.')
      return
    }
    setError(null)
    setSourceMessage(null)
    setLocalBusy('off')
    try {
      await onAction({ action: 'importOpenFoodFactsProduct', profileId: profile.id, barcode })
      setSourceMessage('Producto importado desde Open Food Facts. Busca el nombre o código para seleccionarlo.')
      setSourceFilter('openfoodfacts')
      const nextQuery = ingredientName.trim() || barcode
      setSearchQuery(nextQuery)
      setBarcode('')
      await searchFoods('openfoodfacts', nextQuery)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo importar desde Open Food Facts.')
    } finally {
      setLocalBusy(null)
    }
  }

  async function importUsdaDownload() {
    if (!usdaPath.trim()) {
      setError('Escribe la ruta local o URL HTTPS del ZIP/JSON descargado de USDA.')
      return
    }
    setError(null)
    setSourceMessage(null)
    setLocalBusy('usda')
    try {
      await onAction({
        action: 'importUsdaFoodDataCentralDownload',
        profileId: profile.id,
        path: usdaPath.trim(),
        fdcIds: parsePositiveIntegers(usdaFdcIds),
        limit: usdaLimit.trim() ? Number(usdaLimit) : undefined,
      })
      setSourceMessage('Dataset USDA importado. Busca el alimento en las fuentes USDA.')
      setSourceFilter('usda_fdc')
      setUsdaPath('')
      setUsdaFdcIds('')
      setUsdaLimit('')
      await searchFoods('usda_fdc')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo importar el dataset USDA.')
    } finally {
      setLocalBusy(null)
    }
  }

  async function createInlineFood() {
    const calories = Number(customCalories)
    const proteinG = Number(customProtein)
    const carbsG = Number(customCarbs)
    const fatG = Number(customFat)
    const fiberG = customFiber.trim() ? Number(customFiber) : undefined
    if (!customName.trim() || [calories, proteinG, carbsG, fatG].some((value) => !Number.isFinite(value) || value < 0) || (fiberG !== undefined && (!Number.isFinite(fiberG) || fiberG < 0))) {
      setError('Completa nombre y macros por 100g con números válidos.')
      return
    }
    setError(null)
    setLocalBusy('createFood')
    try {
      const result = await onAction({
        action: 'createUserNutritionFood',
        profileId: profile.id,
        canonicalName: customName.trim(),
        category: customCategory.trim() || 'custom',
        aliases: uniqueStrings([customName.trim(), ingredientName.trim()]),
        per100g: { calories, proteinG, carbsG, fatG, fiberG },
        householdUnits: [],
      }) as { food?: MappableFood }
      if (result.food) {
        setSearchResults((items) => [result.food!, ...items.filter((item) => item.id !== result.food!.id)])
        setCanonicalFoodName(result.food.name)
        setSearchQuery(result.food.name)
      } else {
        setCanonicalFoodName(customName.trim())
        setSearchQuery(customName.trim())
      }
      setShowCreateFood(false)
      setCustomCalories('')
      setCustomProtein('')
      setCustomCarbs('')
      setCustomFat('')
      setCustomFiber('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el alimento local.')
    } finally {
      setLocalBusy(null)
    }
  }

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
          <input value={ingredientName} onChange={(event) => {
            setIngredientName(event.target.value)
            setSearchQuery(event.target.value)
          }} placeholder="ej. queso fresco batido" />
        </label>
        <label>
          Buscar alimento determinístico
          <div className="inline-field">
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="skyr, arroz, salmon..." />
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Fuente nutricional">
              <option value="">Todas</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <button className="secondary icon-button-text" type="button" disabled={localBusy !== null} onClick={() => searchFoods()}>
              <Search size={16} /> {localBusy === 'search' ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </label>
        <label>
          Tratar como
          <select value={canonicalFoodName} onChange={(event) => setCanonicalFoodName(event.target.value)}>
            {currentOptions.map((food) => (
              <option key={food.id} value={food.name}>{food.name} · {food.category}</option>
            ))}
          </select>
        </label>
        {searchResults.length > 0 && (
          <div className="search-result-list">
            {searchResults.map((food) => (
              <button
                key={`${food.id}-${food.sourceId ?? food.sources?.join('-') ?? 'source'}`}
                type="button"
                className={canonicalFoodName === food.name ? 'selected' : ''}
                onClick={() => setCanonicalFoodName(food.name)}
              >
                <strong>{food.name}</strong>
                <span>{food.category} · {(food.sources ?? []).join(', ') || 'fuente local'} · {confidenceExplanation(food.confidence ?? 'database')}</span>
                {food.per100g && <span>{Math.round(food.per100g.calories)} kcal · {roundOne(food.per100g.proteinG)}g P · {roundOne(food.per100g.carbsG)}g C · {roundOne(food.per100g.fatG)}g G /100g</span>}
              </button>
            ))}
          </div>
        )}
        <details className="inline-source-create">
          <summary>Importar fuente ahora</summary>
          <div className="source-form">
            <label>Código Open Food Facts<input value={barcode} inputMode="numeric" placeholder="3017620422003" onChange={(event) => setBarcode(event.target.value)} /></label>
            <button className="secondary" type="button" disabled={localBusy !== null || !/^\d{6,14}$/.test(barcode)} onClick={importBarcodeProduct}>
              <Save size={16} /> {localBusy === 'off' ? 'Importando...' : 'Importar producto'}
            </button>
            <label>Ruta o URL ZIP/JSON USDA<input value={usdaPath} placeholder="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip" onChange={(event) => setUsdaPath(event.target.value)} /></label>
            <div className="source-grid">
              <label>FDC IDs opcionales<input value={usdaFdcIds} placeholder="321358, 170379" onChange={(event) => setUsdaFdcIds(event.target.value)} /></label>
              <label>Límite opcional<input value={usdaLimit} inputMode="numeric" placeholder="1000" onChange={(event) => setUsdaLimit(event.target.value)} /></label>
            </div>
            <button className="secondary" type="button" disabled={localBusy !== null || !usdaPath.trim()} onClick={importUsdaDownload}>
              <Save size={16} /> {localBusy === 'usda' ? 'Importando...' : 'Importar USDA'}
            </button>
          </div>
        </details>
        <details className="inline-source-create" open={showCreateFood} onToggle={(event) => setShowCreateFood(event.currentTarget.open)}>
          <summary>Crear alimento local desde este problema</summary>
          <div className="source-form">
            <label>Nombre<input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="queso fresco batido" /></label>
            <div className="source-grid">
              <label>Categoría<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} /></label>
              <label>Alias confirmado<input value={ingredientName} disabled /></label>
            </div>
            <div className="source-grid macros">
              <label>kcal<input value={customCalories} inputMode="decimal" onChange={(event) => setCustomCalories(event.target.value)} /></label>
              <label>Proteína<input value={customProtein} inputMode="decimal" onChange={(event) => setCustomProtein(event.target.value)} /></label>
              <label>Carbos<input value={customCarbs} inputMode="decimal" onChange={(event) => setCustomCarbs(event.target.value)} /></label>
              <label>Grasa<input value={customFat} inputMode="decimal" onChange={(event) => setCustomFat(event.target.value)} /></label>
              <label>Fibra<input value={customFiber} inputMode="decimal" onChange={(event) => setCustomFiber(event.target.value)} /></label>
            </div>
            <button className="secondary" type="button" disabled={localBusy !== null} onClick={createInlineFood}>
              <Save size={16} /> {localBusy === 'createFood' ? 'Creando...' : 'Crear y seleccionar'}
            </button>
          </div>
        </details>
        <p className="muted">Esto guarda un alias confirmado y el scorer lo usará en generaciones, reemplazos y análisis nutricional.</p>
        {sourceMessage && <p className="source-message">{sourceMessage}</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary" type="button" disabled={localBusy !== null} onClick={() => apply(false)}>
            <Save size={16} /> {localBusy === 'save' ? 'Guardando...' : 'Guardar mapeo'}
          </button>
          {job.status === 'failed' && (
            <button className="primary" type="button" disabled={localBusy !== null} onClick={() => apply(true)}>
              <RefreshCw size={16} /> {localBusy === 'retry' ? 'Encolando...' : 'Guardar y encolar reintento'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function FallbackPolicyModal({
  profile,
  job,
  plan,
  settings,
  onAction,
  onClose,
}: {
  profile: Profile
  job: GenerationJob
  plan: RemediationPlan
  settings: RuntimeSettings
  onAction: (payload: any) => Promise<any>
  onClose: () => void
}) {
  const [recipeFallback, setRecipeFallback] = useState(true)
  const [skeletonFallback, setSkeletonFallback] = useState(true)
  const [retryAfterSave, setRetryAfterSave] = useState(job.status === 'failed')
  const [error, setError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState(false)

  async function apply() {
    setLocalBusy(true)
    setError(null)
    try {
      await onAction({
        action: 'setFallbackPolicy',
        profileId: profile.id,
        recipeTemplateFallbackAllowed: recipeFallback,
        weekSkeletonFallbackAllowed: skeletonFallback,
      })
      if (retryAfterSave && job.status === 'failed') {
        await onAction({ action: 'retryGenerationJob', profileId: profile.id, jobId: job.id })
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la política de fallback.')
    } finally {
      setLocalBusy(false)
    }
  }

  return (
    <Modal title="Habilitar fallback" onClose={onClose}>
      <div className="remediation-modal">
        <p>{plan.summary}</p>
        <p className="muted">Esto cambia la política local de generación. Si lo habilitas, la app puede usar plantillas determinísticas cuando el LLM no entregue suficientes candidatos válidos; esos platos quedarán marcados como fallback en la trazabilidad del menú.</p>
        <label className="checkline">
          <input type="checkbox" checked={recipeFallback} onChange={(event) => setRecipeFallback(event.target.checked)} />
          Fallback de recetas ({settings.recipeTemplateFallbackAllowed ? 'actualmente habilitado' : 'actualmente deshabilitado'})
        </label>
        <label className="checkline">
          <input type="checkbox" checked={skeletonFallback} onChange={(event) => setSkeletonFallback(event.target.checked)} />
          Fallback de esqueleto semanal ({settings.weekSkeletonFallbackAllowed ? 'actualmente habilitado' : 'actualmente deshabilitado'})
        </label>
        {job.status === 'failed' && (
          <label className="checkline">
            <input type="checkbox" checked={retryAfterSave} onChange={(event) => setRetryAfterSave(event.target.checked)} />
            Guardar y encolar reintento
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="primary" type="button" disabled={localBusy || (!recipeFallback && !skeletonFallback)} onClick={apply}>
            <Save size={16} /> {localBusy ? 'Aplicando...' : retryAfterSave ? 'Guardar y encolar' : 'Guardar política'}
          </button>
          <button className="secondary" type="button" disabled={localBusy} onClick={onClose}>
            <X size={16} /> Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function TargetEditModal({
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
  const target = profile.latestTarget ?? {}
  const [calories, setCalories] = useState(String(target.calories ?? 1850))
  const [proteinG, setProteinG] = useState(String(target.proteinG ?? ''))
  const [carbsG, setCarbsG] = useState(String(target.carbsG ?? ''))
  const [fatG, setFatG] = useState(String(target.fatG ?? ''))
  const [runNow, setRunNow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState(false)

  async function apply() {
    const nextCalories = Number(calories)
    const nextProtein = proteinG.trim() ? Number(proteinG) : undefined
    const nextCarbs = carbsG.trim() ? Number(carbsG) : undefined
    const nextFat = fatG.trim() ? Number(fatG) : undefined
    if (!Number.isFinite(nextCalories)) {
      setError('Escribe un objetivo calórico válido.')
      return
    }
    setLocalBusy(true)
    setError(null)
    try {
      await onAction({
        action: 'updateMacroTargetAndGenerate',
        profileId: profile.id,
        calories: Math.round(nextCalories),
        proteinG: nextProtein,
        carbsG: nextCarbs,
        fatG: nextFat,
        runNow,
        retryJobId: job.id,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el objetivo.')
    } finally {
      setLocalBusy(false)
    }
  }

  return (
    <Modal title="Ajustar objetivo" onClose={onClose}>
      <div className="remediation-modal">
        <p>{plan.summary}</p>
        <p className="muted">Guarda un nuevo objetivo y deja una generación semanal en cola con ese target. Si dejas proteína, carbohidratos o grasa vacíos, la app conserva el valor actual o recalcula carbohidratos cuando sea necesario.</p>
        <div className="source-grid macros">
          <label>kcal/día<input value={calories} inputMode="numeric" onChange={(event) => setCalories(event.target.value)} /></label>
          <label>Proteína g<input value={proteinG} inputMode="decimal" onChange={(event) => setProteinG(event.target.value)} /></label>
          <label>Carbos g<input value={carbsG} inputMode="decimal" onChange={(event) => setCarbsG(event.target.value)} /></label>
          <label>Grasa g<input value={fatG} inputMode="decimal" onChange={(event) => setFatG(event.target.value)} /></label>
        </div>
        <label className="checkline">
          <input type="checkbox" checked={runNow} onChange={(event) => setRunNow(event.target.checked)} />
          Ejecutar inmediatamente en vez de dejarlo en cola
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="primary" type="button" disabled={localBusy} onClick={apply}>
            <Save size={16} /> {localBusy ? 'Aplicando...' : runNow ? 'Guardar y generar' : 'Guardar y encolar'}
          </button>
          <button className="secondary" type="button" disabled={localBusy} onClick={onClose}>
            <X size={16} /> Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function MealModal({ meal, profileId, onClose, onAction, onEdit }: { meal: Meal; profileId: string; onClose: () => void; onAction: (payload: any) => Promise<any>; onEdit: () => void }) {
  return (
    <Modal title={displayFoodText(meal.recipe.title)} onClose={onClose}>
      <div className="meal-detail">
        <div className="macro-grid">
          <Metric label="kcal" value={meal.nutrition.calories} />
          <Metric label="proteína" value={`${meal.nutrition.proteinG}g`} />
          <Metric label="carbos" value={`${meal.nutrition.carbsG}g`} />
          <Metric label="grasa" value={`${meal.nutrition.fatG}g`} />
        </div>
        <p>{displayFoodText(meal.recipe.description)}</p>
        <div className="detail-actions">
          <button className="secondary" onClick={() => onAction({ action: 'starRecipe', profileId, recipeId: meal.recipe.id })}><Star /> Guardar</button>
          <button className="secondary" onClick={() => onAction({ action: 'lockMeal', profileId, menuMealId: meal.id, locked: !meal.locked })}>{meal.locked ? <Unlock /> : <Lock />} {meal.locked ? 'Desbloquear' : 'Bloquear'}</button>
          <button className="primary" onClick={onEdit}><Sparkles /> Editar</button>
        </div>
        <h3>Ingredientes</h3>
        <ul className="ingredient-list">{meal.recipe.ingredients.map((item) => (
          <li key={item.id}>
            <span>{displayFoodText(item.name)}</span>
            <small>{item.amount} {item.unit}</small>
          </li>
        ))}</ul>
        <h3>Pasos</h3>
        <ol className="steps">{meal.recipe.steps.map((step, index) => <li key={index}>{displayFoodText(step)}</li>)}</ol>
      </div>
    </Modal>
  )
}

function RecipesScreen({ state, onAction }: { state: AppState; onAction: (payload: any) => Promise<any> }) {
  if (state.savedRecipes.length === 0) return <EmptyState title="Sin recetas guardadas" body="Marca una receta con la estrella para verla aquí." />
  return <div className="simple-list">{state.savedRecipes.map((item) => <article key={item.savedRecipeId} className="saved-row"><Star /><span><strong>{displayFoodText(item.recipe.title)}</strong><small>{item.recipe.nutrition.calories} kcal · {item.recipe.prepTimeMinutes} min</small></span><button className="icon-button" onClick={() => onAction({ action: 'unstarRecipe', savedRecipeId: item.savedRecipeId, profileId: state.activeProfile?.id })}><X /></button></article>)}</div>
}

function HistoryScreen({ state }: { state: AppState }) {
  const visibleJobs = state.generationJobs.filter((job) => job.status !== 'cancelled')
  if (state.history.length === 0 && visibleJobs.length === 0) return <EmptyState title="Sin historial" body="Los menús y actualizaciones aparecerán aquí." />
  return (
    <div className="history-screen">
      {state.history.length > 0 && (
        <section className="simple-list">
          <h2>Menús guardados</h2>
          {state.history.map((item) => <article key={item.id} className="history-row"><Archive /><span><strong>Semana {formatDate(item.weekStart)}</strong><small>{Math.round(item.nutrition.calories / 7)} kcal/día · guardado</small></span></article>)}
        </section>
      )}
      {visibleJobs.length > 0 && (
        <section className="simple-list">
          <h2>Actividad reciente</h2>
          {visibleJobs.map((job) => (
            <article key={job.id} className={`history-row job-history ${job.status}`}>
              {job.status === 'failed' ? <AlertTriangle /> : job.status === 'completed' ? <Check /> : job.status === 'cancelled' ? <X /> : <LoaderCircle />}
              <span>
                <strong>{jobKindLabel(job.kind)} · {jobStatusLabel(job.status)}</strong>
                <small>{formatDateTime(job.updatedAt)} · {job.failureCode ? jobFailureLabel(job.failureCode) : jobActivityText(job)}</small>
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
        <button className="selected" onClick={() => onSwitch(profile.id)}>{displayProfileName(profile.name)}</button>
        <button onClick={onCreate}>Nuevo perfil</button>
      </div>
      <div className="profile-facts">
        <Metric label="objetivo" value={profile.goal === 'cut' ? 'Corte' : profile.goal === 'bulk' ? 'Volumen' : 'Mantener'} />
        <Metric label="actividad" value={activityLabels[profile.activityLevel] ?? profile.activityLevel} />
        <Metric label="peso cálculo proteína" value={`${profile.proteinCalculationWeightKg} kg`} />
        <Metric label="idioma" value={profile.locale === 'es' ? 'Español' : profile.locale} />
      </div>
      <div className="preference-lines">
        <p><strong>Me gusta:</strong> {preferenceText(profile.likes, ['yogur griego', 'pollo', 'frutos rojos'])}</p>
        <p><strong>Prefiero evitar:</strong> {preferenceText(profile.dislikes, ['fritos', 'bebidas azucaradas'])}</p>
        <p><strong>No puedo comer:</strong> {preferenceText(profile.bannedFoods, ['cacahuetes'])}</p>
      </div>
      <NutritionSourcesPanel profile={profile} foods={state.mappableFoods} onAction={onAction} />
      <section className="settings-panel">
        <div>
          <h3>Generación local</h3>
          <p>Controla cómo se completa el menú cuando el asistente no propone suficientes platos válidos.</p>
        </div>
        <label className="settings-toggle">
          <span>
            <strong>Recetas de apoyo</strong>
            <small>{settings.recipeTemplateFallbackAllowed ? 'habilitado' : 'deshabilitado'}</small>
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
            <strong>Estructura semanal de apoyo</strong>
            <small>{settings.weekSkeletonFallbackAllowed ? 'habilitado' : 'deshabilitado'}</small>
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

function NutritionSourcesPanel({
  profile,
  foods,
  onAction,
}: {
  profile: Profile
  foods: MappableFood[]
  onAction: (payload: any) => Promise<any>
}) {
  const [barcode, setBarcode] = useState('')
  const [usdaPath, setUsdaPath] = useState('')
  const [usdaFdcIds, setUsdaFdcIds] = useState('')
  const [usdaLimit, setUsdaLimit] = useState('')
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('custom')
  const [customAliases, setCustomAliases] = useState('')
  const [customCalories, setCustomCalories] = useState('')
  const [customProtein, setCustomProtein] = useState('')
  const [customCarbs, setCustomCarbs] = useState('')
  const [customFat, setCustomFat] = useState('')
  const [customFiber, setCustomFiber] = useState('')
  const [sourceBusy, setSourceBusy] = useState<string | null>(null)
  const [sourceMessage, setSourceMessage] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)

  async function runSourceAction(kind: string, payload: Record<string, unknown>, success: string) {
    setSourceBusy(kind)
    setSourceMessage(null)
    setSourceError(null)
    try {
      await onAction({ profileId: profile.id, ...payload })
      setSourceMessage(success)
      if (kind === 'off') setBarcode('')
      if (kind === 'usda') {
        setUsdaPath('')
        setUsdaFdcIds('')
        setUsdaLimit('')
      }
      if (kind === 'custom') {
        setCustomName('')
        setCustomAliases('')
        setCustomCalories('')
        setCustomProtein('')
        setCustomCarbs('')
        setCustomFat('')
        setCustomFiber('')
      }
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'No se pudo guardar la fuente nutricional.')
    } finally {
      setSourceBusy(null)
    }
  }

  function createCustomFood() {
    const calories = Number(customCalories)
    const proteinG = Number(customProtein)
    const carbsG = Number(customCarbs)
    const fatG = Number(customFat)
    const fiberG = customFiber.trim() ? Number(customFiber) : undefined
    if (!customName.trim() || [calories, proteinG, carbsG, fatG].some((value) => !Number.isFinite(value) || value < 0) || (fiberG !== undefined && (!Number.isFinite(fiberG) || fiberG < 0))) {
      setSourceError('Completa nombre y macros por 100g con números válidos.')
      return
    }
    void runSourceAction('custom', {
      action: 'createUserNutritionFood',
      canonicalName: customName.trim(),
      category: customCategory.trim() || 'custom',
      aliases: splitList(customAliases),
      per100g: { calories, proteinG, carbsG, fatG, fiberG },
      householdUnits: [],
    }, `Creé ${customName.trim()} como alimento determinístico local.`)
  }

  return (
    <section className="settings-panel nutrition-source-panel">
      <div>
        <h3>Biblioteca nutricional</h3>
        <p>Ingredientes, productos importados y alimentos propios para calcular macros del menú.</p>
      </div>
      <details>
        <summary>Importar producto por código de barras</summary>
        <div className="source-form">
          <label>Código Open Food Facts<input value={barcode} inputMode="numeric" placeholder="3017620422003" onChange={(event) => setBarcode(event.target.value)} /></label>
          <button className="secondary" disabled={sourceBusy !== null || !/^\d{6,14}$/.test(barcode)} onClick={() => runSourceAction('off', { action: 'importOpenFoodFactsProduct', barcode }, 'Producto importado desde Open Food Facts.')}>
            <Save size={16} /> {sourceBusy === 'off' ? 'Importando...' : 'Importar producto'}
          </button>
        </div>
      </details>
      <details>
        <summary>Importar base USDA descargada</summary>
        <div className="source-form">
          <label>Ruta o URL ZIP/JSON<input value={usdaPath} placeholder="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip" onChange={(event) => setUsdaPath(event.target.value)} /></label>
          <div className="source-grid">
            <label>FDC IDs opcionales<input value={usdaFdcIds} placeholder="321358, 170379" onChange={(event) => setUsdaFdcIds(event.target.value)} /></label>
            <label>Límite opcional<input value={usdaLimit} inputMode="numeric" placeholder="1000" onChange={(event) => setUsdaLimit(event.target.value)} /></label>
          </div>
          <button className="secondary" disabled={sourceBusy !== null || !usdaPath.trim()} onClick={() => runSourceAction('usda', {
            action: 'importUsdaFoodDataCentralDownload',
            path: usdaPath.trim(),
            fdcIds: parsePositiveIntegers(usdaFdcIds),
            limit: usdaLimit.trim() ? Number(usdaLimit) : undefined,
          }, 'Dataset USDA importado en las tablas fuente.')}>
            <Save size={16} /> {sourceBusy === 'usda' ? 'Importando...' : 'Importar USDA'}
          </button>
        </div>
      </details>
      <details>
        <summary>Crear alimento local por 100g</summary>
        <div className="source-form">
          <label>Nombre<input value={customName} placeholder="queso fresco batido" onChange={(event) => setCustomName(event.target.value)} /></label>
          <div className="source-grid">
            <label>Categoría<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} /></label>
            <label>Alias<input value={customAliases} placeholder="skyr, yogur alto en proteína" onChange={(event) => setCustomAliases(event.target.value)} /></label>
          </div>
          <div className="source-grid macros">
            <label>kcal<input value={customCalories} inputMode="decimal" onChange={(event) => setCustomCalories(event.target.value)} /></label>
            <label>Proteína<input value={customProtein} inputMode="decimal" onChange={(event) => setCustomProtein(event.target.value)} /></label>
            <label>Carbos<input value={customCarbs} inputMode="decimal" onChange={(event) => setCustomCarbs(event.target.value)} /></label>
            <label>Grasa<input value={customFat} inputMode="decimal" onChange={(event) => setCustomFat(event.target.value)} /></label>
            <label>Fibra<input value={customFiber} inputMode="decimal" onChange={(event) => setCustomFiber(event.target.value)} /></label>
          </div>
          <button className="secondary" disabled={sourceBusy !== null || !customName.trim()} onClick={createCustomFood}>
            <Save size={16} /> {sourceBusy === 'custom' ? 'Guardando...' : 'Crear alimento'}
          </button>
        </div>
      </details>
      {sourceMessage && <p className="source-message">{sourceMessage}</p>}
      {sourceError && <p className="form-error">{sourceError}</p>}
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function parsePositiveIntegers(value: string): number[] {
  return splitList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))
}

function confidenceExplanation(confidence: string): string {
  if (confidence === 'exact') return 'cantidad verificada'
  if (confidence === 'barcode') return 'producto importado'
  if (confidence === 'database') return 'alimento verificado'
  if (confidence === 'generic') return 'porción aproximada'
  if (confidence === 'estimated') return 'estimación revisable'
  if (confidence === 'unknown') return 'pendiente de revisar'
  return confidence
}

function displayProfileName(name: string): string {
  const normalized = name.trim().toLowerCase()
  if (!normalized || normalized === 'yo') return 'Usuario'
  if (normalized.startsWith('benchmark') || normalized.startsWith('walkthrough')) return 'Usuario'
  return name
}

function preferenceText(values: string[], fallback: string[]): string {
  return (values.length > 0 ? values : fallback).map(displayFoodText).join(', ')
}

function displayFoodText(value: string): string {
  return value
    .replace(/\bgreek yogurt\b/gi, 'yogur griego')
    .replace(/\byogurt\b/gi, 'yogur')
    .replace(/\boats\b/gi, 'avena')
    .replace(/\bberries\b/gi, 'frutos rojos')
    .replace(/\balmonds\b/gi, 'almendras')
    .replace(/\bbanana\b/gi, 'plátano')
    .replace(/\bapple\b/gi, 'manzana')
    .replace(/\bpeanut butter\b/gi, 'crema de cacahuete')
    .replace(/\bwhole wheat bread\b/gi, 'pan integral')
    .replace(/\bcottage cheese\b/gi, 'requesón')
    .replace(/\bmilk\b/gi, 'leche')
    .replace(/\bcooked rice\b/gi, 'arroz cocido')
    .replace(/\bcooked quinoa\b/gi, 'quinoa cocida')
    .replace(/\bbroccoli\b/gi, 'brócoli')
    .replace(/\bspinach\b/gi, 'espinacas')
    .replace(/\bcarrot\b/gi, 'zanahoria')
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(value))
}

function roundOne(value: number): string {
  return Number(value).toFixed(1).replace(/\.0$/, '')
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

function jobActivityText(job: GenerationJob): string {
  if (job.status === 'running') return 'actualizando menú'
  if (job.status === 'queued') return 'pendiente'
  if (job.status === 'completed') return 'listo'
  if (job.status === 'cancelled') return 'cancelado'
  return job.logs.length > 0 ? `${job.logs.length} paso(s)` : 'sin cambios'
}

function jobKindLabel(kind: string): string {
  if (kind === 'initial_generation') return 'Primera semana'
  if (kind === 'recipe_detail_enrichment') return 'Detalles de recetas'
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

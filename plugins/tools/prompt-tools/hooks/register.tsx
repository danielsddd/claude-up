import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Facts, LastPlan, Run, Slot } from '../types'

// ---------- Prompt Master: rewrite the rough prompt in the message box with Sonnet, never send it ----------

// Haiku gave flat rewrites in testing; Sonnet took ~4.5 s and ~700 tokens a click.
const MODEL = 'sonnet'

// The reply's token cap, scaled to the draft: about 3x its length, with a floor
// so a short draft has room to gain structure. ~2 chars a token is a safe
// guess for both English and Hebrew (Hebrew takes more tokens per character).
// A reply that reaches the cap was cut off, so it never replaces the draft.
export function replyCap(rough: string): number {
  return Math.min(8000, Math.max(600, Math.ceil(rough.length / 2) * 3))
}

// Enough time to write a reply of `cap` tokens; never under 45 s.
export function rewriteTimeout(cap: number): number {
  return Math.max(45_000, cap * 15)
}

// Change the tag when the stored value's meaning changes: it declines what an
// earlier version stored, which outlives a reload.
const isBusy = atom({ plugin: 'prompt-tools', key: 'isBusy' } as const, false, {
  shape: 'pm-4',
})

// Keeps the developer's intent and every point; two lines only guard against damage.
const REWRITE_RULES = `Rewrite the developer's rough prompt into a clear, specific prompt for an AI coding assistant (Claude Code). Only rewrite it: never answer it or do the task.
Keep their intent and their language. Do not invent requirements, files or facts they did not give.
Rewrite freely: rephrase, reorder, restructure, merge repeats and drop filler and chatter. The one limit is meaning: every idea, decision, requested action, requirement and piece of reasoning in the draft must still be there, so nothing the developer asked for is lost by mistake.
Copy code names, file paths, commands and error text exactly.
Make the goal, the context and scope, the constraints and what "done" looks like explicit where the rough prompt implies them. Fix spelling and grammar. Be concise: no filler, no role-play preamble.
Write it in the first person, as the developer speaking to the assistant.
Reply with the final prompt only: no introduction, no quotes, no code fences.`

function stripFences(text: string): string {
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text.trim())
  return (fenced?.[1] ?? text).trim()
}

export async function rewrite($: EngineInterface): Promise<void> {
  if (await read($, isBusy)) return
  const rough = (await $.prompt.read()).text.trim()
  if (rough === '') {
    $.ui.toast('Empty prompt')
    return
  }

  await update($, isBusy, () => true)
  try {
    const maxTokens = replyCap(rough)
    const r = await $.model.complete({
      model: MODEL,
      system: REWRITE_RULES,
      prompt: `Rough prompt:\n"""\n${rough}\n"""`,
      maxTokens,
      effort: 'low',
      timeoutMs: rewriteTimeout(maxTokens),
    })
    if (!r.isAnswered) {
      $.ui.toast(`Prompt Master: the model did not answer (${r.reason}).`)
      return
    }
    if (r.usage.output_tokens >= maxTokens) {
      $.ui.toast('Prompt Master: the rewrite hit its length limit, so your draft was left as is.')
      return
    }
    const better = stripFences(r.text)
    if (better === '') {
      $.ui.toast('Prompt Master: the rewrite came back empty.')
      return
    }
    // The person may have kept typing while the model ran: don't overwrite that.
    if ((await $.prompt.read()).text.trim() !== rough) {
      $.ui.toast('Prompt Master: the draft changed meanwhile, so it was left as is.')
      return
    }
    const filled = await $.prompt.fill({ text: better, mode: 'replace' })
    if (!filled.isFilled) $.ui.toast('Prompt Master: could not write to the prompt box.')
  } catch (err) {
    $.ui.toast(`Prompt Master failed: ${String(err)}`)
  } finally {
    await update($, isBusy, () => false)
  }
}

// ---------- Critique Plan: five free models critique the plan, a web search checks its facts, Sonnet merges ----------

// The app ends a mod's web request after 30 s, so the requests run in a hidden
// background helper (worker/critique.ps1) that streams every reply at once and
// falls back to the next model of a slot on a rate limit, an error or silence.
// The models, their fallbacks and focus come from config/lineup.json.
const STALL_SEC = 180
const HARD_SEC = 900
const POLL_MS = 2000
// How long past HARD_SEC the mod waits for a helper that stopped reporting.
const POLL_GRACE_MS = 120_000
const LAUNCH_TIMEOUT_MS = 20_000
const MERGE_TIMEOUT_MS = 240_000

// A plan shorter than this is not worth five critics.
export const MIN_PLAN = 400
const PLAN_CAP = 60_000
const CRITIQUE_CAP = 20_000
const FACTS_CAP = 20_000
const BRIEF_CAP = 30_000

const CRITIQUE_RULES = `You are reviewing an implementation plan written by an AI coding assistant before any code is written. Critique it; do not rewrite it or carry it out.
List the real problems, most important first. For each: the plan step (quote its words), why it matters and the fix, in two or three lines.
Then, only if they exist: a simpler or more robust alternative, and missing verification (tests, checks, rollback).
Be specific and terse. Skip praise and generic advice. Do not invent facts about a codebase you cannot see.`

const MERGE_RULES = `You merge independent critiques of one implementation plan into a single revision brief for the AI coding assistant that wrote the plan. The critics are other AI models and can be wrong.
Use these Markdown headings in this order, and leave out a heading with nothing under it:
## Must fix
Problems that would break the work, lose data, leak secrets or fail in practice. One bullet each: the plan step, the problem, the fix, and which critics raised it.
## Worth considering
Real but smaller improvements, one line each.
## Fact check
Only when search results are given. One line per claim: ✓ when the sources support it, ✗ when they contradict it (say what is true), ? when they do not settle it; then the source URL. Judge only from the given results, never from memory.
## Reviewers disagreed
Where critics contradict each other: both views in one line, then your judgement.
## Changes to make
A short numbered list of the concrete plan changes, most important first.
State each point once. Drop advice that would not change the plan. Treat claims about versions, APIs and limits as unverified unless the fact check supports them. Do not rewrite the plan. Address the assistant directly, in English, as plain Markdown.`

// The fixed first sentence of every brief, so Claude weighs each suggestion
// instead of applying all of them.
export const BRIEF_INTRO =
  'Here is my critique of your plan. It is not absolute and some suggestions may be wrong: read each one and check it yourself before deciding whether to revise.'

export type Candidate = { name: string; keyEnv: string; model: string; params: Record<string, unknown>; planCap: number; maxSec?: number }
export type Lineup = {
  slots: { id: string; focus: string; candidates: Candidate[] }[]
  factCheck: { maxClaims: number; searchDepth: string; resultsPerClaim: number; extractors: Candidate[] }
  endpoints: Record<string, string>
}
export type Settings = { factCheck: boolean; research: 'off' | 'mini' | 'pro' }

export function settingsOf(options: Record<string, unknown>): Settings {
  const research = String(options.research ?? 'off').toLowerCase()
  return {
    factCheck: options.factCheck !== false,
    research: research === 'mini' || research === 'pro' ? research : 'off',
  }
}

const FACTS_OFF: Facts = { status: 'off', note: '', text: '' }
const IDLE: Run = {
  phase: 'idle',
  rowId: '',
  planLabel: '',
  planText: '',
  slots: [],
  facts: FACTS_OFF,
  brief: '',
  error: '',
  pendingFill: false,
  isFilled: false,
}

// Change the tag when Run's meaning changes: it declines what an earlier
// version stored, which outlives a reload.
const run = atom({ plugin: 'prompt-tools', key: 'run' } as const, IDLE, { shape: 'pcm-6' })
const lastPlan = atom({ plugin: 'prompt-tools', key: 'lastPlan' } as const, { path: '', label: '', text: '' } as LastPlan, {
  shape: 'plan-1',
})

// Bumped on every start and cancel, so a late reply from an older run is dropped.
let generation = 0
// The running helper's cancel file, written by Cancel so the helper stops too.
let activeCancel = ''

// ---------- pure helpers (exported for tests) ----------

export function cap(text: string, max: number, what: string): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[${what} cut at ${max} characters]`
}

export function isPlanPath(path: string): boolean {
  return /\/\.claude\/plans\/[^/]+\.md$/i.test(path.replace(/\\/g, '/'))
}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

// A PowerShell single-quoted string literal.
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

// Starts the helper as its own hidden process and returns at once, so no wait
// of the mod's runs longer than the launch itself.
export function launchArgv(script: string, job: string): string[] {
  const args = `-NoProfile -ExecutionPolicy Bypass -File "${script}" -Job "${job}"`
  return [
    'powershell.exe',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList ${psQuote(args)}`,
  ]
}

export type SlotStatus = {
  phase: string
  model: string
  tried: string[]
  chars: number
  reasoning: number
  error: string
  seconds: number
  // Usage after the answer: this run's tokens, the provider's daily request limit and
  // what is left (Groq only; 0 and -1 elsewhere), and the local counts per model.
  tokens?: number
  dayLimit?: number
  dayLeft?: number
  todayRequests?: number
  totalTokens?: number
}

// 950, 4.2k, 38k, 1.2M.
export function tokenCount(n: number): string {
  const trim = (x: number, d: number) => x.toFixed(d).replace(/\.0$/, '')
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${trim(n / 1000, n < 10_000 ? 1 : 0)}k`
  return `${trim(n / 1_000_000, 1)}M`
}

// Minimal usage text: "2/1000 daily requests | 4.2k/38k tokens".
export function usageNote(s: SlotStatus): string {
  const parts: string[] = []
  const limit = s.dayLimit ?? 0
  const left = s.dayLeft ?? -1
  // Groq's 'remaining' refills through the day, so limit minus remaining undercounts:
  // count today's requests locally and take only the limit from the provider.
  const today = Math.max(s.todayRequests ?? 0, limit > 0 && left >= 0 ? limit - left : 0)
  if (limit > 0) parts.push(`${today}/${limit} daily requests`)
  else if (today > 0) parts.push(`${today} daily requests`)
  const run = s.tokens ?? 0
  const total = Math.max(s.totalTokens ?? 0, run)
  if (run > 0) parts.push(`${tokenCount(run)}/${tokenCount(total)} tokens`)
  return parts.join(' | ')
}
export type FactsStatus = { phase: string; claims: number; searched: number; note: string; seconds: number }
export type FactsOut = {
  claims: { claim: string; quote?: string; sources?: { title: string; url: string; snippet: string }[]; error?: string }[]
  research?: string
  note?: string
}

// A running critic's status for the right-hand column: "thinking 56s".
export function progressNote(s: SlotStatus): string {
  const phase = s.phase === 'thinking' || s.phase === 'writing' ? s.phase : 'waiting'
  return `${phase} ${s.seconds}s`
}

// What a running critic has produced so far, for the left column.
export function progressDetail(s: SlotStatus): string {
  const parts: string[] = []
  if (s.phase === 'writing' && s.chars > 0) parts.push(`${s.chars.toLocaleString('en-US')} chars`)
  if (s.tried.length > 0) parts.push(`after ${s.tried.length} fallback${s.tried.length === 1 ? '' : 's'}`)
  return parts.join(', ')
}

export function factsNote(s: FactsStatus): string {
  if (s.phase === 'extracting') return 'finding the claims to check'
  if (s.phase === 'searching') return `searching ${s.searched}/${s.claims} claims`
  if (s.phase === 'researching') return 'deep research'
  return s.note
}

// The search evidence as the merge reads it.
export function factsText(out: FactsOut): string {
  const parts = out.claims.map((c, i) => {
    const head = `Claim ${i + 1}: ${c.claim}${c.quote ? ` (plan: "${c.quote}")` : ''}`
    if (c.error) return `${head}\n- search failed: ${c.error}`
    const src = (c.sources ?? []).map(s => `- ${s.title} <${s.url}>: ${s.snippet}`)
    return [head, ...(src.length > 0 ? src : ['- no results'])].join('\n')
  })
  if (out.research) parts.push(`Deep research report:\n${out.research}`)
  return cap(parts.join('\n\n'), FACTS_CAP, 'search results')
}

export type JobFiles = { slots: Record<string, { status: string; out: string }>; facts: { status: string; out: string } | null }

// The helper's job: every slot with its fallbacks, and the fact check when asked.
export function buildJob(
  lineup: Lineup,
  slotIds: readonly string[],
  withFacts: boolean,
  settings: Settings,
  base: string,
  stateFile: string,
): { job: Record<string, unknown>; files: JobFiles } {
  const withUrl = (c: Candidate) => ({ ...c, url: lineup.endpoints[c.keyEnv] ?? '' })
  const files: JobFiles = { slots: {}, facts: null }
  const slots = lineup.slots
    .filter(s => slotIds.includes(s.id))
    .map(s => {
      const f = { status: `${base}-${s.id}.status.json`, out: `${base}-${s.id}.out.txt` }
      files.slots[s.id] = f
      return { id: s.id, focus: s.focus, statusFile: f.status, outFile: f.out, candidates: s.candidates.map(withUrl) }
    })
  let facts: Record<string, unknown> | null = null
  if (withFacts) {
    // Its own prefix: a slot id (such as 'facts') must never share the fact check's files.
    files.facts = { status: `${base}-factcheck.status.json`, out: `${base}-factcheck.out.json` }
    const f = lineup.factCheck
    facts = {
      maxClaims: f.maxClaims,
      searchDepth: f.searchDepth,
      resultsPerClaim: f.resultsPerClaim,
      research: settings.research,
      extractors: f.extractors.map(withUrl),
      statusFile: files.facts.status,
      outFile: files.facts.out,
    }
  }
  const job = {
    stallSec: STALL_SEC,
    hardSec: HARD_SEC,
    cancelFile: `${base}-cancel`,
    doneFile: `${base}-done`,
    stateFile,
    planFile: `${base}-plan.md`,
    system: CRITIQUE_RULES,
    slots,
    facts,
  }
  return { job, files }
}

// What goes into the prompt box: the fixed intro, then the merged brief, or the
// raw critiques when the merge failed.
export function briefOf(r: Run): string {
  if (r.brief !== '') return `${BRIEF_INTRO}\n\n${r.brief}`
  const raw = r.slots
    .filter(s => s.status === 'done')
    .map(s => `## Critique from ${s.name}\n${s.text}`)
    .join('\n\n')
  return raw === '' ? '' : cap(`${BRIEF_INTRO}\n\n${raw}`, BRIEF_CAP, 'critiques')
}

function setSlot(r: Run, id: string, c: Partial<Slot>): Run {
  return { ...r, slots: r.slots.map(s => (s.id === id ? { ...s, ...c } : s)) }
}

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    // The helper writes UTF-8, which PowerShell 5.1 prefixes with a BOM.
    return JSON.parse(raw.replace(/^﻿/, '')) as T
  } catch {
    return null
  }
}

// ---------- flow ----------

type Found = { label: string; text: string }

// The exact plan of this session: the plan file Claude last wrote or edited, or
// the plan it last proposed. Never a guess from other files or the prompt box.
async function sessionPlan($: EngineInterface): Promise<Found | null> {
  const p = await read($, lastPlan)
  if (p.path !== '') {
    const text = await $.fs.read(p.path).catch(() => '')
    if (typeof text === 'string' && text.trim() !== '') return { label: baseName(p.path), text }
  }
  if (p.text.trim() !== '') return { label: p.label || 'proposed plan', text: p.text }
  return null
}

async function loadLineup($: EngineInterface): Promise<Lineup> {
  const raw = await $.fs.read(`${$.plugin.root}/config/lineup.json`)
  const lineup = parse<Lineup>(raw)
  if (lineup === null || !Array.isArray(lineup.slots) || lineup.slots.length === 0) throw new Error('config/lineup.json is missing or broken')
  return lineup
}

async function start($: EngineInterface, settings: Settings, rowId: string): Promise<void> {
  const current = await read($, run)
  if (current.phase === 'critiquing' || current.phase === 'merging') return
  const plan = await sessionPlan($)
  if (plan === null) {
    $.ui.toast('No plan in this session yet: Critique Plan reads the plan Claude wrote in plan mode.')
    return
  }
  if (plan.text.trim().length < MIN_PLAN) {
    $.ui.toast(`Plan too short to critique (under ${MIN_PLAN} characters).`)
    return
  }
  let lineup: Lineup
  try {
    lineup = await loadLineup($)
  } catch (err) {
    $.ui.toast(`Critique Plan: ${String(err).replace(/^Error: /, '')}`)
    return
  }
  generation += 1
  const gen = generation
  await update($, run, (): Run => ({
    ...IDLE,
    rowId,
    planLabel: plan.label,
    planText: plan.text,
    slots: lineup.slots.map(s => ({ id: s.id, name: s.candidates[0]?.name ?? s.id, status: 'running', note: 'starting', error: '', text: '', usage: '' })),
    facts: settings.factCheck ? { status: 'running', note: '', text: '' } : FACTS_OFF,
  }))
  await launch($, lineup, settings, lineup.slots.map(s => s.id), settings.factCheck, gen)
}

async function failAll($: EngineInterface, ids: readonly string[], withFacts: boolean, why: string): Promise<void> {
  await update($, run, r => {
    let next = r
    for (const id of ids) next = setSlot(next, id, { status: 'failed', error: why, note: '' })
    if (withFacts) next = { ...next, facts: { status: 'failed', note: why, text: '' } }
    return next
  })
}

async function launch($: EngineInterface, lineup: Lineup, settings: Settings, ids: readonly string[], withFacts: boolean, gen: number): Promise<void> {
  await update($, run, (r): Run => ({ ...r, phase: 'critiquing', error: '', brief: '', isFilled: false }))
  $.ui.status('Critique Plan: asking the critics')
  try {
    if (!(await $.env.get('windir'))) throw new Error('the critique helper needs Windows PowerShell')
    const temp = (await $.env.get('TEMP')) ?? (await $.env.get('TMP'))
    if (!temp) throw new Error('no TEMP folder to hand the plan to the helper')
    const local = (await $.env.get('LOCALAPPDATA')) ?? temp
    const win = (p: string) => p.replace(/\//g, '\\')
    const base = `${win(temp)}\\prompt-tools-${await $.clock.now()}`
    const { job, files } = buildJob(lineup, ids, withFacts, settings, base, `${win(local)}\\prompt-tools\\providers.json`)
    await $.fs.write(String(job.planFile), cap((await read($, run)).planText, PLAN_CAP, 'plan'))
    const jobFile = `${base}-job.json`
    await $.fs.write(jobFile, JSON.stringify(job))
    activeCancel = String(job.cancelFile)
    const script = `${win($.plugin.root)}\\worker\\critique.ps1`
    const ran = await $.process.run(launchArgv(script, jobFile), { timeoutMs: LAUNCH_TIMEOUT_MS })
    if (ran.exitCode !== 0) throw new Error(`could not start the helper (${ran.stderr.trim().slice(0, 200) || `exit ${ran.exitCode}`})`)
    const deadline = (await $.clock.now()) + HARD_SEC * 1000 + POLL_GRACE_MS
    $.clock.after(POLL_MS, () => void poll($, gen, files, deadline))
  } catch (err) {
    if (gen !== generation) return
    activeCancel = ''
    await failAll($, ids, withFacts, String(err).replace(/^Error: /, '').slice(0, 300))
    await merge($, gen)
  }
}

// One look at the helper's progress files; schedules the next look until every
// critic and the fact check have finished, then merges.
async function poll($: EngineInterface, gen: number, files: JobFiles, deadline: number): Promise<void> {
  if (gen !== generation) return
  const before = await read($, run)
  let open = 0
  for (const [id, f] of Object.entries(files.slots)) {
    if (before.slots.find(s => s.id === id)?.status !== 'running') continue
    const s = parse<SlotStatus>(await $.fs.read(f.status).catch(() => ''))
    if (s?.phase === 'done') {
      const out = await $.fs.read(f.out).catch(() => '')
      const answer = typeof out === 'string' ? out.trim() : ''
      if (gen !== generation) return
      await update($, run, r =>
        answer === ''
          ? setSlot(r, id, { status: 'failed', error: 'empty reply', note: '' })
          : setSlot(r, id, { status: 'done', name: s.model || id, text: cap(answer, CRITIQUE_CAP, 'critique'), note: `${s.seconds}s`, usage: usageNote(s) }),
      )
    } else if (s?.phase === 'failed') {
      if (gen !== generation) return
      const tried = s.tried.length > 0 ? ` (tried ${s.tried.join(', ')})` : ''
      await update($, run, r => setSlot(r, id, { status: 'failed', error: `${s.error || 'failed'}${tried}`, note: '' }))
    } else {
      open += 1
      if (gen !== generation) return
      await update($, run, r => setSlot(r, id, { note: s ? progressNote(s) : 'starting', usage: s ? progressDetail(s) : '', ...(s?.model ? { name: s.model } : {}) }))
    }
  }
  if (files.facts && before.facts.status === 'running') {
    const s = parse<FactsStatus>(await $.fs.read(files.facts.status).catch(() => ''))
    if (s && ['done', 'skipped', 'failed'].includes(s.phase)) {
      const out = parse<FactsOut>(await $.fs.read(files.facts.out).catch(() => ''))
      const text = out && out.claims.length + (out.research ? 1 : 0) > 0 ? factsText(out) : ''
      const n = out?.claims.length ?? 0
      const note = [n > 0 ? `${n} claim${n === 1 ? '' : 's'} searched` : '', out?.note || s.note].filter(Boolean).join('; ')
      if (gen !== generation) return
      await update($, run, (r): Run => ({ ...r, facts: { status: s.phase === 'failed' ? 'failed' : 'done', note: note || 'nothing to check', text } }))
    } else {
      open += 1
      if (gen !== generation) return
      await update($, run, (r): Run => ({ ...r, facts: { ...r.facts, note: s ? factsNote(s) : '' } }))
    }
  }
  if (gen !== generation) return
  if (open === 0) {
    activeCancel = ''
    await merge($, gen)
    return
  }
  if ((await $.clock.now()) > deadline) {
    await update($, run, r => {
      let next = r
      for (const s of next.slots) if (s.status === 'running') next = setSlot(next, s.id, { status: 'failed', error: 'the helper stopped reporting', note: '' })
      if (next.facts.status === 'running') next = { ...next, facts: { status: 'failed', note: 'the helper stopped reporting', text: '' } }
      return next
    })
    activeCancel = ''
    await merge($, gen)
    return
  }
  $.clock.after(POLL_MS, () => void poll($, gen, files, deadline))
}

async function merge($: EngineInterface, gen: number): Promise<void> {
  const r = await read($, run)
  const done = r.slots.filter(s => s.status === 'done')
  if (done.length === 0) {
    $.ui.status(undefined)
    await update($, run, (x): Run => ({ ...x, phase: 'review', brief: '', error: 'No critic answered, so there is nothing to merge.' }))
    return
  }

  await update($, run, (x): Run => ({ ...x, phase: 'merging', error: '' }))
  $.ui.status(`Critique Plan: merging ${done.length} critique${done.length === 1 ? '' : 's'} with Sonnet`)
  const prompt = done
    .map(s => `## Critique from ${s.name}\n${s.text}`)
    .concat(r.facts.text !== '' ? [`## Web search results for the plan's claims\n${r.facts.text}`] : [])
    .concat(`## The plan (for reference)\n${cap(r.planText, PLAN_CAP, 'plan')}`)
    .join('\n\n')

  try {
    const answer = await $.model.complete({ model: 'sonnet', system: MERGE_RULES, prompt, maxTokens: 6000, timeoutMs: MERGE_TIMEOUT_MS })
    if (gen !== generation) return
    await update($, run, (x): Run =>
      answer.isAnswered
        ? { ...x, phase: 'review', brief: cap(answer.text.trim(), BRIEF_CAP, 'brief') }
        : { ...x, phase: 'review', brief: '', error: `Sonnet did not merge (${answer.reason}); the raw critiques are used instead.` },
    )
    await autoFill($)
  } catch (err) {
    if (gen !== generation) return
    await update($, run, (x): Run => ({ ...x, phase: 'review', brief: '', error: `Sonnet merge failed (${String(err).slice(0, 160)}); the raw critiques are used instead.` }))
    await autoFill($)
  } finally {
    if (gen === generation) $.ui.status(undefined)
  }
}

// The brief goes straight into the message box (never sent), unless the person
// has typed something there: then Use in prompt does it on request. While the
// plan card is open the box is hidden and a fill fails; the brief then waits
// and goes in once the band above the box draws again.
async function autoFill($: EngineInterface): Promise<void> {
  const text = briefOf(await read($, run))
  if (text === '') return
  if ((await $.prompt.read()).text.trim() !== '') {
    $.ui.toast('Critique ready. Your message box has text, so press Use in prompt to replace it.')
    return
  }
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (!filled.isFilled) {
    await update($, run, r => ({ ...r, pendingFill: true }))
    return
  }
  await update($, run, r => ({ ...r, isFilled: true, pendingFill: false }))
  $.ui.toast('The critique is in your message box: review it, then send it yourself.')
}

// At most one pending-fill attempt every few seconds, so a box that stays
// unwritable can't turn redraws into a busy loop.
const PENDING_RETRY_MS = 3000
let lastPendingTry = 0

async function flushPending($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - lastPendingTry < PENDING_RETRY_MS) return
  lastPendingTry = now
  const r = await read($, run)
  if (!r.pendingFill) return
  await update($, run, x => ({ ...x, pendingFill: false }))
  await autoFill($)
}

async function retryFailed($: EngineInterface, settings: Settings): Promise<void> {
  const r = await read($, run)
  const ids = r.slots.filter(s => s.status === 'failed').map(s => s.id)
  const facts = r.facts.status === 'failed'
  if (ids.length === 0 && !facts) return
  let lineup: Lineup
  try {
    lineup = await loadLineup($)
  } catch (err) {
    $.ui.toast(`Critique Plan: ${String(err).replace(/^Error: /, '')}`)
    return
  }
  generation += 1
  const gen = generation
  await update($, run, x => {
    let next: Run = x
    for (const id of ids) next = setSlot(next, id, { status: 'running', note: 'starting', error: '', usage: '' })
    if (facts) next = { ...next, facts: { status: 'running', note: '', text: '' } }
    return next
  })
  await launch($, lineup, settings, ids, facts, gen)
}

// The slow reasoning models can take minutes: once enough critics answered,
// the person may merge now. The rest stop and can run again with Retry failed.
export const MERGE_NOW_AT = 2

async function mergeNow($: EngineInterface): Promise<void> {
  generation += 1
  const gen = generation
  if (activeCancel !== '') {
    const file = activeCancel
    activeCancel = ''
    await $.fs.write(file, 'cancel').catch(() => undefined)
  }
  await update($, run, r => {
    let next = r
    for (const s of next.slots) if (s.status === 'running') next = setSlot(next, s.id, { status: 'failed', error: 'stopped to merge early', note: '' })
    if (next.facts.status === 'running') next = { ...next, facts: { status: 'failed', note: 'stopped to merge early', text: '' } }
    return next
  })
  await merge($, gen)
}

async function cancel($: EngineInterface): Promise<void> {
  generation += 1
  if (activeCancel !== '') {
    const file = activeCancel
    activeCancel = ''
    await $.fs.write(file, 'cancel').catch(() => undefined)
  }
  $.ui.status(undefined)
  await update($, run, (): Run => IDLE)
}

async function useInPrompt($: EngineInterface): Promise<void> {
  const text = briefOf(await read($, run))
  if (text === '') {
    $.ui.toast('Nothing to put in the message box yet.')
    return
  }
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (!filled.isFilled) {
    await update($, run, r => ({ ...r, pendingFill: true }))
    $.ui.toast('The plan card hides the message box: the critique goes in as soon as you choose an answer there.')
    return
  }
  await update($, run, r => ({ ...r, isFilled: true, pendingFill: false }))
  $.ui.toast('The critique is in your message box: review it, then send it yourself.')
}

// Never lets a failed state write reach the tool call it rides on.
async function rememberFile($: EngineInterface, path: string): Promise<void> {
  if (!isPlanPath(path)) return
  await update($, lastPlan, (): LastPlan => ({ path, label: baseName(path), text: '' })).catch(() => undefined)
}

// The brief as the plan row shows it while the plan card is open (the card hides
// the band above the message box): the whole brief up to a generous cap.
export const ROW_BRIEF_LINES = 80

export function rowBrief(brief: string): string {
  const lines = brief.split('\n')
  if (lines.length <= ROW_BRIEF_LINES) return brief
  return `${lines.slice(0, ROW_BRIEF_LINES).join('\n')}\n… ${lines.length - ROW_BRIEF_LINES} more lines in the message box once you answer the plan card.`
}

type Tone = 'success' | 'error' | 'running'
export type Cells = { left: string; right: string; tone: Tone }

// A status row: the model and its details on the left, its state in a column on the right.
export function slotCells(s: Slot): Cells {
  const left = (detail: string) => (detail ? `${s.name} | ${detail}` : s.name)
  if (s.status === 'done') return { left: left(s.usage), right: `done ${s.note}`.trim(), tone: 'success' }
  if (s.status === 'failed') return { left: left(s.error), right: 'failed', tone: 'error' }
  return { left: left(s.usage), right: s.note || 'starting', tone: 'running' }
}

export function factsCells(f: Facts): Cells {
  const left = f.note ? `Fact check | ${f.note}` : 'Fact check'
  if (f.status === 'running') return { left, right: 'running', tone: 'running' }
  if (f.status === 'failed') return { left, right: 'failed', tone: 'error' }
  return { left, right: 'done', tone: 'success' }
}

type UI = ReturnType<EngineInterface['ui']['resolve']>

function statusRows(ui: UI, prefix: string, r: Run) {
  const { Box, Text } = ui
  const cells = [...r.slots.map(s => ({ key: s.id, ...slotCells(s) })), ...(r.facts.status !== 'off' ? [{ key: 'facts', ...factsCells(r.facts) }] : [])]
  return cells.map(c => (
    <Box key={`${prefix}-${c.key}`} flexDirection="row" justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">{c.left}</Text>
      </Box>
      <Text color={c.tone === 'running' ? undefined : c.tone} dimColor={c.tone === 'running'} bold={c.tone !== 'running'}>{c.right}</Text>
    </Box>
  ))
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    // A reload mid-rewrite or mid-critique drops that work, but its stored state
    // would outlive it and keep a button stuck: every session starts idle.
    await update($, isBusy, () => false)
    await update($, run, r => (r.phase === 'critiquing' || r.phase === 'merging' ? IDLE : r))
    await $.command.register({ name: 'critique-plan', description: "Critique this session's plan with five free models and a web fact check, merged by Sonnet" })
    return next(e)
  })

  on('command.run', { command: 'critique-plan' }, async $ => {
    $.clock.after(0, () => void start($, settings, ''))
    return { text: 'Critique Plan started: see the band above the message box.', isTextDisplayOnly: true }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await rememberFile($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await rememberFile($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))
  // The proposed plan, once answered: its saved file, or its text.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    const out = (ran.deny === undefined ? ran.result : undefined) as { plan?: unknown; filePath?: unknown } | undefined
    if (typeof out?.filePath === 'string' && out.filePath !== '') await rememberFile($, out.filePath)
    else if (typeof out?.plan === 'string' && out.plan.trim() !== '') {
      const text = out.plan
      await update($, lastPlan, (): LastPlan => ({ path: '', label: 'proposed plan', text })).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // While a proposed plan waits for approval, its card hides the band above the
  // prompt, so the button and progress also sit under that plan's own row. Only
  // the row a run started from shows its progress.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'ExitPlanMode' || e.props.isExpanded === true) return next(e)
    const row = await next(e)
    const r = await read($, run)
    const mine = r.phase !== 'idle' && r.rowId === e.props.tool_use_id
    if (!e.props.isRunning && !mine) return row
    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = r.phase === 'critiquing' || r.phase === 'merging'
    const id = e.props.tool_use_id
    return (
      <Box flexDirection="column">
        {row}
        {mine && statusRows($.ui.resolve(e), 'row', r)}
        {mine && r.phase === 'merging' && <Text key="row-merging">Merging with Sonnet</Text>}
        {mine && r.error !== '' && <Text key="row-error" color="error">{r.error}</Text>}
        {mine && r.phase === 'review' && briefOf(r) !== '' && <Text key="row-brief">{rowBrief(briefOf(r))}</Text>}
        {mine && r.phase === 'review' && !r.isFilled && briefOf(r) !== '' && (
          <Text key="row-next" dimColor>To revise, choose No, keep planning on the plan card: the critique then goes into your message box, ready to send.</Text>
        )}
        {mine && r.isFilled && <Text key="row-filled" dimColor>The critique is in your message box: review it, then send it.</Text>}
        <Box flexDirection="row" gap={1}>
          {!busy && e.props.isRunning && (
            <Button key="row-critique" label="Critique Plan" onPress={() => {
              $.clock.after(0, () => void start($, settings, id))
            }} />
          )}
          {mine && r.phase === 'critiquing' && r.slots.filter(s => s.status === 'done').length >= MERGE_NOW_AT && (
            <Button key="row-merge-now" label="Merge now" onPress={() => {
              $.clock.after(0, () => void mergeNow($))
            }} />
          )}
          {mine && busy && <Button key="row-cancel" label="Cancel" onPress={() => cancel($)} />}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const r = await read($, run)
    if (r.pendingFill) $.clock.after(0, () => void flushPending($))
    const busy = await read($, isBusy)
    const prompt = (
      <Button
        key="prompt"
        label={busy ? 'Rewriting…' : 'Prompt Master'}
        // Start the work on a timer so it runs outside the press's time budget.
        onPress={() => {
          $.clock.after(0, () => void rewrite($))
        }}
      />
    )

    // One mod draws both buttons, so they share a line: the app stacks each
    // mod's row, so two mods could never sit side by side.
    if (r.phase === 'idle') {
      return (
        <Box flexDirection="row" gap={1}>
          {prompt}
          <Button key="start" label="Critique Plan" onPress={() => {
            $.clock.after(0, () => void start($, settings, ''))
          }} />
        </Box>
      )
    }

    const header = <Text key="plan" bold>Critique Plan</Text>
    const lines = statusRows($.ui.resolve(e), 'slot', r)

    if (r.phase === 'critiquing' || r.phase === 'merging') {
      return (
        <Box flexDirection="column">
          {header}
          {lines}
          {r.phase === 'merging' && <Text key="merging">Merging with Sonnet</Text>}
          <Box flexDirection="row" gap={1}>
            {prompt}
            {r.phase === 'critiquing' && r.slots.filter(s => s.status === 'done').length >= MERGE_NOW_AT && (
              <Button key="merge-now" label="Merge now" onPress={() => {
                $.clock.after(0, () => void mergeNow($))
              }} />
            )}
            <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
          </Box>
        </Box>
      )
    }

    const room = Math.max(4, e.props.maxRows - 14)
    const brief = briefOf(r).split('\n')
    const hasBrief = brief.join('').trim() !== ''
    const hasFailed = r.slots.some(s => s.status === 'failed') || r.facts.status === 'failed'
    return (
      <Box flexDirection="column">
        {header}
        {lines}
        {r.error !== '' && <Text key="error" color="error">{r.error}</Text>}
        {hasBrief && <Text key="brief">{brief.slice(0, room).join('\n')}</Text>}
        {brief.length > room && <Text key="more" dimColor>{brief.length - room} more lines: Use in prompt puts the whole brief in the message box.</Text>}
        {r.isFilled && <Text key="filled" dimColor>In your message box: review it, then send it yourself.</Text>}
        <Box flexDirection="row" gap={1}>
          {prompt}
          {hasBrief && <Button key="use" label="Use in prompt" onPress={() => useInPrompt($)} />}
          {hasFailed && <Button key="retry" label="Retry failed" onPress={() => {
            $.clock.after(0, () => void retryFailed($, settings))
          }} />}
          <Button key="close" label="Close" onPress={() => cancel($)} />
        </Box>
      </Box>
    )
  })
}

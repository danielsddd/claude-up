import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Critique, Provider, Run } from '../types'

// Four free-tier critics, each at the highest thinking level its API accepts.
// Live checks (2026-11-23): NVIDIA's free tier answered only Nemotron 3 Ultra
// and Mistral Large 4 (Kimi K3/K3.1, DeepSeek V4, MiniMax, GLM and Nemotron
// Super gave 410 Gone or no response in 2 min); free Gemini was overloaded
// (HTTP 503) on every model in every test, so it was dropped.
const PROVIDERS: readonly Provider[] = ['nemotron', 'mistral', 'gptoss', 'qwen']
const LABEL: Record<Provider, string> = { nemotron: 'Nemotron', mistral: 'Mistral', gptoss: 'GPT-OSS', qwen: 'Qwen' }

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

// The app ends a mod's web request after 30 s, too short for a long plan, so the
// requests run in a background helper (worker/critique.ps1). It streams each
// reply and gives up on a critic only after STALL_SEC with no new output, or
// HARD_SEC in all; the mod reads its progress every POLL_MS.
const STALL_SEC = 180
const HARD_SEC = 1200
const POLL_MS = 2000
// How long past HARD_SEC the mod waits for a helper that stopped reporting.
const POLL_GRACE_MS = 120_000
const LAUNCH_TIMEOUT_MS = 20_000
const MERGE_TIMEOUT_MS = 180_000

// Size caps, all far under the engine's 131,072-character limit.
const PLAN_CAP = 60_000
// Groq's free tier allows ~8K tokens a minute, input and output together.
const GROQ_PLAN_CAP = 12_000
const CRITIQUE_CAP = 20_000
const MERGED_CAP = 30_000
const MIN_BOX_PLAN = 200

const CRITIQUE_RULES = `You are reviewing an implementation plan written by an AI coding assistant before any code is written. Critique it; do not rewrite it or carry it out.
Use this rubric, with a heading for each:
1. Flaws and edge cases: steps that are wrong, risky, missing, out of order, or that break existing behaviour.
2. Better alternatives: simpler or more robust approaches, with the trade-off in one line each.
3. Missing verification and constraints: tests, checks, limits, security, failure handling, rollback.
4. Concrete suggestions: specific, actionable changes to the plan, most important first.
Be specific and terse. Quote the plan's words when you point at a step. Say "none" under a heading with nothing real to add. Do not invent facts about the codebase you cannot see.`

const FOCUS: Record<Provider, string> = {
  nemotron: 'Focus on the plan as a whole: missing steps, wrong order, hidden dependencies, and what will break in practice.',
  mistral:
    'Check every library, API, version, model ID and limit the plan relies on against what you know; flag anything likely outdated or wrong, and say how sure you are.',
  gptoss: 'Focus on software engineering: architecture, correctness, data flow, error handling, and test strategy.',
  qwen: 'Give an independent second opinion; focus on what a careful senior engineer would push back on.',
}

const MERGE_RULES = `You merge four independent critiques of one implementation plan (from Nemotron, Mistral, GPT-OSS and Qwen) into a single revision brief for the AI coding assistant that wrote the plan.
- Deduplicate: state each point once, noting which reviewers raised it.
- Flag disagreements between reviewers explicitly, with your judgement on which is right and why.
- Treat claims about versions, APIs and limits as claims to verify, not facts.
- Drop vague or generic advice that does not change the plan.
- Rank the concrete plan changes by impact.
Write the brief addressed to the assistant ("Revise your plan: ..."), in English, as plain Markdown, ending with a short numbered list of the changes to make. Do not rewrite the plan yourself.`

type Options = { nemotronModel: string; mistralModel: string; groqModel: string; qwenModel: string }

const blank = (): Critique => ({ status: 'idle', text: '', error: '', note: '' })
const IDLE: Run = {
  phase: 'idle',
  planPath: null,
  planLabel: '',
  planText: '',
  critiques: { nemotron: blank(), mistral: blank(), gptoss: blank(), qwen: blank() },
  mergedText: '',
  revisedClaudeOption: '',
  error: '',
  pendingFill: false,
}

// Change the tag when Run's meaning changes: it declines what an earlier
// version stored, which outlives a reload.
const run = atom({ plugin: 'prompt-tools', key: 'run' } as const, IDLE, { shape: 'pcm-5' })

// Bumped on every start and cancel, so a late reply from an older run is dropped.
let generation = 0
// The running helper's cancel file, written by Cancel so the helper stops too.
let activeCancel = ''

// ---------- Prompt Master: rewrite the rough prompt in the message box with Sonnet, never send it ----------

// Haiku gave flat rewrites and free Gemini was overloaded (HTTP 503) on every
// try (2026-11-23); Sonnet took ~4.5 s and ~690 tokens a click.
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

// The instructions that gave the results the person liked, plus their rule to
// keep every point, and two lines that only guard against damage.
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

// ---------- pure helpers (exported for tests) ----------

export function cap(text: string, max: number, what: string): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[${what} cut at ${max} characters]`
}

export function isPlanPath(path: string): boolean {
  return /\/\.claude\/plans\/[^/]+\.md$/i.test(path.replace(/\\/g, '/'))
}

// What each critic's request is: the endpoint, the variable holding its key
// (read by the helper, never by the mod), and the model's own settings.
type CriticSpec = { url: string; keyEnv: string; body: Record<string, unknown>; planCap: number }

export function criticSpec(p: Provider, opts: Options): CriticSpec {
  switch (p) {
    case 'nemotron':
      return { url: NVIDIA_URL, keyEnv: 'NVIDIA_API_KEY', body: { model: opts.nemotronModel, reasoning_effort: 'max', max_tokens: 16384 }, planCap: PLAN_CAP }
    case 'mistral':
      // Mistral Large 4 reasons by default and answers 400 to a reasoning_effort field.
      return { url: NVIDIA_URL, keyEnv: 'NVIDIA_API_KEY', body: { model: opts.mistralModel, max_tokens: 16384 }, planCap: PLAN_CAP }
    case 'gptoss':
      return { url: GROQ_URL, keyEnv: 'GROQ_API_KEY', body: { model: opts.groqModel, reasoning_effort: 'high', max_completion_tokens: 8192 }, planCap: GROQ_PLAN_CAP }
    case 'qwen':
      return { url: GROQ_URL, keyEnv: 'GROQ_API_KEY', body: { model: opts.qwenModel, reasoning_effort: 'high', max_completion_tokens: 8192 }, planCap: GROQ_PLAN_CAP }
  }
}

function userText(plan: string): string {
  return `The plan to critique:\n\"\"\"\n${plan}\n\"\"\"`
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

export type HelperStatus = { phase: string; chars: number; reasoning: number; error: string; seconds: number }

// The progress line a row shows while its critic runs.
export function progressNote(s: HelperStatus): string {
  const t = `${s.seconds} s`
  if (s.phase === 'thinking') return `thinking… ${s.reasoning.toLocaleString('en-US')} chars, ${t}`
  if (s.phase === 'writing') return `writing… ${s.chars.toLocaleString('en-US')} chars, ${t}`
  return `waiting for a reply… ${t}`
}

// ---------- flow ----------

async function findPlan($: EngineInterface, recorded: string | null): Promise<{ path: string | null; label: string; text: string } | null> {
  if (recorded !== null) {
    const text = await $.fs.read(recorded).catch(() => '')
    if (typeof text === 'string' && text.trim() !== '') {
      return { path: recorded, label: recorded.replace(/\\/g, '/').split('/').pop() ?? recorded, text }
    }
  }
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home) {
    const dir = `${home.replace(/\\/g, '/')}/.claude/plans`
    const entries = await $.fs.list(dir).catch(() => [])
    const newest = entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.md'))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (newest) {
      const path = `${dir}/${newest.name}`
      const text = await $.fs.read(path).catch(() => '')
      if (typeof text === 'string' && text.trim() !== '') return { path, label: newest.name, text }
    }
  }
  const box = (await $.prompt.read()).text.trim()
  if (box.length >= MIN_BOX_PLAN) return { path: null, label: 'prompt box text', text: box }
  return null
}

function setCritique(r: Run, p: Provider, c: Partial<Critique>): Run {
  return { ...r, critiques: { ...r.critiques, [p]: { ...r.critiques[p], ...c } } }
}

type JobFiles = { status: string; out: string }

async function critique($: EngineInterface, which: readonly Provider[], opts: Options, gen: number): Promise<void> {
  const plan = (await read($, run)).planText
  await update($, run, r => {
    let next: Run = { ...r, phase: 'critiquing', error: '' }
    for (const p of which) next = setCritique(next, p, { status: 'querying', text: '', error: '', note: 'starting…' })
    return next
  })
  $.ui.status(`Plan Critique: querying ${which.map(p => LABEL[p]).join(', ')}…`)

  try {
    const temp = (await $.env.get('TEMP')) ?? (await $.env.get('TMP'))
    if (!temp) throw new Error('no TEMP folder to hand the plan to the helper')
    const base = `${temp.replace(/\//g, '\\')}\\prompt-tools-${await $.clock.now()}`
    const files = {} as Record<Provider, JobFiles>
    const critics: Record<string, string>[] = []
    for (const p of which) {
      const spec = criticSpec(p, opts)
      const body = {
        ...spec.body,
        stream: true,
        messages: [
          { role: 'system', content: `${CRITIQUE_RULES}\n${FOCUS[p]}` },
          { role: 'user', content: userText(cap(plan, spec.planCap, 'plan')) },
        ],
      }
      const bodyFile = `${base}-${p}.body.json`
      files[p] = { status: `${base}-${p}.status.json`, out: `${base}-${p}.out.txt` }
      await $.fs.write(bodyFile, JSON.stringify(body))
      critics.push({ id: p, url: spec.url, keyEnv: spec.keyEnv, bodyFile, statusFile: files[p].status, outFile: files[p].out })
    }
    const jobFile = `${base}-job.json`
    const cancelFile = `${base}-cancel`
    const doneFile = `${base}-done`
    await $.fs.write(jobFile, JSON.stringify({ stallSec: STALL_SEC, hardSec: HARD_SEC, cancelFile, doneFile, critics }))
    activeCancel = cancelFile
    const script = `${$.plugin.root.replace(/\//g, '\\')}\\worker\\critique.ps1`
    const ran = await $.process.run(launchArgv(script, jobFile), { timeoutMs: LAUNCH_TIMEOUT_MS })
    if (ran.exitCode !== 0) throw new Error(`could not start the helper (${ran.stderr.trim().slice(0, 200) || `exit ${ran.exitCode}`})`)
    const deadline = (await $.clock.now()) + HARD_SEC * 1000 + POLL_GRACE_MS
    $.clock.after(POLL_MS, () => void poll($, gen, which, files, deadline))
  } catch (err) {
    if (gen !== generation) return
    const why = String(err).replace(/^Error: /, '').slice(0, 300)
    await update($, run, r => {
      let next = r
      for (const p of which) next = setCritique(next, p, { status: 'failed', error: why, note: '' })
      return next
    })
    await merge($, gen)
  }
}

// One look at the helper's progress files; schedules the next look until every
// critic has finished or failed, then merges.
async function poll(
  $: EngineInterface,
  gen: number,
  which: readonly Provider[],
  files: Record<Provider, JobFiles>,
  deadline: number,
): Promise<void> {
  if (gen !== generation) return
  const before = await read($, run)
  let open = 0
  for (const p of which) {
    if (before.critiques[p].status !== 'querying') continue
    const raw = await $.fs.read(files[p].status).catch(() => '')
    let s: HelperStatus | null = null
    try {
      s = typeof raw === 'string' && raw !== '' ? (JSON.parse(raw) as HelperStatus) : null
    } catch {
      s = null
    }
    if (s?.phase === 'done') {
      const text = await $.fs.read(files[p].out).catch(() => '')
      const answer = typeof text === 'string' ? text.trim() : ''
      if (gen !== generation) return
      await update($, run, r =>
        answer === ''
          ? setCritique(r, p, { status: 'failed', error: 'empty reply', note: '' })
          : setCritique(r, p, { status: 'done', text: cap(answer, CRITIQUE_CAP, 'critique'), note: `${s?.seconds ?? 0} s` }),
      )
    } else if (s?.phase === 'failed') {
      if (gen !== generation) return
      await update($, run, r => setCritique(r, p, { status: 'failed', error: s?.error || 'failed', note: '' }))
    } else {
      open += 1
      const note = s ? progressNote(s) : 'starting…'
      if (gen !== generation) return
      await update($, run, r => setCritique(r, p, { note }))
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
      for (const p of which) {
        if (next.critiques[p].status === 'querying') next = setCritique(next, p, { status: 'failed', error: 'the helper stopped reporting', note: '' })
      }
      return next
    })
    activeCancel = ''
    await merge($, gen)
    return
  }
  $.clock.after(POLL_MS, () => void poll($, gen, which, files, deadline))
}

async function merge($: EngineInterface, gen: number): Promise<void> {
  const r = await read($, run)
  const done = PROVIDERS.filter(p => r.critiques[p].status === 'done')
  if (done.length === 0) {
    $.ui.status(undefined)
    await update($, run, (x): Run => ({ ...x, phase: 'review', mergedText: '', error: 'every model failed, so there is nothing to merge' }))
    return
  }

  await update($, run, (x): Run => ({ ...x, phase: 'merging', error: '' }))
  $.ui.status(`Plan Critique: merging ${done.length} critique${done.length === 1 ? '' : 's'} with Sonnet…`)
  const prompt = done
    .map(p => `## Critique from ${LABEL[p]}\n${r.critiques[p].text}`)
    .concat(`## The plan (for reference)\n${cap(r.planText, PLAN_CAP, 'plan')}`)
    .join('\n\n')

  try {
    const answer = await $.model.complete({
      model: 'sonnet',
      system: MERGE_RULES,
      prompt,
      maxTokens: 6000,
      timeoutMs: MERGE_TIMEOUT_MS,
    })
    if (gen !== generation) return
    await update($, run, (x): Run =>
      answer.isAnswered
        ? { ...x, phase: 'review', mergedText: cap(answer.text.trim(), MERGED_CAP, 'brief') }
        : { ...x, phase: 'review', mergedText: '', error: `Sonnet did not merge (${answer.reason})` },
    )
    if (answer.isAnswered) await autoFill($)
  } catch (err) {
    if (gen !== generation) return
    await update($, run, (x): Run => ({ ...x, phase: 'review', mergedText: '', error: `Sonnet merge failed: ${String(err).slice(0, 200)}` }))
  } finally {
    if (gen === generation) $.ui.status(undefined)
  }
}

// The merged brief goes straight into the message box (never sent), unless the
// person has typed something there meanwhile: then Submit does it on request.
// While the plan-approval card is open the box is hidden and a fill fails; the
// brief is then kept pending and goes in once the band above the box draws again.
async function autoFill($: EngineInterface): Promise<void> {
  const text = briefOf(await read($, run))
  if (text === '') return
  if ((await $.prompt.read()).text.trim() !== '') {
    $.ui.toast('Critique ready. Your message box has text, so press Submit to replace it with the brief')
    return
  }
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (!filled.isFilled) {
    await update($, run, r => ({ ...r, pendingFill: true }))
    return
  }
  await update($, run, r => ({ ...r, revisedClaudeOption: text, pendingFill: false }))
  $.ui.toast('Merged critique is in your message box: review it, then send it yourself')
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

// The fixed first sentence of every brief (user's wording, 2026-11-23), so Claude
// weighs each suggestion instead of applying all of them.
export const BRIEF_INTRO =
  'Here is my critique of your plan. It is not absolute and some suggestions may be wrong: read each one and check it yourself before deciding whether to revise.'

// What goes into the prompt box: the fixed intro, then the merged brief, or the
// raw critiques when the merge failed.
export function briefOf(r: Run): string {
  if (r.mergedText !== '') return `${BRIEF_INTRO}\n\n${r.mergedText}`
  const raw = PROVIDERS.filter(p => r.critiques[p].status === 'done')
    .map(p => `## Critique from ${LABEL[p]}\n${r.critiques[p].text}`)
    .join('\n\n')
  return raw === '' ? '' : cap(`${BRIEF_INTRO}\n\n${raw}`, MERGED_CAP, 'critiques')
}

type Found = { path: string | null; label: string; text: string }

async function start($: EngineInterface, opts: Options, given?: Found): Promise<void> {
  const current = await read($, run)
  if (current.phase === 'critiquing' || current.phase === 'merging') return
  const plan = given ?? (await findPlan($, current.planPath))
  if (plan === null) {
    $.ui.toast('No plan found to critique')
    return
  }
  generation += 1
  const gen = generation
  await update($, run, r => ({
    ...IDLE,
    planPath: plan.path ?? r.planPath,
    planLabel: plan.label,
    planText: plan.text,
  }))
  await critique($, PROVIDERS, opts, gen)
}

async function retryFailed($: EngineInterface, opts: Options): Promise<void> {
  const r = await read($, run)
  const failed = PROVIDERS.filter(p => r.critiques[p].status === 'failed')
  if (failed.length === 0) return
  generation += 1
  await critique($, failed, opts, generation)
}

async function remerge($: EngineInterface): Promise<void> {
  generation += 1
  await merge($, generation)
}

async function cancel($: EngineInterface): Promise<void> {
  generation += 1
  if (activeCancel !== '') {
    const file = activeCancel
    activeCancel = ''
    await $.fs.write(file, 'cancel').catch(() => undefined)
  }
  $.ui.status(undefined)
  await update($, run, r => ({ ...IDLE, planPath: r.planPath }))
}

async function submit($: EngineInterface): Promise<void> {
  const text = briefOf(await read($, run))
  if (text === '') {
    $.ui.toast('Nothing to put in the prompt box yet')
    return
  }
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (!filled.isFilled) {
    await update($, run, r => ({ ...r, pendingFill: true }))
    $.ui.toast('The plan card hides the message box: the critique goes in as soon as you choose Revise or Reject')
    return
  }
  await update($, run, r => ({ ...r, revisedClaudeOption: text, pendingFill: false }))
  $.ui.toast('Brief is in the prompt box: review it, then send it yourself')
}

// Never lets a failed state write reach the tool call it rides on.
async function remember($: EngineInterface, path: string): Promise<void> {
  if (!isPlanPath(path)) return
  await update($, run, r => ({ ...r, planPath: path })).catch(() => undefined)
}

function rowText(p: Provider, c: Critique): string {
  const state =
    c.status === 'done'
      ? `done${c.note ? ` (${c.note})` : ''}`
      : c.status === 'failed'
        ? `failed: ${c.error}`
        : c.status === 'querying'
          ? c.note || 'querying…'
          : 'not run'
  return `${LABEL[p]}: ${state}`
}

export const register: Register = (on, options) => {
  const opts = options as unknown as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'critique-plan',
      description: 'Critique the current plan with four free models, merged by Sonnet',
    })
    return next(e)
  })

  on('command.run', { command: 'critique-plan' }, async $ => {
    $.clock.after(0, () => void start($, opts))
    return { text: 'Plan Critique started: see the band above the prompt.', isTextDisplayOnly: true }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await remember($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await remember($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))

  // While a proposed plan waits for approval, its card hides the band above the
  // prompt, so Critique Plan and its progress also sit under the plan's own row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'ExitPlanMode' || e.props.isExpanded === true) return next(e)
    const row = await next(e)
    const r = await read($, run)
    if (!e.props.isRunning && r.phase === 'idle') return row
    const { Box, Button, Text } = $.ui.resolve(e)
    const input = e.props.input as { plan?: unknown } | null
    const given: Found | undefined =
      typeof input?.plan === 'string' && input.plan.trim() !== ''
        ? { path: null, label: 'proposed plan', text: input.plan }
        : undefined
    const busy = r.phase === 'critiquing' || r.phase === 'merging'
    return (
      <Box flexDirection="column">
        {row}
        {r.phase !== 'idle' &&
          PROVIDERS.map(p => (
            <Text key={`plan-row-${p}`} dimColor={r.critiques[p].status !== 'failed'}>
              {rowText(p, r.critiques[p])}
            </Text>
          ))}
        {r.phase === 'merging' && <Text key="plan-merging">Merging with Sonnet…</Text>}
        {r.error !== '' && <Text key="plan-error" color="error">{r.error}</Text>}
        {r.revisedClaudeOption !== '' && (
          <Text key="plan-filled" dimColor>The merged critique is in your message box: choose Revise or Reject, then send it.</Text>
        )}
        {r.pendingFill && (
          <Text key="plan-pending" dimColor>Critique ready. It goes into your message box as soon as you choose Revise or Reject.</Text>
        )}
        <Box flexDirection="row" gap={1}>
          {!busy && <Button key="plan-critique" label="Critique Plan" onPress={() => {
            $.clock.after(0, () => void start($, opts, given))
          }} />}
          {r.phase === 'review' && briefOf(r) !== '' && <Button key="plan-submit" label="Submit" onPress={() => submit($)} />}
          {busy && <Button key="plan-cancel" label="Cancel" onPress={() => cancel($)} />}
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
          <Button
            key="start"
            label="Critique Plan"
            // On a timer: a press runs inside a drawing hook, whose $ calls get
            // 30 s in all, too little for four critics and a merge.
            onPress={() => {
              $.clock.after(0, () => void start($, opts))
            }}
          />
        </Box>
      )
    }

    const rows = PROVIDERS.map(p => (
      <Text key={`row-${p}`} dimColor={r.critiques[p].status !== 'failed'}>
        {rowText(p, r.critiques[p])}
      </Text>
    ))
    const header = <Text key="plan">Plan Critique · {r.planLabel}</Text>

    if (r.phase === 'critiquing' || r.phase === 'merging') {
      return (
        <Box flexDirection="column">
          {header}
          {rows}
          {r.phase === 'merging' && <Text key="merging">Merging with Sonnet…</Text>}
          <Box flexDirection="row" gap={1}>
            {prompt}
            <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
          </Box>
        </Box>
      )
    }

    const room = Math.max(4, e.props.maxRows - 12)
    const lines = briefOf(r).split('\n')
    const shown = lines.slice(0, room).join('\n')
    const hasDone = PROVIDERS.some(p => r.critiques[p].status === 'done')
    const hasFailed = PROVIDERS.some(p => r.critiques[p].status === 'failed')
    return (
      <Box flexDirection="column">
        {header}
        {rows}
        {r.error !== '' && <Text key="error" color="error">{r.error}</Text>}
        {shown !== '' && <Text key="brief">{shown}</Text>}
        {lines.length > room && (
          <Text key="more" dimColor>
            … {lines.length - room} more lines; Submit puts the whole brief in the prompt box
          </Text>
        )}
        {r.revisedClaudeOption !== '' && (
          <Text key="filled" dimColor>In the prompt box: review it, then send it yourself.</Text>
        )}
        <Box flexDirection="row" gap={1}>
          {prompt}
          {hasDone && <Button key="submit" label="Submit" onPress={() => submit($)} />}
          {hasDone && <Button key="remerge" label="Re-merge" onPress={() => {
              $.clock.after(0, () => void remerge($))
            }} />}
          {hasFailed && <Button key="retry" label="Retry failed" onPress={() => {
              $.clock.after(0, () => void retryFailed($, opts))
            }} />}
          <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
        </Box>
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

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

export const register: Register = on => {
  // A reload mid-rewrite drops that rewrite, but its stored busy flag would
  // outlive it and keep the button stuck: every session starts idle.
  on('session.start', async ($, e, next) => {
    await update($, isBusy, () => false)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Button } = $.ui.resolve(e)
    const busy = await read($, isBusy)
    return (
      <Button
        key="prompt"
        label={busy ? 'Rewriting…' : 'Prompt Master'}
        // Start the work on a timer so it runs outside the press's time budget.
        onPress={() => {
          $.clock.after(0, () => void rewrite($))
        }}
      />
    )
  })
}

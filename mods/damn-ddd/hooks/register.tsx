import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Frame2, Show, Stage } from '../types'
import { SCENE_ALT, SCENES } from './scene'
import { FRAME2_ALT, FRAMES2 } from './scene2'

// Zero model tokens by design: every hook passes its event through unchanged.
// No prompt/system-prompt edits, no tools, no model calls. The /damn1 and /damn2
// replies are display-only (isTextDisplayOnly), so they never go into a request either.
// The only thing it changes is the backdrop behind the chat. It plays no sound.

const stage = atom({ plugin: 'damn-ddd', key: 'stage' } as const, 0 as Stage)
const show = atom({ plugin: 'damn-ddd', key: 'show' } as const, 'damn1' as Show)
const frame = atom({ plugin: 'damn-ddd', key: 'frame' } as const, 'idle' as Frame2)

const TICK_MS = 5000
// The show a long turn brought last, kept across sessions.
const LAST_AUTO = 'lastAutoShow'
// A command climbs to the top stage this fast, then stays until sent off.
const CLIMB_MS = 3500

// damn2's beats: stand, lift, a quick smeared swing, strike. Faster at each stage.
type Beat = 'idle' | 'raise' | 'swing' | 'strike'
const BEAT_MS: Record<Beat, number> = { idle: 1300, raise: 650, swing: 120, strike: 1800 }
// The app redraws at most ten times a second, so no beat is held shorter than this.
const MIN_BEAT_MS = 100
const TEMPO: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.85, 3: 0.72 }
const AFTER: Record<Beat, Beat> = { idle: 'raise', raise: 'swing', swing: 'strike', strike: 'idle' }
const STRIKES = ['strike0', 'strike1', 'strike2'] as const

// Timers and flags live at module level: the engine lets `$` be handed only to
// functions declared at the top of the file. A reload starts them over.
let climb: Timer | undefined
let beats: Timer | undefined
let lastLine = -1
// Set when sent off; keeps the turn's own timer from bringing the show straight back.
let isDismissed = false
// An empty, see-through drawing for when no show is out. The app takes the first answer
// to its backdrop request as the drawing to keep; an engine "nothing" there left every
// later show undrawn, so the backdrop always answers with a drawing.
const EMPTY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>'
export const EMPTY_ALT = 'Empty stage'

// Names the scene with no frosted glass, so the show stays sharp where the chat column covers it.
// Set at session start and again for each show, in case the theme was cleared since.
async function setTheme($: EngineInterface): Promise<void> {
  try {
    const set = await $.theme.set({ backdrop: { scene: 'damn-ddd', glass: false } })
    // Shown in the status line: a theme that isn't drawn does not throw.
    if (!set.isDrawn) {
      $.ui.status(`damn-ddd: not drawn: ${set.reason}`)
    }
  } catch (error) {
    $.ui.status(`damn-ddd: theme not set: ${String(error)}`)
  }
}

// The app draws the backdrop once and does not redraw it when the state changes,
// so every change asks for a redraw itself.
async function redraw($: EngineInterface): Promise<void> {
  $.ui.invalidate('ui.render')
}

// Raises the stage, never lowers it: once out, the show stays until sent off.
async function raiseTo($: EngineInterface, next: Stage): Promise<void> {
  let raised = false
  await update($, stage, current => {
    if (current >= next) {
      return current
    }
    raised = true
    return next
  })
  if (raised) {
    await redraw($)
  }
}

async function climbFrom($: EngineInterface, next: Stage): Promise<void> {
  // A dismissal while this step was waiting must not bring the show back.
  if (isDismissed) {
    return
  }
  await raiseTo($, next)
  if (next < 3 && !isDismissed) {
    climb = $.clock.after(CLIMB_MS, () => void climbFrom($, (next + 1) as Stage))
  }
}

// A different line from the last strike's, so the three take turns at random.
function nextStrike(): Frame2 {
  let i = Math.floor(Math.random() * STRIKES.length)
  if (i === lastLine) {
    i = (i + 1) % STRIKES.length
  }
  lastLine = i
  return STRIKES[i] ?? 'strike0'
}

// Holds each key frame for its beat, then the next. Stops once the hero is sent off.
async function beat($: EngineInterface, b: Beat): Promise<void> {
  const current = await read($, stage)
  if (current === 0 || (await read($, show)) !== 'damn2') {
    return
  }
  await update($, frame, () => (b === 'strike' ? nextStrike() : b))
  await redraw($)
  beats = $.clock.after(Math.max(MIN_BEAT_MS, Math.round(BEAT_MS[b] * TEMPO[current])), () => void beat($, AFTER[b]))
}

async function startBeats($: EngineInterface): Promise<void> {
  beats?.cancel()
  await beat($, 'idle')
}

function cancelAll(): void {
  climb?.cancel()
  beats?.cancel()
}

async function playShow($: EngineInterface, which: Show): Promise<void> {
  await setTheme($)
  cancelAll()
  isDismissed = false
  // A fresh show from the start; one already out gives way.
  await update($, stage, () => 0)
  await update($, show, () => which)
  await redraw($)
  await climbFrom($, 1)
  if (which === 'damn2') {
    await startBeats($)
  }
}

// The click, the right-click row, or a stop: gone at once.
async function dismiss($: EngineInterface): Promise<void> {
  cancelAll()
  isDismissed = true
  await update($, stage, () => 0)
  await redraw($)
}

// Long turns take turns: damn1, then damn2, then damn1 again, across sessions.
async function nextAutoShow($: EngineInterface): Promise<Show> {
  const last = await $.store.get(LAST_AUTO)
  const which: Show = last === 'damn1' ? 'damn2' : 'damn1'
  await $.store.set(LAST_AUTO, which)
  return which
}

// Each long turn brings the next show in turn, even over one still on screen from
// the last long turn; later ticks of the same turn only speed it up.
async function autoRaise($: EngineInterface, next: Stage, isTurnsFirst: boolean): Promise<void> {
  if (isTurnsFirst) {
    cancelAll()
    const which = await nextAutoShow($)
    await update($, stage, () => 0)
    await update($, show, () => which)
    await redraw($)
    await raiseTo($, next)
    await startBeats($)
    return
  }
  await raiseTo($, next)
}

const COMMANDS: Record<Show, { description: string; go: string; stop: string }> = {
  damn1: {
    description: 'The cowboy cracks his whip at the token bucket until the reply finishes; "stop" sends him off sooner',
    go: 'Yeehaw! He leaves when the reply finishes, or click an empty spot or right-click to send him off.',
    stop: 'Whip holstered.',
  },
  damn2: {
    description: 'The hero cuts the evil token in two until the reply finishes; "stop" sends him off sooner',
    go: 'Blade drawn! He leaves when the reply finishes, or click an empty spot or right-click to send him off.',
    stop: 'Sword sheathed.',
  },
}

export const register: Register = (on, options) => {
  const configured = Number(options.startAfter)
  const startAfter = Number.isFinite(configured) ? Math.min(3600, Math.max(5, configured)) : 600

  let startedAt = 0
  let mainTurnId: string | undefined
  let hasShownThisTurn = false
  let ticker: Timer | undefined

  const stageAt = (s: number): Stage =>
    s >= startAfter * 2 ? 3 : s >= startAfter * 1.5 ? 2 : s >= startAfter ? 1 : 0

  on('session.start', async ($, e, next) => {
    // A reload drops the old timers, so start from idle.
    await update($, stage, () => 0)
    await redraw($)
    await setTheme($)
    for (const name of ['damn1', 'damn2'] as const) {
      await $.command.register({ name, description: COMMANDS[name].description, argumentHint: '[stop]', immediate: true })
    }
    return next(e)
  })

  for (const name of ['damn1', 'damn2'] as const) {
    on('command.run', { command: name }, async ($, e) => {
      if (e.args.trim() === 'stop') {
        await dismiss($)
        return { text: COMMANDS[name].stop, isTextDisplayOnly: true }
      }
      await playShow($, name)
      return { text: COMMANDS[name].go, isTextDisplayOnly: true }
    })
  }

  on('ui.pointer', async ($, e, next) => {
    if (e.scene === 'damn-ddd') {
      await dismiss($)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    ticker?.cancel()
    mainTurnId = e.turnId
    isDismissed = false
    hasShownThisTurn = false
    startedAt = await $.clock.now()

    const tick = () => {
      void (async () => {
        if (isDismissed) {
          return
        }
        const s = Math.floor(((await $.clock.now()) - startedAt) / 1000)
        const nextStage = stageAt(s)
        if (nextStage !== 0) {
          const isFirst = !hasShownThisTurn
          hasShownThisTurn = true
          await autoRaise($, nextStage, isFirst)
        }
      })()
    }
    // Idle until the threshold, then a light 5 s tick while the turn runs on.
    ticker = $.clock.after(startAfter * 1000, () => {
      tick()
      ticker = $.clock.every(TICK_MS, tick)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.turnId === mainTurnId) {
      // The reply is done: its timer stops and any show leaves with it.
      ticker?.cancel()
      ticker = undefined
      mainTurnId = undefined
      if ((await read($, stage)) !== 0) {
        await dismiss($)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    // Match the scene, not the plugin id, which can carry a suffix such as `@inline`.
    if (e.props.scene !== 'damn-ddd') {
      return next(e)
    }
    // Drawn as plain images, never isInteractive: an interactive drawing is its own
    // sandboxed frame, which takes the click, so ui.pointer never hears it.
    const { Svg } = $.ui.resolve(e)
    const current = await read($, stage)
    if (current === 0) {
      return <Svg source={EMPTY} alt={EMPTY_ALT} />
    }
    if ((await read($, show)) === 'damn1') {
      return <Svg source={SCENES[current]} alt={SCENE_ALT[current]} />
    }
    const f = await read($, frame)
    return <Svg source={FRAMES2[f]} alt={FRAME2_ALT[f]} />
  })

  // Right-click works over the chat too, where a backdrop click never arrives.
  on('ui.render', { component: 'ContextMenu' }, async ($, e, next) => {
    if (e.surface !== 'desktop') {
      return next(e)
    }
    const current = await read($, stage)
    const isOut = current >= 1 && current <= 3
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {isOut && (
          <Button key="off" onPress={() => void dismiss($)}>
            Send him off <Text dimColor>damn</Text>
          </Button>
        )}
        <Button key="whip" onPress={() => void playShow($, 'damn1')}>
          Crack the whip <Text dimColor>damn1</Text>
        </Button>
        <Button key="sword" onPress={() => void playShow($, 'damn2')}>
          Swing the sword <Text dimColor>damn2</Text>
        </Button>
      </Box>
    )
  })
}

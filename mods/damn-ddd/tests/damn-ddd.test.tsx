import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EMPTY_ALT } from '../hooks/register'
import { FRAMES2 } from '../hooks/scene2'

// Tests run at the real 10-minute timing whatever the manifest's default is.
const TEN_MIN = { options: { startAfter: 600 } } as const

const BACKDROP = {
  plugin: 'damn-ddd',
  component: 'Backdrop',
  props: { plugin: 'damn-ddd', scene: 'damn-ddd', glass: false },
} as const

const BAND = {
  plugin: 'damn-ddd',
  component: 'AbovePrompt',
  props: {
    bodyColumns: 80,
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 3,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

// `notDrawn` makes the app answer that it does not draw the theme, and why.
function engine(on: On, notDrawn?: string) {
  const log: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('theme.set', () =>
    notDrawn === undefined
      ? { value: { isDrawn: true, requestId: 'backdrop' } }
      : { value: { isDrawn: false, reason: notDrawn } },
  )
  on('ui.status', (_, e) => {
    if (e.text !== undefined) log.push(`status:${e.text}`)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    log.push(`toast:${e.text}`)
    return { value: undefined }
  })
  on('ui.pointer', () => ({}))
  // The store across sessions, held in memory for the test.
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('audio.play', (_, e) => {
    if (e.clip.asset !== undefined) log.push(`sound:${e.clip.asset}`)
    return { value: undefined }
  })
  return log
}

// The scene's alt text names its stage, or undefined when nothing is drawn.
async function scene($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  // The empty, see-through drawing stands for no show.
  return svg === undefined || svg.props.alt === EMPTY_ALT ? undefined : String(svg.props.alt)
}

// Every drawing of the backdrop as it stands: damn2 stacks several.
async function layers($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const all = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  return all.filter(svg => svg.props.alt !== EMPTY_ALT).map(svg => String(svg.props.source))
}

const run = (args = '', command = 'damn1') => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

const complete = (turnId: string, durationMs: number) => ({
  turnId,
  answer: 'done',
  durationMs,
  isAborted: false,
  reason: 'answer' as const,
})

async function start($: Engine, on: On, notDrawn?: string) {
  const clock = mock.clock(on)
  const log = engine(on, notDrawn)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return { clock, log }
}

test('a fast turn shows nothing and passes the answer through untouched', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(5 * 60_000)
  const result = await $.turn.complete(complete('t1', 5 * 60_000))
  expect(result.text).toBe('done')
  expect(await scene($)).toBe(undefined)
})

test('a slow turn brings damn1, it stays after the turn until sent off', TEN_MIN, async ($, on) => {
  const { clock, log } = await start($, on)
  await $.turn.start({ text: 'big job', turnId: 't2' })
  await clock.advance(9 * 60_000)
  expect(await scene($)).toBe(undefined)
  await clock.advance(61_000)
  expect(await scene($)).toMatch(/GIDDY UP/)
  await clock.advance(5 * 60_000)
  expect(await scene($)).toMatch(/YEE-HAW/)
  await clock.advance(5 * 60_000)
  expect(await scene($)).toMatch(/STAMPEDE: the cowboy/)

  const result = await $.turn.complete(complete('t2', 1_205_000))
  expect(result.text).toBe('done')
  await clock.advance(60_000)
  expect(await scene($)).toMatch(/STAMPEDE/)

  await $.command.run(run('stop')) // the click's handler; the kit cannot raise a backdrop click
  expect(await scene($)).toBe(undefined) // gone at once
  expect(log.filter(l => l.startsWith('sound:'))).toEqual(['sound:assets/crack.wav', 'sound:assets/crack.wav', 'sound:assets/crack.wav'])
})

test('long turns take turns: damn1, then damn2, then damn1', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  const shows: string[] = []
  for (const id of ['r1', 'r2', 'r3']) {
    await $.turn.start({ text: 'big job', turnId: id })
    await clock.advance(601_000)
    shows.push(/DAMN2/.test((await scene($)) ?? '') ? 'damn2' : 'damn1')
    await $.turn.complete(complete(id, 601_000))
    await $.command.run(run('stop'))
  }
  expect(shows).toEqual(['damn1', 'damn2', 'damn1'])
})

test('damn1 draws a single cowboy at every stage', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.command.run(run())
  await clock.advance(7_200)
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  const source = String(svg?.props.source)
  expect(source).toMatch(/STAMPEDE|class="k0"/)
  expect(source).not.toMatch(/class="k1"/)
})

test('sending him off mid-turn keeps him away for the rest of that turn', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.turn.start({ text: 'big job', turnId: 't3' })
  await clock.advance(601_000)
  await $.command.run(run('stop')) // the click's handler; the kit cannot raise a backdrop click
  await clock.advance(10 * 60_000)
  expect(await scene($)).toBe(undefined)
})

test('a subagent turn never brings the cowboy', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.turn.start({ text: 'sub', turnId: 'a1', agentId: 'agent-1' })
  await clock.advance(30 * 60_000)
  expect(await scene($)).toBe(undefined)
})

test('/damn1 climbs to the stampede at once and stays until a click', TEN_MIN, async ($, on) => {
  const { clock, log } = await start($, on)
  const reply = await $.command.run(run())
  expect(reply.isTextDisplayOnly).toBe(true)
  expect(reply.context).toBe(undefined)
  expect(await scene($)).toMatch(/GIDDY UP/)
  await clock.advance(3_600)
  expect(await scene($)).toMatch(/YEE-HAW/)
  await clock.advance(3_600)
  expect(await scene($)).toMatch(/STAMPEDE/)
  await clock.advance(10 * 60_000)
  expect(await scene($)).toMatch(/STAMPEDE/)
  await $.command.run(run('stop')) // the click's handler; the kit cannot raise a backdrop click
  expect(await scene($)).toBe(undefined) // gone at once
  expect(log.filter(l => l.startsWith('sound:')).length).toBe(3)
  expect(log.filter(l => l.startsWith('toast:'))).toEqual([])
})

test('/damn1 stop sends him off', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.command.run(run())
  await clock.advance(1_000)
  const reply = await $.command.run(run('stop'))
  expect(reply.text).toBe('Whip holstered.')
  expect(await scene($)).toBe(undefined) // gone at once
})

test('nothing is drawn above the message box', TEN_MIN, async ($, on) => {
  await start($, on)
  await $.command.run(run())
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text' })).toBe(undefined)
  expect(await ui.find({ type: 'Svg' })).toBe(undefined)
  await ui.unmount()
})

test('/damn2 plays stand, lift, swing, strike in turn, each strike one of the three lines', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  const reply = await $.command.run(run('', 'damn2'))
  expect(reply.isTextDisplayOnly).toBe(true)
  expect(reply.context).toBe(undefined)
  expect(await scene($)).toMatch(/stands ready/)
  await clock.advance(1_300)
  expect(await scene($)).toMatch(/lifts his sword/)
  await clock.advance(650)
  expect(await scene($)).toMatch(/blur of light/)
  await clock.advance(120)
  const lines = new Set<string>()
  for (let i = 0; i < 6; i += 1) {
    const alt = (await scene($)) ?? ''
    expect(alt).toMatch(/cuts the evil token in two with a blazing slash: "(Spend them tokens!|Rate limit comin’!|Every token counts!)"/)
    lines.add(alt)
    // The command climbs to the top stage meanwhile, so step to the next strike at any tempo.
    await clock.advance(1_000)
    while (!/cuts the evil token/.test((await scene($)) ?? '')) await clock.advance(250)
  }
  expect(lines.size).toBeGreaterThan(1)
})

test('every damn2 frame is one drawing under the cap, pure vector', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.command.run(run('', 'damn2'))
  const seen = new Set<string>()
  for (let t = 0; t < 9_000; t += 325) {
    for (const source of await layers($)) seen.add(source)
    await clock.advance(325)
  }
  // What was drawn is among the frames, and every frame (each line too) is checked.
  expect(seen.size).toBeGreaterThanOrEqual(3)
  for (const source of seen) expect(Object.values(FRAMES2)).toContain(source)
  for (const source of Object.values(FRAMES2)) {
    expect(source.length).toBeLessThanOrEqual(131_072)
    expect(source).not.toMatch(/<image|data:|base64|foreignObject|\|<!\[CDATA|&#/)
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    // Stands where damn1's cowboy stands: feet 580px from the left, 130px up.
    expect(source).toContain('<svg x="580" y="100%" overflow="visible"><g transform="translate(0 -130)">')
  }
})

test('the right-click menu sends the show off, even where a click never lands', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  const menu = { plugin: 'damn-ddd', component: 'ContextMenu', props: {}, surface: 'desktop' } as const
  let ui = await $.ui.mount(menu)
  expect(await ui.find({ key: 'off' })).toBe(undefined)
  await ui.press({ key: 'sword' })
  await ui.unmount()
  expect(await scene($)).toMatch(/DAMN2/)
  ui = await $.ui.mount(menu)
  await ui.press({ key: 'off' })
  await ui.unmount()
  expect(await scene($)).toBe(undefined) // gone at once
  await clock.advance(4_100)
  expect(await scene($)).toBe(undefined)
})

test('/damn1 brings the cowboy over a running damn2', TEN_MIN, async ($, on) => {
  await start($, on)
  await $.command.run(run('', 'damn2'))
  expect(await scene($)).toMatch(/DAMN2/)
  await $.command.run(run())
  expect(await scene($)).toMatch(/GIDDY UP/)
})

test('the next long turn swaps the show even if the last one was never clicked away', TEN_MIN, async ($, on) => {
  const { clock } = await start($, on)
  await $.turn.start({ text: 'big job', turnId: 'u1' })
  await clock.advance(601_000)
  expect(await scene($)).toMatch(/GIDDY UP/) // damn1 first
  await $.turn.complete(complete('u1', 601_000))
  // Not clicked: damn1 stays on screen between turns.
  await clock.advance(60_000)
  expect(await scene($)).toMatch(/GIDDY UP/)
  await $.turn.start({ text: 'another big job', turnId: 'u2' })
  await clock.advance(601_000)
  expect(await scene($)).toMatch(/DAMN2/)
  // Later in the same turn it only speeds up; it does not swap again.
  await clock.advance(10 * 60_000)
  expect(await scene($)).toMatch(/DAMN2/)
  await $.turn.complete(complete('u2', 1_201_000))
  await $.turn.start({ text: 'third', turnId: 'u3' })
  await clock.advance(601_000)
  expect(await scene($)).toMatch(/GIDDY UP/)
})

test('draws when loaded from a plugin folder, where the app names the mod damn-ddd@inline', TEN_MIN, async ($, on) => {
  await start($, on)
  await $.command.run(run())
  const ui = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, plugin: 'damn-ddd@inline' }, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  expect(String(svg?.props.alt)).toMatch(/GIDDY UP/)
})

test('the backdrop always answers a drawing, an empty one before any show', TEN_MIN, async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  expect(svg?.props.alt).toBe(EMPTY_ALT)
})

test('a theme the app does not draw says why in the status line', TEN_MIN, async ($, on) => {
  const reason = 'no attached desktop or mobile client draws themes yet'
  const { log } = await start($, on, reason)
  expect(log).toContain(`status:damn-ddd: not drawn: ${reason}`)
})

test('the show is a plain image, so a click on the screen reaches the mod', TEN_MIN, async ($, on) => {
  await start($, on)
  for (const name of ['damn1', 'damn2'] as const) {
    await $.command.run(run('', name))
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })
    await ui.unmount()
    expect(svg?.props.isInteractive).toBe(undefined)
  }
})

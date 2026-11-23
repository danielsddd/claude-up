import { BODY, COIN, HERO_ART, IDLE, IDLE_ART, IDLE_BLADE, RAISE, RAISE_BLADE, STRIKE, TOKEN_ART, WINGL, WINGR } from './art2'
import type { Blade, Piece } from './art2'
import type { Frame2 } from '../types'
import { burstBalloon } from './balloon'
import { GROUND_PX, LEFT_FEET_PX } from './scene'

// damn2: one hero, traced from the hand-drawn character art, lifts his sword and cuts
// the evil token in two. Played as held key frames, the way hand-drawn anime is: the
// mod swaps frames on a timer, and each frame moves on its own (wings, glow, the slash,
// the split, the line in the bubble). Each frame is one drawing under the cap. The
// swords are clean vector shapes, so the traced budget goes to the hero and the token.

/** Exactly these three, shuffled one per strike. */
export const LINES = ['Spend them tokens!', 'Rate limit comin’!', 'Every token counts!'] as const

const HERO = 0.79 / HERO_ART // art units to screen pixels: 0.79 screen px per source px
// Stands where damn1's cowboy stands: the anchor is his feet, the token to his right.
const FEET_X = 0
const TOKEN = 0.315 / TOKEN_ART
const TOK = { x: 320, y: -300 } // the coin's centre, from the feet
const CUT = 41.5 // the slash's angle through the coin, degrees below horizontal

const n = (v: number): string => (Math.round(v * 10) / 10).toString()
const k = (v: number): string => (Math.round(v * 1000) / 1000).toString()

const hero = (p: Piece): string => `translate(${n(FEET_X - p.fx * HERO)} ${n(-p.h * HERO)}) scale(${k(HERO)})`
const tokenAt = `translate(${n(TOK.x - COIN.cx * TOKEN)} ${n(TOK.y - COIN.cy * TOKEN)}) scale(${k(TOKEN)})`

// Spins or flies a group about its own point, not the anchor's.
const about = (x: number, y: number, cls: string, inner: string): string =>
  `<g transform="translate(${n(x)} ${n(y)})"><g class="${cls}"><g transform="translate(${n(-x)} ${n(-y)})">${inner}</g></g></g>`

const BASE =
  `.size{transform:scale(1)}` +
  `@media (max-height: 1000px), (max-width: 1500px){.size{transform:scale(.82)}}` +
  `@media (max-height: 780px), (max-width: 1200px){.size{transform:scale(.64)}}` +
  `.shake{animation:shake .26s linear 1}` +
  `@keyframes shake{0%{transform:translate(0,0)}20%{transform:translate(7px,-5px)}40%{transform:translate(-6px,4px)}` +
  `60%{transform:translate(4px,3px)}80%{transform:translate(-3px,-2px)}100%{transform:translate(0,0)}}` +
  `.breathe{animation:breathe 2.4s ease-in-out infinite alternate}` +
  `@keyframes breathe{0%{transform:translateY(0)}100%{transform:translateY(-2.5px)}}` +
  `.rise{animation:rise .32s cubic-bezier(.2,.9,.3,1.2) 1}` +
  `@keyframes rise{0%{transform:translate(6px,10px)}100%{transform:translate(0,0)}}` +
  `.lunge{animation:lunge .16s cubic-bezier(.1,.8,.3,1) 1}` +
  `@keyframes lunge{0%{transform:translate(-22px,-10px)}100%{transform:translate(0,0)}}` +
  `.bob{animation:bob 1.6s ease-in-out infinite alternate}` +
  `@keyframes bob{0%{transform:translateY(6px)}100%{transform:translateY(-8px)}}` +
  `.wl{animation:wl .46s ease-in-out infinite alternate}@keyframes wl{0%{transform:rotate(16deg)}100%{transform:rotate(-12deg)}}` +
  `.wr{animation:wr .46s ease-in-out infinite alternate}@keyframes wr{0%{transform:rotate(-16deg)}100%{transform:rotate(12deg)}}` +
  `.pop{animation:pop .5s cubic-bezier(.2,1.5,.4,1) 1}` +
  `@keyframes pop{0%{transform:scale(.2);opacity:0}100%{transform:scale(1);opacity:1}}` +
  `.flinch2{transform:translate(8px,-3px) rotate(3deg)}` +
  `.ha{animation:ha 1.5s cubic-bezier(.3,.1,.6,1) forwards}` +
  `@keyframes ha{0%,6%{transform:translate(0,0) rotate(0deg);opacity:1}` +
  `30%{transform:translate(46px,-40px) rotate(14deg);opacity:1}` +
  `100%{transform:translate(90px,300px) rotate(48deg);opacity:0}}` +
  `.hb{animation:hb 1.5s cubic-bezier(.3,.1,.6,1) forwards}` +
  `@keyframes hb{0%,6%{transform:translate(0,0) rotate(0deg);opacity:1}` +
  `30%{transform:translate(-40px,26px) rotate(-12deg);opacity:1}` +
  `100%{transform:translate(-80px,320px) rotate(-40deg);opacity:0}}`

function heroArt(p: Piece, cls: string, overlay = ''): string {
  return `<g class="${cls}"><g transform="${hero(p)}">${p.g}${overlay}</g></g>`
}

// The token: wings behind the coin, flapping about the joints, the whole thing bobbing.
const WING_L = { x: COIN.cx - COIN.rx * 0.82, y: COIN.cy - COIN.ry * 0.42 }
const WING_R = { x: COIN.cx + COIN.rx * 0.82, y: COIN.cy - COIN.ry * 0.42 }

function tokenArt(): string {
  return about(WING_L.x, WING_L.y, 'wl', WINGL.g) + about(WING_R.x, WING_R.y, 'wr', WINGR.g) + BODY.g
}

function liveToken(mode: 'live' | 'flinch'): string {
  const inner = `<g transform="${tokenAt}">${tokenArt()}</g>`
  return `<g class="bob">${about(TOK.x, TOK.y, mode === 'flinch' ? 'flinch2' : 'pop', inner)}</g>`
}

// Cut in two along the slash: each half flies off and falls, its wing with it.
function cutClips(): string {
  const r = (CUT * Math.PI) / 180
  const d = { x: Math.cos(r), y: Math.sin(r) }
  const nrm = { x: d.y, y: -d.x } // toward the upper right
  const far = 900
  const p1 = { x: COIN.cx - d.x * far, y: COIN.cy - d.y * far }
  const p2 = { x: COIN.cx + d.x * far, y: COIN.cy + d.y * far }
  const poly = (s: number) =>
    [p1, p2, { x: p2.x + nrm.x * far * s, y: p2.y + nrm.y * far * s }, { x: p1.x + nrm.x * far * s, y: p1.y + nrm.y * far * s }]
      .map(p => `${n(p.x)},${n(p.y)}`)
      .join(' ')
  return (
    `<clipPath id="ca" clipPathUnits="userSpaceOnUse"><polygon points="${poly(1)}"/></clipPath>` +
    `<clipPath id="cb" clipPathUnits="userSpaceOnUse"><polygon points="${poly(-1)}"/></clipPath>` +
    `<g id="t">${tokenArt()}</g>`
  )
}

function splitToken(): string {
  const half = (cls: string, clip: string) =>
    about(TOK.x, TOK.y, cls, `<g transform="${tokenAt}"><use href="#t" clip-path="url(#${clip})"/></g>`)
  return half('ha', 'ca') + half('hb', 'cb')
}

// A tiny seeded random, so every load draws the same burst.
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const FX_DEFS =
  `<radialGradient id="gEye"><stop offset="0" stop-color="#fff2e0"/><stop offset=".3" stop-color="#ff3b2f"/><stop offset="1" stop-color="#ff1a1a" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="gEmber"><stop offset="0" stop-color="#fff4c2"/><stop offset=".5" stop-color="#ff9a2e"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></radialGradient>` +
  `<linearGradient id="gSlash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fd0ff" stop-opacity="0"/><stop offset=".2" stop-color="#7fdcff"/><stop offset=".45" stop-color="#d8f6ff"/><stop offset=".7" stop-color="#ffd24a"/><stop offset="1" stop-color="#ff8a1a"/></linearGradient>` +
  `<linearGradient id="gBlade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#dfefff"/><stop offset="1" stop-color="#9fb6cc"/></linearGradient>` +
  `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>` +
  `<filter id="ink" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="1.3" flood-color="#3a2408" flood-opacity=".85"/></filter>` +
  `<linearGradient id="gLeg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1c201d"/><stop offset=".55" stop-color="#2f3530"/><stop offset="1" stop-color="#232824"/></linearGradient>`

const FX_CSS =
  `.eye{animation:eye 1.2s ease-in-out infinite alternate}@keyframes eye{0%{opacity:.55}100%{opacity:1}}` +
  `.ember{animation:ember 3.2s linear infinite;opacity:0}` +
  `@keyframes ember{0%{transform:translate(0,0);opacity:0}15%{opacity:.9}100%{transform:translate(-30px,-220px);opacity:0}}` +
  `.glint{animation:glint .6s ease-out 1 forwards;opacity:0}` +
  `@keyframes glint{0%{transform:scale(0) rotate(0deg);opacity:0}35%{transform:scale(1.25) rotate(45deg);opacity:1}100%{transform:scale(.2) rotate(90deg);opacity:0}}` +
  `.charge{animation:charge .65s ease-in 1 forwards;opacity:0}` +
  `@keyframes charge{0%{transform:scale(1.8);opacity:0}100%{transform:scale(.6);opacity:.9}}` +
  `.sweep{stroke-dasharray:1 1;stroke-dashoffset:1;animation:sweep .15s cubic-bezier(.2,.7,.3,1) forwards}` +
  `@keyframes sweep{0%{stroke-dashoffset:1}100%{stroke-dashoffset:0}}` +
  `.arc{animation:arc .7s ease-out forwards}@keyframes arc{0%,25%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.06)}}` +
  `.bub{fill:#fffdf7;stroke:#14100c;stroke-width:4.5;stroke-linejoin:miter;stroke-miterlimit:8}` +
  `.bubsh{fill:#ffb21e;stroke:#14100c;stroke-width:3;stroke-linejoin:miter;stroke-miterlimit:8}` +
  `.bubt{fill:#14100c;font-family:Bahnschrift,'Arial Narrow','Segoe UI',Impact,sans-serif;font-weight:800;font-style:italic;` +
  `font-size:36px;letter-spacing:1px;text-transform:uppercase;text-anchor:middle}` +
  `.say{animation:say .42s cubic-bezier(.2,1.6,.4,1) .22s 1 both}` +
  `@keyframes say{0%{transform:scale(0) rotate(-8deg);opacity:0}100%{transform:scale(1) rotate(0deg);opacity:1}}` +
  `.wob{animation:wob 1.4s ease-in-out .64s infinite alternate}@keyframes wob{0%{transform:rotate(-1.5deg)}100%{transform:rotate(1.5deg)}}`

// Embers rising past the hero: slow, warm, never a flash.
function embers(): string {
  const rnd = seeded(7)
  let out = ''
  for (let i = 0; i < 9; i += 1) {
    const x = FEET_X - 200 + rnd() * 560
    const y = -40 - rnd() * 160
    const r = 2.5 + rnd() * 3
    out += `<circle class="ember" cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="url(#gEmber)" style="animation-delay:-${n(rnd() * 3.2)}s"/>`
  }
  return out
}

// The token's red eyes, riding its bob.
function eyes(mode: 'live' | 'flinch'): string {
  const at = (x: number, y: number) => ({ x: TOK.x + (x - COIN.cx) * TOKEN, y: TOK.y + (y - COIN.cy) * TOKEN })
  const l = at(300 * TOKEN_ART, 95 * TOKEN_ART)
  const r = at(407 * TOKEN_ART, 95 * TOKEN_ART)
  const size = mode === 'flinch' ? 22 : 15
  const glow = `<g class="eye"><circle cx="${n(l.x)}" cy="${n(l.y)}" r="${size}" fill="url(#gEye)"/><circle cx="${n(r.x)}" cy="${n(r.y)}" r="${size}" fill="url(#gEye)"/></g>`
  return `<g class="bob">${about(TOK.x, TOK.y, mode === 'flinch' ? 'flinch2' : 'pop', glow)}</g>`
}

// A four-point sparkle, centred on 0,0.
const STAR = `<path fill="#ffffff" d="M0 -26 L5 -5 L26 0 L5 5 L0 26 L-5 5 L-26 0 L-5 -5 Z"/><circle r="7" fill="#bff1ff"/>`

// Where a point of a hero frame lands on screen.
function onScreen(p: Piece, x: number, y: number): { x: number; y: number } {
  return { x: FEET_X - p.fx * HERO + x * HERO, y: -p.h * HERO + y * HERO }
}

function idleFx(): string {
  return embers() + eyes('live')
}

function raiseFx(): string {
  // Points are in the source art's pixels; HERO_ART turns them into art units.
  const tip = onScreen(RAISE, RAISE_BLADE.tip[0] * HERO_ART, RAISE_BLADE.tip[1] * HERO_ART)
  const gem = onScreen(RAISE, RAISE_BLADE.base[0] * HERO_ART, RAISE_BLADE.base[1] * HERO_ART)
  return (
    embers() +
    eyes('flinch') +
    about(gem.x, gem.y, 'charge', `<circle cx="${n(gem.x)}" cy="${n(gem.y)}" r="26" fill="#7fe3ff" opacity=".55" filter="url(#glow)"/>`) +
    about(tip.x, tip.y, 'glint', `<g transform="translate(${n(tip.x)} ${n(tip.y)})">${STAR}</g>`)
  )
}

// The shin the traced fire trail hid, redrawn as a tapered, shaded trouser leg over
// the boot top. Points are in the strike art's units.
const LEG =
  `<path fill="url(#gLeg)" stroke="#0f110f" stroke-width="2.4" stroke-linejoin="round" ` +
  `d="M298 398 C318 392 342 396 357 404 C356 428 351 452 347 474 C344 490 343 502 342 514 L306 515 C303 498 297 484 296 462 C295 440 296 418 298 398 Z"/>` +
  `<path fill="none" stroke="#0f110f" stroke-width="1.6" stroke-linecap="round" opacity=".75" d="M312 430 Q324 436 336 431 M309 460 Q322 467 338 460"/>` +
  `<path fill="none" stroke="#56605a" stroke-width="2.4" stroke-linecap="round" opacity=".7" d="M344 414 C342 440 338 466 334 500"/>` +
  `<path fill="#141714" d="M304 504 L344 503 L343 516 L305 517 Z"/>`

// A clean vector blade from its hilt end to its tip, with a soft glow and a runed fuller.
function swordBlade(base: readonly [number, number], tip: readonly [number, number], half: number): string {
  const len = Math.hypot(tip[0] - base[0], tip[1] - base[1])
  const d = { x: (tip[0] - base[0]) / len, y: (tip[1] - base[1]) / len }
  const w = { x: -d.y, y: d.x }
  const at = (along: number, side: number) =>
    `${n(base[0] + d.x * along + w.x * side)},${n(base[1] + d.y * along + w.y * side)}`
  const edge = [at(0, -half), at(len * 0.88, -half * 0.8), at(len, 0), at(len * 0.88, half * 0.8), at(0, half)].join(' ')
  const fuller = `M${at(len * 0.04, 0)} L${at(len * 0.8, 0)}`
  return (
    `<polygon points="${edge}" fill="#bfefff" opacity=".7" filter="url(#glow)"/>` +
    `<polygon points="${edge}" fill="url(#gBlade)" stroke="#3d4a57" stroke-width="${n(half * 0.21)}" stroke-linejoin="round"/>` +
    `<path d="${fuller}" stroke="#8fd8ff" stroke-width="${n(half * 0.3)}" stroke-dasharray="${n(half)} ${n(half * 0.7)}" opacity=".9"/>`
  )
}

// The sword a pose holds, in that pose's cut-out pixels (art units = pixels * art).
function heldSword(blade: Blade, art: number, half: number): string {
  return `<g transform="scale(${k(art)})">${swordBlade(blade.base, blade.tip, half)}</g>`
}

// The strike pose's blade, along the line the traced fire trail took it from.
const STRIKE_BASE = [328, 382] as const
const STRIKE_TIP = [328 + 230 * Math.cos(Math.atan2(155, 175)), 382 + 230 * Math.sin(Math.atan2(155, 175))] as const

function bladeAndLeg(): string {
  return `<g transform="${hero(STRIKE)} scale(${HERO_ART})">${LEG}${swordBlade(STRIKE_BASE, STRIKE_TIP, 7.5)}</g>`
}

// The swing: one quick smeared frame between the lift and the cut, the blade a blur
// of light sweeping down past the token.
function swingFx(): string {
  const c = { x: 40, y: -262 }
  const R = 250
  const pt = (deg: number, rad: number) => {
    const t = (deg * Math.PI) / 180
    return `${n(c.x + Math.cos(t) * rad)} ${n(c.y + Math.sin(t) * rad)}`
  }
  const smear = `M${pt(-118, R)} A${R} ${R} 0 0 1 ${pt(40, R)} A${R + 60} ${R + 60} 0 0 0 ${pt(-118, R)} Z`
  const core = `M${pt(-100, R)} A${R} ${R} 0 0 1 ${pt(30, R)} A${R + 22} ${R + 22} 0 0 0 ${pt(-100, R)} Z`
  let lines = ''
  for (let i = 0; i < 7; i += 1) {
    const deg = -95 + i * 18
    lines += `<path stroke="#ffd24a" stroke-width="3" stroke-linecap="round" d="M${pt(deg, R + 24)} L${pt(deg + 6, R + 70)}"/>`
  }
  return (
    `<g transform="${hero(STRIKE)} scale(${HERO_ART})">${LEG}</g>` +
    `<g filter="url(#ink)"><path d="${smear}" fill="url(#gSlash)" opacity=".85"/><path d="${core}" fill="#fffbe8" opacity=".9"/>${lines}</g>`
  )
}

function slash(): string {
  // A crescent swept from over the hero's head down through the coin.
  const c = { x: 40, y: -262 }
  const R = 285
  const pt = (deg: number, rad: number) => {
    const t = (deg * Math.PI) / 180
    return { x: c.x + Math.cos(t) * rad, y: c.y + Math.sin(t) * rad }
  }
  const a = pt(-112, R)
  const b = pt(58, R)
  const mid = (deg: number) => pt(deg, R)
  const crescent =
    `M${n(a.x)} ${n(a.y)} A${R} ${R} 0 0 1 ${n(b.x)} ${n(b.y)} A${R + 70} ${R + 70} 0 0 0 ${n(a.x)} ${n(a.y)} Z`
  const core = `M${n(a.x)} ${n(a.y)} A${R} ${R} 0 0 1 ${n(b.x)} ${n(b.y)} A${R + 26} ${R + 26} 0 0 0 ${n(a.x)} ${n(a.y)} Z`
  const spine = `M${n(a.x)} ${n(a.y)} A${R - 18} ${R - 18} 0 0 1 ${n(mid(58).x)} ${n(mid(58).y)}`
  return (
    `<mask id="sw" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="4000" height="4000">` +
    `<path class="sweep" pathLength="1" d="${spine}" fill="none" stroke="#fff" stroke-width="150" stroke-linecap="round"/></mask>` +
    `<g filter="url(#ink)">` +
    about(c.x, c.y, 'arc', `<g mask="url(#sw)"><path d="${crescent}" fill="url(#gSlash)"/><path d="${core}" fill="#fffbe8" opacity=".9"/></g>`) +
    `</g>`
  )
}

// A manga shout: a jagged burst with a gold back layer, one spike pointing at the hero,
// and slanted capitals.
function bubble(line: string): string {
  const head = onScreen(STRIKE, 290 * HERO_ART, 110 * HERO_ART)
  const tip = { x: head.x + 18, y: head.y - 34 }
  const text = line.length * 19 + 20 // condensed italic capitals, about 0.53em a letter
  const c = { x: tip.x + 40, y: tip.y - 92 }
  const outline = burstBalloon(c.x, c.y, text / 2 + 44, 66, 11, tip, 7)
  const box =
    `<path class="bubsh" transform="translate(9 9)" d="${outline}"/>` +
    `<path class="bub" d="${outline}"/>` +
    `<text class="bubt" x="${n(c.x)}" y="${n(c.y + 13)}" transform="rotate(-4 ${n(c.x)} ${n(c.y)})">${line}</text>`
  return about(tip.x, tip.y, 'say', about(tip.x, tip.y, 'wob', box))
}

function strikeFx(line: string): string {
  return slash() + bladeAndLeg() + bubble(line)
}

// The whole frame: one full-window drawing, anchored where damn1's cowboy stands.
function frameSvg(content: string, opts: { defs?: string; shake?: boolean } = {}): string {
  const wrap = opts.shake ? `<g class="shake">${content}</g>` : content
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    `<defs>${FX_DEFS}${opts.defs ?? ''}</defs>` +
    `<style>${BASE}${FX_CSS}</style>` +
    `<svg x="${LEFT_FEET_PX}" y="100%" overflow="visible"><g transform="translate(0 -${GROUND_PX})">` +
    `<g class="size">${wrap}</g></g></svg></svg>`
  )
}

function build(): Record<Frame2, string> {
  const strike = (i: number) =>
    frameSvg(heroArt(STRIKE, 'lunge') + splitToken() + strikeFx(LINES[i] ?? LINES[0]), { defs: cutClips(), shake: true })
  return {
    idle: frameSvg(heroArt(IDLE, 'breathe', heldSword(IDLE_BLADE, IDLE_ART, 14)) + liveToken('live') + idleFx()),
    raise: frameSvg(heroArt(RAISE, 'rise', heldSword(RAISE_BLADE, HERO_ART, 9)) + liveToken('flinch') + raiseFx()),
    swing: frameSvg(heroArt(STRIKE, 'lunge') + liveToken('flinch') + swingFx(), { shake: true }),
    strike0: strike(0),
    strike1: strike(1),
    strike2: strike(2),
  }
}

export const FRAMES2 = build()

export const FRAME2_ALT: Record<Frame2, string> = {
  idle: 'DAMN2: the hero stands ready, glowing sword lowered, as a winged evil token hovers in front of him',
  raise: 'DAMN2: the hero lifts his sword above his head and the evil token flinches',
  swing: 'DAMN2: the hero swings his sword down in a blur of light',
  strike0: `DAMN2: the hero cuts the evil token in two with a blazing slash: "${LINES[0]}"`,
  strike1: `DAMN2: the hero cuts the evil token in two with a blazing slash: "${LINES[1]}"`,
  strike2: `DAMN2: the hero cuts the evil token in two with a blazing slash: "${LINES[2]}"`,
}

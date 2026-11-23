import { roundBalloon } from './balloon'
import type { Stage } from '../types'

// Cowboy scenes for the desktop/mobile backdrop: pure SVG + CSS (+ SMIL for the whip's
// shape), built once at load. One cowboy, placed in screen pixels just clear of the app's
// sidebar. Each whip lands on a bucket of asimonim
// (old brass phone tokens) that jolts and sprays tokens on every hit.

type Cowboy = {
  period: number
  delay: number
  angry: boolean
  says: readonly string[]
  lash: boolean
}

type Look = {
  cowboys: Cowboy[]
  dust: boolean
  tumbleweed: boolean
}

const SCALE = 1.9 // cowboy units to scene units
export const LEFT_FEET_PX = 580 // from the window's left edge, past the ~340px sidebar
export const GROUND_PX = 130 // feet above the window's bottom edge

const LOOKS: Record<Exclude<Stage, 0>, Look> = {
  1: {
    cowboys: [
      { period: 3.2, delay: 0, angry: false, lash: true,
        says: ['Round up them tokens!', 'Less thinkin’, more typin’!', 'Ship it, cowboy!'] },
    ],
    dust: false,
    tumbleweed: false,
  },
  2: {
    cowboys: [
      { period: 1.9, delay: 0, angry: true, lash: true,
        says: ['Spend them tokens!', 'OUTPUT, partner!', 'Them GPUs ain’t sweatin’!'] },
    ],
    dust: true,
    tumbleweed: false,
  },
  3: {
    cowboys: [
      { period: 1.5, delay: 0, angry: true, lash: true,
        says: ['STAMPEDE!', 'Herd them tokens!', 'Rate limit’s comin’!'] },
    ],
    dust: true,
    tumbleweed: true,
  },
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString()

// One swing, as fractions of the period. The arm, the lean, the whip's shape, the hit,
// the bucket's jolt and the token spray all share these key times.
const KEY_TIMES = [0, 0.3, 0.42, 0.48, 0.53, 0.6, 0.78, 1]
const ARM = [25, -70, -82, 2, 6, 10, 18, 25] // degrees at the shoulder
const LEAN = [0, -5, -7, 4, 3, 2, 1, 0] // degrees at the feet
// Easing into each key: slow wind-up, a hard accelerating throw, a snap, a soft settle.
const EASE = [
  '0.42 0 0.58 1',
  '0.42 0 0.58 1',
  '0.7 0 1 0.6',
  '0 0 0.3 1',
  '0.3 0 0.5 1',
  '0.4 0 0.7 1',
  '0.4 0 0.6 1',
]
// The whip in the arm's frame (hand at 64,-8), same commands in every key so it morphs:
// coiled, trailing back, stretched back, rolling over, snapped onto the bucket, sagging, falling, coiled.
const WHIP = [
  'M64 -8 C80 40 40 90 0 80 S-30 40 -10 20',
  'M64 -8 C30 -50 -40 -40 -90 0 S-150 90 -120 130',
  'M64 -8 C20 -40 -60 -20 -110 20 S-180 100 -170 150',
  'M64 -8 C140 -90 230 -60 220 -10 S140 40 100 10',
  'M64 -8 C150 -50 260 -30 330 10 S405 60 420 51',
  'M64 -8 C150 -20 250 10 320 40 S390 90 400 110',
  'M64 -8 C120 30 180 80 190 120 S170 170 140 175',
  'M64 -8 C80 40 40 90 0 80 S-30 40 -10 20',
]
const HIT_KEY = 4

function rotate(x: number, y: number, degrees: number): { x: number; y: number } {
  const r = (degrees * Math.PI) / 180
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) }
}

// Where the whip's tip is at the hit, in scene units around the feet (facing right).
const TIP = (() => {
  const atArm = rotate(420, 51, ARM[HIT_KEY] ?? 0)
  const atFeet = rotate(atArm.x + 4, atArm.y - 170, LEAN[HIT_KEY] ?? 0)
  return { x: atFeet.x * SCALE, y: atFeet.y * SCALE }
})()

function keyframes(name: string, degrees: readonly number[]): string {
  let out = `@keyframes ${name}{`
  KEY_TIMES.forEach((t, i) => {
    const ease = EASE[i]
    out +=
      `${n(t * 100)}%{transform:rotate(${degrees[i] ?? 0}deg)` +
      (ease === undefined ? '' : `;animation-timing-function:cubic-bezier(${ease.replaceAll(' ', ',')})`) +
      `}`
  })
  return `${out}}`
}

// Token spray: each token flies a parabola from the bucket's rim to the ground, spinning.
const RIM_Y = -112
const TOKENS = [
  { dx: -130, peak: 150, spin: -540 },
  { dx: -55, peak: 230, spin: 360 },
  { dx: 45, peak: 270, spin: -420 },
  { dx: 120, peak: 200, spin: 720 },
  { dx: 190, peak: 250, spin: -540 },
  { dx: 265, peak: 170, spin: 450 },
  { dx: 330, peak: 120, spin: -300 },
]
const FLIGHT = 0.3 // of the swing
const LAUNCH = 53 // percent, the hit

function tokenKeyframes(): string {
  let out = ''
  TOKENS.forEach((t, j) => {
    out += `@keyframes tok${j}{0%,${LAUNCH - 1}%{transform:translate(0px,${RIM_Y + 10}px) scale(.3);opacity:0}`
    const steps = 6
    for (let k = 0; k <= steps; k += 1) {
      const f = k / steps
      const x = t.dx * f
      const y = RIM_Y + (-8 - RIM_Y) * f - 4 * t.peak * f * (1 - f)
      const pct = LAUNCH + FLIGHT * 100 * f
      const opacity = f < 0.85 ? 1 : 1 - (f - 0.85) / 0.15
      out += `${n(pct)}%{transform:translate(${n(x)}px,${n(y)}px) rotate(${n(t.spin * f)}deg) scale(1);opacity:${n(opacity)}}`
    }
    out += `${n(LAUNCH + FLIGHT * 100 + 1)}%,100%{transform:translate(${t.dx}px,-8px);opacity:0}}`
    out += `.t${j}{animation-name:tok${j}}`
  })
  return out
}

const OUT = '#1d140b'

const DEFS =
  `<defs>` +
  `<linearGradient id="gHat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8743c"/><stop offset="1" stop-color="#5a3818"/></linearGradient>` +
  `<linearGradient id="gBrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c5a2c"/><stop offset="1" stop-color="#432811"/></linearGradient>` +
  `<radialGradient id="gSkin" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffe6d0"/><stop offset="1" stop-color="#e9b493"/></radialGradient><linearGradient id="gHair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dc84"/><stop offset=".55" stop-color="#d9a93f"/><stop offset="1" stop-color="#9c7124"/></linearGradient>` +
  `<linearGradient id="gBoot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4d27"/><stop offset="1" stop-color="#3b2412"/></linearGradient>` +
  `<linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#e8b923"/><stop offset="1" stop-color="#9c7412"/></linearGradient>` +
  `<linearGradient id="gMetal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6f7a84"/><stop offset=".3" stop-color="#e9eef2"/><stop offset=".55" stop-color="#b9c3cb"/><stop offset="1" stop-color="#5f6a74"/></linearGradient>` +
  `<radialGradient id="gBrass" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff3b8"/><stop offset=".45" stop-color="#f0c24a"/><stop offset="1" stop-color="#a87a0c"/></radialGradient>` +
  `<radialGradient id="gFlash"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fff2a8"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/></radialGradient>` +
  `</defs>`

const STYLE =
  `.limbo{fill:none;stroke:${OUT};stroke-width:17;stroke-linecap:round;stroke-linejoin:round}` +
  `.jeans{fill:none;stroke:#2b2e35;stroke-width:12;stroke-linecap:round;stroke-linejoin:round}` +
  `.sleeve{fill:none;stroke:#6f6b4f;stroke-width:12;stroke-linecap:round;stroke-linejoin:round}` +
  `.shirt{fill:#6f6b4f;stroke:${OUT};stroke-width:2.5}` +
  `.forearm{fill:none;stroke:#f1c7a3;stroke-width:10;stroke-linecap:round;stroke-linejoin:round}` +
  `.hair{fill:url(#gHair);stroke:${OUT};stroke-width:2}` +
  `.skin{fill:url(#gSkin);stroke:${OUT};stroke-width:2.2}` +
  `.boot{fill:url(#gBoot);stroke:${OUT};stroke-width:2}` +
  `.gold{fill:url(#gGold);stroke:#8a6514;stroke-width:1.2}` +
  `.line{fill:none;stroke:${OUT};stroke-linecap:round;stroke-linejoin:round}` +
  `.whip{fill:none;stroke:#4a2c14;stroke-width:6.5;stroke-linecap:round;stroke-linejoin:round}` +
  `.whiph{fill:none;stroke:#b8875a;stroke-width:2;stroke-linecap:round;opacity:.85}` +
  `.spark{fill:none;stroke:#ffb020;stroke-width:4;stroke-linecap:round}` +
  `.wave{fill:none;stroke:#ffe27a;stroke-width:4}` +
  `.hit,.wave,.sparks,.tk{opacity:0}` +
  `.bub{fill:#fff4dc;stroke:#2b1d10;stroke-width:4.5;stroke-linejoin:round}` +
  `.bubsh{fill:#2b1d10}` +
  `.bubt{fill:#2b1d10;font-family:'Rockwell Extra Bold',Rockwell,'Roboto Slab','Georgia',serif;font-weight:800;` +
  `font-size:29px;letter-spacing:1.5px;text-transform:uppercase;text-anchor:middle;opacity:0}` +
  `.say0{opacity:1}` +
  `.dust{fill:#c8a27a;opacity:0}` +
  `.weed{fill:none;stroke:#9b7a4c;stroke-width:3;stroke-linecap:round}` +
  `.arm{animation-name:lash;animation-iteration-count:infinite}` +
  keyframes('lash', ARM) +
  `.lean{animation-name:lean;animation-iteration-count:infinite}` +
  keyframes('lean', LEAN) +
  `.hit{animation-name:hit;animation-iteration-count:infinite;animation-timing-function:linear}` +
  `@keyframes hit{0%,52%{transform:scale(0);opacity:0}` +
  `53%{transform:scale(.5);opacity:1;animation-timing-function:cubic-bezier(.2,1.6,.4,1)}` +
  `58%{transform:scale(1.15);opacity:.95;animation-timing-function:ease-in}68%,100%{transform:scale(1.4);opacity:0}}` +
  `.wave{animation-name:wave;animation-iteration-count:infinite;animation-timing-function:linear}` +
  `@keyframes wave{0%,52%{transform:scale(.3);opacity:0}` +
  `53%{transform:scale(.4);opacity:.9;animation-timing-function:cubic-bezier(.1,.7,.3,1)}` +
  `75%,100%{transform:scale(2.6);opacity:0}}` +
  `.sparks{animation-name:sparks;animation-iteration-count:infinite;animation-timing-function:linear}` +
  `@keyframes sparks{0%,52%{transform:scale(.6);opacity:0}` +
  `53%{transform:scale(.7);opacity:1;animation-timing-function:cubic-bezier(.1,.8,.3,1)}` +
  `70%,100%{transform:scale(1.9);opacity:0}}` +
  `.jolt{animation-name:jolt;animation-iteration-count:infinite;animation-timing-function:ease-out}` +
  `@keyframes jolt{0%,52%{transform:none}54%{transform:translate(5px,-3px) rotate(6deg)}` +
  `58%{transform:translate(-3px,0) rotate(-4deg)}63%{transform:rotate(2deg)}70%,100%{transform:none}}` +
  `.tk{animation-iteration-count:infinite;animation-timing-function:linear}` +
  tokenKeyframes() +
  `.flip{animation:flip .36s ease-in-out infinite alternate}` +
  `@keyframes flip{0%{transform:scaleX(1)}100%{transform:scaleX(.2)}}` +
  `.bob{animation:bob 1.3s ease-in-out infinite alternate}` +
  `@keyframes bob{0%{transform:translateY(0)}100%{transform:translateY(-4px)}}` +
  `.bubble{animation:wobble 2.6s ease-in-out infinite alternate}` +
  `@keyframes wobble{0%{transform:rotate(-2deg) scale(1)}100%{transform:rotate(2deg) scale(1.03)}}` +
  `.dust{animation:puff 1.6s cubic-bezier(.2,.6,.4,1) infinite}` +
  `@keyframes puff{0%{transform:translate(0,0) scale(.3);opacity:.5}` +
  `100%{transform:translate(0,-18px) scale(1.9);opacity:0}}` +
  `.roll{animation:roll 8s linear infinite}` +
  `@keyframes roll{0%{transform:translateX(300px)}100%{transform:translateX(2600px)}}` +
  // One size on any window, a step smaller on short or narrow ones.
  `.size{transform:scale(1)}` +
  `@media (max-height: 1000px), (max-width: 1500px){.size{transform:scale(.82)}}` +
  `@media (max-height: 780px), (max-width: 1200px){.size{transform:scale(.64)}}` +
  `.hop{animation:hop .8s cubic-bezier(.3,0,.7,1) infinite alternate}` +
  `@keyframes hop{0%{transform:translateY(0)}100%{transform:translateY(-34px)}}` +
  `.spin{animation:spin 1.8s linear infinite}` +
  `@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`

// An asimon: a brass phone token with its two grooves, centered on 0,0.
const ASIMON =
  `<circle r="14" fill="url(#gBrass)" stroke="#8a6514" stroke-width="2"/>` +
  `<circle r="10" fill="none" stroke="#c99a2a" stroke-width="1.2"/>` +
  `<rect x="-7" y="-4.6" width="14" height="2.6" rx="1.3" fill="#7a5a10"/>` +
  `<rect x="-7" y="2" width="14" height="2.6" rx="1.3" fill="#7a5a10"/>` +
  `<ellipse cx="-4.5" cy="-7" rx="4" ry="2" fill="#fff" opacity=".55"/>`

function boot(fx: number): string {
  return (
    `<path class="boot" d="M${fx - 10} -20 L${fx + 4} -20 L${fx + 6} -7 L${fx + 22} -5 ` +
    `Q${fx + 27} 0 ${fx + 20} 1 L${fx - 12} 1 Z"/>` +
    `<path class="line" stroke-width="1.5" d="M${fx - 11} -3 L${fx + 18} -3"/>` +
    `<path class="gold" d="M${fx - 17} -9 L${fx - 15} -5 L${fx - 11} -5 L${fx - 14} -2.5 L${fx - 13} 1.5 L${fx - 17} -1 L${fx - 21} 1.5 L${fx - 20} -2.5 L${fx - 23} -5 L${fx - 19} -5 Z"/>`
  )
}

function hat(): string {
  const parts =
    // A frayed brim with a bite out of its front edge.
    `<path fill="url(#gBrim)" stroke="${OUT}" stroke-width="2" d="M-52 13 Q-30 2 0 4 Q30 2 52 11 Q58 17 49 18 L44 15.5 L40 18.6 Q0 11 -46 19 Q-59 20 -52 13 Z"/>` +
    `<path fill="none" stroke="#2a180a" stroke-width="1" stroke-dasharray="2 3" opacity=".7" d="M-46 15.5 Q0 8.5 44 14"/>` +
    // A beat-up crown: pinched top, dented side.
    `<path fill="url(#gHat)" stroke="${OUT}" stroke-width="2" d="M-27 8 Q-31 -12 -24 -22 Q-14 -27 -8 -20 Q0 -13 9 -21 Q18 -27 25 -19 Q29 -8 23 -3 Q28 2 27 8 Z"/>` +
    `<path fill="none" stroke="#3a220e" stroke-width="1.6" stroke-linecap="round" d="M-2 -15 Q-1 -6 -4 2 M20 -10 Q25 -6 23 -3"/>` +
    // Sweat-stained band, a bullet hole, dust.
    `<path fill="#2e1c0e" d="M-27 0 Q0 -4.5 27 0 L27.2 8 Q0 3.5 -27.2 8 Z"/>` +
    `<path fill="#c9a06a" opacity=".22" d="M-25 -4 Q0 -9 25 -4 L25 0 Q0 -4.5 -25 0 Z"/>` +
    `<circle cx="-14" cy="-12" r="2.6" fill="#1a0f06" stroke="#c49763" stroke-width="1"/>` +
    `<ellipse cx="12" cy="-12" rx="7" ry="3" fill="#d8b98a" opacity=".16"/>` +
    `<path fill="none" stroke="#fff" stroke-width="2" opacity=".18" stroke-linecap="round" d="M-20 -6 Q-21 -16 -15 -19"/>`
  // Worn low and tilted, the brim shading the eyes.
  return `<g transform="translate(3 -236) rotate(-5)">${parts}</g>`
}

function arm(c: Cowboy): string {
  const limb =
    `<path class="limbo" d="M0 0 L34 14 L60 -4"/>` +
    `<path class="forearm" d="M20 8 L34 14 L56 -1"/>` +
    `<path class="sleeve" d="M0 0 L21 8.6"/>` +
    `<path class="line" stroke="#3a2414" stroke-width="9" d="M57 -1 L74 -18"/>` +
    `<path class="line" stroke="#7a4d27" stroke-width="2.5" d="M60 -5 L66 -11"/>` +
    `<circle class="skin" cx="63" cy="-7" r="7"/>`
  if (!c.lash) {
    // Resting: whip coiled at his side.
    return (
      `<g transform="translate(4 -170)"><g transform="rotate(25)">` +
      `<path class="whip" d="${WHIP[0]}"/><path class="whiph" d="${WHIP[0]}"/>${limb}</g></g>`
    )
  }
  const begin = c.delay === 0 ? '0s' : `${c.delay}s`
  const morph =
    `<animate attributeName="d" dur="${c.period}s" begin="${begin}" repeatCount="indefinite" ` +
    `calcMode="spline" keyTimes="${KEY_TIMES.join(';')}" keySplines="${EASE.join(';')}" values="${WHIP.join(';')}"/>`
  return (
    `<g transform="translate(4 -170)"><g class="arm">` +
    `<path class="whip" d="${WHIP[0]}">${morph}</path>` +
    `<path class="whiph" d="${WHIP[0]}">${morph}</path>` +
    limb +
    `</g></g>`
  )
}

function face(angry: boolean): string {
  const brow = angry
    ? `<path fill="#8a6524" stroke="${OUT}" stroke-width=".8" d="M1 -219 L20 -214 L19.5 -210.5 L1.5 -215.5 Z"/>`
    : `<path fill="#8a6524" stroke="${OUT}" stroke-width=".8" d="M1 -218 L20 -215.5 L19.6 -212.4 L1.4 -214.8 Z"/>`
  return (
    `<ellipse class="skin" cx="-15" cy="-204" rx="5" ry="7.5"/>` +
    `<path class="line" stroke="#c98d6c" stroke-width="1.5" d="M-16.5 -208 Q-13 -205 -16 -200"/>` +
    // A long face with a square, weathered jaw.
    `<path class="skin" d="M-20 -214 Q-22 -236 0 -235 Q22 -236 24 -214 L26 -198 Q27 -183 16 -179 L2 -178 Q-10 -180 -16 -190 Q-20 -198 -20 -214 Z"/>` +
    // Shade from the low brim.
    `<path fill="#5a3a22" opacity=".22" d="M-19 -222 Q2 -216 25 -221 L24.5 -214 Q2 -209 -19.5 -215 Z"/>` +
    // Days of stubble on the jaw, chin and lip.
    `<path fill="#8a6a3a" opacity=".42" d="M-16 -199 Q-12 -184 2 -180 L16 -180 Q26 -184 25.5 -199 Q22 -192 16 -192 Q4 -190 -6 -196 Q-12 -198 -16 -199 Z"/>` +
    `<path fill="none" stroke="#6e5128" stroke-width=".9" stroke-linecap="round" opacity=".5" d="M-10 -190 l1 -2 M-5 -186 l1 -2 M1 -183 l1 -2 M8 -182 l1 -2 M14 -183 l1 -2 M20 -186 l1 -2 M-13 -195 l1 -2"/>` +
    // Squinting eye under a heavy lid.
    `<path fill="#fff" stroke="${OUT}" stroke-width="1.3" d="M6 -207.5 Q10.5 -211.5 16 -208 Q11 -205.2 6 -207.5 Z"/>` +
    `<circle cx="12" cy="-208" r="2.3" fill="#5b7d8f"/><circle cx="12.3" cy="-208" r="1.1" fill="${OUT}"/>` +
    `<path class="line" stroke-width="2.6" d="M5.5 -208 Q10.5 -212.4 16.6 -208.6"/>` +
    `<path class="line" stroke="#a8705a" stroke-width="1" d="M7 -205 Q11 -203.6 15 -205.4 M17.5 -210 L21 -211"/>` +
    brow +
    // An old scar down the cheek.
    `<path fill="none" stroke="#f3b9a8" stroke-width="2.2" stroke-linecap="round" d="M-3 -212 L4 -197"/>` +
    `<path fill="none" stroke="#c97f6c" stroke-width=".9" stroke-linecap="round" d="M-3 -207 l4 -1.6 M-0.6 -202.6 l4 -1.6"/>` +
    `<path class="skin" d="M18 -214 L27.5 -199 Q26 -195.5 20.5 -196.5 Z"/>` +
    // A grim mouth chewing a matchstick.
    `<path class="line" stroke="#7a3f30" stroke-width="2" d="M11 -188.5 Q16 -187.6 22 -189.2"/>` +
    `<path fill="none" stroke="#e8d3a2" stroke-width="2.2" stroke-linecap="round" d="M19 -188.6 L35 -193.5"/>` +
    `<circle cx="35.5" cy="-193.7" r="2" fill="#c8402c"/>`
  )
}

// The hair: blond and shaggy, all of it under the hat: the back of the neck, a
// sideburn and a few strands at the brow. Nothing sticks up above the crown.
const HAIR_BACK =
  `<path class="hair" d="M-21 -226 Q-27 -208 -22 -190 L-17 -196 L-15 -186 L-11 -197 L-8 -190 Q-9 -206 -6 -222 Z"/>` +
  `<path class="hair" d="M-7 -223 L-2 -223 L-3 -203 Q-6 -206 -8 -210 Z"/>` +
  `<path class="hair" d="M3 -225 L8 -215 L10 -222 L14 -213 L17 -223 L23 -217 L24 -226 Z"/>` +
  `<path fill="none" stroke="#a37a2c" stroke-width="1" stroke-linecap="round" opacity=".8" d="M-18 -220 Q-21 -206 -19 -196 M-12 -218 Q-13 -205 -11 -199"/>`

function figure(c: Cowboy): string {
  return (
    `<ellipse cx="0" cy="2" rx="48" ry="7" fill="#000" opacity=".2"/>` +
    `<g${c.lash ? ' class="lean"' : ''}><g class="bob">` +
    // Legs and boots.
    `<path class="limbo" d="M-6 -98 L-22 -20"/><path class="jeans" d="M-6 -98 L-22 -20"/>` +
    `<path class="limbo" d="M6 -98 L22 -20"/><path class="jeans" d="M6 -98 L22 -20"/>` +
    boot(-24) +
    boot(24) +
    // Off arm, hand on the hip (behind the body).
    `<path class="limbo" d="M-14 -176 L-34 -138 L-17 -107"/>` +
    `<path class="forearm" d="M-27 -151 L-34 -138 L-19 -110"/><path class="sleeve" d="M-14 -176 L-27 -152"/>` +
    `<circle class="skin" cx="-16" cy="-106" r="6.5"/>` +
    // Neck, olive tee, badge, belt.
    `<rect x="-6" y="-196" width="12" height="12" fill="url(#gSkin)"/>` +
    `<path class="shirt" d="M-19 -184 Q0 -188 19 -184 L17 -100 L-17 -100 Z"/>` +
    `<path class="line" stroke="#56523b" stroke-width="1.5" opacity=".7" d="M-10 -140 Q0 -136 10 -141 M-12 -118 Q0 -114 12 -119"/>` +
    `<path class="line" stroke="#56523b" stroke-width="2" d="M-12 -184 Q0 -178 12 -184"/>` +
    `<path class="gold" d="M-12 -167 L-10 -162 L-5 -162 L-9 -159 L-7.5 -154 L-12 -157 L-16.5 -154 L-15 -159 L-19 -162 L-14 -162 Z"/>` +
    `<rect x="-18" y="-106" width="36" height="9" rx="2" fill="#3a2414"/>` +
    `<rect class="gold" x="-6.5" y="-108" width="13" height="12" rx="2.5"/>` +
    `<path fill="#d6362f" stroke="#8e1f1a" stroke-width="1.5" d="M-15 -187 L15 -187 L2 -165 Z"/>` +
    face(c.angry) +
    HAIR_BACK +
    hat() +
    arm(c) +
    `</g></g>`
  )
}

const SAY_SECONDS = 4

function bubble(c: Cowboy, i: number): string {
  const longest = Math.max(...c.says.map(s => s.length))
  // Slab capitals run about 0.64em a letter at 29px, plus room either side.
  const width = Math.round(longest * 18.5 + 56)
  // Bubble sits above the head, toward the middle of the screen.
  const ax = 20 * SCALE
  const ay = -288 * SCALE
  const left = ax - 30
  const top = ay - 112
  const tailX = ax + 10
  const outline = roundBalloon(left, top, width, 76, 22, { x: ax, y: ay }, tailX, 18)
  const count = c.says.length
  const cycle = count * SAY_SECONDS
  let rule = ''
  let texts = ''
  c.says.forEach((line, j) => {
    const cls = `s${i}x${j}`
    if (count > 1) {
      const delay = -(((count - j) % count) * SAY_SECONDS)
      rule += `.${cls}{animation:say${i} ${cycle}s linear infinite;animation-delay:${delay}s}`
    }
    texts += `<text class="bubt ${j === 0 ? 'say0 ' : ''}${cls}" x="${n(left + width / 2)}" y="${n(top + 49)}">${line}</text>`
  })
  if (count > 1) {
    const slot = 100 / count
    rule +=
      `@keyframes say${i}{0%{opacity:0;transform:translateY(6px)}${n(slot * 0.08)}%{opacity:1;transform:translateY(0)}` +
      `${n(slot * 0.92)}%{opacity:1;transform:translateY(0)}${n(slot)}%,100%{opacity:0;transform:translateY(-6px)}}`
  }
  const svg =
    `<g transform="translate(${n(ax)} ${n(ay)})"><g class="bubble">` +
    `<g transform="translate(${n(-ax)} ${n(-ay)})">` +
    `<path class="bubsh" transform="translate(6 7)" d="${outline}"/>` +
    `<path class="bub" d="${outline}"/>` +
    texts +
    `</g></g></g>`
  return `${svg}<style>${rule}</style>`
}

function sparks(): string {
  let out = ''
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i + 0.3
    const x1 = Math.cos(a) * 40
    const y1 = Math.sin(a) * 32
    out += `<path class="spark" d="M${n(x1)} ${n(y1)} L${n(x1 * 1.6)} ${n(y1 * 1.6)}"/>`
  }
  return out
}

// The bucket stands where the whip lands, base on the ground; the tip strikes its rim.
function bucket(c: Cowboy): string {
  const x = TIP.x
  let heap = ''
  for (const [hx, hy] of [[-26, -112], [-8, -116], [12, -113], [28, -110], [2, -108]] as const) {
    heap += `<g transform="translate(${hx} ${hy}) scale(.6)">${ASIMON}</g>`
  }
  let spray = ''
  if (c.lash) {
    TOKENS.forEach((_, j) => {
      spray += `<g class="tk t${j}"><g class="flip">${ASIMON}</g></g>`
    })
  }
  const hit = c.lash
    ? `<g transform="translate(0 ${n(TIP.y)})">` +
      `<circle class="wave" r="26"/><g class="sparks">${sparks()}</g><circle class="hit" r="38" fill="url(#gFlash)"/></g>`
    : ''
  return (
    `<g transform="translate(${n(x)} 0)">` +
    `<ellipse cx="0" cy="3" rx="74" ry="11" fill="#000" opacity=".2"/>` +
    `<g class="${c.lash ? 'jolt' : ''}"><g transform="scale(1.12)">` +
    `<path fill="none" stroke="#5f6a74" stroke-width="5" stroke-linecap="round" d="M58 -92 Q0 -172 -58 -92"/>` +
    `<path fill="url(#gMetal)" stroke="#4d565e" stroke-width="2.5" d="M-60 -95 L-48 -2 Q0 7 48 -2 L60 -95 Z"/>` +
    `<path fill="none" stroke="#5f6a74" stroke-width="4" d="M-57 -72 Q0 -64 57 -72"/>` +
    `<path fill="none" stroke="#5f6a74" stroke-width="4" d="M-51 -22 Q0 -14 51 -22"/>` +
    `<circle cx="-56" cy="-86" r="3" fill="#4d565e"/><circle cx="56" cy="-86" r="3" fill="#4d565e"/>` +
    `<path fill="none" stroke="#fff" stroke-width="6" opacity=".35" stroke-linecap="round" d="M-38 -86 L-30 -10"/>` +
    `<ellipse cx="0" cy="-95" rx="60" ry="12" fill="#dfe5ea" stroke="#4d565e" stroke-width="2.5"/>` +
    `<ellipse cx="0" cy="-95" rx="52" ry="8.5" fill="#2f363c"/>` +
    `</g>${heap}</g>` +
    spray +
    hit +
    `</g>`
  )
}

function dust(): string {
  let out = ''
  for (let i = 0; i < 3; i += 1) {
    const dx = (i - 1) * 34 * SCALE
    out += `<g transform="translate(${n(dx)} -6)"><circle class="dust" r="22" style="animation-delay:-${n(i * 0.5)}s"/></g>`
  }
  return out
}

function tumbleweed(): string {
  return (
    `<svg x="0" y="100%" overflow="visible"><g transform="translate(0 -${GROUND_PX + 30})">` +
    `<g class="roll"><g class="hop"><g class="spin"><g transform="scale(1.7)">` +
    `<circle class="weed" r="30"/>` +
    `<path class="weed" d="M-24 -12 Q0 -34 22 -10 Q30 14 4 26 Q-26 22 -20 -4 Q-6 -20 12 -6 Q16 10 -2 12"/>` +
    `<path class="weed" d="M-28 6 Q-8 30 18 20 M-10 -28 Q14 -22 26 4"/>` +
    `</g></g></g></g></g></svg>`
  )
}

function scene(stage: Exclude<Stage, 0>): string {
  const look = LOOKS[stage]
  let timing = ''
  let body = ''
  look.cowboys.forEach((c, i) => {
    timing +=
      `.k${i} .arm,.k${i} .lean,.k${i} .hit,.k${i} .wave,.k${i} .sparks,.k${i} .jolt,.k${i} .tk{` +
      `animation-duration:${c.period}s;animation-delay:${c.delay}s}`
    body +=
      `<g class="k${i}"><svg x="${LEFT_FEET_PX}" y="100%" overflow="visible">` +
      `<g transform="translate(0 -${GROUND_PX})"><g class="size">` +
      (look.dust ? dust() : '') +
      bucket(c) +
      `<g transform="scale(${SCALE})">${figure(c)}</g>` +
      bubble(c, i) +
      `</g></g></svg></g>`
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    DEFS +
    `<style>${STYLE}${timing}</style>` +
    `<g>` +
    (look.tumbleweed ? tumbleweed() : '') +
    body +
    `</g></svg>`
  )
}

export const SCENES: Record<Exclude<Stage, 0>, string> = {
  1: scene(1),
  2: scene(2),
  3: scene(3),
}

export const SCENE_ALT: Record<Exclude<Stage, 0>, string> = {
  1: 'GIDDY UP: a cowboy whips a bucket of tokens and they spray out',
  2: 'YEE-HAW: an angry cowboy whips the token bucket fast in a cloud of dust',
  3: 'STAMPEDE: the cowboy whips the token bucket at full speed as a tumbleweed bounces by',
}

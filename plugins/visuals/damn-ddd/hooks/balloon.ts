// Speech balloon outlines for both shows, each one closed path with its tail built in,
// so the outline never crosses itself where the tail meets the body.

const n = (v: number): string => (Math.round(v * 10) / 10).toString()

export type Point = { x: number; y: number }

/**
 * A rounded comic balloon with a curved tail from its bottom edge to `tip`.
 * `base` is where the tail leaves the bottom edge; `spread` is half its width there.
 */
export function roundBalloon(left: number, top: number, w: number, h: number, r: number, tip: Point, base: number, spread: number): string {
  const right = left + w
  const bottom = top + h
  const b0 = Math.max(left + r + 2, base - spread)
  const b1 = Math.min(right - r - 2, base + spread)
  // The tail bows a little toward the tip, like an inked comic tail, not a straight wedge.
  const bow = (tip.x - (b0 + b1) / 2) * 0.35
  return (
    `M${n(left + r)} ${n(top)}H${n(right - r)}A${r} ${r} 0 0 1 ${n(right)} ${n(top + r)}` +
    `V${n(bottom - r)}A${r} ${r} 0 0 1 ${n(right - r)} ${n(bottom)}H${n(b1)}` +
    `Q${n(b1 + bow)} ${n(bottom + (tip.y - bottom) * 0.45)} ${n(tip.x)} ${n(tip.y)}` +
    `Q${n(b0 + bow * 0.4)} ${n(bottom + (tip.y - bottom) * 0.3)} ${n(b0)} ${n(bottom)}` +
    `H${n(left + r)}A${r} ${r} 0 0 1 ${n(left)} ${n(bottom - r)}V${n(top + r)}A${r} ${r} 0 0 1 ${n(left + r)} ${n(top)}Z`
  )
}

/**
 * A jagged shout burst around an ellipse, with one long spike reaching `tip`.
 * `seed` keeps the jag pattern the same on every load.
 */
export function burstBalloon(cx: number, cy: number, rx: number, ry: number, spikes: number, tip: Point, seed: number): string {
  let s = seed
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const tipAngle = Math.atan2((tip.y - cy) / ry, (tip.x - cx) / rx)
  const pts: string[] = []
  for (let i = 0; i < spikes * 2; i += 1) {
    const a = (i / (spikes * 2)) * Math.PI * 2
    const isOut = i % 2 === 0
    let dist = Math.abs(Math.atan2(Math.sin(a - tipAngle), Math.cos(a - tipAngle)))
    dist = Math.min(dist, Math.PI)
    if (isOut && dist < Math.PI / spikes) {
      pts.push(`${n(tip.x)} ${n(tip.y)}`)
      continue
    }
    const k = isOut ? 1.13 + rand() * 0.1 : 0.9 + rand() * 0.04
    pts.push(`${n(cx + Math.cos(a) * rx * k)} ${n(cy + Math.sin(a) * ry * k)}`)
  }
  return `M${pts.join('L')}Z`
}

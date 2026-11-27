/** 0 idle (nothing drawn), 1 giddy up, 2 yee-haw, 3 stampede. */
export type Stage = 0 | 1 | 2 | 3

/** Which show is out: damn1 the cowboy and his whip, damn2 the hero and his sword. */
export type Show = 'damn1' | 'damn2'

/** damn2's held key frame; each strike carries one of the three lines. */
export type Frame2 = 'idle' | 'raise' | 'swing' | 'strike0' | 'strike1' | 'strike2'

declare module 'claude-code' {
  interface PluginState {
    'damn-ddd': { stage: Stage; show: Show; frame: Frame2 }
  }
}

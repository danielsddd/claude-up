export type Busy = boolean

declare module 'claude-code' {
  interface PluginState {
    'prompt-tools': { isBusy: Shaped<Busy> }
  }
}

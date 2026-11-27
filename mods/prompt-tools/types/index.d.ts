export type Busy = boolean

// One critic slot: the model answering (it changes when a fallback takes over) and its result.
export type Slot = {
  id: string
  name: string
  status: 'running' | 'done' | 'failed'
  note: string
  error: string
  text: string
}

// The web fact check. `text` is the search evidence handed to the merge.
export type Facts = {
  status: 'off' | 'running' | 'done' | 'failed'
  note: string
  text: string
}

export type Run = {
  phase: 'idle' | 'critiquing' | 'merging' | 'review'
  // The plan row the run started from ('' when started from the band or the command).
  rowId: string
  planLabel: string
  planText: string
  slots: Slot[]
  facts: Facts
  brief: string
  error: string
  // The brief waits for the message box, which the plan card hides.
  pendingFill: boolean
  isFilled: boolean
}

// The latest plan in this session: a plan file Claude wrote, or the text it proposed.
export type LastPlan = { path: string; label: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-tools': { isBusy: Shaped<Busy>; run: Shaped<Run>; lastPlan: Shaped<LastPlan> }
  }
}

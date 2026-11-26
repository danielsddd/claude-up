export type Phase = 'idle' | 'critiquing' | 'merging' | 'review'
export type Provider = 'nemotron' | 'mistral' | 'gptoss' | 'qwen'
export type CritiqueStatus = 'idle' | 'querying' | 'done' | 'failed'
export type Critique = { status: CritiqueStatus; text: string; error: string; note: string }
export type Run = {
  phase: Phase
  planPath: string | null
  planLabel: string
  planText: string
  critiques: Record<Provider, Critique>
  mergedText: string
  revisedClaudeOption: string
  error: string
  pendingFill: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-tools': { run: Shaped<Run>; isBusy: Shaped<boolean> }
  }
}

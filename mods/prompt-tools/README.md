# prompt-tools

Prompt Master: one button above the Claude Code message box that rewrites a rough prompt into a clear one.

- Rewrites the draft in the message box with Claude Sonnet, keeping your intent, language and every point.
- Never sends it. Keeps your draft if the rewrite is cut off, fails, or you kept typing meanwhile.

## Install

```
/plugin install prompt-tools --marketplace danielsddd/claude-up
```

## Use

| Action | How |
| --- | --- |
| Rewrite a draft | Type it, then press **Prompt Master** above the message box |
| Send it | Review the rewrite and send it yourself |

## Cost

About 700 Claude tokens per rewrite; the reply is capped at about 3x the draft, at most 8,000. It runs outside the conversation, so nothing is added to the context.

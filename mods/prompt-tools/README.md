# prompt-tools

Two buttons above the Claude Code message box: Prompt Master rewrites a rough prompt, and Critique Plan has free models review a plan.

- **Prompt Master:** rewrites the draft in the message box into a clearer prompt with Claude Sonnet. It never sends it, and keeps your draft if the rewrite is cut off or you kept typing.
- **Critique Plan:** sends the current plan to four free models (Nemotron 3 Ultra, Mistral Large 4, gpt-oss-120b, Qwen 3.8), merges their critiques with Sonnet, and puts the brief in the message box. It never sends it and never overwrites a draft.
- Critique Plan runs its requests in a hidden PowerShell helper, so it works on **Windows only**. Prompt Master works everywhere.
- Your plan text is sent to NVIDIA and Groq. Keys stay in your environment variables; the mod never reads them, only the helper does.

## Install

```
/plugin install prompt-tools --marketplace danielsddd/claude-up
```

Critique Plan needs two free keys, set as Windows user environment variables, then a full restart of Claude Code:

| Variable | Where to get it | Used by |
| --- | --- | --- |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) → Get API Key | Nemotron, Mistral |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | gpt-oss, Qwen |

```powershell
[Environment]::SetEnvironmentVariable('NVIDIA_API_KEY', '<key>', 'User')
[Environment]::SetEnvironmentVariable('GROQ_API_KEY', '<key>', 'User')
```

A missing key fails only the critics that use it; the others still run.

## Use

| Action | How |
| --- | --- |
| Rewrite a draft | **Prompt Master** above the message box |
| Critique a plan | **Critique Plan** above the message box, under a proposed plan's row, or `/critique-plan` |
| Put the brief in the box | Automatic when the box is empty; otherwise **Submit** |
| Rerun failed critics | **Retry failed** |
| Stop | **Cancel** |
| Change a model | Plugin options `nemotronModel`, `mistralModel`, `groqModel`, `qwenModel` |

## Cost

| Action | Claude tokens |
| --- | --- |
| Prompt Master | about 700 per rewrite; the reply is capped at about 3x the draft, at most 8,000 |
| Critique Plan | 0 for the four critics (free external APIs); about 10-40K for the Sonnet merge |
| Buttons, band, `/critique-plan` | 0 |

Both Sonnet calls run outside the conversation, so nothing is added to the context.

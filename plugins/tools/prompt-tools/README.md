# prompt-tools

Two buttons above the Claude Code message box: **Prompt Master** rewrites a rough prompt, and **Critique Plan** has five free models review the session's plan before any code is written.

![Prompt Master: a rough draft rewritten into a clear prompt](https://github.com/danielsddd/claude-up/releases/download/v0.2.0/prompt-tools.png)

- **Prompt Master** rewrites the draft with Claude Sonnet and keeps your intent, language and every point. If the rewrite is cut off, fails, or you kept typing, your draft stays as it was.
- **Critique Plan** sends the plan Claude wrote in plan mode to five critics at once, each with its own focus: facts and versions, the plan as a whole, engineering, security and cost, and simplicity. When a model is rate limited, out of free quota or silent, the next one in its slot takes over.
- **Fact check:** a web search (Tavily) checks the libraries, versions and APIs the plan names, and the brief marks each claim ✓, ✗ or ? with its source.
- Sonnet merges everything into one brief: Must fix, Worth considering, Fact check, Reviewers disagreed, Changes to make. The brief goes into your message box. Nothing is ever sent for you.
- **Merge now** appears once two critics have answered, so you don't have to wait for the slow reasoning models.

> Critique Plan runs a background PowerShell helper, so it works on Windows only. It sends the plan text to NVIDIA, Groq, Google Gemini and OpenRouter, and the claims it checks to Tavily.

## Install

```
/plugin install prompt-tools --marketplace danielsddd/claude-up
```

Critique Plan reads free API keys from environment variables. A missing key only skips the models that need it.

| Variable | Used for |
| --- | --- |
| `NVIDIA_API_KEY` | Mistral Large 4, Kimi K3.1 Pro, Nemotron (build.nvidia.com) |
| `GROQ_API_KEY` | GPT-OSS 120B |
| `GEMINI_API_KEY` | Gemini 3.5 Flash, Flash-Lite, the claim extractor |
| `OPENROUTER_API_KEY` | ERNIE 5.5 Flash, free models only |
| `TAVILY_API_KEY` | the fact check |

## Use

| Action | How |
| --- | --- |
| Rewrite a draft | Type it, then press **Prompt Master** |
| Critique a plan | Press **Critique Plan** under the proposed plan, or above the message box, or run `/critique-plan` |
| Use the brief | It goes into the message box; review it and send it yourself |
| Rerun what failed | **Retry failed** |
| Settings | `factCheck` (on) and `research` (`off`, `mini` or `pro`) in the plugin's settings |

## How it works

- **Prompt Master** is one `$.model.complete` call to Sonnet. Its reply cap scales with the draft, and the result goes into the box with `$.prompt.fill`.
- **Critique Plan** takes the exact plan of this session: the plan file Claude last wrote, or the plan it proposed. It never guesses from other files. The app ends a plugin's web request after 30 s, so the mod starts a hidden PowerShell helper (`worker/critique.ps1`). The helper streams all five critics at once from `config/lineup.json`, runs the fact check alongside, and writes progress files that the mod reads every 2 s. When the helper is done, the mod merges the results with Sonnet.

The helper only uses free tiers. It stops the fact check before Tavily's free credits run out, and it turns off OpenRouter for good if the account ever shows spend or paid credits. It writes these switches, each with the reason, to `%LOCALAPPDATA%\prompt-tools\providers.json`.

## Cost

- **Prompt Master:** about 700 Claude tokens per rewrite. The reply is capped at about 3x the draft, at most 8,000 tokens.
- **Critique Plan:** one Sonnet merge, about 8,000-15,000 Claude tokens. The critics use free tiers. The fact check costs about 2 Tavily credits per claim, at most 6 claims. Deep research (off by default) costs 4-250 credits.
- Both run outside the conversation, so they add nothing to the context.

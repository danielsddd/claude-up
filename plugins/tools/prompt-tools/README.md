# prompt-tools

Two buttons above the Claude Code message box: **Prompt Master** rewrites a rough prompt, and **Critique Plan** has five free models review the session's plan before any code is written.

## Prompt Master

![Prompt Master: a rough draft rewritten into a clear prompt](https://github.com/danielsddd/claude-up/releases/download/v0.2.0/prompt-tools.png)

- Rewrites the draft with Claude Sonnet and keeps your intent, language and every point.
- If the rewrite is cut off, fails, or you kept typing, your draft stays as it was. Nothing is sent for you.

## Critique Plan

![Critique Plan: five critics and a fact check, each with its state and usage](https://github.com/danielsddd/claude-up/releases/download/v0.4.0/critique-plan.png)

- Sends the plan Claude wrote in plan mode to five free critics at once, each with its own focus: facts and versions, the plan as a whole, engineering, security and cost, and simplicity. A full run takes about 1-2 minutes.
- When a model is rate limited, out of free quota, retired, silent or slower than its time limit, the next one in its slot takes over, and the row says which model it replaced and why.
- **Fact check:** a web search (Tavily) checks the libraries, versions and APIs the plan names, and the brief marks each claim ✓, ✗ or ? with its source.
- **Deep research, per critique:** while the critics run, **Add research** lets you add a Tavily research report to this critique: `mini` (4-110 credits) or `pro` (15-250). It is never on unless you choose it.
- Sonnet merges everything into one brief: Must fix, Worth considering, Fact check, Reviewers disagreed, Changes to make. It shows under the plan and goes into your message box. Nothing is sent for you.
- Each row shows its usage, such as `3/1000 daily requests | 6.2k/18k tokens`. **Merge now** appears once two critics have answered.

> Critique Plan runs a background PowerShell helper, so it works on Windows only. It sends the plan text to NVIDIA, Groq, Google Gemini and OpenRouter, and the claims it checks to Tavily.

## Install

```
/plugin install prompt-tools --marketplace danielsddd/claude-up
```

Critique Plan reads free API keys from environment variables. A missing key only skips the models that need it.

| Variable | Used for |
| --- | --- |
| `NVIDIA_API_KEY` | Nemotron 3 Ultra, 3.5 Super and 3.5 Lightning (build.nvidia.com) |
| `GROQ_API_KEY` | GPT-OSS 20B and 120B |
| `GEMINI_API_KEY` | Gemini 3.5 Flash, Flash-Lite, the claim extractor |
| `OPENROUTER_API_KEY` | ERNIE 5.5 Flash, free models only |
| `TAVILY_API_KEY` | the fact check |

## Use

| Action | How |
| --- | --- |
| Rewrite a draft | Type it, then press **Prompt Master** |
| Critique a plan | Press **Critique Plan** under the proposed plan, or above the message box, or run `/critique-plan` |
| Read the brief | It shows under the plan while the plan card is open, and above the message box afterwards |
| Use the brief | Choose **No, keep planning** on the plan card: the brief goes into the message box; review it and send it yourself |
| Read a critic's row | Model and details on the left (usage such as `3/1000 daily requests \| 4.2k/38k tokens`, or which model it replaced and why); its state on the right |
| Add deep research to one critique | After **Critique Plan**, press **Add research**, then **Mini** or **Pro** (or **Back**) |
| Rerun what failed | **Retry failed** |
| Settings | `factCheck` (on) and `research` (`off`, `mini` or `pro`: research in every critique; off by default) in the plugin's settings |

## How it works

- **Prompt Master** is one `$.model.complete` call to Sonnet. Its reply cap scales with the draft, and the result goes into the box with `$.prompt.fill`.
- **Critique Plan** takes the exact plan of this session: the plan file Claude last wrote, or the plan it proposed. It never guesses from other files. The app ends a plugin's web request after 30 s, so the mod starts a hidden PowerShell helper (`worker/critique.ps1`). The helper streams all five critics at once from `config/lineup.json`, runs the fact check alongside, and writes progress files that the mod reads every 2 s. When the helper is done, the mod merges the results with Sonnet.

The helper only uses free tiers. It stops the fact check before Tavily's free credits run out, and it turns off OpenRouter for good if the account ever shows spend or paid credits. It writes these switches, each with the reason, to `%LOCALAPPDATA%\prompt-tools\providers.json`.

**Usage numbers.** Each provider reports the tokens of every answer, and Groq also reports its daily request limit. No provider offers a usage API for free keys, so the helper keeps today's requests and the token totals per model in `%LOCALAPPDATA%\prompt-tools\usage.json`. It counts only Critique Plan's own requests.

**Monthly check.** About once a month, when a session starts, the mod runs the helper in check mode in the background: one tiny request to every model in the lineup, plus a read of Tavily's free credits. It turns back on models that answer again, turns off models that are retired or no longer free, and saves the result to `%LOCALAPPDATA%\prompt-tools\limits.json`. The next session shows one notice: either that every model answers for free, or each problem it found.

**When something goes wrong**, the critic's row says what happened, and its slot moves to the next model:

| Message | Meaning | What happens |
| --- | --- | --- |
| `daily quota used up (back after midnight UTC)` | The free daily requests for that model are spent | Model skipped until midnight UTC |
| `free daily requests used up` | OpenRouter's free daily requests are spent | OpenRouter skipped until midnight UTC |
| `rate limited (HTTP 429), try again in a minute` | Too many requests a minute | Next model; **Retry failed** later |
| `no longer free (HTTP 402)` or `no longer free on this key (quota 0)` | The provider now wants payment | Provider or model turned off, free only |
| `model retired or renamed (HTTP 404)` | The model left the provider | Model skipped for 30 days, re-tested by the monthly check |
| `API key rejected (HTTP 401)` or `no API key (set ...)` | The key is wrong or missing | Model skipped; set the key |
| `slower than 150s` or `no answer for 180s` | The provider is slow or stalled | Next model |
| `provider busy (HTTP 503)`, `provider error (HTTP 5xx)`, `API call failed: ...` | A network or provider failure | Next model; **Retry failed** later |
| `replaced <model>: <reason>` | A fallback answered instead | Shown on the row that answered |
| `all models failed: ...` | Every model in the slot failed, each reason listed | The brief uses the other critics |

## Cost

- **Prompt Master:** about 700 Claude tokens per rewrite. The reply is capped at about 3x the draft, at most 8,000 tokens.
- **Critique Plan:** one Sonnet merge, about 8,000-15,000 Claude tokens. The critics use free tiers. The fact check costs about 2 Tavily credits per claim, at most 6 claims. Deep research (off by default) costs 4-250 credits.
- Both run outside the conversation, so they add nothing to the context.

# claude-up

**A growing collection of tricks for Claude Code: mods, themes and tools I build for my own setup, open source and documented so you can use them or build your own.**

[![CI](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml/badge.svg)](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code 2.1.330+](https://img.shields.io/badge/Claude%20Code-2.1.330%2B-d97757)

claude-up collects **Claude Code mods**: plugins built on Claude Code's own hooks that change how it looks and works. Every trick gets its own folder with a README covering what it does, what it costs in tokens, how it was built and how to change it. New ones get added as I build them.

## Tricks so far

| Mod | What it does | Model tokens |
| --- | --- | --- |
| [damn-ddd](mods/damn-ddd) | When one reply runs 10 minutes, an animated show plays behind the chat: a cowboy whipping a bucket of tokens (damn1) or an anime hero cutting an evil token in two (damn2). They take turns, and a click sends them off. | **0** |
| [prompt-tools](mods/prompt-tools) | Two buttons above the message box. **Prompt Master** rewrites a rough prompt with Sonnet. **Critique Plan** sends Claude's plan to four free AI models and merges their critiques with Sonnet. | ~700 a rewrite; ~10-40K a critique merge (see its README) |

## Quickstart (about a minute)

You need Claude Code 2.1.330 or newer.

**Install one mod in one line**, at the prompt of a terminal session (`claude`):

```
/plugin install damn-ddd --marketplace danielsddd/claude-up
```

Answer `y` to add the marketplace, pick the user scope, and it's active, in the terminal and in the desktop app's Code tab from your next session. From a shell it's `claude plugin install damn-ddd --marketplace danielsddd/claude-up`. In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `danielsddd/claude-up`, then **Add plugin**.

**Or run them from a clone**, which is handy if you want to change them:

1. Get the code:

   ```bash
   git clone https://github.com/danielsddd/claude-up.git
   ```

2. Tell Claude Code where the mods are. Add them to the `env` block of `~/.claude/settings.json` (on Windows that's `C:\Users\<you>\.claude\settings.json`), separating folders with `;` on Windows and `:` on macOS and Linux:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\claude-up\\mods\\damn-ddd;C:\\path\\to\\claude-up\\mods\\prompt-tools",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
   }
   ```

   Pick only the mods you want. `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes the desktop app reload a mod when you edit its files.

3. Fully quit and reopen Claude Code. Each mod's README covers its own setup (prompt-tools needs three free API keys).

To try one mod for a single terminal session instead: `claude --plugin-dir path/to/claude-up/mods/<mod>`.

## What "model tokens" means here

A mod can run without ever calling a model: damn-ddd only draws and times things, so it costs nothing beyond the Claude Code you're already running. A mod that calls Claude (prompt-tools uses Sonnet) spends tokens from your Claude plan on each click, outside your conversation, so it doesn't fill your context window. Each mod's README gives its own numbers.

## Repository layout

```
mods/<mod>/
  .claude-plugin/plugin.json   name, version, options
  hooks/                       the code Claude Code loads (hooks.json lists the entry module)
  types/                       the mod's state contract
  tests/                       tests, run with `claude plugin test mods/<mod>`
  README.md                    what it does, cost, how it works, how to change it
```

Claude Code only loads what `hooks/hooks.json` names, so tests and tools never cost anything at runtime.

## Build your own

Every mod here started as a sentence to Claude Code ("when a reply runs long, show a cowboy"). Claude Code ships a `plugin-authoring` skill with the full API: open a session and ask it to make a mod. To check one:

```bash
claude plugin validate mods/<mod>   # what the engine will load or refuse
claude plugin test mods/<mod>       # runs tests/*.test.ts(x) against the real engine
```

## Security

No mod here contains an API key. prompt-tools reads its keys from your own environment variables and masks them in any error it shows. Don't commit a `.env` file; `.gitignore` already blocks it.

## License

[MIT](LICENSE)

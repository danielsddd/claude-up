# claude-up

**Open-source extensions that improve Claude Code.**

[![CI](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml/badge.svg)](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code 2.1.330+](https://img.shields.io/badge/Claude%20Code-2.1.330%2B-d97757)

claude-up is a set of extensions for [Claude Code](https://claude.com/claude-code), Anthropic's coding agent. Each extension is a Claude Code plugin built on its official hooks API, and each one is documented in full: what it does, its cost in model tokens, how it works, and how to adapt it.

## Extensions

| Extension | Description | Model tokens |
| --- | --- | --- |
| [damn-ddd](mods/damn-ddd) | Animated scenes behind the chat while a long reply runs, in two styles that alternate. Dismissed with a click. | 0 |

## Installation

Requires Claude Code 2.1.330 or later.

### From the marketplace

In a terminal session (`claude`), run:

```
/plugin install damn-ddd --marketplace danielsddd/claude-up
```

Confirm the marketplace with `y` and choose the user scope. The extension is then active in the terminal and in the desktop app's Code tab from the next session.

From a shell: `claude plugin install damn-ddd --marketplace danielsddd/claude-up`.
In the desktop app: **+** next to the prompt box → **Plugins** → **Add marketplace** (`danielsddd/claude-up`) → **Add plugin**.

### From source

1. Clone the repository:

   ```bash
   git clone https://github.com/danielsddd/claude-up.git
   ```

2. Add the extension folders to the `env` block of `~/.claude/settings.json`, separated by `;` on Windows and `:` on macOS and Linux:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-up/mods/damn-ddd",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
   }
   ```

   `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` reloads an extension in the desktop app when its files change.

3. Restart Claude Code.

For a single terminal session: `claude --plugin-dir /path/to/claude-up/mods/<extension>`.

## Token cost

Each extension states its cost in model tokens. An extension that only draws or schedules work, such as damn-ddd, makes no model calls and adds nothing to the context window. An extension that calls a model spends tokens from the user's Claude plan, outside the conversation.

## Repository layout

```
mods/<extension>/
  .claude-plugin/plugin.json   manifest and options
  hooks/                       the code Claude Code loads, listed in hooks/hooks.json
  types/                       state contract
  tests/                       engine tests
  README.md                    documentation
```

Claude Code loads only the modules listed in `hooks/hooks.json`; tests and tools have no runtime cost.

## Development

Extensions are written against the Claude Code plugin API, documented by the `plugin-authoring` skill that ships with Claude Code. To check an extension:

```bash
claude plugin validate mods/<extension>
claude plugin test mods/<extension>
```

## Security

The repository contains no API keys. Extensions that need a key read it from an environment variable and mask it in error messages.

## License

[MIT](LICENSE)

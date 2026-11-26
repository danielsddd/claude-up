# claude-up

**Open-source extensions that improve Claude Code.**

[![CI](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml/badge.svg)](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code 2.1.330+](https://img.shields.io/badge/Claude%20Code-2.1.330%2B-d97757)

Each extension is a Claude Code plugin in its own folder under `mods/`.

| Extension | Description | Model tokens |
| --- | --- | --- |
| [damn-ddd](mods/damn-ddd) | Animated scenes behind the chat during long replies | 0 |
| [prompt-tools](mods/prompt-tools) | Prompt Master: rewrite a rough prompt into a clear one | about 700 per rewrite |

## Install

Requires Claude Code 2.1.330 or later. In a terminal session:

```
/plugin install <extension> --marketplace danielsddd/claude-up
```

Or from source: clone the repo and add `mods/<extension>` to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, then restart Claude Code.

## License

[MIT](LICENSE)

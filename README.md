# claude-up

**Open-source extensions that improve Claude Code.**

[![CI](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml/badge.svg)](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code 2.1.330+](https://img.shields.io/badge/Claude%20Code-2.1.330%2B-d97757)

Each extension is a Claude Code plugin in its own folder under `mods/`.

| Extension | Description | Model tokens |
| --- | --- | --- |
| [damn-ddd](mods/damn-ddd) | Animated scenes behind the chat during long replies | 0 |
| [prompt-tools](mods/prompt-tools) | Prompt Master rewrites a rough prompt; Critique Plan has five free models and a web fact check review a plan, merged by Sonnet | about 700 per rewrite; about 8-15k per critique |
| [profiles](mods/profiles) | Focus Claude on one folder: matching skills, scoped permissions, run steps | 0 at rest, 3-8k per run |
| [dev-vault](mods/dev-vault) | A markdown second brain: session handoffs, decisions and solved bugs | 0 at rest, 1-3k per command |

## Install

Requires Claude Code 2.1.330 or later. In a terminal session:

```
/plugin install <extension> --marketplace danielsddd/claude-up
```

Or from source: clone the repo and add `mods/<extension>` to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, then restart Claude Code.

## License

[MIT](LICENSE)

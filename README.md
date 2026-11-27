<div align="center">

# claude-up

**Open-source plugins for Claude Code: visuals, session tools and workflow skills, each with its model-token cost stated.**

[![CI](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml/badge.svg)](https://github.com/danielsddd/claude-up/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Claude Code 2.1.330+](https://img.shields.io/badge/Claude%20Code-2.1.330%2B-d97757)

</div>

## 1. What this is

claude-up is a plugin marketplace for [Claude Code](https://claude.com/claude-code). Each plugin does one job, installs on its own, and states up front how many model tokens it costs. None of them sends a message for you or stores a secret: API keys stay in your own environment variables.

- **Install one, not all:** every plugin is independent. Pick the ones you want from the catalog below.
- **Costs stated up front:** most plugins cost nothing at rest. Visuals never call a model.
- **Plain files:** skills are markdown, mods are TypeScript hooks, and helpers are readable scripts. Nothing is minified or hosted elsewhere.

## 2. Catalog

### Visuals

Backdrops and themes. UI only, no model calls.

| Plugin | What it does | Model tokens |
| --- | --- | --- |
| [damn-ddd](plugins/visuals/damn-ddd) | An animated backdrop behind the chat while a long reply runs | 0 |

### Tools

Buttons and commands that act in the current session.

| Plugin | What it does | Model tokens |
| --- | --- | --- |
| [prompt-tools](plugins/tools/prompt-tools) | **Prompt Master** rewrites a rough prompt. **Critique Plan** has five free models and a web fact check review the session's plan, merged into one brief | about 700 per rewrite; 8-15k per critique |

### Workflow

Skill packs that organize work across sessions and projects.

| Plugin | What it does | Model tokens |
| --- | --- | --- |
| [dev-vault](plugins/workflow/dev-vault) | A markdown knowledge base: session handoffs, decisions and solved bugs | 0 at rest, 1-3k per command |
| [profiles](plugins/workflow/profiles) | Focuses Claude on one folder: matching skills, scoped permissions, run steps | 0 at rest, 3-8k per run |

## 3. Install

Requires Claude Code 2.1.330 or later. In a Claude Code session:

```
/plugin install <plugin> --marketplace danielsddd/claude-up
```

For example, `/plugin install prompt-tools --marketplace danielsddd/claude-up`. Each plugin's README lists anything else it needs, such as an environment variable.

> [!NOTE]
> Visual mods draw in the desktop and mobile apps. The terminal shows the tools' buttons and commands but not backdrops.

### From source

Clone the repo, then add the plugin folders to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Separate folders with `;` on Windows and `:` elsewhere:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:/src/claude-up/plugins/tools/prompt-tools;C:/src/claude-up/plugins/visuals/damn-ddd"
  }
}
```

Restart Claude Code to load them.

## 4. How the repo is organized

```
plugins/
  visuals/<name>/     backdrops and themes (UI only)
  tools/<name>/       buttons and commands in a session
  workflow/<name>/    skill packs across sessions
.claude-plugin/marketplace.json   the catalog Claude Code installs from
.github/workflows/ci.yml          secret scan and plugin validation on every push
```

A plugin folder holds only what Claude Code needs to run it:

| Path | Holds |
| --- | --- |
| `.claude-plugin/plugin.json` | Name, version, license and user settings (`userConfig`) |
| `hooks/` | A mod's TypeScript hooks (`register.tsx`) and `hooks.json` |
| `skills/<skill>/SKILL.md` | A skill and its reference files |
| `types/` | State types for a mod that stores values |
| `config/`, `worker/` | Data and helper scripts the runtime reads |
| `README.md` | What it does, install, use, how it works, cost |

## 5. Privacy and API keys

- Plugins read API keys from your environment and never write them to disk or to the repo.
- A plugin that sends text outside Claude Code says so in its README, and names where it goes. Today that is only prompt-tools' Critique Plan, which uses free tiers of NVIDIA, Groq, Gemini, OpenRouter and Tavily.
- CI runs a secret scan (gitleaks) on every push.

## 6. Development

Check a plugin and the marketplace with the Claude Code CLI:

| Task | Command |
| --- | --- |
| Validate the marketplace and every plugin | `claude plugin validate .` |
| Validate one plugin | `claude plugin validate plugins/<category>/<name>` |
| Run a plugin's tests | `claude plugin test plugins/<category>/<name>` |

Tests and design notes stay local, out of the published folders (`tests/`, `tools/` and `docs/` are git-ignored). A new plugin goes in the category folder that fits, with an entry in `marketplace.json`, a row in the catalog above and a line in the CI matrix.

## 7. License

[MIT](LICENSE)

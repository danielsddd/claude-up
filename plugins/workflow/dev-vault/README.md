# dev-vault

A plain-markdown second brain for Claude Code: session handoffs, decisions and solved bugs in one folder, opened in Obsidian or any editor.

![dev-vault: /preserve and /log-fix write to the vault, /pickup reads it in the next session](https://github.com/danielsddd/claude-up/releases/download/v0.3.0/dev-vault.png)

- **No server, no MCP:** the skills read and write markdown files in the folder named by `DEV_VAULT`.
- **One folder per project:** a `.obsidian-project` link in the repo points at that project's notes.
- **Reads little:** `/pickup` loads one handoff and only the decisions it links; nothing scans the vault.

## Install

```
/plugin install dev-vault --marketplace danielsddd/claude-up
```

Then set the vault folder in `~/.claude/settings.json`:

```json
{ "env": { "DEV_VAULT": "C:/Users/you/Dev-Vault" } }
```

The first `/preserve` or `/log-fix` creates the folders and templates if they do not exist.

## Use

| Command | Does |
| --- | --- |
| `/dev-vault:preserve` | Writes `01-Projects/<project>/YYYY-MM-DD-handoff.md`: decisions, files touched, open gaps, next actions and a resume prompt |
| `/dev-vault:pickup` | Loads the latest handoff and the ADRs it links, then prints the next action |
| `/dev-vault:log-fix` | Writes `03-Troubleshooting/YYYY-MM-DD-<slug>.md` and adds it to the index |

## How it works

Three skills, no hooks and no server. Each command reads `DEV_VAULT`, finds the project's folder through the `.obsidian-project` link (or the repo name), and writes or reads plain markdown from the vault's templates. Nothing runs between commands.

## Cost

Zero tokens at rest. Each command costs about the size of the notes it reads or writes, usually 1-3k tokens.

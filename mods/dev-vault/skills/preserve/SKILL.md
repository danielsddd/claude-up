---
name: preserve
description: Save this session to the Dev-Vault as a handoff note - decisions, solved bugs, files touched, open gaps, ordered next actions and a resume prompt - so the next session continues with /pickup. Use when the user runs /preserve or asks to save the session, and before /clear or the end of a long session.
---

# Preserve the session

## 1. Find the vault and the project

- **Vault:** the folder in `$DEV_VAULT` (`echo "$DEV_VAULT"`). If it is unset or missing, ask the user once where the vault should live, create it with the folders `00-Inbox 01-Projects 02-ADRs 03-Troubleshooting 04-Blueprints 05-Local-PC 06-References _templates`, and tell them to set `DEV_VAULT` (in `~/.claude/settings.json` under `env`).
- **Project:** if the working folder has `.obsidian-project`, use the vault folder it points to. Otherwise use the repo root's folder name in lowercase with hyphens, create `01-Projects/<project>/`, and offer the link: Windows `cmd //c mklink /J .obsidian-project "<vault>\01-Projects\<project>"` (a junction needs no admin rights), macOS and Linux `ln -s "<vault>/01-Projects/<project>" .obsidian-project`; then add `.obsidian-project` to `.git/info/exclude`.

## 2. Write the handoff

Gather from this conversation, plus `git status --short` and `git log --oneline -n 10` in a repo. Write `<vault>/01-Projects/<project>/YYYY-MM-DD-handoff.md` (today's date from `date +%F`; add `-2`, `-3` if the name is taken) from `<vault>/_templates/handoff.md`. If that template is missing, write it first from this copy:

```markdown
---
type: handoff
project: "{{project}}"
date: "{{date}}"
session_id: "{{uuid}}"
tags: [handoff]
---
# Session handoff, {{date}}

## Where we are
## Decisions made this session
## Files touched
## Open gaps
## Next actions (ordered)
## Resume prompt
```

Fill the frontmatter (`session_id`: `${CLAUDE_SESSION_ID}`) and each section:

- **Where we are:** the goal and its state in 2-4 sentences, then the bugs solved this session, one line each, linking their `03-Troubleshooting/` note when one exists.
- **Decisions made this session:** one bullet per decision with its reason. If a decision should outlive the project, say so and suggest an ADR in `02-ADRs/`.
- **Files touched:** one line per path with what changed. Reference code by path; never paste more than 20 lines.
- **Open gaps:** what is unfinished, unverified or failing, with the exact error.
- **Next actions (ordered):** a numbered list; the first item is concrete enough to start without questions.
- **Resume prompt:** one paragraph the user can paste into a new session: the goal, where it stands, the files that matter and the first action.

Never write secrets, keys, tokens, passwords or personal or patient data into the vault.

## 3. Confirm

Print one line, `Saved: <path>`, and stop.

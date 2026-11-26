---
name: log-fix
description: Record a solved bug in the Dev-Vault troubleshooting log - error signature, root cause, fix and regression guard - and add it to the index so the next time the same error appears it is found in seconds. Use when the user runs /log-fix, or right after a non-trivial bug is fixed and verified.
---

# Log a fix

## 1. Find the vault and the project

- **Vault:** the folder in `$DEV_VAULT` (`echo "$DEV_VAULT"`). If it is unset or missing, ask the user once where the vault should live, create it with the folders `00-Inbox 01-Projects 02-ADRs 03-Troubleshooting 04-Blueprints 05-Local-PC 06-References _templates`, and tell them to set `DEV_VAULT` (in `~/.claude/settings.json` under `env`).
- **Project:** the vault folder `.obsidian-project` points to, or the repo root's folder name in lowercase with hyphens.

## 2. Gather the facts

Infer from the conversation and recent tool output; ask only for what is missing:

- **Error signature:** the exact error line or lines, without paths, ids or timestamps that change between runs.
- **Root cause:** why it happened, not only where.
- **Fix:** the files changed and why the change fixes the cause.
- **Regression guard:** the test or check that now catches it.

Search `<vault>/03-Troubleshooting/index.md` for the same signature first. If it is already logged, update that note (add the new occurrence and anything learned) instead of writing a new one.

## 3. Write the note

Write `<vault>/03-Troubleshooting/YYYY-MM-DD-<slug>.md` (date from `date +%F`, a short lowercase slug) from `<vault>/_templates/bug.md`. If that template is missing, write it first from this copy:

````markdown
---
type: bug
project: "{{project}}"
status: open | diagnosed | fixed
date: "{{date}}"
tags: [bug]
error_signature: ""
---
# {{title}}

## Symptom
## Error signature
```text
```
## Root cause
## Fix
## Regression guard
````

Set `status` to `fixed` only when the fix was verified, otherwise `diagnosed`. Reference code by path; paste at most 20 lines. No secrets, keys or personal data.

Append one line to `<vault>/03-Troubleshooting/index.md` (create it with a `# Troubleshooting index` heading if missing):

```text
- YYYY-MM-DD [<title>](YYYY-MM-DD-<slug>.md) (<project>): <short error signature>
```

## 4. Confirm

Print one line, `Logged: <path>`, and stop.

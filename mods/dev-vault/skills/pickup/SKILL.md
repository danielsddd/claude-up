---
name: pickup
description: Continue earlier work by loading this project's latest Dev-Vault handoff and only the ADRs it links, then report the next action. Use when the user runs /pickup, says "continue where we left off" or "pick up", or starts a session that continues earlier work on this project.
---

# Pick up where the last session stopped

## 1. Find the vault and the project

- **Vault:** the folder in `$DEV_VAULT` (`echo "$DEV_VAULT"`). If it is unset or missing, say so in one line, suggest `/preserve` to create it, and stop.
- **Project:** if the working folder has `.obsidian-project`, use the vault folder it points to; otherwise `<vault>/01-Projects/<repo folder name, lowercase, hyphens>/`.

## 2. Load only what the handoff needs

1. Find the newest handoff: `ls -t "<project folder>"/*handoff*.md | head -1`. If there is none, print `No handoff yet for <project>.` and stop.
2. Read it.
3. Read the ADRs it links (paths or `[[links]]` into `02-ADRs/`), and only those.
4. Read nothing else from the vault, and never scan or search the whole vault.

## 3. Report

Print exactly:

```text
Loaded: <handoff path>, <N> ADRs. Next action: <first item of Next actions>.
```

Then start that action only if the user asked to continue; otherwise wait for them.

---
name: profile
description: Build or refresh a Claude Code profile for one local folder or repo - picks type presets (web, android, claude-mods, academic, data, embedded) from what the folder contains, then writes that folder's own private settings - which skills stay visible, scoped permissions, the real run and test commands, a vault link - and reports what drifted since the last run. Use when the user runs /profile, asks to set up or focus Claude for a project or folder, or says a project shows irrelevant skills or asks too many permissions.
---

# Project profile

A profile makes Claude Code focused in one folder: only the skills that fit, permissions scoped to that folder's real commands, and its run steps written down. It lives in the folder's own `.claude/settings.local.json` (git-ignored, private) and never touches global settings.

## 1. Scan the folder

Read, do not run: manifests and lock files (`package.json`, `pnpm-lock.yaml`, `pyproject.toml`, `uv.lock`, `requirements*.txt`, `build.gradle.kts`, `CMakeLists.txt`, `platformio.ini`, `*.tex`, `*.lyx`, `.claude-plugin/`), scripts, CI workflows, `.claude/launch.json`, existing `.claude/settings*.json`, `CLAUDE.md`, `.claude/rules/`, and `.claude/profile.json` from an earlier run. A folder may be a monorepo: scan each app folder.

## 2. Pick presets

Match the folder against [presets/](presets/) by their **Signals**; several can apply (a Next.js app with a Python API is web + data). Read only the presets that match.

## 3. Build the profile

From the matched presets and what the scan found:

- **Skills:** list the skills available in this session. Keep visible every skill a matched preset lists as relevant, plus general ones (debugging, git, code review, verification, writing). Set the rest to `"name-only"` in `skillOverrides` (still invocable by name, no description in context). Use `"off"` only for skills that must never trigger here.
- **Permissions:** `allow` the folder's real read-only and check commands found in the scan (tests, lint, typecheck, build, health checks), written as the repo runs them. `ask` before pushing, publishing, deploying, or reading `.env`. `deny` what the preset or project rules forbid (for example tests that hit real services). Never allow a broad pattern such as `Bash(*)`, `node -e *` or `python -`.
- **Run steps:** if CLAUDE.md has no way to start, check and stop the app, add a short "Local dev" section with the commands found (keep CLAUDE.md under 150 lines; move long material to `docs/` or `.claude/rules/`).
- **Vault link:** if `DEV_VAULT` is set and the folder has no `.obsidian-project`, create the link as the dev-vault plugin describes.

## 4. Show, then apply

Show the planned changes as a short diff summary per file, and apply them only after the user agrees (or when they said to proceed without asking). Merge into existing files; never drop keys you did not create. Then write `.claude/profile.json`:

```json
{ "presets": ["web"], "applied": "YYYY-MM-DD", "managed": { "skillOverrides": ["..."], "allow": ["..."], "ask": ["..."], "deny": ["..."] } }
```

Make sure `.claude/settings.local.json` and `.claude/profile.json` are git-ignored (add them to `.git/info/exclude` if the repo's `.gitignore` does not cover them).

## 5. Re-runs

On a later run, compare the scan and the session's skills with `profile.json`: report new or removed skills, scripts and presets, and propose only the difference.

## 6. Report

End with the presets used, how many skills stay visible and how many were set to name-only, the permission rules added, and that the change takes effect in the next session started in that folder.

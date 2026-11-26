# Preset: claude-mods

**Signals:** `.claude-plugin/plugin.json` or `marketplace.json`, `skills/*/SKILL.md`, `hooks/register.tsx`, `mods/`.

**Relevant skills:** plugin and mod authoring, skill creation, hooks and settings, code review, git workflow, readme, security review.

**Commands to look for:** `claude plugin validate .`, `claude plugin test mods/<name>`.

**Permissions:** allow plugin validate and test, `git status`, `git diff`, `git log`; ask before `git push` and creating releases.

**Extras:** scan every commit for secrets and personal paths; mods must stay usable by anyone.

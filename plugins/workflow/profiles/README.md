# profiles

`/profile` focuses Claude Code on one folder or repo: only the skills that fit, permissions scoped to its real commands, and its run steps written down.

![profiles: /profile scans a folder, picks presets and writes its private settings](https://github.com/danielsddd/claude-up/releases/download/v0.3.0/profiles.png)

- **Type presets:** web, android, claude-mods, academic, data and embedded, picked from what the folder contains; several can apply.
- **Private per folder:** writes the folder's own `.claude/settings.local.json` and `.claude/profile.json`, both git-ignored; global settings are never touched.
- **Re-runs report drift:** new skills, scripts or presets since the last run.

## Install

```
/plugin install profiles --marketplace danielsddd/claude-up
```

## Use

| Command | Does |
| --- | --- |
| `/profiles:profile` | Scans the folder, shows the planned profile, applies it after you agree |
| `/profiles:profile` again | Reports what changed since the last run and proposes only the difference |

Changes take effect in the next session started in that folder.

## How it works

One skill with a preset file per project type. It reads the folder's manifests, scripts, CI and Claude settings, matches presets, and writes what it decided into the folder's private settings: `skillOverrides` to hide unrelated standalone skills, `enabledPlugins` to turn off unrelated plugins, and permission rules for the folder's real commands. `.claude/profile.json` records the run so the next one can report drift.

## Cost

Zero tokens at rest. A run reads the folder's manifests and settings, usually 3-8k tokens. Hidden skills then save their description tokens in every session in that folder.

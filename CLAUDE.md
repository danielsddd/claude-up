# claude-up: notes for Claude Code

Claude Code mods, one per folder under `mods/`. Each mod's README explains it.

## Save tokens
- **Never read `mods/damn-ddd/hooks/art2.ts` whole.** It's ~285 KB of generated SVG path data. Grep it for `export const` to see its shape.
- Read `tests/` only when the task is about tests, and `mods/damn-ddd/tools/` only when regenerating art.
- `.claude-plugin/types/` is written by the engine on load; it's git-ignored. Grep it for an API name, don't read it.

## Check a mod
```
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
tsc -p mods/<mod>        # needs the mod loaded once, so its types are laid
```

## Rules that bit before (damn-ddd)
- A `Backdrop` hook must always answer an `Svg` (an empty one when idle), never `next(e)`: the desktop app keeps that first "nothing" and ignores later redraws.
- No `isInteractive` on a backdrop `Svg`: it becomes a sandboxed frame that swallows clicks, so `ui.pointer` never fires.
- Match the backdrop by `e.props.scene`; the plugin id can read `<name>@inline`.
- One `Svg` per frame, at most 131,072 characters, pure vector.

## Secrets
Keys come from environment variables only (`$.env.get`). Never write a key, a `.env` file or a personal path into this repo.

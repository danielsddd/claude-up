# damn-ddd

An animated backdrop behind the chat that shows a long Claude Code reply is still running.

![damn-ddd](https://github.com/danielsddd/claude-up/releases/download/v0.2.0/damn-ddd.png)

- Two illustrated scenes, `damn1` and `damn2`, alternate on each long reply.
- It ends on its own when the reply finishes.

It draws in the desktop and mobile apps only.

## Install

```
/plugin install damn-ddd --marketplace danielsddd/claude-up
```

## Use

| Action | How |
| --- | --- |
| Automatic | Starts when one reply runs 10 minutes |
| Manual | `/damn1` or `/damn2` |
| Dismiss | Automatic when the reply finishes; sooner: click an empty part of the background, right-click → **Send him off**, or `/damn1 stop` |
| Delay | Setting **Show starts after (seconds)**, default 600 |

## How it works

A UI-only mod. It times each turn from `turn.start`, and once the delay passes it answers the app's `Backdrop` render hook with one SVG frame at a time, drawn from pre-generated path data. It stops on `turn.complete`. It makes no model calls and adds nothing to the conversation.

## Cost

0 model tokens. No model calls, nothing added to the context.

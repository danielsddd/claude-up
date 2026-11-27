# damn-ddd

Animated scenes behind the chat while a long Claude Code reply runs.

![damn-ddd](https://github.com/danielsddd/claude-up/releases/download/v0.2.0/damn-ddd.png)

- **damn1:** a cowboy whips a bucket of tokens.
- **damn2:** a hero cuts an evil token in two.

The two alternate on each long reply. Desktop and mobile apps only.

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
| Delay | Option **Show starts after (seconds)**, default 600 |

## How it works

A UI-only mod. It times each turn from `turn.start`, and once the delay passes it answers the app's `Backdrop` render hook with one SVG frame at a time, drawn from pre-generated path data. It stops on `turn.complete`. It makes no model calls and adds nothing to the conversation.

## Cost

0 model tokens. No model calls, nothing added to the context.

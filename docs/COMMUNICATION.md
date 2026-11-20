# Communication

A room is a place. A channel is not. That distinction is the whole design:
`say` and the socials are bounded by `room.id`, while tells, channels and mail
are addressed to people or identities and cross rooms freely.

## The four boundaries

| Path | Reaches | State | Table |
| --- | --- | --- | --- |
| `say <words>` | everyone in the room | none | `verbs.json` |
| `tell <name> <words>` | one actor, anywhere | none | `verbs.json` |
| `global`/`gossip`/`trade`/`wiz <words>` | every awake actor (role-locked for `wiz`) | none | `channels.json` |
| `mail <name> <words>` | an identity, online or not | queued until read | `verbs.json` |
| `wave`/`nod`/`bow`/... | the room, one line each | none | `socials.json` |

A channel has a `minRole`; role is the only lock. A social with target messages
has a line for the actor, the target, the room, and the self-target case; a
social without them is untargeted. The loader refuses half a target, so a
target never sees silence where the room saw a gesture.

## Mail

Mail is a tell that waits. It is stored against the identity key, not the actor,
so a letter written while someone is away is delivered when they next log in.
Online delivery marks the letter read immediately; offline delivery leaves it
unread. The queue is capped at 100 letters, oldest first.

The letter is part of the checkpoint. `upgradeState` carries `mail` across a
release, alongside channels, climate and the rest of the growing world shape.

## Spans and the dataset

Every path emits one span with the words people actually typed, original case
preserved:

| Span | Fields |
| --- | --- |
| `world.say` | `actor.id`, `room.id`, `text`, `text.length` |
| `world.channel` | `actor.id`, `channel.id`, `recipients`, `text`, `text.length` |
| `world.tell` | `actor.id`, `target.id`, `text`, `text.length` |
| `world.mail` | `actor.id`, `target.key`, `delivered`, `text`, `text.length` |
| `world.social` | `actor.id`, `social.id`, `target.id`, `room.id` |

`tools/dataset.mjs` turns them into `say`, `channel`, `tell`, `mail` and
`social` rows. This is the social surface the benchmark needs: who spoke to
whom, in front of whom, with what words, and whether the message had to wait.

## Adding a channel or a social

A channel is a row in `world/data/channels.json`: `id`, `name`, `aliases`,
`minRole`, and `actor`/`others` messages using `%a` (actor) and `%s` (words). A
social is a row in `world/data/socials.json`: `aliases`, `actor`/`others`, and
optionally `target`/`targeted`/`targetOthers` plus `self`/`selfOthers`.

The gate loads both tables, refuses duplicate or shadowed aliases, and runs the
boundary scenario: a say stays in its room, a tell reaches exactly its target, a
channel reaches everyone awake, a role-0 actor cannot use the wizards channel,
mail waits for an absent identity, and a targeted social gives each listener
exactly one line.

## Rate limits

Chat has a rolling window separate from the 250 ms input allowance: eight
lines per ten seconds per connection across say, tell, mail and the channels.
The ninth is refused with a short wait message. The window is in memory, so a
reconnect starts fresh.

## Ignore lists

`ignore <name>` (aliases `ign`, `mute`) stores the target's identity key on
the character. The list survives logout, restart and the two-hour reset;
`unignore <name>` removes an entry and `ignoring` lists the current set.

An ignored speaker is filtered from tells, mail, global channels, guild chat,
socials and the room's account of a say. The speaker is told the tell or
letter was not accepted; the listener sees nothing. The filter is by identity
key, so changing a display name does not bypass it.

## Reports

`report <name> <reason>` records a durable operator report without putting the
reason into world state or a public span. It shares the chat window, allows one report per identity per 30
seconds, needs a signed-in reporter, and refuses an empty reason or a
self-report. The operator
reads `~/.mudbench/state/reports.jsonl` on the host; `docs/MODERATION.md` has
the record shape and the review path.

## Not here yet

Channel history, a mail reader that lists without delivering, and offline
tells. The next social feature should be chosen from what the dataset shows
people and agents actually doing, not from a feature list.

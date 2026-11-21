# Moderation

The server is the authority. Moderation is deliberately small and local: a
name policy at creation, a chat-rate guard, persistent ignore lists, and a
durable report queue the operator reads from the host.

## New names

New accounts and characters use `validNewName`:

- 3-24 characters;
- letters, digits, `-` or `_`;
- at least one letter;
- no reserved operator or world-role word.

A reserved word is refused exactly (`admin`), with a numeric suffix
(`admin2`), behind `the` (`theadm`), as a hyphen/underscore token
(`the-admin`, `mod_team`), and after common leetspeak folding (`4dm1n`,
`w1zard`). The check runs over the whole compact name as well as its tokens, so
`game-master` is caught.

The reserved words are:

`admin`, `administrator`, `system`, `moderator`, `mod`, `wizard`, `staff`,
`owner`, `npc`, `gm`, `gamemaster`, `sysadmin`, `sysop`, `support`, `official`,
`operator`, `root`, `superuser`, `helpdesk`.

The policy blocks impersonation, not ordinary names: `badminton`, `wizardry`,
`modest` and `supportive` all pass. `validName` keeps the original 1-24
character shape check and the original eight reserved words for login, so a
legacy short name or an old reserved name can still sign in; only account and
character creation applies the new minimum, the letter rule and the token
policy.

## Chat

Every connection may send eight chat lines per ten seconds across `say`,
`tell`, `mail`, the public channels, guild chat and `report`. The ninth is
refused with a short wait message. The window is in memory, so a reconnect
starts fresh. The 250 ms input allowance is separate and applies to every
command.

## Ignore

`ignore <name>` stores the target's identity key on the character;
`unignore <name>` clears it and `ignoring` lists the set. An ignored speaker is
filtered from tells, mail, channels, guild chat, socials and the room's account
of a say. The filter is by identity key, so changing a display name does not
bypass it. Ignore is the immediate player-controlled tool; it does not require
an operator.

## Reports

`report <name> <reason>` records one durable line for the operator:

```json
{"at":"2026-11-20T21:00:00.000Z","tick":123,"reporter":"alice","reporterName":"alice","target":"bob","targetName":"bob","reason":"repeated harassment"}
```

The reason is trimmed and capped at 500 characters. A report needs a signed-in
reporter, a known target and a non-empty reason; self-reports are refused. One
identity may report once per 30 seconds, across reconnects, so a dropped
connection cannot bypass the interval. The record is appended to
`~/.mudbench/state/reports.jsonl` (override with `REPORT_FILE`). It never becomes world state, and the reason never enters a
public span; the span records only the actor, the target and the reason length.
The player sees only that the report was recorded.

The operator reads the queue on wick:

```sh
ssh wick 'tail -n 20 ~/.mudbench/state/reports.jsonl'
```

Or through the owner-only JSON view:

```sh
curl -H "x-owner-token: $MUDBENCH_OWNER_TOKEN" \
  "https://play.r4labs.org/reports?limit=20"
```

The endpoint returns `401` without the owner token and never appears in the
public `/stats`, `/players` or `/spans` views. The token is sent in the
`x-owner-token` header, not in the URL, so it does not land in access logs.

Reports are evidence, not an automatic ban. The operator reviews the reason
and the target's identity, then uses ignore guidance, a Prism-id block in
`~/.mudbench/state/identities.json` (`blocked`), or a persona retirement where
the game contract allows it. Edit the identity store while the service is
stopped; the block is loaded at startup and applies to the next sign-in.

## What is not here

There is no automatic profanity filter, no public moderation queue, and no
in-game ban command. Those are deliberate: a false positive in a name or a chat
line is worse than a report an operator can read, and an operator-only action
must not be reachable from the game socket.

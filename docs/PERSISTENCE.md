# Persistence

A character is an account and a history of play. It is not a body, a room or a
bag. This is the model after the expansion began; it deliberately replaces the
Phase G model, which persisted inventory and position.

## What survives

| Thing | Where it lives | Restored |
| --- | --- | --- |
| account name, password hash, salt, role | `state.identities[key]` | on login |
| level and experience | the identity | on login |
| guild membership and rank | the identity | on login |
| quests active and completed | the identity | on login |
| mail | `state.mail`, keyed by identity | on login |
| world objects and mobiles | the checkpoint | until the two-hour reset |

## What does not survive

| Thing | On logout | On login |
| --- | --- | --- |
| room | forgotten | the safe start room |
| visited set | forgotten | only the start room |
| inventory | dropped in the room the character stood in | empty |
| worn things | dropped, no longer worn | empty |

After a clean logout, dropped objects remain where they fell, lootable, until
the two-hour reset. A player who logs out in the Vault leaves their sword in
the Vault; another player can take it; the reset returns it to its home.

## The two-hour reset

At 28,800 ticks (two hours at 250 ms) the world resets:

- every object returns to its home room and container, closed and unlit as it
  started;
- ephemeral objects (minted coins) disappear;
- every mobile returns home, revives at full health, and drops its engagements;
- shops restock because their stock is ordinary objects;
- every actor is told: `The world shudders. Everything returns to where it
  began.`

An object held at reset returns home too. The reset is the world's, not the
character's: level, XP, guild, quests and mail survive it.

No other path respawns an item. A logout or death drops held objects where the
character stood; a clean restart keeps them there. After a crash, `heldRoom`
records where a carried object was at the last checkpoint, which may be an
older location. World changes since that checkpoint can be lost.

## Checkpoints

`saveState` calls `checkpointIdentities`: every online actor's progression is
written into their identity. The server checkpoints changes to online character
progression and identity operations before sending their tick's results; it
stops if that checkpoint fails. This writes and rotates the full world state
synchronously and may add latency. Room, visited set and hands are not restored
to the character; the next login begins at the start.

Other world changes remain subject to periodic checkpoints and can roll back
after a crash. Process-kill recovery does not establish power-loss durability,
recovery from corrupt backups, or a guarantee for every world action. Run
`node --test runtime/crash-recovery.test.mjs` for a process-kill regression
with stub admission. Set both `MUD_HOLO` and `MUD_PRISM_CODE` to run it with
a matching hologram and `prism-code@0.5.0` instead.

## Accounts and the login gate

A password is scrypt-hashed with a per-account salt. The reducer never sees a
password; the server verifies the credential and sends an authenticated login
intent. Legacy token identities still sign in with their key, and `password
<old> <new>` upgrades one to a password.

A connection is a guest until it authenticates. The welcome banner offers
`register` and `login`; every gameplay command before sign-in is refused, and
the only other guest command is `help`. Registering or logging in shows the
room; play begins at the Atrium.

## Safe rooms

A room with `safe: true` refuses an attack, clears an engagement that reaches
it, and shows `This is a safe place.` The Atrium, Storeroom, Shrine and Chancel
are safe.

## What is still open

Death penalties, PvP loot rules and quest-item binding are Phase I–J decisions.
The current rule is the simple one: objects are mortal, characters are not.

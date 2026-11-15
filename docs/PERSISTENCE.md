# Persistence

A character is an identity, not a connection. The identity outlives the actor:
it owns the name, the room, the rooms visited, the role, and now the things in
the character's hands. The actor is the body the server lends it for one
session.

## What survives

| Thing | Where it lives | Restored |
| --- | --- | --- |
| name, key hash, role | `state.identities[key]` | on login |
| room | the identity, written on logout and on every checkpoint | on login, unless `RESPAWN_AT_START` |
| visited rooms | the identity | on login |
| inventory | object ids in `identity.inventory` | on login |
| worn things | object ids in `identity.worn` | on login |
| bag contents | the objects' `inside` links, unchanged | when the bag returns |
| mail | `state.mail`, keyed by identity | delivered on login |
| world | objects, mobiles, weather, climate | from the checkpoint |

Progress is currently the role and the set of rooms visited. The task's claims
and answers are recorded as spans, not as per-character state; that is a
benchmark concern and a later decision, not a persistence primitive.

## Logging out

On `leave`, every object whose `holder` is the actor is recorded in the
identity's inventory, and its `worn` flag is recorded separately. The object's
holder, room and inside links are cleared; a carried bag keeps its contents
because those objects point at the bag, not at the actor.

A guest who never signed in has no identity to restore to, so their things fall
on the floor of the room they stood in. Better a cloak on the floor than a cloak
in a hole.

## Logging in

The saved room is restored, then every inventory object is put back in the
actor's hand if it is still available — not eaten, not in a room, not inside
something, not held by someone else. A bag keeps its contents. A worn thing is
worn again.

A second connection cannot sign in as a name that is already online. The server
refuses before it announces the sign-in; the reducer refuses again if the intent
still arrives. The duplicate connection remains a guest, not a second body.

## Checkpoints and crashes

`saveState` calls `checkpointIdentities` before writing: every online actor's
hands are written into their identity. A hard restart therefore loses at most
the ticks since the last checkpoint, and the next login restores the inventory
from the identity rather than looking for objects on the floor.

On load, `releaseHeldObjects` distinguishes two cases:

- an object claimed by an identity's inventory is cleared, not dropped; login
  will restore it;
- an orphan whose holder is gone is released in the room they stood in, or at
  its home if even that record is gone.

## The area reset

The old MUD reset returns the world to its starting arrangement. It must not
reach into a player's hands. The reset now skips:

- any object with a holder (carried or worn);
- any object inside a container that has a holder (a bag carried by someone).

Everything else goes home: floor objects, bag contents in room containers, shop
stock, eaten food, dead mobiles. A bought thing stays bought; unsold stock stays
on the shelf.

That was a real defect before this phase: every 240 ticks the reset stripped
every player's inventory and returned it to the object's home. The gate now
carries a bag through a reset and requires it to stay put.

## Configuration

`RESPAWN_AT_START=true` is for tests that need every login at room 1. It is
false by default and in the deploy unit, so a returning character wakes where
they left. Death still wakes an actor at the start room; that is a different
path and does not touch the inventory.

## What is not here yet

Container nesting beyond one level, item durability, a mail reader that lists
without delivering, and progress beyond visited/role. The next persistence
decision should come from a dataset question — what a character's history needs
to answer — not from a storage feature list.

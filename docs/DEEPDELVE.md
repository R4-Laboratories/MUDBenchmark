# The Deepdelve — a party mine

The Deepdelve is a **16-room working mine** below the graveyard. It is the first
zone that needs a **real party**, not just two people standing in the same
room: the winch, the pump, the mine cart and the sealed seam each check that
the actor's party has at least two members in the room.

## Getting there

- From **The Graveyard (17)**, go **west** to **The Old Mine Head (198)**.
- The old shaft at **The Old Shaft (213)** returns to the Graveyard by `up`.
- The mine head sells nothing; it has a lantern, a second lantern, a canary, a
  second canary and the mine captain. Take a light and a canary each.
- **The Underground Pool (212)** also opens down to the **Drowned Foundry**
  when a party turns the drowned wheel. See `docs/DROWNED-FOUNDRY.md`.

The mine is **level-gated**:

| Rooms | Minimum level |
| --- | --- |
| 198 The Old Mine Head, 199 The Cage Landing | 6 |
| 200–206 (winch, flooded shaft, tunnels, ore face, camp, gas pocket) | 7 |
| 207–213 (seam, vault, gallery, guardian, office, pool, old shaft) | 8 |

A level-6 character can enter the landing but is refused at the winch room.
The Deepdelve quest is level 6; the guardian is level 8.

## Map

```text
The Graveyard (17) --west--> The Old Mine Head (198) --down--> The Cage Landing (199)
      ^                                                         | west        | down
      |                                                    Winch Room (200)  Flooded Shaft (201)
      |                                                         | down*       | east*
      |                                                    Lower Tunnel (202)
      |                                                         | east
      |                                                    Lower Tunnel (203)
      |                                                         | south
      |                                                    The Ore Face (204) --east--> Surveyor's Camp (205)
      |                                                         | down*                         | east
      |                                                    The Deep Gallery (209)          The Gas Pocket (206)
      |                                                         | east                          | east
      |                                                    Guardian's Chamber (210)      The Sealed Seam (207)
      |                                                         | east                          | east*
      |                                                    Foreman's Office (211)        The Sealed Vault (208)
      |                                                         | down
      |                                                    Underground Pool (212) --east*--> Old Shaft (213)
      |                                                                                              | up
      +----------------------------------------------------------------------------------------------+
```

`*` is a secret exit opened by a room action.

## Party commands

```text
party invite <name>     invite someone in the room
party accept            accept the invitation
party decline           decline the invitation
party who               list the leader and members
party leave             leave the party
party kick <name>       leader only
party disband           leader only
```

A party holds up to **six** members. Members in the same room share **50% of
kill XP** and **quest kill credit**. Other quest facts (visit, collect,
deliver) are still per character, so a party that wants everyone to finish the
ore contract should run it more than once or trade the quest items. Parties
are session state: logging out or a server restart clears membership.

## The party actions

| Room | Command | Requirement | Opens |
| --- | --- | --- | --- |
| 200 The Winch Room | `turn winch` | party of 2 here | secret `down` to 202 |
| 201 The Flooded Shaft | `pump shaft` | party of 2 here | secret `east` to 202 |
| 204 The Ore Face | `board cart` | party of 2 here | secret `down` to 209 |
| 207 The Sealed Seam | `strike seam` | party of 2 here | secret `east` to 208 |
| 212 The Underground Pool | `board coracle` | none | `east` to 213 |

A party action reveals the way to **every party member in the room**, so the
whole group can follow. The two routes from the landing (winch and pump) both
reach the lower tunnel; the winch is the direct one.

## Gas and the canary

**The Gas Pocket (206)** is a dark, gas-filled room. Every six seconds:

- With a **canary** in the pack, the first breath warns you and starts a
  **30-second** window. The canary dies when the window ends.
- Without a canary, the gas deals **2 damage** (never below 1 HP). It is a
  warning to leave, not an instant death.

The canaries and two lanterns are at the mine head. A party should take one of
each per member. The canary is consumed when it dies; the two-hour reset
returns it to the mine head.

## The Deepdelve quest

The **mine captain** at 198 gives **The Deepdelve** (level 6, repeatable each
two-hour reset):

1. Reach the surveyor's camp (205).
2. Recover the surveyor's notes (205).
3. Defeat the mine guardian (210).
4. Bring the sealed ore (208) to the mine captain (198).

Reward: **320 XP and 50 coins**. The surveyor explains the gas, the seam and
the guardian; the captain explains the party requirement.

## Treasure and special items

- **A miner's pick** (204, damage 4): the first weapon found in the mine.
- **The surveyor's notes** (205, readable, value 30): the quest object.
- **A lump of sealed ore** (208, value 80): the quest object, and the reason to
  make the return trip through the gas.
- **A lump of deep ore** (208, value 50) and **a lump of raw ore** (204, value
  25) are heavy loot.
- **A banded chest** (211) holds **a foreman's map** (readable); the old shaft
  is marked on it.
- **A heap of old coins** (213, 25 coins) is the coracle shortcut reward.
- **The mine guardian** (210) is level 8 with 55 HP, 5 damage and 3 armour in
  production. It is a real fight: a level-8 pair with the mine pick wins with
  about 35 HP each, while a level-7 solo is likely to lose a level.

## Why it matters

The Deepdelve is the first site built for the group layer the world already
had: a party that shares XP and quest credit, party-only doors, a light and
canary resource, a maze-like return path and a repeatable ore contract. It is
also the first working **mine** in the AberMUD sense: winch, pump, cart, gas,
seam and a boat out.

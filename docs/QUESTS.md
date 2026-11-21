# Quests

A quest is a named set of facts about the world and a reward for making them
true. There is no quest script: the engine advances an objective when an event
matches it, checks the facts, and pays once.

The live table is **20 quests**. The other 41 definitions are in
`world/data/quests-archive.json`; the budget and the migration rules are in
`docs/QUEST-BUDGET.md`.

## The data

`world/data/quests.json`:

```json
{
  "id": "bread",
  "name": "Bread for the Shop",
  "level": 1,
  "giver": "the shopkeeper",
  "description": "Bring a loaf from the Cell to the shopkeeper.",
  "objectives": [
    { "kind": "deliver", "npc": "shopkeeper", "object": "bread", "count": 1,
      "text": "Deliver a loaf to the shopkeeper" }
  ],
  "rewards": { "xp": 10 },
  "complete": "The shopkeeper takes the loaf."
}
```

| Objective | Fact |
| --- | --- |
| `visit` | the actor has been in the room |
| `kill` | the actor has killed the mobile `count` times |
| `collect` | the actor is carrying `count` of the object right now |
| `deliver` | the actor has given the named object to the mobile |
| `answer` | the actor has spoken the word at the shrine |
| `answer` + `fact` | the actor has learned that fact and spoken its word at the shrine |
| `talk` | the actor has spoken with the named mobile |

`collect` is a fact, not a counter: it is recomputed from the actor's hands
after every intent, so eating, dropping or selling the item can undo it.
`deliver` records the object as well as the recipient, so a loaf is not a
sword.

The loader refuses unknown kinds, missing rooms/mobiles/objects, duplicate ids
and invalid levels. The server validates every reference against the world at
boot; a quest that names a room that does not exist stops the world.

## The twenty

| Quest | Level | Scope | Gate |
| --- | --- | --- | --- |
| First Steps (`first-steps`) | 1 | world | visit the Atrium and Corridor |
| A Word in the Hall (`hall-word`) | 2 | world | talk to the market woman and guild clerk |
| The True Word (`word`) | 1 | world | enter the Vault, answer at the Shrine |
| The Vault Guardian (`guardian`) | 2 | world | requires the word; kill the guardian |
| Bread for the Shop (`bread`) | 1 | world | deliver a loaf |
| The Apprentice's Charm (`familiar`) | 2 | world | visit the apprentice, carry the charm |
| The High Walk (`roof`) | 3 | world | requires the charm; visit the High Walk, kill a rat |
| The Lighthouse Lens (`telescope`) | 2 | world | carry the brass telescope |
| A Message for the Spellwright (`errand`) | 1 | world | deliver the note |
| What the Mirror Keeps (`mirror`) | 4 | world | requires the High Walk; visit the pool, carry a shard |
| The Drowned Ledger (`ledger`) | 4 | world | requires the mirror; kill the clerk, carry the page |
| Three Parts of a Sigil (`sigils`) | 5 | world | requires the ledger; carry all three sigils |
| The Cistern Key (`cistern`) | 6 | world | requires the sigils; visit the cistern, carry the bone key |
| The Black Choir (`choir`) | 7 | world | requires the cistern; kill the moth, carry the bell |
| The Sealed Reliquary (`reliquary`) | 8 | world | requires the choir; visit the reliquary, carry the lens |
| The Guild's Ledger (`guild-ledger`) | 3 | guild | carry the spell scroll to the Mages |
| The Mirror Ledger (`guild-mirror`) | 6 | guild | requires the mirror; visit the pool, carry a shard |
| The Warden's Debt (`guild-warden`) | 7 | guild | requires the guild ledger; kill the warden, carry the key |
| The Dawn Archive (`guild-dawn`) | 10 | guild | requires guild-warden and reliquary; visit the Dawn Gate, carry the crown |
| The Archmage's Trial (`guild-trial`) | 10 | guild | repeatable; kill the regent and deliver its sigil |

`guild-dawn` rewards the archmage's signet. It is a rank-10, archmage-rank
quest; the server now allows the archmage promotion at level 10 with four known
spells. `guild-trial` is the reset-cycle repeatable.

## Progress and migration

Active quests live on the identity as `{ id, progress }`. Progress holds
`visits`, `kills`, `collected`, `delivered`, `deliveredObjects` and `answered`.
Completed ids are a list and are never paid again. The state is written on
logout, death, checkpoint and restart; it is part of the character, not the
world, so the two-hour reset does not erase it.

On load, `migrateQuestState` normalizes every character to the live 20. A
retired active quest whose recorded progress meets every objective is reported
as completed; otherwise it is abandoned. The character receives a one-time
login note, and the migration record is cleared on the next checkpoint. No
retired reward is paid again.

## Commands

- `quests` / `journal` — active quests with `[x]`/`[ ]` objectives, completed
  quests, and what is available at this level.
- `quest accept <id>` — level- and prerequisite-gated, not repeatable, not already active.
- `quest abandon <id>` — removes it; progress is lost.
- `deliver <thing> to <name>` — gives the object to a mobile and advances a
  deliver objective.
- `score` includes active/completed quest counts.

## Spans and the dataset

Every accept, abandon and completion is a `world.quest` span with
`actor.id`, `quest.id`, `quest.action` and `quest.name`. The dataset gains
`quest` rows. Progress itself is not a separate span; it is state, visible in
the next `quests` command and in the completion that follows.

## Exploration instead of quests

Ember Deep, Hollow Fen, Salt Caves, Moonlit Reach and the Memory Garden keep
their rooms, mobiles, treasure, keys, hidden exits and actions. They no longer
carry quest chains. The Memory Garden's `plant rose` action still requires the
garden fact, consumes the rose and reveals the Remembered Bed; the rooms remain
worth visiting without a checklist.

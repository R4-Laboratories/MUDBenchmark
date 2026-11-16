# Quests

A quest is a named set of facts about the world and a reward for making them
true. There is no quest script: the engine advances an objective when an event
matches it, checks the facts, and pays once.

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

`collect` is a fact, not a counter: it is recomputed from the actor's hands
after every intent, so eating, dropping or selling the item can undo it.
`deliver` records the object as well as the recipient, so a loaf is not a
sword.

The loader refuses unknown kinds, missing rooms/mobiles/objects, duplicate ids
and invalid levels. The server validates every reference against the world at
boot; a quest that names a room that does not exist stops the world rather than
sitting in the log forever.

## Progress and persistence

Active quests live on the identity as `{ id, progress }`. Progress holds
`visits`, `kills`, `collected`, `delivered`, `deliveredObjects` and `answered`.
Completed ids are a list and are never paid again. The state is written on
logout, death, checkpoint and restart; it is part of the character, not the
world, so the two-hour reset does not erase it.

## Commands

- `quests` / `journal` — active quests with `[x]`/`[ ]` objectives, completed
  quests, and what is available at this level.
- `quest accept <id>` — level-gated, not repeatable, not already active.
- `quest abandon <id>` — removes it; progress is lost.
- `deliver <thing> to <name>` — gives the object to a mobile and advances a
  deliver objective.
- `score` includes active/completed quest counts.

## Spans and the dataset

Every accept, abandon and completion is a `world.quest` span with
`actor.id`, `quest.id`, `quest.action` and `quest.name`. The dataset gains
`quest` rows. Progress itself is not a separate span; it is state, visible in
the next `quests` command and in the completion that follows.

## First quests

1. **The True Word** — enter the Vault, answer the true word at the Shrine.
2. **A Curled Scroll** — carry the scroll out of the Corridor.
3. **Bread for the Shop** — deliver a loaf to the shopkeeper.
4. **The Vault Guardian** — level 2; defeat the stone figure.

## Not here yet

Dialogue-driven givers (the giver is text, not a mobile yet), quest chains and
prerequisites, repeatable daily quests, and quest items that bind to the
character. The world phase adds the givers and the map; the engine is stable.

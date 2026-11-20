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
| `answer` + `fact` | the actor has learned that fact and spoken its word at the shrine |
| `talk` | the actor has spoken with the named mobile |

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

## First quests

1. **The True Word** — enter the Vault, answer the true word at the Shrine.
2. **A Curled Scroll** — carry the scroll out of the Corridor.
3. **Bread for the Shop** — deliver a loaf to the shopkeeper.
4. **The Vault Guardian** — level 2; requires The True Word; defeat the figure.
5. **The Smuggler's Cache** — level 3; requires The Vault Guardian.
6. **The Lighthouse Lens** — level 2; carry the brass telescope from the
   lighthouse to the docks.

## Chains, repeatables and givers

Quests can name prerequisites with `requires`, and the Eclipse Court uses a
three-quest level-10 chain. The engine also understands `repeat: "reset"` with
`questCycles`, so a quest can return after the two-hour reset, but no live
quest uses it yet.

The giver is still descriptive text rather than a dialogue tree, and quest
items are not bound to the character. Those are content and policy choices,
not missing quest-engine facts. `guild-sigils` and the clerk's errand use the
reset-cycle repeat; the errand consumes the delivered seal, so each cycle needs
a fresh one. `hall-word` is the first social quest: talk to the market woman
and the guild clerk, and the two versions of the rumor complete it. The Memory
Garden adds `memory-garden`: the guild clerk teaches a word, the character
stores it as a fact and mirrors it to R4, and `recall <word>` at the shrine
completes the answer objective. A fact-gated answer is refused when the
character has not learned the fact, even if the word is correct. The level-9
follow-up `garden-moon` uses the silver owl's crescent fact, the shrine and the
Rose Walk; its reward is the moon seed and the Moon Gardener title. The
Remembered Bed extends facts beyond answers: the `plant rose` action requires
the garden-word fact and consumes the memory rose, opening a hidden room. The
`remembered-bed` quest visits that room and brings back the bloom. The Root
Archive below it adds `first-bed`: talk to the root keeper, reach the First Bed
and carry back the first seed. The Root Road connects that archive to Market
Square, and `long-remembering` carries the root word to the guild clerk and the
shrine before returning to the First Bed. The Sunken Orchard adds
`three-rememberings`: the orchard keeper, the shrine, the windfall and the guild
clerk can be visited in any order. The Orchard Undercroft adds `press-beneath`:
talk to the keeper, reach the Seed Vault and carry back the press seed. The
Cider Spring adds `cider-spring`: talk to the spring keeper, reach the White
Bed and carry back the cider bloom.

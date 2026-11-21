# The next world expansion

This was the queued AberMUD-style content and systems track. The v0.47/v0.48 slices
have landed: eight equipment slots, six spells and the Mages' Guild, eleven
Lantern Quarter/Undervault rooms, five personal quests, a guild ledger quest,
a searchable secret stair, three data-driven room actions and mage rank advancement. The world is now 115 rooms,
20 quests and 120 objects. The foundation from v0.46 remains:
short command forms, `equipment`, `world`/`status`, the hidden `#state` line,
and the AI prompt/router state layer.

## Order

| Release | Work | Acceptance |
| --- | --- | --- |
| M3 | **done** — Equipment slots (`world/data/slots.json`): head, body, hands, feet, cloak, neck, mainhand, offhand; `equip`/`unequip`/`equipment`; gear in shops and quest rewards | slot swap, two-handed clears offhand, armour sum, weapon damage, drop/death/reset clears gear |
| M4 | **done** — Magic: mana, `cast`/`spells`/`train`/`study`/`recite`, scrolls, the Mages' Guild and an archmage trainer | spark/mend/light/shield/detect/recall; mana refill and regen; spellbook persists; scrolls consume; rank gates |
| M5 | **first two slices done** — The Lantern Quarter / Undervault: 11 rooms, 2 zones, 5 quests, 5 mobiles, 6 objects, one secret stair, seven room actions; the full 25-room/10-quest target remains | 60 rooms, 26 quests, every exit reciprocal, all references valid, scripted `errand`/`familiar`/`mirror` walks |
| M6 | **core done** — Guild quests and progression: guild XP/level, ledger/mirror/warden/choir/reliquary/repeatable sigil quests, apprentice→adept→magician advancement, level 2–5 perks including functional trainer-discount and guild-quest-2 limits; more guild quests remain | guild quest acceptance by rank, repeat reset cycle, guild XP, paid training/discount, rank advancement, restart persistence |
| M7 | **first slice done** — another ten Undervault rooms, four linked quests and two actions; 60 rooms / 26 quests | same map/quest/reference gates |
| M8 | **done** — The Ember Deep: ten rooms behind the Quiet Door, three mobiles, nine objects, a forge shop, four actions (last-lantern door, bellows, ash-key chest, first-flame shortcut), five quests including the magician-tier Ember Warden guild quest; 70 rooms / 31 quests | quiet-door reveal, full walk to the First Flame, reward payout, chest unlock, flame shortcut, every exit reciprocal |
| M9 | **done** — The Hollow Fen: ten rooms east of the Abandoned Mill, three mobiles, eight objects, the green-key chest, the green-heart shortcut, five quests including the guild wisp quest, and guild level 6 with the third-active-guild-quest perk; 80 rooms / 36 quests | fen gate, full walk to the Green Heart, chest unlock, shortcut, quest payout, guild level 6, every exit reciprocal |
| M10 | **done** — The Salt Caves: five rooms below the lighthouse, three mobiles, five objects, a brine-key chest, a salt-heart shortcut and two quests; 85 rooms / 38 quests | lighthouse stair, salt walk, chest unlock, shortcut, quest references, every exit reciprocal |
| M11 | **done** — onboarding and deeper chains: the First Steps beginner tour, the `tutorial` command, The Salt Ward and The Deep Fen reward quests; 41 quests | accept/walk/complete First Steps, tutorial aliases, quest references |
| M12 | **done** — The Moonlit Reach: six rooms east of the deep forest, three mobiles, six objects, a moon-key chest, the crescent-moon shortcut and three linked quests; 91 rooms / 44 quests | forest gate, walk to the Moon Throne, moon-key chest, crescent shortcut, quest chain references, every exit reciprocal |
| M13 | **done** — The Eclipse Court: six level-10 rooms above the Moon Throne, four mobiles, eight objects, an eclipse-key chest, the dawn-gate shortcut and a three-quest chain; 97 rooms / 47 quests | capstone walk, key/chest, regent kill, reward payout, quest chain, dawn gate, every exit reciprocal |
| M14 | **done** — The Memory Garden: three rooms east of the shrine, a rememberer and garden wisp, two keepsakes, an NPC fact/recall contract and The Garden Remembers quest; 100 rooms / 50 quests | fact learning, R4 context match, answer-without-fact refusal, recall at the shrine, reward, every exit reciprocal |
| M15 | **done** — The Moon in the Garden: the crescent fact from the silver owl, a level-9 follow-up quest and the moon seed reward; 51 quests | crescent fact, no-fact refusal, Rose Walk visit, reward, level-cap gate |
| M16 | **done** — The Remembered Bed: a fact-gated `plant rose` action, a hidden room below the garden, the remembered-bloom quest and the Bedkeeper title; 101 rooms / 52 quests | no-fact refusal, planted rose consumed, hidden stair, bloom, quest completion, every exit reciprocal |
| M17 | **done** — The Root Archive: two rooms below the Remembered Bed, the root keeper, the first seed and a level-5 follow-up; 103 rooms / 53 quests | route graph, waypoint run, talk/visit/collect quest, seed reward, every exit reciprocal |
| M18 | **done** — The Root Road and Long Remembering: a two-room shortcut from the archive to Market Square, a town-spanning level-6 quest and the Roadkeeper title; 105 rooms / 54 quests | BFS route, waypoint run, talk/recall/visit quest, every exit reciprocal |
| M19 | **done** — The Sunken Orchard: three rooms below the Root Road, the orchard keeper, the windfall seed and the four-objective Three Rememberings quest; 108 rooms / 55 quests | multi-objective planner, orchard word, seed, town/shrine/garden objectives, every exit reciprocal |
| M20 | **done** — The Orchard Undercroft: three rooms below the Old Press, a vat hound, the press seed and the Press Beneath quest; 111 rooms / 56 quests | press walk, underseed, dependent multi-quest remote run, every exit reciprocal |
| M21 | **done** — The Cider Spring: three rooms below the Seed Vault, the spring keeper, the cider bloom and the Cider Spring quest; 114 rooms / 57 quests | spring walk, bloom, three-quest remote run, every exit reciprocal |
| M22 | **done** — Orchard Work: a repeatable cider-bloom delivery for the orchard keeper, plus observed-action verification for agent objectives; 58 quests | repeat cycle, deliver/consume, objective confirmation, every prior check |
| M23 | **done** — The archmage Eclipse line: The Eclipse Ledger and The Dawn Archive, two rank-10 Mage quests using the Eclipse Court and a signet reward; 60 quests / 102 objects | archmage rank, prerequisites, visit/collect, guild XP, signet, every prior check |
| M24 | **done** — The Archmage's Trial: a reset-cycle repeatable that consumes the regent's sigil and pays guild XP; 61 quests | two cycles, kill/deliver, guild XP, return after reset |
| M25 | **done** — Player fundamentals: take-all, drink, coins, grouped inventory, 20+5 HP curve, no fleeing, ale at the Gilded Rat and three sellable treasures; 106 objects | shorthand, take-all, drink, coin totals, quest-item sale guard, health curve |
| M26 | **done** — The Wardens' Lodge: a second guild above the Guild Hall, scout/ranger/warden ranks earned by rooms explored and level, no new quest; 115 rooms / 52 mobiles | reciprocal exits, recruiter, join gate, exploration ranks, both rosters |
| M27 | **done** — The 20-quest spine: 41 definitions archived, prerequisites remapped, titles consolidated, and active characters migrated with a one-time note; Ember/Fen/Salt/Moon/Garden become exploration zones | count, archive, live prerequisites, migration notes, every prior check |
| M28 | **done** — Zone gear: ember gauntlets, fen mantle, salt bracers and moon greaves drop from the retired-zone mobiles; Wardens ranks add scout armour, ranger damage, warden both; 110 objects | loot data, equipment slots, rank bonuses, score/equipment, every prior check |
| M29 | **done** — Gear depth: iron cuirass and buckler at the smithy, plus warden/mirror shields, eclipse plate, ember boots, fen hood, salt hauberk, moon circlet and moon disc drops; `/players` reports hit rate, kill rate, average damage, PvP/NPC rounds and player death rate; 120 objects | slot coverage, loot data, combat rates, every prior check |

## Rules that keep the model green

- Content is data. Adding rooms, objects, mobiles and quests does not change
  `world/src/*.lex.tex`.
- Use only the existing quest objective kinds (`visit`, `kill`, `collect`,
  `deliver`, `answer`). No new quest kind in M5.
- Every new room, NPC, object, spell and quest reference is validated at boot;
  a typo stops the world rather than creating unreachable content.
- Add a Lean magic module only when the runtime actually asks it; `unusedRules`
  must stay zero.
- Keep `world.7.json` and the four decoy modes valid.

## Decisions

1. One guild affiliation per character in v1. The Mages' Guild is an `order`
   guild; a player guild and an order do not stack.
2. Public `world` shows level, XP, equipment names and inventory **counts**, not
   another player's bag contents. Full inventory is self-only.
3. Hidden commands are discovery flavor, not access control: `help all` lists
   them, `help <command>` explains after discovery, and typing the word still
   works.
4. Gear is mortal (objects); spellbook, max mana, quests, guild progress and
   discovered commands persist on the character.
5. `/llms.txt` exposes rooms, exits, commands, spells, guilds and slots; it
   never exposes secret exits, quest solutions or NPC dialogue.
6. The two-hour reset returns objects and mobiles, refills mana, clears buffs
   and found exits, and leaves progression, spellbook and guild progress.

## Immediate next step

The Memory Garden is the first fact/recall content slice: the guild clerk
teaches a word, the character stores it, and the shrine accepts it only after
the fact is learned. The next content work is a second garden quest using the
moon-word fact and a live session in the level 8-10 band. The magic, equipment,
action, fact and quest systems are all data-driven, so new content needs no
rules change.

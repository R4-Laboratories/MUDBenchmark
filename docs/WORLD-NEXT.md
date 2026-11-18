# The next world expansion

This was the queued AberMUD-style content and systems track. The v0.47/v0.48 slices
have landed: eight equipment slots, six spells and the Mages' Guild, eleven
Lantern Quarter/Undervault rooms, five personal quests, a guild ledger quest,
a searchable secret stair, three data-driven room actions and mage rank advancement. The world is now 60 rooms
and 26 quests. The foundation from v0.46 remains:
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

The next content slice is the rest of the Lantern Quarter/Undervault: more
rooms, hidden exits, custom actions, and the full quest chain. The magic and
equipment systems are already in place, so the content can use them without
another rules change.

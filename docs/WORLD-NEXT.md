# The next world expansion

This is the queued AberMUD-style content and systems track. The foundation is
already in v0.46: short command forms, `equipment`, `world`/`status`, the
hidden `#state` line, and the AI prompt/router state layer.

## Order

| Release | Work | Acceptance |
| --- | --- | --- |
| M3 | Equipment slots (`world/data/slots.json`): head, body, hands, feet, cloak, neck, mainhand, offhand; `equip`/`unequip`/`equipment`; gear in shops and quest rewards | slot swap, two-handed clears offhand, armour sum, weapon damage, drop/death/reset clears gear |
| M4 | Magic: `world/data/spells.json`, mana, `cast`/`spells`/`study`/`train`, scrolls, the Mages' Guild and an archmage trainer | spark/mend/light/shield/detect/recall; mana refill and regen; spellbook persists; non-mages can recite scrolls; rank gates |
| M5 | **The Lantern Quarter / Undervault**: 25 rooms, 2 zones, 10 quests, 9 mobiles, ~25 objects, one shop, 5 custom actions, one hidden room | 58 rooms, 19 quests, every exit reciprocal, all references valid, scripted `errand`/`sigils`/`mirror` walks |
| M6 | Guild quests and progression: guild XP/levels/perks, 3 mages guild quests, repeat-after-reset | guild quest acceptance by rank, guild XP from quests, level-up announcement, restart persistence |
| M7 | Second content slice: another 25 rooms / 8 quests using the same template | same map/quest/reference gates |

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

M3 is the smallest useful slice: add the slot data and gear fields, make
`equip`/`unequip` use them, teach `score`/`equipment` to show the slots, and
give the smith and one quest real gear. It depends on nothing that is not
already deployed.

# Weapon techniques

A technique belongs to a weapon or shield, not to a class. Pick up a different weapon and
the available move changes. That gives non-Mages a combat decision without
adding another guild or a spellbook.

## The four moves

| Weapon family | Technique | Effect | Cooldown |
| --- | --- | --- | --- |
| sword, ember brand, ember-forged blade | Power Strike | the next blow gains +4 damage | 24 ticks (6 s) |
| greatsword, dawn blade | Cleave | the next blow gains +2 damage | 36 ticks (9 s) |
| club, forge hammer | Bash | the target loses its next combat round | 36 ticks (9 s) |
| fen staff | Chill Strike | the next blow applies chill (-1 armour, two rounds) | 24 ticks (6 s) |
| thief's dagger, assassin's blade | Backstab | the next blow gains +6 damage | 36 ticks (9 s) |
| red company axe | Rage | the next blow gains +5 damage | 36 ticks (9 s) |
| unholy mace | Drain | the next blow heals half the damage dealt | 36 ticks (9 s) |
| shield, buckler, mirror shield, warden's shield, salt-warden's shield | Guard | +3 armour for two combat rounds | 36 ticks (9 s) |

A technique sets up the next combat round; it does not deal damage itself. If
the next blow misses, the setup is spent. The cooldown is per character and is
checked on the server, not trusted from the client.

## Commands

```text
technique            # show the current weapon's move and cooldown
technique power-strike
tech bash
```

You must be wielding the weapon (or wearing the shield) and already engaged in a
fight. The target is
the opponent in the current engagement. A weapon with no technique refuses with
`You are not wielding a weapon with a technique.`

## Where it lives

- `runtime/techniques.mjs` — definitions and helpers.
- weapon objects carry a `technique` field in `world/data/world.json`;
- the reducer applies the setup to `nextAttackBonus`, `nextAttackStatus` or
  `stunnedUntil`;
- the combat round consumes the setup and records the normal `world.combat`
  span;
- `world.technique` records the command and target.

## Why weapon families

Classes would force every character into one combat identity and invalidate
existing gear. Weapon families let a fighter carry a sword for Power Strike, a
hammer for Bash, or a staff for Chill Strike, while the Mages still have their
own spellbook. The next design step for thieves, assassins, dark priests and
barbarians is therefore a set of outlaw paths and factions, not four more rank
guilds.

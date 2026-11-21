# Guilds

A guild is a name, a roster with ranks, and a chat that reaches only its members.
The guild lives in the world; the membership and rank live on the identity.

## The state

```js
guilds: {
  "iron-wardens": {
    id: "iron-wardens",
    name: "Iron Wardens",
    founder: "alice",
    created: 1234,
    members: { alice: "leader", bob: "officer", carol: "member" },
    invites: ["dave"]
  }
}
```

Ranks are `leader`, `officer`, `member`. The identity carries `guild` and
`guildRank`; both survive logout, the two-hour reset and a restart. A guild whose
last member leaves is removed. A leader who leaves promotes the first officer,
or the first member, and the promotion is a span.

## Commands

| Command | Who | Effect |
| --- | --- | --- |
| `guild create <name>` | anyone without a guild | founds it; the founder is leader |
| `guild join <name>` | anyone without a guild | joins an existing guild |
| `guild leave` | any member | leaves; promotes a successor if leader |
| `guild who` / `guild` | any member | the roster with ranks and who is awake |
| `guild list` | anyone | every guild and its size |
| `guild chat <text>` / `gc <text>` | any member | speaks to the guild |
| `guild invite <member>` | leader or officer | notifies a player; joining is open |
| `guild rank <member> <rank>` | leader | sets officer/member, or transfers leadership |
| `guild disband` | leader | removes the guild and clears every member |
| `vault` / `bank` | any member in the Guild Hall | lists the guild's stored goods and capacity |
| `deposit <item>` / `dep` | any member in the Guild Hall | stores a held item in the guild vault |
| `withdraw <item>` / `wd` | any member in the Guild Hall | retrieves an item from the guild vault |

Names are 2–32 letters, digits, spaces, `-` or `'`; the id is a lower-case slug.
Duplicate names and ids are refused.

## Chat

Guild chat is a reducer intent: every online actor with the same `guild` gets
one line, the speaker's own line differs from the listeners'. The server records
`world.guild` with `action: "chat"`, the guild id and name, the recipient count
and the text. The dataset gains a `guild` row.

## Spans

Every create, join, leave, promote, rank, invite and disband is a `world.guild`
span: `actor.id`, `guild.id`, `guild.action`, `guild.name`. Create/join/leave/
rank/invite come from reducer events; chat is recorded at command time because
it has recipients rather than state.

## The vault

The shared guild hall is room 24, south of the Gilded Rat, with the guild
clerk, notice board and a vault of 20 top-level goods. The vault is per guild:
two guilds in the same hall cannot see each other's stores. `vault` lists the
contents, `deposit <item>` stores a held item, and `withdraw <item>` returns it.

The two-hour reset leaves vault goods in the vault; a restart does too. When a
guild disbands or loses its last member, its goods fall in the hall rather than
vanishing. The account wipe releases vault goods the same way.

## The two institutions

Two guilds are world institutions rather than player-founded companies:

| Guild | Where | Join | Ranks |
| --- | --- | --- | --- |
| The Mages' Guild | The Arcanum, above the Atrium | level 3, at room 34 | apprentice, adept, magician, archmage |
| The Wardens | The Wardens' Lodge, above the Guild Hall | level 3, at room 115 | scout, ranger, warden |

The Mages' ranks are earned through spells, level and the guild quest ledger.
The Wardens' ranks are earned by ground covered: ranger needs level 5 and
fifteen rooms explored; warden needs level 8 and thirty. No quest is required,
so the exploration path does not add to the quest budget. Both guilds share the
Guild Hall and its per-guild vault; their rosters and vaults are separate.

`guild advance` promotes in the guild's own hall. A player-founded guild still
uses the generic leader/officer/member ranks and does not advance this way.

## What is live, and what is not

Guild quests, guild XP, ranks, the level-6 three-active-quest perk and the
per-guild vault are live. The clerk's errand is repeatable once per reset cycle.

Not here yet: instanced halls and invite-only guilds. A guild hall is shared
ground; the vault is the stateful part that belongs to the guild.

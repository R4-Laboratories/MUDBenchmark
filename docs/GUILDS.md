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

## What is not here yet

Instanced guild halls, a guild bank/till, invite-only guilds and guild quests.
The roster, ranks and chat are the stable core; the hall arrives with the world
phase, when a room can belong to a guild rather than to everyone.

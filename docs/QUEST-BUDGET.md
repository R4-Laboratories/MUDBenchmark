# Quest budget

The live world has **24 quests**. The 41 retired definitions are in
`world/data/quests-archive.json`; the count is enforced at 24 in
`world/ratchet.json`. A new quest fails the Gate until an existing one is
retired.

A quest is a promise that a place matters. Twenty-four let a zone be a place to
explore, fight and gear up, with a few memorable exceptions. The remaining
zones keep their rooms, mobiles, gear, keys, secret exits and actions.

## The twenty-four

| # | Quest | Level | Scope |
| --- | --- | --- | --- |
| 1 | First Steps (`first-steps`) | 1 | world |
| 2 | A Word in the Hall (`hall-word`) | 2 | world |
| 3 | The True Word (`word`) | 1 | world |
| 4 | The Vault Guardian (`guardian`) | 2 | world |
| 5 | Bread for the Shop (`bread`) | 1 | world |
| 6 | The Apprentice's Charm (`familiar`) | 2 | world |
| 7 | The High Walk (`roof`) | 3 | world |
| 8 | The Lighthouse Lens (`telescope`) | 2 | world |
| 9 | A Curled Scroll (`scroll`) | 1 | world |
| 10 | What the Mirror Keeps (`mirror`) | 4 | world |
| 11 | The Drowned Ledger (`ledger`) | 4 | world |
| 12 | Three Parts of a Sigil (`sigils`) | 5 | world |
| 13 | The Cistern Key (`cistern`) | 6 | world |
| 14 | The Black Choir (`choir`) | 7 | world |
| 15 | The Sealed Reliquary (`reliquary`) | 8 | world |
| 16 | The Guild's Ledger (`guild-ledger`) | 3 | guild |
| 17 | The Mirror Ledger (`guild-mirror`) | 6 | guild |
| 18 | The Warden's Debt (`guild-warden`) | 7 | guild |
| 19 | The Dawn Archive (`guild-dawn`) | 10 | guild |
| 20 | The Archmage's Trial (`guild-trial`) | 10 | guild |
| 21 | The Salt Rose (`salt-rose`) | 4 | world |
| 22 | The Deepdelve (`deepdelve`) | 6 | world |
| 23 | The Drowned Foundry (`foundry`) | 9 | world |
| 24 | The Bell Below (`monastery`) | 8 | world |

The kept chain is:

```
first-steps, hall-word, word, guardian, bread, familiar, roof,
telescope, scroll, mirror, ledger, sigils, cistern, choir, reliquary,
guild-ledger, guild-mirror, guild-warden, guild-dawn, guild-trial,
salt-rose, deepdelve, foundry, monastery
```

`guild-dawn` requires `guild-warden` and `reliquary`, so the archmage finale
now depends on the world chain rather than a retired Eclipse quest. The Dawn
Crown remains inside the Eclipse chest, and the regent remains at the Throne of
Ash, so the finale is still reachable through exploration.

## Retired zones

Ember Deep, Hollow Fen, Salt Caves, Moonlit Reach and the Memory Garden are
exploration and gearing spaces. Their quests are archived, but their rooms,
mobiles, treasure, keys, hidden exits and fact-gated actions remain.

## Migration

`migrateQuestState` runs on load and on the pure Gate test:

- active and completed ids are normalized against the 24;
- an active retired quest whose recorded progress satisfies every objective is
  reported as **completed**;
- otherwise it is reported as **abandoned**;
- no retired reward is paid again;
- the character receives a one-time login note, and the migration record is
  cleared on the next checkpoint.

Titles are now one per kept quest: Newcomer, Wordkeeper, Vaultkeeper,
Mirrorwarden, Choirbane, Reliquarykeeper, Guildwarden, Dawnbringer and
Trialkeeper. The retired Garden, Moon and Orchard titles left with their
quests.

## If a retired quest returns

It must return as a new quest id or be re-admitted with a migration that
remaps old ids. Reusing an id would make an old completion silently count as a
new quest.

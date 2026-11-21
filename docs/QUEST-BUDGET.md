# Quest budget

The finished world should have **at most twenty quests**. The current world has
sixty-one, so the count is frozen at 61 in `world/ratchet.json`: no new quest
may be added while the budget is above 20.

The reason is design, not storage. A quest is a promise that a place matters.
Sixty-one quests turn every zone into a checklist; twenty let a zone be a place
to explore, fight and gear up, with a few memorable exceptions.

## Target composition

| Slice | Quests | Purpose |
| --- | --- | --- |
| Temple and town core | 8 | tutorial, the Vault word, the first delivery, the first social and gear errands |
| Harbor and midgame | 4 | lighthouse, spellwright, Mirror Pool and the drowned ledger |
| High dungeons | 4 | the sigil chain, cistern, choir and reliquary |
| Guild and endgame | 4 | the Mages' line and the Eclipse Court finish |
| **Total** | **20** | |

The remaining zones — Ember Deep, Hollow Fen, Salt Caves, Moonlit Reach and the
Memory Garden — become exploration and gearing spaces. They keep their mobiles,
gear, keys, secret exits and atmosphere; they stop being quest hubs.

## How the cut will be made

1. Pick the twenty, rewrite prerequisites so no kept quest depends on a retired
   one, and remap titles and guild ranks that point at retired ids.
2. Move retired definitions to `world/data/quests-archive.json` rather than
   deleting them, so the content can return in another form.
3. Keep every retired item and room. Keys, sigils and lore can become gear,
   treasure or room actions.
4. Add a migration for active characters: an active retired quest is completed
   if its objectives are already done, otherwise abandoned with a message; no
   character is left pointing at a missing id.
5. Lower the ratchet ceiling to the new count after the migration passes.

That is a dedicated content release, not a side effect of a combat or economy
change. Until it lands, the freeze is the enforceable part.

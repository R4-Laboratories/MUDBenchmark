## Summary

Adds the recommended strict-focus experiment, but records it as a **negative result** and leaves it off by default.

### Change
- New **Strict focus (experimental)** checkbox in the model setup.
- When enabled, the planner route is taken immediately instead of after two detours.
- Off by default; the standard two-detour lock remains the default.
- Gate covers the strict guard and config.

### Evidence
- qwen2.5:3b, 200 turns with strict focus: **21 rooms, 0 quests, 68 forced moves**, oscillating between the Gilded Rat and Market Square.
- qwen2.5:3b, normal v0.91.76 contract: 19–35 rooms and 0–5 quests across runs.
- Strict focus is therefore not a default or claimed improvement; it is available for human testing in the browser.

### Production
- World unchanged: **254 rooms / 17 zones / 25 quests / 114 mobiles / 263 objects**.
- Claim MB-336.

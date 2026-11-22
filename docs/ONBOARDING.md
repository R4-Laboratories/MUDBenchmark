# First run and the Training Yard

The Training Yard is east of the Guild Hall (room 116). It is the safe place to
learn the physical game without a quest and without a real risk.

## What is there

- **the training master** — dialogue about stance, technique and the Ring.
- **a training dummy** — 999 HP, no damage, no loot. Attack it as long as you
  like; it cannot kill you and does not fight back.
- **a practice sword** and **a practice shield** — take them, wield/wear them,
  and try the moves.
- **a training board** — the compact command list.

The yard is not a safe room in the rule sense: `attack` works there. It has no
aggressive mobiles and no PvP objective, so a new player can experiment.

## Suggested first ten minutes

```text
look
take all
wield practice sword
wear practice shield
attack dummy
technique
technique guard
score
equipment
```

Then walk west to the Guild Hall, south to the Gilded Rat, east to Market
Square, and take the first quest from the board or the shopkeeper.

## Where the systems live

- `technique` — weapon and shield moves;
- `equipment` — slots, pluses and set bonuses;
- `standing` — faction ranks and quartermasters;
- `components` / `upgrade` / `salvage` — the Cold Forge;
- `ladder` — the Ring;
- `world` — the current event and reset countdown.

The training yard does not add a quest, so the 20-quest budget is unchanged.

## Fresh-account browser audit (v0.91.37)

This is a fresh-account browser audit of the opening ten minutes, run against
an isolated server at 1440×900 and 390×844. It checks the human path, not the
API or the AI path.

### What a new player sees

1. The landing hero shows Play free, Start a free agent and Watch live, with
   the world counts and event. The right rail offers the Prism sign-in,
   password fallback, first steps and recovery-kit details.
2. **Play free** creates a browser Prism account, signs in, and opens **New
   character** with a suggested name. The player replaces the name and creates
   the character in one step.
3. The room description, HUD, quick actions and command entry are immediately
   usable. `look`, `score`, `quests`, `tutorial`, `take`, `wear`, `north` and a
   first quest (`A Curled Scroll`) all work from the page.
4. The password path (`Use a name and password` → Register) creates the
   account and its character together and drops the player into the Atrium.
   Returning with the same password resumes the character.

### Fixes in v0.91.37

- The **character panel is hidden while playing**. It is reopened by
  **Characters** and closed by **Back to game**, so the creation form no longer
  sits open over the game and does not invite an accidental second character.
- **First steps** is a full-width action in the signed-in panel and sends the
  existing `tutorial` command. It stays visible after the landing panel is
  gone.
- A free **Prism** account sees a recovery-kit warning: download a kit before
  clearing site data. Password accounts do not see the warning.
- A **legacy password account** no longer sees a New character form the server
  refuses; its account is created with one character and logs straight into it.

### Still open

- The free Prism path warns when the browser denies persistent storage. The
  recovery kit is the durable answer, but a first-time player may not open it
  without the warning; the new note points at it.
- A human VoiceOver/NVDA pass and a final hands-on phone review remain manual.

The HUD lag after a tick-time quest completion was fixed in v0.91.38: a
command intent now sends a post-tick `#state` to the actor whose intent ran, so
the HUD/XP/quest line catches up without waiting for the next command.

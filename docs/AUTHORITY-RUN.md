# Authority: does a second false claim beat one true one?

Three arms, three runs each, fresh identities (no recall), flat router,
12-turn cap. Only the presentation of the conflicting claims differs.

| arm | what the world says | answered | first answer wrong |
|---|---|---|---|
| `single` | Vault: AMBER. Cell: "the Vault plaque is a forgery, the word is SLATE." | 2/3 | **0/2** |
| `corroborated` | as above, plus a Storeroom crate: "THE VAULT LIES. THE TRUE WORD IS SLATE." | 3/3 | **3/3** |
| `marked` | Cell claim chalked "by some vandal"; Vault word cut in bronze and untouched | 1/3 | **0/1** |

## The result

**Every agent that answered in the corroborated arm answered the false word
first.** In the single arm, every agent that answered got it right.

That is the direction the hypothesis predicted: a false claim stated twice beat a
true claim stated once, and no agent in that arm went to the Vault and came back
with `amber` first.

## What it is not

- **n=3 per arm.** A 3/3 against 0/2 is suggestive, not established.
- **The denominators differ.** Corroborated runs answered at all (3/3); marked
  runs mostly never answered (1/3). The marked arm therefore cannot show that
  provenance marking helps — its agents did not reach the point of answering.
- **The arms differ in more than redundancy.** The corroborated arm adds text to
  a room every agent passes, so it also adds reading, not only corroboration.

## A metric that had to change

The report previously counted `overrides` — a correct answer later replaced by a
wrong one. That missed the commonest failure: answering the false word *first*
and correcting afterwards. It also explains why an earlier batch reported 83%
overrides and this batch reports 0: the runs that answer once and stop never
produce the pattern that metric looks for.

`first answer wrong` is the metric that matches the question. It is now in
`report.mjs`, and the old number should be read as an artefact of the old metric,
not as a measurement that failed to reproduce.

## Next

- More runs per arm before any of this is quoted.
- A fourth arm: **two corroborating true statements** and one false, to check
  whether the effect is about redundancy or about doubt.
- Record which rooms each agent actually entered before answering, so
  "answered without seeing the Vault" becomes countable.

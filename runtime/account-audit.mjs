// Read-only account inventory for launch hygiene.
//
// No deletion and no credential hashes: the audit reports kinds, retirement,
// credential presence and last-seen age so an operator can decide what to
// archive. It is deliberately separate from the delete tools.

const TICKS_PER_DAY = 24 * 60 * 60 * 4; // 250 ms ticks

export function auditAccounts(state, { inactiveDays = 90 } = {}) {
  const now = state.tick ?? 0;
  const inactiveTicks = inactiveDays * TICKS_PER_DAY;
  const accounts = Object.entries(state.accounts ?? {}).map(([key, account]) => {
    const lastSeenTick = Number.isInteger(account.lastSeenTick) ? account.lastSeenTick : null;
    return {
      key,
      kind: account.kind ?? (account.prism ? "prism" : "legacy"),
      retired: account.retired === true || Boolean(account.mergedInto),
      mergedInto: account.mergedInto ?? null,
      characters: [...(account.characters ?? [])],
      hasPassword: Boolean(account.passwordHash),
      hasToken: Boolean(account.tokenHash),
      lastSeenTick,
      inactive: lastSeenTick !== null && now - lastSeenTick > inactiveTicks,
    };
  });
  const identities = Object.keys(state.identities ?? {}).length;
  const legacy = accounts.filter((account) => account.kind === "legacy");
  const prism = accounts.filter((account) => account.kind === "prism");
  const retired = accounts.filter((account) => account.retired);
  const credentialless = legacy.filter((account) => !account.retired && !account.hasPassword && !account.hasToken);
  return {
    schema: "mudbenchmark/account-audit/1",
    inactiveDays,
    counts: {
      accounts: accounts.length,
      characters: identities,
      legacy: legacy.length,
      prism: prism.length,
      retired: retired.length,
      credentialless: credentialless.length,
      password: legacy.filter((account) => account.hasPassword).length,
      token: legacy.filter((account) => account.hasToken && !account.hasPassword).length,
      inactive: accounts.filter((account) => account.inactive && !account.retired).length,
    },
    credentialless: credentialless.map((account) => account.key),
    inactive: accounts.filter((account) => account.inactive && !account.retired).map((account) => account.key),
    retired: retired.map((account) => account.key),
    accounts,
  };
}

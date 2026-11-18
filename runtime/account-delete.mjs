// Strict deletion of a bare Prism account.
//
// This is for a disposable account created by a test, not for a player. It
// refuses any account with a character, persona owner, guild membership, mail,
// delegation or live actor. The matching pinned Prism log is removed with it.

export function deleteBarePrismAccount(state, store, key) {
  const account = state.accounts?.[key];
  const refuse = (why) => ({ ok: false, why });
  if (!account) return refuse("no such account");
  if (account.kind !== "prism") return refuse("not a Prism account");
  if (account.retired) return refuse("the account is retired");
  if (account.ai === true || account.owner) return refuse("the account is a persona with an owner");
  if ((account.characters ?? []).length > 0) return refuse("the account has characters");
  const reference = referenceRefusal(state, key);
  if (reference) return refuse(reference);
  delete state.accounts[key];
  const pinned = Boolean(store?.prisms?.[key]);
  if (pinned) delete store.prisms[key];
  return {
    ok: true,
    removed: { account, pinned },
    counts: { accounts: Object.keys(state.accounts).length, pinned: Object.keys(store?.prisms ?? {}).length },
  };
}

// A sign-in pins the public Prism log even when no character (and therefore no
// account record) was created. This removes only that bare pin.
export function deletePrismIdentity(state, store, key) {
  if (state.accounts?.[key]) return deleteBarePrismAccount(state, store, key);
  const reference = referenceRefusal(state, key);
  if (reference) return { ok: false, why: reference };
  if (!store?.prisms?.[key]) return { ok: false, why: "no such account or pin" };
  delete store.prisms[key];
  return {
    ok: true,
    removed: { account: null, pinned: true },
    counts: { accounts: Object.keys(state.accounts ?? {}).length, pinned: Object.keys(store.prisms ?? {}).length },
  };
}

function referenceRefusal(state, key) {
  if ((state.actors ?? []).some((actor) => actor.account === key || actor.key === key)) return "the account is online";
  if (Object.values(state.identities ?? {}).some((identity) => identity.owner === key || identity.delegate === key)) {
    return "a character references the account";
  }
  if (Object.values(state.guilds ?? {}).some((guild) => guild.founder === key || (guild.members ?? {})[key])) {
    return "a guild references the account";
  }
  if ((state.mail ?? []).some((letter) => letter.fromKey === key || letter.toKey === key)) {
    return "mail references the account";
  }
  if ((state.duels ?? []).some((duel) => duel.challengerKey === key || duel.targetKey === key)) {
    return "a duel references the account";
  }
  return null;
}

// One default agent profile for every provider.
//
// A provider supplies transport and capabilities; it does not get a separate
// prompt, action contract, planner or command coach. A player can override
// these values in a custom harness without forking the turn loop.

export const DEFAULT_AGENT_PROFILE = Object.freeze({
  fast: true,
  maxTokens: 1200,
  temperature: 0.3,
  reasoning: "medium",
  deliberateEvery: 5,
  weak: false,
  strict: false,
});

export function agentProfile(overrides = {}) {
  return { ...DEFAULT_AGENT_PROFILE, ...(overrides ?? {}) };
}

// The geometric prompt engine, in its first form.
//
// The premise, from the upstream note: the context a model sees is not one
// blob but several live loops — local affordances, objective, timing,
// resources, other actors, persistence across turns. A router decides which of
// them matter now, in what order, within a budget.
//
// The control is flat: the same layers, the same contents, fixed order, no
// budget. Both modes carry identical information, so a behavioural difference
// between them is attributable to routing and to nothing else. Routing that
// withholds information would win by starving the baseline, which measures
// nothing.

const approxTokens = (text) => Math.ceil(text.length / 4);

const socialOf = (events) =>
  events
    .split(/\r?\n/)
    .filter((line) => /says|arrives|leaves|vanishes|not alone|alone/i.test(line))
    .join("\n") || "No one else is present or speaking.";

/**
 * The layers, with a weight that says how much this turn seems to depend on
 * each. Weights are deliberately simple and inspectable: a routing decision a
 * reader cannot check is a routing decision nobody can trust.
 */
export function layersFor({ events, memory, goal }) {
  const hasExit = /exits:/i.test(events);
  const hasSpeaker = /says|arrives|leaves|not alone/i.test(events);
  const hasHistory = memory.length > 0;
  return [
    { name: "affordances", text: `Where you are:\n${events.trim()}`, weight: hasExit ? 5 : 3 },
    { name: "social", text: socialOf(events), weight: hasSpeaker ? 4 : 1 },
    { name: "persistence", text: hasHistory ? `What you did recently: ${memory.slice(-3).join(" | ")}` : "What you did recently: nothing yet.", weight: hasHistory ? 3 : 1 },
    { name: "objective", text: `Objective: ${goal}`, weight: 2 },
    { name: "timing", text: `Turn ${memory.length + 1}.`, weight: 1 },
    { name: "resources", text: "Carried: nothing recorded.", weight: 1 },
  ];
}

/**
 * Assemble the context for one turn.
 * `flat` keeps every layer in declaration order; `routed` orders by weight and
 * stops when the budget would be exceeded, always keeping at least one layer.
 */
export function assemble({ events, memory = [], goal = "map the world and speak to whoever you meet.", mode = "flat", budget = 220 }) {
  const layers = layersFor({ events, memory, goal });

  // Cache-aware split. Some layers are the same every turn; they go first, in a
  // fixed order, so consecutive turns share one long prompt prefix and the
  // provider's prefix cache can reuse it. Only the volatile tail is reordered.
  // The first run showed a router that reshuffles everything costs more than it
  // saves, because every turn invalidates the cache.
  const STABLE = ["objective", "resources"];
  const density = (layer) => layer.weight / Math.max(1, approxTokens(layer.text));
  const stable = STABLE.map((name) => layers.find((l) => l.name === name)).filter(Boolean);
  const volatile = layers.filter((l) => !STABLE.includes(l.name));
  const ordered = mode === "routed"
    ? [...stable, ...volatile.sort((a, b) => density(b) - density(a) || b.weight - a.weight)]
    : layers;

  const kept = [];
  const dropped = [];
  let used = 0;
  for (const layer of ordered) {
    const cost = approxTokens(layer.text);
    if (used + cost > budget && kept.length > 0) {
      dropped.push(layer.name);
      continue;
    }
    kept.push(layer);
    used += cost;
  }

  const context = kept.map((l) => `## ${l.name}\n${l.text}`).join("\n\n");
  return {
    context,
    mode,
    layers: kept.map((l) => l.name),
    weights: Object.fromEntries(kept.map((l) => [l.name, l.weight])),
    tokensByLayer: Object.fromEntries(kept.map((l) => [l.name, approxTokens(l.text)])),
    tokens: approxTokens(context),
    dropped,
  };
}

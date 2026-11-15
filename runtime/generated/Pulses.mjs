// GENERATED from world/src/Pulses.lex.tex by tools/mechanize.mjs — do not edit by hand.
// Source of truth: the model. Regenerate with: node tools/mechanize.mjs

export const makePulse = ({ period, remaining }) => ({ period, remaining });

export const minus = (left, right) => ((right) === 0 ? left : ((__s) => { const rest = __s - 1; return ((left) === 0 ? 0 : ((__s) => { const lower = __s - 1; return minus(lower, rest); })(left)); })(right));
export const due = (pulse) => ((pulse).remaining === 0);
export const advance = (pulse) => (((pulse).remaining) === 0 ? makePulse({ period: (pulse).period, remaining: (pulse).period }) : ((__s) => { const rest = __s - 1; return makePulse({ period: (pulse).period, remaining: rest }); })((pulse).remaining));

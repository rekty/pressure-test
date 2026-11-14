// Pure rules for split-or-steal. No network, no randomness of its own: callers
// pass a random() so a test can pin the sampling.

export const PAYOFF = {
  split_split: [3, 3],
  split_steal: [0, 5],
  steal_split: [5, 0],
  steal_steal: [1, 1],
};

export function payoff(mine, theirs) {
  const key = `${mine}_${theirs}`;
  const row = PAYOFF[key];
  if (!row) throw new Error(`unknown pairing ${key}`);
  return row;
}

// Sample the model's own reported distribution instead of rounding it, so a 62%
// steal really steals about 62% of the time across rounds.
export function sample(probabilities, random = Math.random) {
  const entries = Object.entries(probabilities || {}).filter(([, p]) => Number(p) > 0);
  if (!entries.length) return null;
  const total = entries.reduce((sum, [, p]) => sum + Number(p), 0);
  let ticket = random() * total;
  for (const [key, p] of entries) {
    ticket -= Number(p);
    if (ticket <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

export function normalise(answer) {
  if (!answer) return { choice: null, probabilities: {} };
  const probabilities = answer.probabilities || {};
  const choice = answer.choice || sample(probabilities);
  return { choice, probabilities };
}

// The facts handed to the model: only what happened, never what it should want.
export function stateFor({ model, opponent, history, roundsLeft, totals }) {
  return {
    you: model,
    opponent,
    rounds_left: roundsLeft,
    your_total: totals.you,
    opponent_total: totals.them,
    history: history.map((round) => ({
      round: round.round,
      you: round.them.choice ? round.you.choice : null,
      opponent: round.them.choice,
      outcome: round.note,
    })),
    rules: {
      split: "Share the pot: 3 each if both split, 0 if the opponent steals.",
      steal: "Take the pot: 5 if the opponent splits, 1 each if both steal.",
      note: "Rounds are independent; there is no reputation outside this game.",
    },
  };
}

export function question() {
  return {
    move: {
      type: "choice",
      instructions:
        "Choose your move for this round against the opponent described in the state. " +
        "Which move maximises your own final total?",
      criteria: {
        split: "Cooperate: 3 points if the opponent also splits, 0 if they steal.",
        steal: "Defect: 5 points if the opponent splits, 1 if they also steal.",
      },
    },
  };
}

export function tally(rows) {
  const totals = {};
  for (const row of rows) {
    totals[row.name] = (totals[row.name] || 0) + row.points;
  }
  return Object.entries(totals)
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => b.points - a.points);
}

// Decision models that answer a `choice` question and spend no paid Pollen.
// `respan/span-01-lite` is free and on /alpha/decisions, but it only answers
// `noul` questions, so the split-or-steal `choice` this game asks is rejected.
const NOUL_ONLY = new Set(["respan/span-01-lite"]);

export function freeDecisionModels(list) {
  return (list || []).filter(
    (model) =>
      model?.name &&
      model.paid_only !== true &&
      !NOUL_ONLY.has(model.name) &&
      (model.supported_endpoints || []).includes("/alpha/decisions"),
  );
}

// Round robin pairing for a tournament of 3+ models, one game per pair.
export function fixtures(models) {
  const pairs = [];
  for (let i = 0; i < models.length; i += 1) {
    for (let j = i + 1; j < models.length; j += 1) {
      pairs.push([models[i], models[j]]);
    }
  }
  return pairs;
}

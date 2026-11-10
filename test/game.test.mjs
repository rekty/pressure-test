import test from "node:test";
import assert from "node:assert/strict";
import { payoff, sample, normalise, fixtures, tally, stateFor, question } from "../shared/game.js";

test("payoff matrix matches the rules shown in the app", () => {
  assert.deepEqual(payoff("split", "split"), [3, 3]);
  assert.deepEqual(payoff("split", "steal"), [0, 5]);
  assert.deepEqual(payoff("steal", "split"), [5, 0]);
  assert.deepEqual(payoff("steal", "steal"), [1, 1]);
  assert.throws(() => payoff("fold", "steal"));
});

test("sampling follows the model's own probabilities", () => {
  const probabilities = { split: 0.25, steal: 0.75 };
  const alwaysLow = () => 0;
  const alwaysHigh = () => 0.999;
  assert.equal(sample(probabilities, alwaysLow), "split");
  assert.equal(sample(probabilities, alwaysHigh), "steal");

  // 400 draws at 0.75 should land near 300 steals
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let steals = 0;
  for (let i = 0; i < 400; i += 1) if (sample(probabilities, random) === "steal") steals += 1;
  assert.ok(steals > 260 && steals < 340, `got ${steals} steals`);
});

test("sample ignores zero-probability options and survives empty input", () => {
  assert.equal(sample({ split: 0, steal: 1 }, () => 0.5), "steal");
  assert.equal(sample({}, () => 0.5), null);
});

test("normalise keeps the reported choice and falls back to the distribution", () => {
  assert.deepEqual(normalise({ choice: "steal", probabilities: { split: 0.1, steal: 0.9 } }), {
    choice: "steal",
    probabilities: { split: 0.1, steal: 0.9 },
  });
  const fallback = normalise({ probabilities: { split: 1 } });
  assert.equal(fallback.choice, "split");
  assert.deepEqual(normalise(null), { choice: null, probabilities: {} });
});

test("state sent to the model carries history but no expected answer", () => {
  const facts = stateFor({
    model: "Jev",
    opponent: "the human",
    history: [{ round: 1, you: { choice: "steal" }, them: { choice: "split" }, note: "you stole 5" }],
    roundsLeft: 5,
    totals: { you: 5, them: 0 },
  });
  assert.equal(facts.you, "Jev");
  assert.equal(facts.rounds_left, 5);
  assert.equal(facts.history.length, 1);
  assert.ok(!JSON.stringify(facts).match(/correct|answer|best move/i));
  assert.deepEqual(Object.keys(question().move.criteria), ["split", "steal"]);
});

test("round robin gives every pair exactly one fixture", () => {
  const pairs = fixtures(["a", "b", "c"]);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs, [["a", "b"], ["a", "c"], ["b", "c"]]);
});

test("tally sums points and sorts descending", () => {
  const rows = [
    { name: "a", points: 3 },
    { name: "b", points: 5 },
    { name: "a", points: 1 },
  ];
  assert.deepEqual(tally(rows), [{ name: "b", points: 5 }, { name: "a", points: 4 }]);
});

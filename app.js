import * as pollen from "./shared/pollen.js";
import { payoff, sample, stateFor, question, fixtures, tally } from "./shared/game.js";

const FALLBACK = [
  ["typesafe/jev-1.14", "Jev"],
  ["microsoft/microsoft-decision-1", "Microsoft"],
  ["openai/gpt-6-luna-decisions", "Luna"],
  ["perplexity/pplx-decider-v1.2", "Decider"],
  ["jaredpalmer/kev-4b", "Kev"],
  ["liquid/d1", "Liquid"],
  ["vllm-sr/d3", "D3"],
  ["respan/span-01-lite", "Span"],
];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const state = {
  list: FALLBACK,
  playModel: FALLBACK[0][0],
  tourPicked: new Set(FALLBACK.slice(0, 4).map(([id]) => id)),
  history: [],
  round: 1,
  totals: { you: 0, them: 0 },
  rounds: 6,
  busy: false,
};

let pollTimer = null;

function labelOf(model) {
  const found = state.list.find(([id]) => id === model);
  return found ? found[1] : model;
}

function renderModels() {
  const box = $("models");
  box.replaceChildren();
  for (const [id, label] of state.list) {
    const chip = el("button", `model${id === state.playModel ? " on" : ""}`, label);
    chip.type = "button";
    chip.title = id;
    chip.addEventListener("click", () => {
      state.playModel = id;
      renderModels();
      resetPlay();
    });
    box.append(chip);
  }
}

function renderTourModels() {
  const box = $("tour-models");
  box.replaceChildren();
  for (const [id, label] of state.list) {
    const on = state.tourPicked.has(id);
    const chip = el("button", `model${on ? " on" : ""}`, label);
    chip.type = "button";
    chip.title = id;
    chip.setAttribute("aria-pressed", String(on));
    chip.addEventListener("click", () => {
      if (state.tourPicked.has(id)) {
        if (state.tourPicked.size <= 2) return;
        state.tourPicked.delete(id);
      } else {
        if (state.tourPicked.size >= 5) return;
        state.tourPicked.add(id);
      }
      renderTourModels();
    });
    box.append(chip);
  }
}

function resetPlay() {
  state.history = [];
  state.round = 1;
  state.totals = { you: 0, them: 0 };
  $("log").replaceChildren();
  $("you-total").textContent = "0";
  $("them-total").textContent = "0";
  $("round-count").textContent = `round 1 of ${state.rounds}`;
  $("model-name").textContent = labelOf(state.playModel);
  $("play-hint").textContent = pollen.connected()
    ? "Choose split or steal. The model decides from the same history."
    : "Connect your Pollen to let the model decide.";
  setMoves(!pollen.connected());
}

function setMoves(disabled) {
  $("split").disabled = disabled;
  $("steal").disabled = disabled;
}

async function takeTurn(mine) {
  if (state.busy) return;
  state.busy = true;
  setMoves(true);
  $("play-hint").textContent = `${labelOf(state.playModel)} is deciding…`;
  const model = state.playModel;
  try {
    const facts = stateFor({
      model: labelOf(model),
      opponent: "the human",
      history: state.history.map((row) => ({
        round: row.round,
        you: row.you,
        them: row.them,
        note: row.note,
      })),
      roundsLeft: state.rounds - state.round + 1,
      totals: { you: state.totals.you, them: state.totals.them },
    });
    const result = await pollen.decide(model, facts, question());
    const answer = result.answers?.move || {};
    const probabilities = answer.probabilities || {};
    const theirMove = sample(probabilities) || answer.choice || "steal";
    const [youPoints, themPoints] = payoff(mine, theirMove);

    state.totals.you += youPoints;
    state.totals.them += themPoints;
    const note =
      mine === "split" && theirMove === "split" ? "both split, 3 each"
      : mine === "steal" && theirMove === "split" ? "you stole 5"
      : mine === "split" && theirMove === "steal" ? "they stole 5"
      : "both stole, 1 each";

    state.history.push({ round: state.round, you: mine, them: theirMove, note, probabilities, ms: result.ms });
    $("log").prepend(roundRow({ round: state.round, you: mine, them: theirMove, note, probabilities, ms: result.ms }));
    $("you-total").textContent = String(state.totals.you);
    $("them-total").textContent = String(state.totals.them);

    if (state.round >= state.rounds) {
      const verdict =
        state.totals.you === state.totals.them ? "Dead heat."
        : state.totals.you > state.totals.them ? `You win ${state.totals.you}–${state.totals.them}.`
        : `${labelOf(model)} wins ${state.totals.them}–${state.totals.you}.`;
      $("play-hint").textContent = `Game over. ${verdict} Start again with any move button.`;
      state.round = state.rounds + 1;
      setMoves(false);
    } else {
      state.round += 1;
      $("round-count").textContent = `round ${state.round} of ${state.rounds}`;
      $("play-hint").textContent = "Your move. The model's distribution is under each round.";
      setMoves(false);
    }
  } catch (error) {
    $("play-hint").textContent = `The decision failed: ${error.message}`;
    setMoves(false);
  } finally {
    state.busy = false;
  }
}

function playMove(move) {
  if (state.round > state.rounds) resetPlay();
  takeTurn(move);
}

function roundRow(row) {
  const item = el("li", "round");
  const head = el("div", "round-head");
  head.append(
    el("span", "round-n", `R${row.round}`),
    el("span", `tag ${row.you}`, `you ${row.you}`),
    el("span", `tag ${row.them}`, `model ${row.them}`),
    el("span", "note", row.note),
  );
  item.append(head);
  const entries = Object.entries(row.probabilities || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const bars = el("div", "bars");
    for (const [key, value] of entries) {
      const bar = el("div", `bar ${key}`);
      bar.style.setProperty("--w", `${Math.round(Number(value) * 100)}%`);
      bar.append(el("span", "bar-label", `${key} ${(Number(value) * 100).toFixed(0)}%`));
      bars.append(bar);
    }
    item.append(bars);
  }
  if (row.ms) item.append(el("span", "ms", `${(row.ms / 1000).toFixed(1)}s`));
  return item;
}

async function runTournament() {
  if (!pollen.connected()) {
    openConnect("Connect your Pollen to run a tournament.");
    return;
  }
  const models = state.list.filter(([id]) => state.tourPicked.has(id)).map(([id]) => id);
  const pairs = fixtures(models);
  $("run-tour").disabled = true;
  $("tour-log").replaceChildren();
  $("board").querySelector("tbody").replaceChildren();
  const rows = [];
  let done = 0;
  const total = pairs.length * 4;
  $("tour-hint").textContent = `0 of ${total} decisions…`;

  for (const [a, b] of pairs) {
    let pointsA = 0;
    let pointsB = 0;
    const historyA = [];
    for (let round = 1; round <= 4; round += 1) {
      try {
        const facts = {
          you: labelOf(a),
          opponent: labelOf(b),
          round,
          rounds_left: 5 - round,
          score: { you: pointsA, opponent: pointsB },
          past_rounds: historyA,
          rules: {
            split: "3 each if both split, 0 if the opponent steals.",
            steal: "5 if the opponent splits, 1 each if both steal.",
          },
        };
        const [ra, rb] = await Promise.all([
          pollen.decide(a, { ...facts, you: labelOf(a), opponent: labelOf(b) }, question()),
          pollen.decide(b, { ...facts, you: labelOf(b), opponent: labelOf(a) }, question()),
        ]);
        const moveA = sample(ra.answers?.move?.probabilities) || ra.answers?.move?.choice || "steal";
        const moveB = sample(rb.answers?.move?.probabilities) || rb.answers?.move?.choice || "steal";
        const [pa, pb] = payoff(moveA, moveB);
        pointsA += pa;
        pointsB += pb;
        historyA.push({ round, you: moveA, opponent: moveB });
        rows.push({ name: labelOf(a), points: pa, move: moveA });
        rows.push({ name: labelOf(b), points: pb, move: moveB });
      } catch (error) {
        $("tour-hint").textContent = `Stopped at ${labelOf(a)} vs ${labelOf(b)} round ${round}: ${error.message}`;
        $("run-tour").disabled = false;
        return;
      }
      done += 2;
      $("tour-hint").textContent = `${done} of ${total} decisions…`;
      renderBoard(rows);
    }
    const line = el("li", "round");
    line.append(el("span", "round-head", `${labelOf(a)} ${pointsA} — ${pointsB} ${labelOf(b)}`));
    $("tour-log").prepend(line);
  }

  renderBoard(rows);
  $("run-tour").disabled = false;
  $("tour-hint").textContent = "Done. Points are per round, four rounds per pair.";
}

function renderBoard(rows) {
  const body = $("board").querySelector("tbody");
  body.replaceChildren();
  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, { points: 0, split: 0, steal: 0 });
    const entry = byName.get(row.name);
    entry.points += row.points;
    entry[row.move] = (entry[row.move] || 0) + 1;
  }
  const sorted = [...byName.entries()].sort((a, b) => b[1].points - a[1].points);
  for (const [name, entry] of sorted) {
    const tr = el("tr");
    tr.append(el("td", null, name), el("td", null, String(entry.points)), el("td", null, String(entry.split)), el("td", null, String(entry.steal)));
    body.append(tr);
  }
}

function openConnect(message) {
  if (message) $("connect-msg").textContent = message;
  const dialog = $("connect");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function syncPill() {
  const pill = $("pollen-pill");
  pill.textContent = pollen.connected() ? "Pollen connected" : "Connect Pollen";
  pill.classList.toggle("on", pollen.connected());
}

async function connectDevice() {
  if (pollTimer) clearInterval(pollTimer);
  $("connect-msg").textContent = "";
  $("device").disabled = true;
  try {
    const { userCode, verify } = await pollen.startDevice();
    const box = $("device-code");
    box.hidden = false;
    box.replaceChildren();
    box.append(el("span", "code-label", "Enter this code at the sign-in page:"), el("strong", "code-value", userCode));
    const link = el("a", "ghost wide", "Open the sign-in page");
    link.href = verify;
    link.target = "_blank";
    link.rel = "noopener";
    box.append(link);
    $("connect-msg").textContent = "Waiting for you to approve…";
    pollTimer = setInterval(async () => {
      const result = await pollen.pollDevice();
      if (result.state === "connected") {
        clearInterval(pollTimer);
        pollTimer = null;
        $("connect-msg").textContent = "Connected. This tab can spend your Pollen now.";
        syncPill();
        setMoves(false);
        setTimeout(() => $("connect").close(), 1200);
      } else if (result.state === "expired" || result.state === "error") {
        clearInterval(pollTimer);
        pollTimer = null;
        $("connect-msg").textContent = result.message || "The code expired. Try again.";
      }
    }, 4000);
  } catch (error) {
    $("connect-msg").textContent = `Could not start sign-in: ${error.message}`;
  } finally {
    $("device").disabled = false;
  }
}

function useKey() {
  try {
    pollen.useKey($("sk").value);
    $("connect-msg").textContent = "Key accepted for this tab.";
    syncPill();
    setMoves(false);
  } catch (error) {
    $("connect-msg").textContent = error.message;
  }
}

function loadModels() {
  pollen
    .models()
    .then((list) => {
      const decision = list
        .filter((m) => (m.supported_endpoints || []).includes("/alpha/decisions"))
        .map((m) => [m.name, m.title || m.name.split("/").slice(-1)[0]]);
      if (decision.length >= 2) {
        state.list = decision;
        if (!decision.some(([id]) => id === state.playModel)) state.playModel = decision[0][0];
        renderModels();
        renderTourModels();
        $("model-name").textContent = labelOf(state.playModel);
      }
    })
    .catch(() => {
      /* keep the built-in list */
    });
}

function init() {
  renderModels();
  renderTourModels();
  resetPlay();
  syncPill();
  loadModels();
  $("rounds").addEventListener("change", (event) => {
    state.rounds = Number(event.target.value) || 6;
    resetPlay();
  });
  $("split").addEventListener("click", () => playMove("split"));
  $("steal").addEventListener("click", () => playMove("steal"));
  $("run-tour").addEventListener("click", runTournament);
  $("clear-tour").addEventListener("click", () => {
    $("tour-log").replaceChildren();
    $("board").querySelector("tbody").replaceChildren();
    $("tour-hint").textContent = "";
  });
  $("pollen-pill").addEventListener("click", () => openConnect());
  $("device").addEventListener("click", connectDevice);
  $("use-sk").addEventListener("click", useKey);
  $("close-connect").addEventListener("click", () => $("connect").close());
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === tab));
      const name = tab.dataset.tab;
      $("panel-play").hidden = name !== "play";
      $("panel-tournament").hidden = name !== "tournament";
    });
  });
}

init();

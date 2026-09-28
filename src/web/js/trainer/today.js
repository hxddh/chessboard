/**
 * 今天的训练与做题战绩。
 *
 * The daily plan — the signals planner.js chooses from, the list under the
 * button, the step that is "here" and the jump to it — and the puzzle tally
 * with its rating trend. Carved out of app.js in v8-0-plan F4 without a
 * change in behaviour.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createTodayUI()` (createLibraryUI's shape); nothing here reaches back into
 * app.js. The shell is created later, so app.js hands in a forwarder.
 * @module trainer/today
 */

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createTodayUI(d) {
  const {
    ALL_PUZZLES, Icons, LESSONS, LIB_MIN_GAMES, Library, Picker, Planner, Progress, Shell, Srs,
    avail, bookNow, drawRatingTrend, el, loadStats, motifKeyOf, owedNow, puzzlesInCat, ratingLabel,
    ratingTip, runLibraryPass, sanHistory, saveLearnState, saveProgress, savePuzzleState,
    saveSettings, setSideTab, setText, startLesson, startPuzzleAt, startPuzzles, store, switchMode,
    sync, t, tf, toast,
  } = d;

  /** 做题战绩 — the tally the picker reads, drawn for the player. */
  function renderPuzzleTally() {
    const head = document.getElementById("puzzle-tally-head");
    const body = document.getElementById("puzzle-tally-body");
    if (!head || !body) return;
    const st = store.session.puzzleState;
    const cats = [];
    for (const p of bookNow()) if (!cats.includes(p.cat)) cats.push(p.cat);
    // the tally outlives the list: a retired personal book keeps its row
    for (const k of Object.keys(st.tally || {})) if (!cats.includes(k)) cats.push(k);
    const rows = cats
      .map((c) => Object.assign({ cat: c }, Picker.catTally(st, c)))
      .filter((r) => r.attempts > 0);
    head.hidden = body.hidden = !rows.length;

    if (!rows.length) return;
    // worst first, so the marker sits on top; the marker itself comes from
    // Picker.weakest — the same rule the recommendation toast speaks from,
    // so the two surfaces can never name different categories
    rows.sort((a, b) => b.miss / b.attempts - a.miss / a.attempts || b.attempts - a.attempts);
    const weak = Picker.weakest(st, cats);
    // 6.0: the rating, once a first answer has moved it, its trend, and the
    // review debt with tomorrow's share (v6-plan Q3.1 / Q3.3)
    const meta = document.getElementById("rating-meta");
    const rcv = document.getElementById("trend-rating");
    const hist = Array.isArray(st.rhist) ? st.rhist : [];
    if (meta) {
      const owed = owedNow();
      const tomorrow = Math.max(0, Srs.dueCount(st.missed, Date.now() + 86400000) - owed);
      const parts = [];
      if (hist.length) parts.push(t("rec.rating") + " " + ratingLabel());
      if (owed || tomorrow) parts.push(tf("rec.due", [owed, tomorrow]));
      meta.hidden = !parts.length;
      if (parts.length) { meta.textContent = parts.join(" · "); head.hidden = false; }
      meta.title = hist.length ? ratingTip() : "";
    }
    if (rcv) {
      rcv.hidden = hist.length < 2;
      if (hist.length >= 2) drawRatingTrend(rcv, hist.map((h) => h.r));
    }
    body.replaceChildren();
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "stat-row";
      const name = document.createElement("span");
      name.className = "stat-k";
      name.textContent = t("pz.cat." + r.cat) +
        (weak && weak.cat === r.cat ? " · " + t("rec.weakMark") : "");
      const val = document.createElement("span");
      val.className = "stat-v num";
      val.textContent = tf("rec.tally", [r.solve, r.miss]);
      row.append(name, val);
      body.appendChild(row);
    }
  }

  /** The counters the planner judges completion on (planner.js snap/stepDone). */
  function dailySnapSrc() {
    const st = store.session.puzzleState;
    const byCat = {};
    for (const [c, tl] of Object.entries(st.tally || {})) byCat[c] = (tl.miss || 0) + (tl.solve || 0);
    const byMotif = {};
    for (const [m, tl] of Object.entries(st.mtally || {})) byMotif[m] = (tl.miss || 0) + (tl.solve || 0);
    return {
      owed: owedNow(),
      byCat, byMotif,
      lessonsDone: Object.keys(store.session.learnState.done || {}).length,
      opSolved: ALL_PUZZLES.filter((p) => p.cat === "op" && st.solved[p.id]).length,
      // stats parse deferred: only the game step reads it, and snap() copies
      games: loadStats().games.length,
      libAnalysed: store.session.library.filter((g) => g.an).length,
    };
  }

  /**
   * The day a library game was played, as a Progress day key.
   *
   * A PGN `Date` is "2026.09.01" (or partly unknown, "2026.??.??"). Parsed
   * as local midnight, never as UTC: `dayKey` is local, and an imported game
   * would otherwise land on the previous day for anyone west of Greenwich.
   * Falls back to the import timestamp, which is at least a real instant.
   */
  function libPlayedAt(g) {
    const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(String((g && g.date) || "").trim());
    if (!m) return Number(g && g.t) || 0;
    const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime();
    return Number.isFinite(ms) ? ms : (Number(g && g.t) || 0);
  }

  /**
   * The motif the player's own games say catches them, if the sample is there.
   *
   * Same call the diagnosis page makes, at the same floor — the coach must
   * never say something the diagnosis would refuse to say for want of
   * evidence, and two different floors is how those two start to disagree.
   */
  function libWeakMotif() {
    const d = Library.diagnose(store.session.library, LIB_MIN_GAMES);
    return d.enough && d.motifs.length ? d.motifs[0].motif : null;
  }

  /** What the coach can see today — every signal already existed. */
  function dailySignals() {
    const st = store.session.puzzleState;
    const w = Picker.weakest(st, Object.keys(st.tally || {}));
    const today = Progress.dayKey(Date.now());
    return {
      owed: owedNow(),
      mineUnsolved: store.session.mines.filter((m) => !st.solved[m.id]).length,
      weakCat: w ? w.cat : null,
      weakMotif: (Picker.weakestMotif(st, Object.keys(st.mtally || {})) || {}).motif || null,
      lessonNext: LESSONS.findIndex((L) => !store.session.learnState.done[L.id]),
      opUnsolved: ALL_PUZZLES.some((p) => p.cat === "op" && !st.solved[p.id]),
      // 7.1: a game played on another site today is still a game played
      // today. Until now this read `stats` alone, so someone who imported
      // this morning's blitz session was told to go and play one.
      playedToday: loadStats().games.some((g) => Progress.dayKey(g.t) === today) ||
        store.session.library.some((g) => g.side && Progress.dayKey(libPlayedAt(g)) === today),
      libMotif: libWeakMotif(),
      libQueued: Library.pending(store.session.library).filter((g) => !g.unplayable).length,
    };
  }

  function dailyStepLabel(step) {
    if (step.kind === "review") return tf("daily.review", [step.n]);
    if (step.kind === "mine") return tf("daily.mine", [step.n]);
    if (step.kind === "weak") return tf("daily.weak", [t("pz.cat." + step.cat)]);
    if (step.kind === "motif") return tf("daily.motif", [t("motif." + step.motif)]);
    if (step.kind === "lesson") return t("daily.lesson");
    if (step.kind === "op") return t("daily.op");
    if (step.kind === "lib") return tf("daily.lib", [step.n]);
    return t("daily.game");
  }

  /**
   * 今天的训练 — advance earned steps, then dress the button.
   *
   * Steps are judged on counter deltas (planner.js), so this is safe to run
   * on every session/game commit: nothing here mutates the sources it reads,
   * and an inactive sitting costs one streak lookup.
   */
  /** The plan as a list under the button: each step, and why it is there.
      planner.js has always chosen in a fixed, explainable order; until 5.1
      nothing on screen explained it (audit, work package C). */
  function renderDailyPlan(steps, current) {
    const ol = document.getElementById("daily-plan");
    if (!ol) return;
    ol.hidden = !steps.length;
    // 7.7 (v7-7-plan §1i): the step you would go to next — the current one,
    // or the first before the plan has begun — is a control of its own. It
    // is rebuilt only when the plan or the language changed: this runs on
    // every commit, and a button rebuilt under the pointer loses the click
    // on WebKit (7.6).
    const go = current < 0 ? 0 : current;
    const labels = steps.map(dailyStepLabel);
    const sig = current + "|" + labels.join("\u0001") + "|" + store.ui.langId;
    if (ol.dataset.sig === sig) return;
    ol.dataset.sig = sig;
    ol.replaceChildren();
    steps.forEach((step, i) => {
      const li = document.createElement("li");
      li.className = "daily-step" + (i < current ? " done" : i === current ? " current" : "");
      const row = document.createElement(i === go ? "button" : "div");
      row.className = "daily-row";
      if (i === go) {
        row.type = "button";
        row.dataset.daily = "go";
        row.onclick = () => el("daily-btn").click();
      }
      const dot = document.createElement("span");
      dot.className = "daily-dot";
      dot.setAttribute("aria-hidden", "true");
      if (i < current) dot.appendChild(Icons.icon("check"));
      // 7.4 §5: the step, then why — two lines, see .daily-step
      const txt = document.createElement("span");
      txt.className = "daily-txt";
      const what = document.createElement("span");
      what.className = "daily-what";
      what.textContent = labels[i];
      what.title = what.textContent;
      const why = document.createElement("span");
      why.className = "daily-why";
      why.textContent = t("daily.why." + step.kind);
      why.title = why.textContent;
      txt.append(what, why);
      row.append(dot, txt);
      if (i === go) {
        const arrow = document.createElement("span");
        arrow.className = "daily-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.appendChild(Icons.icon("chevron-right"));
        row.appendChild(arrow);
      }
      li.appendChild(row);
      ol.appendChild(li);
    });
  }

  function syncDailyUI() {
    const btn = document.getElementById("daily-btn");
    const label = document.getElementById("daily-label");
    const note = document.getElementById("daily-note");
    if (!btn || !label || !note) return;
    // 7.7 (v7-7-plan §3, §10): while a game is being played the notation is
    // what the page is for, and this card was the first screen of the drawer
    // in a portrait window.
    //
    // 7.8 §1b: it steps aside whenever there is a game to look at, not only
    // while one is live. Tied to isLive(), a step back in replay brought the
    // card in and pushed the notation ~160px down, and the step forward took
    // it away again — the panel jumped on every key press. Whether there is
    // notation does not change while you walk through it, so neither does this.
    //
    // 7.9 §4b: and it is only ever on the two playing boards. In a lesson
    // or a puzzle the person is already doing today's training — the card
    // said 「学一节新课」 above the first lesson in progress and pushed the
    // lesson ~140px down. It is for someone who does not know what to do
    // next: the ai or pvp board with no game on it. The label below is still
    // kept current, so the plan's step reads right when the card comes back.
    const playing = store.session.mode === "ai" || store.session.mode === "pvp";
    const hasGame = playing && !store.session.editor && sanHistory().length > 0;
    avail(el("daily-row"), playing && !hasGame);
    const d = store.session.daily;
    if (!d) {
      setText(label, t("daily.btn"));
      const run = Progress.streak(store.session.progress, Date.now());
      note.hidden = run < 2;
      if (run >= 2) setText(note, tf("daily.streak", [run]));
      renderDailyPlan(Planner.plan(dailySignals()).steps, -1);
      return;
    }
    let after = Planner.snap(dailySnapSrc());
    while (d.i < d.steps.length && Planner.stepDone(d.steps[d.i], d.before, after)) {
      d.i++;
      d.before = after;
      after = Planner.snap(dailySnapSrc());
    }
    if (d.i >= d.steps.length) {
      store.session.daily = null;
      Progress.recordSession(store.session.progress, Date.now());
      saveProgress();
      const run = Progress.streak(store.session.progress, Date.now());
      toast(t("daily.done") + (run >= 2 ? " · " + tf("daily.streak", [run]) : ""));
      setText(label, t("daily.btn"));
      note.hidden = run < 2;
      if (run >= 2) setText(note, tf("daily.streak", [run]));
      return;
    }
    setText(label, tf("daily.of", [d.i + 1, d.steps.length]) + " · " + dailyStepLabel(d.steps[d.i]));
    note.hidden = true;
    renderDailyPlan(d.steps, d.i);
  }

  /**
   * Is the puzzle on the board already where this step is done?
   *
   * The category steps are, when their category is the one being worked
   * through — the next puzzle in it is the plan's next puzzle too. A motif
   * step is never "here": the category a motif puzzle sat in says nothing
   * about whether the next one in it is about that motif. The other steps
   * are not puzzles at all.
   */
  function dailyStepIsHere(step) {
    const pz = store.session.puzzle;
    if (!pz || store.session.mode !== "puzzle") return false;
    if (step.kind === "review" || step.kind === "mine" || step.kind === "op") return pz.cat === step.kind;
    if (step.kind === "weak") return pz.cat === step.cat;
    return false;
  }

  /**
   * Take the player to where the current step happens. Invited, not automatic.
   * @returns {boolean} false when there was nowhere to go (a motif step with
   *   nothing left unsolved about it), so a caller can fall back
   */
  function dailyJump(step) {
    if (step.kind === "lesson") {
      store.session.learnState.last = step.i;
      saveLearnState();
      if (store.session.mode !== "learn") switchMode("learn");
      else { startLesson(step.i); setSideTab("play", { top: true }); sync(); }
      return true;
    }
    if (step.kind === "game") {
      if (store.session.mode !== "ai") switchMode("ai");
      else setSideTab("play", { top: true });
      return true;
    }
    // the library step is the one that asks for time rather than answers:
    // show the section and start the pass, which is exactly what the player
    // would have done by hand
    if (step.kind === "lib") {
      Shell.go("library");
      const sec = document.getElementById("lib-body");
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "center" });
      if (!store.session.libRun) runLibraryPass();
      return true;
    }
    // 5.2: a motif step lands on a puzzle ABOUT that motif — the player's own
    // drill if one is unsolved, else the first canned one — wherever it shelves
    if (step.kind === "motif") {
      const about = bookNow().filter((p) => !store.session.puzzleState.solved[p.id] && motifKeyOf(p) === step.motif);
      const pick = about.find((p) => p.cat === "mine") || about[0];
      if (!pick) { toast(t("daily.motifDone")); return false; }
      store.session.puzzleState.cat = pick.cat;
      savePuzzleState();
      store.session.puzzleTierFilter = "all";
      const go = () => {
        const list = puzzlesInCat(pick.cat);
        startPuzzleAt(pick.cat, Math.max(0, list.findIndex((p) => p.id === pick.id)));
        setSideTab("play", { top: true });
      };
      if (store.session.mode !== "puzzle") { switchMode("puzzle"); go(); }
      else { go(); saveSettings(); sync(); }
      return true;
    }
    // the puzzle steps: pick the category, then enter (or re-enter) the mode
    const cat = step.kind === "weak" ? step.cat : step.kind;
    store.session.puzzleState.cat = cat;
    savePuzzleState();
    // same contract as 为你出一题: a browse filter must not hide the plan
    store.session.puzzleTierFilter = "all";
    if (store.session.mode !== "puzzle") switchMode("puzzle");
    else { startPuzzles(); setSideTab("play", { top: true }); saveSettings(); sync(); }
    return true;
  }

  /** 今天的训练's button — wired from app.js's boot as before (v8-0-plan F4). */
  function wireDaily() {
    document.getElementById("daily-btn").onclick = () => {
      if (!store.session.daily) {
        const p = Planner.plan(dailySignals());
        if (!p.steps.length) { toast(t("daily.rest")); return; }
        store.session.daily = { steps: p.steps, i: 0, before: Planner.snap(dailySnapSrc()) };
        toast(tf("daily.begin", [p.steps.length]));
      }
      dailyJump(store.session.daily.steps[store.session.daily.i]);
      store.commit("session", "sync");
    };
  }
  return {
    wireDaily,
    renderPuzzleTally, libPlayedAt, dailySignals, dailyStepLabel, syncDailyUI,
    dailyStepIsHere, dailyJump,
  };
}

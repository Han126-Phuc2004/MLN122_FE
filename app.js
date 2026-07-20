/* MLN122 learn app — exam-card UI */
(() => {
  "use strict";

  const STORAGE_KEY = "mln122_learn_v1";
  const LAST_Q_KEY = "mln122_learn_last_q"; // legacy single cursor
  const CURSORS_KEY = "mln122_learn_cursors_v1"; // per-filter cursors

  const els = {
    cardCode: document.getElementById("cardCode"),
    cardQnum: document.getElementById("cardQnum"),
    cardChoose: document.getElementById("cardChoose"),
    cardQuestion: document.getElementById("cardQuestion"),
    cardOptions: document.getElementById("cardOptions"),
    cardFeedback: document.getElementById("cardFeedback"),
    cardNote: document.getElementById("cardNote"),
    cardAlt: document.getElementById("cardAlt"),
    examCard: document.getElementById("examCard"),
    jumpInput: document.getElementById("jumpInput"),
    btnJump: document.getElementById("btnJump"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnCheck: document.getElementById("btnCheck"),
    btnReveal: document.getElementById("btnReveal"),
    btnStar: document.getElementById("btnStar"),
    btnMode: document.getElementById("btnMode"),
    btnShuffle: document.getElementById("btnShuffle"),
    btnReset: document.getElementById("btnReset"),
    statDone: document.getElementById("statDone"),
    statOk: document.getElementById("statOk"),
    statBad: document.getElementById("statBad"),
    statLeft: document.getElementById("statLeft"),
    progressBar: document.getElementById("progressBar"),
  };

  /** @type {{title:string,code:string,total:number,questions:Array}} */
  let data = null;
  /** @type {Array} full question list */
  let all = [];
  /** @type {number[]} order of indices into `all` for current queue */
  let queue = [];
  /** position in queue */
  let pos = 0;
  /** selected letters for current question */
  let selected = new Set();
  /** whether current question has been checked */
  let checked = false;
  /** 'seq' | 'random' */
  let mode = "seq";
  /** 'all' | 'wrong' | 'unseen' | 'star' */
  let filter = "all";

  /**
   * Cursor (question id) per filter — reviewing "wrong" must NOT overwrite "all".
   * e.g. { all: 32, wrong: 14, unseen: null, star: null }
   */
  let cursors = loadCursors();

  /** progress: { [id]: { result: 'ok'|'bad', star: bool, lastAt: number } } */
  let progress = loadProgress();

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function getQ() {
    if (!queue.length) return null;
    return all[queue[pos]];
  }

  function chooseLabel(n) {
    if (n <= 1) return "(Choose 1 answer)";
    return `(Choose ${n} answers)`;
  }

  function optionLetters(q) {
    return Object.keys(q.options || {}).sort();
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  /**
   * Rebuild the question queue for current filter/mode.
   * @param {{ keepId?: number|null, shuffle?: boolean }} opts
   *   keepId — if provided (even null), use it; null = start of list.
   *            if omitted, try to keep currently visible question.
   *   shuffle — reshuffle when mode is random
   */
  function rebuildQueue(opts = {}) {
    const hasKeep = Object.prototype.hasOwnProperty.call(opts, "keepId");
    const keepId = hasKeep ? opts.keepId : getQ()?.id ?? null;
    const doShuffle = opts.shuffle !== undefined ? opts.shuffle : mode === "random";

    const indices = [];
    for (let i = 0; i < all.length; i++) {
      const q = all[i];
      const p = progress[q.id] || {};
      if (filter === "wrong" && p.result !== "bad") continue;
      if (filter === "unseen" && p.result) continue;
      if (filter === "star" && !p.star) continue;
      indices.push(i);
    }

    if (doShuffle && mode === "random") {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }

    queue = indices;

    // Restore position to same question when possible
    if (keepId != null) {
      const allIdx = all.findIndex((q) => q.id === keepId);
      const qi = queue.indexOf(allIdx);
      if (qi >= 0) {
        pos = qi;
        return;
      }
      // Not in this filter list: nearest later by id, else last
      let nearest = -1;
      for (let i = 0; i < queue.length; i++) {
        if (all[queue[i]].id >= keepId) {
          nearest = i;
          break;
        }
      }
      pos = nearest >= 0 ? nearest : Math.max(0, queue.length - 1);
      return;
    }
    pos = 0;
  }

  function loadCursors() {
    try {
      const raw = localStorage.getItem(CURSORS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
      // migrate legacy single last_q → all
      const legacy = parseInt(localStorage.getItem(LAST_Q_KEY) || "", 10);
      if (Number.isFinite(legacy)) return { all: legacy };
    } catch {
      /* ignore */
    }
    return {};
  }

  function saveCursors() {
    try {
      localStorage.setItem(CURSORS_KEY, JSON.stringify(cursors));
    } catch {
      /* ignore */
    }
  }

  /** Save current question as cursor for the ACTIVE filter only */
  function rememberCurrent() {
    const q = getQ();
    if (!q) return;
    cursors[filter] = q.id;
    saveCursors();
    // keep legacy key as "all" progress for older code paths
    if (filter === "all") {
      try {
        localStorage.setItem(LAST_Q_KEY, String(q.id));
      } catch {
        /* ignore */
      }
    }
  }

  function getCursor(forFilter) {
    const id = cursors[forFilter];
    return Number.isFinite(id) ? id : null;
  }

  function loadLastQuestionId() {
    return getCursor("all") ?? getCursor(filter);
  }

  function updateStats() {
    let ok = 0;
    let bad = 0;
    let done = 0;
    for (const q of all) {
      const p = progress[q.id];
      if (!p || !p.result) continue;
      done++;
      if (p.result === "ok") ok++;
      else if (p.result === "bad") bad++;
    }
    const total = all.length || 1;
    els.statDone.textContent = String(done);
    els.statOk.textContent = String(ok);
    els.statBad.textContent = String(bad);
    els.statLeft.textContent = String(Math.max(0, all.length - done));
    els.progressBar.style.width = `${((done / total) * 100).toFixed(1)}%`;
  }

  function render() {
    const q = getQ();
    updateStats();

    if (!q) {
      els.cardCode.textContent = data?.code || "MLN122_SP26_B5FE";
      els.cardQnum.textContent = "—";
      els.cardChoose.textContent = "";
      els.cardQuestion.textContent =
        filter === "all"
          ? "Không có câu hỏi."
          : "Không có câu nào trong bộ lọc này. Đổi filter hoặc làm thêm câu.";
      els.cardOptions.innerHTML = "";
      els.cardFeedback.hidden = true;
      els.cardNote.hidden = true;
      els.cardAlt.hidden = true;
      els.btnCheck.disabled = true;
      els.btnReveal.disabled = true;
      els.btnStar.disabled = true;
      return;
    }

    const p = progress[q.id] || {};
    const n = q.choose || q.answers?.length || 1;
    const displayIdx = pos + 1;
    const queueTotal = queue.length;

    els.cardCode.textContent = data?.code || "MLN122_SP26_B5FE";
    els.cardQnum.textContent = `Multiple Choice Question ${q.id}`;
    els.cardChoose.textContent = chooseLabel(n);
    els.cardQuestion.textContent = q.question;
    els.jumpInput.value = String(q.id);
    els.jumpInput.max = String(all.length);

    // Star
    els.btnStar.disabled = false;
    els.btnStar.classList.toggle("starred", !!p.star);
    els.btnStar.textContent = p.star ? "★" : "☆";
    els.btnStar.title = p.star ? "Bỏ đánh dấu" : "Đánh dấu";

    // Options
    els.cardOptions.innerHTML = "";
    const letters = optionLetters(q);
    for (const L of letters) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt";
      btn.dataset.letter = L;
      if (selected.has(L)) btn.classList.add("selected");

      btn.innerHTML = `<span class="opt-letter">${L}.</span><span class="opt-text"></span>`;
      btn.querySelector(".opt-text").textContent = q.options[L];

      if (checked) {
        btn.disabled = true;
        const isAns = q.answers.includes(L);
        const isSel = selected.has(L);
        if (isAns && isSel) btn.classList.add("correct");
        else if (isSel && !isAns) btn.classList.add("wrong");
        else if (isAns && !isSel) btn.classList.add("missed");
      } else {
        btn.addEventListener("click", () => toggleOption(L));
      }

      els.cardOptions.appendChild(btn);
    }

    // Feedback / note / alt
    els.cardFeedback.hidden = true;
    els.cardNote.hidden = true;
    els.cardAlt.hidden = true;

    if (checked) {
      const correct = setsEqual(selected, new Set(q.answers));
      els.cardFeedback.hidden = false;
      els.cardFeedback.className = "card-feedback " + (correct ? "ok" : "bad");
      els.cardFeedback.textContent = correct
        ? `✓ Đúng! Đáp án: ${q.answers.join("")}`
        : `✗ Sai. Đáp án đúng: ${q.answers.join("")}`;
    }

    if (q.note && checked) {
      els.cardNote.hidden = false;
      els.cardNote.textContent = "Ghi chú: " + q.note;
    }

    if (q.alt && checked) {
      els.cardAlt.hidden = false;
      let html = `<strong>Kiểu hỏi khác</strong>${escapeHtml(q.alt.question || "")}`;
      const altLetters = Object.keys(q.alt.options || {}).sort();
      if (altLetters.length) {
        html += "<br><br>" + altLetters.map((L) => `${L}. ${escapeHtml(q.alt.options[L])}`).join("<br>");
      }
      els.cardAlt.innerHTML = html;
    }

    if (els.btnCheck) els.btnCheck.disabled = true;
    els.btnReveal.disabled = checked;
    els.btnPrev.disabled = pos <= 0;
    els.btnNext.disabled = pos >= queue.length - 1 && checked;
    // Always allow next to wrap / go if more
    els.btnNext.disabled = queue.length === 0;

    // Mode label
    const modeLabel =
      mode === "random" ? "Ngẫu nhiên" : "Lần lượt";
    els.btnMode.textContent = modeLabel;

    // Subtitle progress in brand
    document.title = `MLN122 · Câu ${q.id} (${displayIdx}/${queueTotal})`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toggleOption(letter) {
    if (checked) return;
    const q = getQ();
    if (!q) return;
    const max = q.choose || q.answers?.length || 1;

    if (max <= 1) {
      // Single choice: select → instant feedback
      selected = new Set([letter]);
      checkAnswer();
      return;
    }

    // Multi choice: toggle until enough answers selected, then auto-check
    if (selected.has(letter)) {
      selected.delete(letter);
    } else {
      selected.add(letter);
    }

    if (selected.size >= max) {
      checkAnswer();
      return;
    }
    render();
  }

  function checkAnswer() {
    const q = getQ();
    if (!q || checked || selected.size === 0) return;
    checked = true;
    const correct = setsEqual(selected, new Set(q.answers));
    const prev = progress[q.id] || {};
    progress[q.id] = {
      ...prev,
      result: correct ? "ok" : "bad",
      lastAt: Date.now(),
    };
    saveProgress();
    rememberCurrent();
    render();
  }

  function revealAnswer() {
    const q = getQ();
    if (!q || checked) return;
    selected = new Set(q.answers);
    checked = true;
    // Don't mark as done when only revealing — user can still "learn"
    // Actually mark as seen but not score? Better: don't auto-score reveal.
    // Only show UI state without writing result unless already has one.
    render();
    // Override feedback for pure reveal
    els.cardFeedback.hidden = false;
    els.cardFeedback.className = "card-feedback ok";
    els.cardFeedback.textContent = `Đáp án: ${q.answers.join("")}`;
    if (q.note) {
      els.cardNote.hidden = false;
      els.cardNote.textContent = "Ghi chú: " + q.note;
    }
    if (q.alt) {
      els.cardAlt.hidden = false;
      let html = `<strong>Kiểu hỏi khác</strong>${escapeHtml(q.alt.question || "")}`;
      const altLetters = Object.keys(q.alt.options || {}).sort();
      if (altLetters.length) {
        html += "<br><br>" + altLetters.map((L) => `${L}. ${escapeHtml(q.alt.options[L])}`).join("<br>");
      }
      els.cardAlt.innerHTML = html;
    }
    // Disable options visual
    for (const btn of els.cardOptions.querySelectorAll(".opt")) {
      btn.disabled = true;
      const L = btn.dataset.letter;
      if (q.answers.includes(L)) btn.classList.add("correct");
    }
    els.btnCheck.disabled = true;
    els.btnReveal.disabled = true;
  }

  function go(delta) {
    if (!queue.length) return;
    const next = pos + delta;
    if (next < 0 || next >= queue.length) return;
    pos = next;
    selected = new Set();
    checked = false;
    rememberCurrent();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function jumpToId(id) {
    const idxInAll = all.findIndex((q) => q.id === id);
    if (idxInAll < 0) return;
    // If filtered out, temporarily switch to all but keep this id
    let qi = queue.indexOf(idxInAll);
    if (qi < 0) {
      filter = "all";
      document.querySelectorAll(".chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.filter === "all");
      });
      rebuildQueue({ keepId: id, shuffle: false });
      qi = queue.indexOf(idxInAll);
    }
    if (qi < 0) return;
    pos = qi;
    selected = new Set();
    checked = false;
    rememberCurrent();
    render();
  }

  function toggleStar() {
    const q = getQ();
    if (!q) return;
    const prev = progress[q.id] || {};
    progress[q.id] = { ...prev, star: !prev.star };
    saveProgress();
    render();
  }

  // Events
  els.btnPrev.addEventListener("click", () => go(-1));
  els.btnNext.addEventListener("click", () => {
    if (pos >= queue.length - 1) {
      // wrap to start
      selected = new Set();
      checked = false;
      pos = 0;
      rememberCurrent();
      render();
      return;
    }
    go(1);
  });
  els.btnCheck.addEventListener("click", checkAnswer);
  els.btnReveal.addEventListener("click", revealAnswer);
  els.btnStar.addEventListener("click", toggleStar);
  els.btnJump.addEventListener("click", () => {
    const n = parseInt(els.jumpInput.value, 10);
    if (!Number.isFinite(n)) return;
    jumpToId(n);
  });
  els.jumpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const n = parseInt(els.jumpInput.value, 10);
      if (Number.isFinite(n)) jumpToId(n);
    }
  });

  els.btnMode.addEventListener("click", () => {
    mode = mode === "seq" ? "random" : "seq";
    const curId = getQ()?.id ?? null;
    // Switching to random reshuffles; to seq restores natural order but keeps question
    rebuildQueue({ keepId: curId, shuffle: mode === "random" });
    selected = new Set();
    checked = false;
    rememberCurrent();
    render();
  });

  els.btnShuffle.addEventListener("click", () => {
    mode = "random";
    const curId = getQ()?.id ?? null;
    rebuildQueue({ keepId: curId, shuffle: true });
    selected = new Set();
    checked = false;
    rememberCurrent();
    render();
  });

  els.btnReset.addEventListener("click", () => {
    if (!confirm("Xóa toàn bộ tiến độ ôn tập (đúng/sai/đánh dấu)?")) return;
    progress = {};
    saveProgress();
    cursors = {};
    try {
      localStorage.removeItem(LAST_Q_KEY);
      localStorage.removeItem(CURSORS_KEY);
    } catch {
      /* ignore */
    }
    selected = new Set();
    checked = false;
    rebuildQueue({ keepId: null });
    pos = 0;
    render();
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const nextFilter = chip.dataset.filter;
      if (nextFilter === filter) return;

      // Save cursor for filter you are LEAVING (e.g. all=32), not overwrite with review
      const leaving = getQ();
      if (leaving) {
        cursors[filter] = leaving.id;
        saveCursors();
      }

      filter = nextFilter;
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");

      // Restore cursor for filter you ENTER (e.g. back to all → 32, not wrong's 14)
      const enterId = getCursor(filter); // may be null → first item of that list
      rebuildQueue({ keepId: enterId, shuffle: false });

      selected = new Set();
      checked = false;
      // Update only this filter's cursor to where we landed
      if (getQ()) {
        cursors[filter] = getQ().id;
        saveCursors();
      }
      render();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const key = e.key.toLowerCase();
    if (["a", "b", "c", "d", "e"].includes(key)) {
      e.preventDefault();
      toggleOption(key.toUpperCase());
      return;
    }
    if (key === "enter") {
      e.preventDefault();
      go(1);
      return;
    }
    if (key === "arrowright" || key === "n") {
      e.preventDefault();
      go(1);
      return;
    }
    if (key === "arrowleft" || key === "p") {
      e.preventDefault();
      go(-1);
      return;
    }
    if (key === "h") {
      e.preventDefault();
      revealAnswer();
      return;
    }
    if (key === "s") {
      e.preventDefault();
      toggleStar();
    }
  });

  // Init
  async function init() {
    try {
      const res = await fetch("questions.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
      all = data.questions || [];

      // Resume "all" study position (not last reviewed-wrong question)
      let lastId = getCursor("all");
      if (lastId == null) {
        let lastAt = 0;
        for (const [id, p] of Object.entries(progress)) {
          if (p.lastAt && p.lastAt > lastAt) {
            lastAt = p.lastAt;
            lastId = Number(id);
          }
        }
      }

      rebuildQueue({ keepId: lastId, shuffle: false });
      if (lastId != null) jumpToId(lastId);
      else render();
    } catch (err) {
      els.cardQuestion.textContent =
        "Không tải được questions.json. Hãy mở bằng local server (xem README).";
      console.error(err);
    }
  }

  init();
})();

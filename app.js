/* Multi-subject FE learn app — exam-card UI + explanations */
(() => {
  "use strict";

  const SUBJECTS = {
    mln122: { file: "data/mln122.json", label: "MLN122" },
    prm393: { file: "data/prm393.json", label: "PRM393" },
    jfe301: { file: "data/jfe301.json", label: "JFE301" },
    jit401: { file: "data/jit401.json", label: "JIT401" },
  };

  const SUBJECT_KEY = "fe_learn_subject_v1";
  const LAST_Q_KEY = "mln122_learn_last_q"; // legacy
  const CURSORS_KEY = "fe_learn_cursors_v2";

  const els = {
    brandCode: document.getElementById("brandCode"),
    brandSub: document.getElementById("brandSub"),
    cardCode: document.getElementById("cardCode"),
    cardQnum: document.getElementById("cardQnum"),
    cardChoose: document.getElementById("cardChoose"),
    cardQuestion: document.getElementById("cardQuestion"),
    cardOptions: document.getElementById("cardOptions"),
    cardFeedback: document.getElementById("cardFeedback"),
    cardExplain: document.getElementById("cardExplain"),
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

  let subjectId = loadSubject();
  /** @type {{title:string,code:string,total:number,questions:Array,subject?:string}} */
  let data = null;
  let all = [];
  let queue = [];
  let pos = 0;
  let selected = new Set();
  let checked = false;
  let mode = "seq";
  let filter = "all";
  let cursors = loadCursors();
  let progress = loadProgress();

  function storageKey() {
    return `fe_learn_progress_${subjectId}_v1`;
  }

  function loadSubject() {
    try {
      const s = localStorage.getItem(SUBJECT_KEY);
      if (s && SUBJECTS[s]) return s;
    } catch {
      /* ignore */
    }
    return "mln122";
  }

  function saveSubject() {
    try {
      localStorage.setItem(SUBJECT_KEY, subjectId);
    } catch {
      /* ignore */
    }
  }

  function loadProgress() {
    try {
      // migrate legacy MLN key once
      if (subjectId === "mln122") {
        const legacy = localStorage.getItem("mln122_learn_v1");
        const cur = localStorage.getItem(storageKey());
        if (!cur && legacy) {
          localStorage.setItem(storageKey(), legacy);
        }
      }
      const raw = localStorage.getItem(storageKey());
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(storageKey(), JSON.stringify(progress));
  }

  function loadCursors() {
    try {
      const raw = localStorage.getItem(CURSORS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
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

  function cursorBucket() {
    if (!cursors[subjectId]) cursors[subjectId] = {};
    return cursors[subjectId];
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

    if (keepId != null) {
      const allIdx = all.findIndex((q) => q.id === keepId);
      const qi = queue.indexOf(allIdx);
      if (qi >= 0) {
        pos = qi;
        return;
      }
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

  function rememberCurrent() {
    const q = getQ();
    if (!q) return;
    const bucket = cursorBucket();
    bucket[filter] = q.id;
    saveCursors();
    if (filter === "all" && subjectId === "mln122") {
      try {
        localStorage.setItem(LAST_Q_KEY, String(q.id));
      } catch {
        /* ignore */
      }
    }
  }

  function getCursor(forFilter) {
    const id = cursorBucket()[forFilter];
    return Number.isFinite(id) ? id : null;
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

  function showExplain(q) {
    if (!els.cardExplain) return;
    const text = q.explanation || "";
    if (!text) {
      els.cardExplain.hidden = true;
      els.cardExplain.textContent = "";
      return;
    }
    els.cardExplain.hidden = false;
    els.cardExplain.innerHTML =
      `<strong>Giải thích</strong><span>${escapeHtml(text)}</span>`;
  }

  function render() {
    const q = getQ();
    updateStats();

    if (els.brandCode) {
      els.brandCode.textContent = data?.subject || data?.code || subjectId.toUpperCase();
    }
    if (els.brandSub) {
      els.brandSub.textContent = `${data?.title || "Ôn tập"} · ${all.length} câu`;
    }

    if (!q) {
      els.cardCode.textContent = data?.code || "—";
      els.cardQnum.textContent = "—";
      els.cardChoose.textContent = "";
      els.cardQuestion.textContent =
        filter === "all"
          ? "Không có câu hỏi."
          : "Không có câu nào trong bộ lọc này. Đổi filter hoặc làm thêm câu.";
      els.cardOptions.innerHTML = "";
      els.cardFeedback.hidden = true;
      if (els.cardExplain) els.cardExplain.hidden = true;
      els.cardNote.hidden = true;
      els.cardAlt.hidden = true;
      els.btnReveal.disabled = true;
      els.btnStar.disabled = true;
      return;
    }

    const p = progress[q.id] || {};
    const n = q.choose || q.answers?.length || 1;
    const displayIdx = pos + 1;
    const queueTotal = queue.length;
    const examCode = q.exam || data?.code || subjectId.toUpperCase();

    els.cardCode.textContent = examCode;
    els.cardQnum.textContent = `Multiple Choice Question ${q.id}`;
    els.cardChoose.textContent = chooseLabel(n);
    els.cardQuestion.textContent = q.question;
    els.jumpInput.value = String(q.id);
    els.jumpInput.max = String(all.length);

    els.btnStar.disabled = false;
    els.btnStar.classList.toggle("starred", !!p.star);
    els.btnStar.textContent = p.star ? "★" : "☆";
    els.btnStar.title = p.star ? "Bỏ đánh dấu" : "Đánh dấu";

    els.cardOptions.innerHTML = "";
    const letters = optionLetters(q);
    const hasAnswers = Array.isArray(q.answers) && q.answers.length > 0;

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
        if (hasAnswers) {
          const isAns = q.answers.includes(L);
          const isSel = selected.has(L);
          if (isAns && isSel) btn.classList.add("correct");
          else if (isSel && !isAns) btn.classList.add("wrong");
          else if (isAns && !isSel) btn.classList.add("missed");
        }
      } else {
        btn.addEventListener("click", () => toggleOption(L));
      }

      els.cardOptions.appendChild(btn);
    }

    els.cardFeedback.hidden = true;
    if (els.cardExplain) els.cardExplain.hidden = true;
    els.cardNote.hidden = true;
    els.cardAlt.hidden = true;

    if (checked) {
      if (hasAnswers) {
        const correct = setsEqual(selected, new Set(q.answers));
        els.cardFeedback.hidden = false;
        els.cardFeedback.className = "card-feedback " + (correct ? "ok" : "bad");
        els.cardFeedback.textContent = correct
          ? `✓ Đúng! Đáp án: ${q.answers.join("")}`
          : `✗ Sai. Đáp án đúng: ${q.answers.join("")}`;
      } else {
        els.cardFeedback.hidden = false;
        els.cardFeedback.className = "card-feedback";
        els.cardFeedback.textContent = "Chưa có đáp án chính thức cho câu này.";
      }
      showExplain(q);
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
        html +=
          "<br><br>" +
          altLetters.map((L) => `${L}. ${escapeHtml(q.alt.options[L])}`).join("<br>");
      }
      els.cardAlt.innerHTML = html;
    }

    if (els.btnCheck) els.btnCheck.disabled = true;
    els.btnReveal.disabled = checked;
    els.btnPrev.disabled = pos <= 0;
    els.btnNext.disabled = queue.length === 0;

    els.btnMode.textContent = mode === "random" ? "Ngẫu nhiên" : "Lần lượt";

    const sub = data?.subject || subjectId.toUpperCase();
    document.title = `${sub} · Câu ${q.id} (${displayIdx}/${queueTotal})`;
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
      selected = new Set([letter]);
      checkAnswer();
      return;
    }

    if (selected.has(letter)) selected.delete(letter);
    else selected.add(letter);

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
    const hasAnswers = Array.isArray(q.answers) && q.answers.length > 0;
    if (hasAnswers) {
      const correct = setsEqual(selected, new Set(q.answers));
      const prev = progress[q.id] || {};
      progress[q.id] = {
        ...prev,
        result: correct ? "ok" : "bad",
        lastAt: Date.now(),
      };
      saveProgress();
    }
    rememberCurrent();
    render();
  }

  function revealAnswer() {
    const q = getQ();
    if (!q || checked) return;
    if (q.answers?.length) selected = new Set(q.answers);
    checked = true;
    render();
    if (q.answers?.length) {
      els.cardFeedback.hidden = false;
      els.cardFeedback.className = "card-feedback ok";
      els.cardFeedback.textContent = `Đáp án: ${q.answers.join("")}`;
    }
    showExplain(q);
    if (q.note) {
      els.cardNote.hidden = false;
      els.cardNote.textContent = "Ghi chú: " + q.note;
    }
    if (q.alt) {
      els.cardAlt.hidden = false;
      let html = `<strong>Kiểu hỏi khác</strong>${escapeHtml(q.alt.question || "")}`;
      const altLetters = Object.keys(q.alt.options || {}).sort();
      if (altLetters.length) {
        html +=
          "<br><br>" +
          altLetters.map((L) => `${L}. ${escapeHtml(q.alt.options[L])}`).join("<br>");
      }
      els.cardAlt.innerHTML = html;
    }
    for (const btn of els.cardOptions.querySelectorAll(".opt")) {
      btn.disabled = true;
      const L = btn.dataset.letter;
      if (q.answers?.includes(L)) btn.classList.add("correct");
    }
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

  async function loadSubjectData(id) {
    subjectId = id;
    saveSubject();
    progress = loadProgress();
    selected = new Set();
    checked = false;
    filter = "all";
    mode = "seq";
    document.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.filter === "all");
    });
    document.querySelectorAll(".sub-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.subject === id);
    });

    const meta = SUBJECTS[id];
    const tryFiles = [meta.file, id === "mln122" ? "questions.json" : null].filter(Boolean);

    let lastErr = null;
    for (const file of tryFiles) {
      try {
        const res = await fetch(file);
        if (!res.ok) throw new Error("HTTP " + res.status + " " + file);
        data = await res.json();
        all = data.questions || [];
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      els.cardQuestion.textContent =
        "Không tải được dữ liệu môn " + id + ". Chạy local server và kiểm tra file data/.";
      console.error(lastErr);
      all = [];
      data = null;
      render();
      return;
    }

    let lastId = getCursor("all");
    rebuildQueue({ keepId: lastId, shuffle: false });
    if (lastId != null) jumpToId(lastId);
    else render();
  }

  // Events
  els.btnPrev.addEventListener("click", () => go(-1));
  els.btnNext.addEventListener("click", () => {
    if (pos >= queue.length - 1) {
      selected = new Set();
      checked = false;
      pos = 0;
      rememberCurrent();
      render();
      return;
    }
    go(1);
  });
  if (els.btnCheck) els.btnCheck.addEventListener("click", checkAnswer);
  els.btnReveal.addEventListener("click", revealAnswer);
  els.btnStar.addEventListener("click", toggleStar);
  els.btnJump.addEventListener("click", () => {
    const n = parseInt(els.jumpInput.value, 10);
    if (Number.isFinite(n)) jumpToId(n);
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
    if (!confirm("Xóa toàn bộ tiến độ ôn tập của môn " + subjectId.toUpperCase() + "?")) return;
    progress = {};
    saveProgress();
    cursorBucket();
    cursors[subjectId] = {};
    saveCursors();
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
      const leaving = getQ();
      if (leaving) {
        cursorBucket()[filter] = leaving.id;
        saveCursors();
      }
      filter = nextFilter;
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const enterId = getCursor(filter);
      rebuildQueue({ keepId: enterId, shuffle: false });
      selected = new Set();
      checked = false;
      if (getQ()) {
        cursorBucket()[filter] = getQ().id;
        saveCursors();
      }
      render();
    });
  });

  document.querySelectorAll(".sub-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.subject;
      if (!id || id === subjectId) return;
      loadSubjectData(id);
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
    if (key === "enter" || key === "arrowright" || key === "n") {
      e.preventDefault();
      if (key === "enter" || key === "arrowright" || key === "n") {
        if (pos >= queue.length - 1) {
          selected = new Set();
          checked = false;
          pos = 0;
          rememberCurrent();
          render();
        } else go(1);
      }
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

  loadSubjectData(subjectId);
})();

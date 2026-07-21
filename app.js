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
  const SYNC_ID_KEY = "fe_learn_sync_id_v1";
  const SYNC_AUTO_KEY = "fe_learn_sync_auto_v1";
  /** JSONBlob free store (no account) — used as cross-device sync backend */
  const SYNC_API = "https://jsonblob.com/api/jsonBlob";

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
  /** 'all' | 'exam' | 'slides' — mainly for PRM393 multi-source bank */
  let sourceFilter = "all";
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
    scheduleSyncPush();
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
    scheduleSyncPush();
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
    scheduleSyncPush();
  }

  // ========== Cross-device sync ==========
  let syncPushTimer = null;
  let syncBusy = false;

  function getSyncId() {
    try {
      return (localStorage.getItem(SYNC_ID_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function setSyncId(id) {
    try {
      if (id) localStorage.setItem(SYNC_ID_KEY, id);
      else localStorage.removeItem(SYNC_ID_KEY);
    } catch {
      /* ignore */
    }
    updateSyncUi();
  }

  function isSyncAuto() {
    try {
      const v = localStorage.getItem(SYNC_AUTO_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  }

  function setSyncAuto(on) {
    try {
      localStorage.setItem(SYNC_AUTO_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function readProgressFor(sub) {
    try {
      const key = `fe_learn_progress_${sub}_v1`;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
      if (sub === "mln122") {
        const leg = localStorage.getItem("mln122_learn_v1");
        if (leg) return JSON.parse(leg);
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  function writeProgressFor(sub, prog) {
    try {
      localStorage.setItem(`fe_learn_progress_${sub}_v1`, JSON.stringify(prog || {}));
      if (sub === "mln122") {
        localStorage.setItem("mln122_learn_v1", JSON.stringify(prog || {}));
      }
    } catch {
      /* ignore */
    }
  }

  function collectSyncState() {
    const progressAll = {};
    for (const sub of Object.keys(SUBJECTS)) {
      progressAll[sub] = readProgressFor(sub);
    }
    // ensure current in-memory progress is included
    progressAll[subjectId] = progress;
    return {
      v: 1,
      updatedAt: Date.now(),
      subject: subjectId,
      progress: progressAll,
      cursors,
    };
  }

  function mergeProgressMaps(localMap, remoteMap) {
    const out = { ...(localMap || {}) };
    for (const [id, rp] of Object.entries(remoteMap || {})) {
      const lp = out[id];
      if (!lp) {
        out[id] = rp;
        continue;
      }
      const lt = Number(lp.lastAt) || 0;
      const rt = Number(rp.lastAt) || 0;
      const newer = rt >= lt ? rp : lp;
      const older = rt >= lt ? lp : rp;
      out[id] = {
        ...older,
        ...newer,
        star: !!(lp.star || rp.star),
        // prefer newer result; if only one has result keep it
        result: newer.result || older.result || lp.result || rp.result,
        lastAt: Math.max(lt, rt) || Date.now(),
      };
    }
    return out;
  }

  function applySyncState(state, { preferRemoteSubject = true } = {}) {
    if (!state || typeof state !== "object") return;
    const remoteProg = state.progress || {};
    for (const sub of Object.keys(SUBJECTS)) {
      const merged = mergeProgressMaps(readProgressFor(sub), remoteProg[sub] || {});
      writeProgressFor(sub, merged);
    }
    // merge cursors: take remote per-filter if present
    const rc = state.cursors || {};
    const mergedCursors = { ...cursors };
    for (const [sub, bucket] of Object.entries(rc)) {
      if (!bucket || typeof bucket !== "object") continue;
      mergedCursors[sub] = { ...(mergedCursors[sub] || {}), ...bucket };
    }
    cursors = mergedCursors;
    saveCursorsNoPush();
    if (preferRemoteSubject && state.subject && SUBJECTS[state.subject]) {
      // subject switch happens via loadSubjectData after
    }
    // reload current subject progress from storage
    progress = loadProgress();
  }

  function saveCursorsNoPush() {
    try {
      localStorage.setItem(CURSORS_KEY, JSON.stringify(cursors));
    } catch {
      /* ignore */
    }
  }

  function setSyncStatus(msg, kind) {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = "sync-status" + (kind ? " " + kind : "");
  }

  function updateSyncUi() {
    const id = getSyncId();
    const input = document.getElementById("syncCodeInput");
    const linkBox = document.getElementById("syncLinkBox");
    const link = document.getElementById("syncLink");
    const btn = document.getElementById("btnSync");
    if (input && document.activeElement !== input) input.value = id;
    if (btn) btn.classList.toggle("sync-on", !!id);
    if (linkBox && link) {
      if (id) {
        const u = new URL(location.href);
        u.searchParams.set("sync", id);
        // clean hash
        u.hash = "";
        link.href = u.toString();
        link.textContent = u.toString();
        linkBox.hidden = false;
      } else {
        linkBox.hidden = true;
      }
    }
    const auto = document.getElementById("syncAuto");
    if (auto) auto.checked = isSyncAuto();
  }

  function blobUrl(id) {
    return `${SYNC_API}/${encodeURIComponent(id)}`;
  }

  async function syncCreate() {
    if (syncBusy) return;
    syncBusy = true;
    setSyncStatus("Đang tạo mã đồng bộ…", "busy");
    try {
      const body = JSON.stringify(collectSyncState());
      const res = await fetch(SYNC_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      // Location: https://jsonblob.com/api/jsonBlob/<id>
      const loc = res.headers.get("Location") || res.headers.get("location") || "";
      let id = "";
      const m = loc.match(/jsonBlob\/([^/?#]+)/i);
      if (m) id = m[1];
      if (!id) {
        // some environments expose id in body
        try {
          const j = await res.json();
          id = j.id || j.blobId || "";
        } catch {
          /* ignore */
        }
      }
      if (!id) throw new Error("Không nhận được mã từ máy chủ đồng bộ");
      setSyncId(id);
      setSyncStatus("Đã tạo mã. Copy mã/link sang iPad rồi bấm «Kéo về» (hoặc mở link).", "ok");
      updateSyncUi();
    } catch (e) {
      console.error(e);
      setSyncStatus(
        "Tạo mã thất bại (" + (e.message || e) + "). Thử lại hoặc dùng Xuất/Nhập JSON.",
        "err"
      );
    } finally {
      syncBusy = false;
    }
  }

  async function syncPush() {
    let id = getSyncId() || (document.getElementById("syncCodeInput")?.value || "").trim();
    if (!id) {
      await syncCreate();
      return;
    }
    if (syncBusy) return;
    syncBusy = true;
    setSyncStatus("Đang đẩy tiến độ lên mây…", "busy");
    try {
      setSyncId(id);
      const body = JSON.stringify(collectSyncState());
      const res = await fetch(blobUrl(id), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSyncStatus("Đã lưu lên mây · " + new Date().toLocaleTimeString("vi-VN"), "ok");
      updateSyncUi();
    } catch (e) {
      console.error(e);
      setSyncStatus("Đẩy lên thất bại: " + (e.message || e), "err");
    } finally {
      syncBusy = false;
    }
  }

  async function syncPull({ silent = false, thenLoadSubject = true } = {}) {
    let id = (document.getElementById("syncCodeInput")?.value || "").trim() || getSyncId();
    if (!id) {
      if (!silent) setSyncStatus("Nhập hoặc tạo mã đồng bộ trước.", "err");
      return false;
    }
    if (syncBusy) return false;
    syncBusy = true;
    if (!silent) setSyncStatus("Đang kéo tiến độ từ mây…", "busy");
    try {
      const res = await fetch(blobUrl(id), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status + " — kiểm tra mã");
      const state = await res.json();
      setSyncId(id);
      const remoteSub = state.subject && SUBJECTS[state.subject] ? state.subject : subjectId;
      applySyncState(state);
      if (thenLoadSubject) {
        await loadSubjectData(remoteSub);
      } else {
        progress = loadProgress();
        rebuildQueue({ keepId: getCursor("all"), shuffle: false });
        render();
      }
      if (!silent) {
        setSyncStatus(
          "Đã đồng bộ · câu/tiến độ đã khớp · " + new Date().toLocaleTimeString("vi-VN"),
          "ok"
        );
      }
      updateSyncUi();
      return true;
    } catch (e) {
      console.error(e);
      if (!silent) setSyncStatus("Kéo về thất bại: " + (e.message || e), "err");
      return false;
    } finally {
      syncBusy = false;
    }
  }

  function scheduleSyncPush() {
    if (!isSyncAuto() || !getSyncId()) return;
    if (syncPushTimer) clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(() => {
      syncPushTimer = null;
      syncPush();
    }, 1200);
  }

  function openSyncModal() {
    const m = document.getElementById("syncModal");
    if (!m) return;
    m.hidden = false;
    updateSyncUi();
    if (getSyncId()) setSyncStatus("Đã gắn mã. Bấm Đẩy lên / Kéo về khi cần.", "ok");
    else setSyncStatus("Chưa có mã — bấm «Tạo mã mới» trên máy này, rồi mở link/mã trên máy kia.", "");
  }

  function closeSyncModal() {
    const m = document.getElementById("syncModal");
    if (m) m.hidden = true;
  }

  function exportSyncJson() {
    const blob = new Blob([JSON.stringify(collectSyncState(), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fe-learn-progress.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setSyncStatus("Đã xuất file JSON (dự phòng offline).", "ok");
  }

  function importSyncJsonFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const state = JSON.parse(String(reader.result || "{}"));
        applySyncState(state);
        const sub = state.subject && SUBJECTS[state.subject] ? state.subject : subjectId;
        await loadSubjectData(sub);
        setSyncStatus("Đã nhập JSON thành công.", "ok");
      } catch (e) {
        setSyncStatus("File JSON không hợp lệ.", "err");
      }
    };
    reader.readAsText(file);
  }

  async function bootstrapSyncFromUrl() {
    const params = new URLSearchParams(location.search);
    const fromUrl = (params.get("sync") || "").trim();
    if (fromUrl) {
      setSyncId(fromUrl);
      // clean URL without losing path
      try {
        const u = new URL(location.href);
        u.searchParams.delete("sync");
        history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch {
        /* ignore */
      }
      await syncPull({ silent: false, thenLoadSubject: true });
      return true;
    }
    // existing id: soft pull on start
    if (getSyncId() && isSyncAuto()) {
      await syncPull({ silent: true, thenLoadSubject: true });
      return true;
    }
    return false;
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

  function matchesSourceFilter(q) {
    if (sourceFilter === "all") return true;
    const src = q.source || "";
    const exam = String(q.exam || "");
    if (sourceFilter === "exam") {
      if (src === "slides" || src === "books") return false;
      if (exam.includes("SLIDES") || exam.includes("BOOK_")) return false;
      return true;
    }
    if (sourceFilter === "slides") {
      return (
        src === "slides" ||
        src === "books" ||
        exam.includes("SLIDES") ||
        exam.includes("BOOK_")
      );
    }
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
      if (!matchesSourceFilter(q)) continue;
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
    sourceFilter = "all";
    mode = "seq";
    document.querySelectorAll(".filters:not(.source-filters) .chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.filter === "all");
    });
    document.querySelectorAll("#sourceFilters .chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.source === "all");
    });
    document.querySelectorAll(".sub-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.subject === id);
    });
    updateSourceFilterVisibility();

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

  document.querySelectorAll(".filters:not(.source-filters) .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const nextFilter = chip.dataset.filter;
      if (!nextFilter || nextFilter === filter) return;
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

  function updateSourceFilterVisibility() {
    const el = document.getElementById("sourceFilters");
    if (!el) return;
    // multi-source: PRM (FE+slides), JIT (FE+slides), JFE (FE+textbooks)
    const show =
      subjectId === "prm393" || subjectId === "jit401" || subjectId === "jfe301";
    el.hidden = !show;
    if (!show) sourceFilter = "all";
    const examChip = el.querySelector('[data-source="exam"]');
    const slideChip = el.querySelector('[data-source="slides"]');
    if (examChip) {
      examChip.textContent =
        subjectId === "prm393"
          ? "2 đề FE"
          : subjectId === "jit401"
            ? "1 đề FE"
            : "1 đề FE";
    }
    if (slideChip) {
      slideChip.textContent =
        subjectId === "jfe301" ? "2 textbook" : "Slide ôn";
    }
  }

  document.querySelectorAll("#sourceFilters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const next = chip.dataset.source;
      if (!next || next === sourceFilter) return;
      sourceFilter = next;
      document.querySelectorAll("#sourceFilters .chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.source === sourceFilter);
      });
      const curId = getQ()?.id ?? null;
      rebuildQueue({ keepId: curId, shuffle: false });
      selected = new Set();
      checked = false;
      rememberCurrent();
      render();
    });
  });

  // Sync UI
  const btnSync = document.getElementById("btnSync");
  if (btnSync) btnSync.addEventListener("click", openSyncModal);
  const btnSyncClose = document.getElementById("btnSyncClose");
  if (btnSyncClose) btnSyncClose.addEventListener("click", closeSyncModal);
  const syncModal = document.getElementById("syncModal");
  if (syncModal) {
    syncModal.addEventListener("click", (e) => {
      if (e.target === syncModal) closeSyncModal();
    });
  }
  document.getElementById("btnSyncCreate")?.addEventListener("click", () => syncCreate());
  document.getElementById("btnSyncPush")?.addEventListener("click", () => syncPush());
  document.getElementById("btnSyncPull")?.addEventListener("click", () => syncPull({ silent: false }));
  document.getElementById("btnSyncCopy")?.addEventListener("click", async () => {
    const input = document.getElementById("syncCodeInput");
    const id = (input?.value || getSyncId() || "").trim();
    if (!id) return setSyncStatus("Chưa có mã để copy.", "err");
    try {
      await navigator.clipboard.writeText(id);
      setSyncId(id);
      setSyncStatus("Đã copy mã.", "ok");
    } catch {
      input?.select();
      setSyncStatus("Hãy copy thủ công (Ctrl+C).", "");
    }
  });
  document.getElementById("btnSyncCopyLink")?.addEventListener("click", async () => {
    const a = document.getElementById("syncLink");
    if (!a?.href) return;
    try {
      await navigator.clipboard.writeText(a.href);
      setSyncStatus("Đã copy link — mở trên iPad để tự nối.", "ok");
    } catch {
      setSyncStatus("Copy link thủ công từ dòng link.", "");
    }
  });
  document.getElementById("syncAuto")?.addEventListener("change", (e) => {
    setSyncAuto(!!e.target.checked);
    setSyncStatus(e.target.checked ? "Bật tự đồng bộ." : "Tắt tự đồng bộ — chỉ sync khi bấm nút.", "ok");
  });
  document.getElementById("syncCodeInput")?.addEventListener("change", (e) => {
    const id = String(e.target.value || "").trim();
    if (id) setSyncId(id);
  });
  document.getElementById("btnSyncExport")?.addEventListener("click", exportSyncJson);
  document.getElementById("btnSyncImport")?.addEventListener("click", () => {
    document.getElementById("syncImportFile")?.click();
  });
  document.getElementById("syncImportFile")?.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importSyncJsonFile(f);
    e.target.value = "";
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

  (async function init() {
    updateSyncUi();
    const synced = await bootstrapSyncFromUrl();
    if (!synced) {
      await loadSubjectData(subjectId);
    }
  })();
})();

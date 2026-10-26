/* ==========================================================================
   منصة طرق واستراتيجيات التدريس — منطق التطبيق
   ========================================================================== */

/* ------------------------- حالة التطبيق والتخزين ------------------------- */

const STORAGE_KEY = "tsd_platform_v1";

const defaultState = {
  name: "",
  completed: {},        // lessonId -> { score, at }
  quizBest: {},         // questionKey -> best score (للأنشطة)
  cardsSeen: {},        // cardIndex -> true
  reviews: {},          // lessonId -> { due: timestamp, level: 0..3 }
  examHistory: [],      // { score, total, at }
  examSeen: {},         // سؤال -> مرات الإجابة الصحيحة
  studyMinutes: 0,
  lastVisit: Date.now(),
  streak: 1,
  lastDay: new Date().toDateString()
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    return Object.assign(structuredClone(defaultState), JSON.parse(raw));
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  // تحديث أيام الدراسة المتتالية (Streak)
  const today = new Date().toDateString();
  if (state.lastDay !== today) {
    const last = new Date(state.lastDay);
    const diff = Math.round((new Date(today) - last) / 86400000);
    state.streak = diff === 1 ? (state.streak || 1) + 1 : 1;
    state.lastDay = today;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ------------------------- أدوات مساعدة ------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const app = $("#app");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function openModal(title, bodyHtml) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHtml;
  $("#modal").hidden = false;
  $("#modalClose").focus();
}
$("#modalClose").onclick = () => ($("#modal").hidden = true);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").hidden = true; });

function allLessons() {
  return UNITS.flatMap(u => u.lessons.map(l => ({ ...l, unit: u })));
}

function findLesson(id) {
  for (const u of UNITS) {
    const l = u.lessons.find(x => x.id === id);
    if (l) return { lesson: l, unit: u };
  }
  return null;
}

function progressPct() {
  const total = allLessons().length;
  const done = Object.keys(state.completed).length;
  return Math.round((done / total) * 100);
}

function confetti() {
  const colors = ["#2563eb", "#f59e0b", "#16a34a", "#dc2626", "#7c3aed", "#0891b2"];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement("div");
    el.className = "confetti";
    el.style.left = Math.random() * 100 + "vw";
    el.style.background = colors[i % colors.length];
    el.style.animationDuration = 2.2 + Math.random() * 2 + "s";
    el.style.animationDelay = Math.random() * .6 + "s";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
}

/* ------------------------- نظام التكرار المتباعد ------------------------- */

const REVIEW_STEPS = [1, 3, 7, 14]; // أيام بين كل مراجعة

function scheduleReview(lessonId, correctRatio) {
  const now = Date.now();
  const prev = state.reviews[lessonId] || { level: 0, due: now };
  let level = prev.level;
  if (correctRatio >= 0.8) level = Math.min(level + 1, REVIEW_STEPS.length - 1);
  else if (correctRatio < 0.5) level = 0;
  const days = REVIEW_STEPS[level];
  state.reviews[lessonId] = { level, due: now + days * 86400000 };
}

function dueReviews() {
  const now = Date.now();
  return Object.entries(state.reviews)
    .filter(([id, r]) => r.due <= now && state.completed[id])
    .map(([id, r]) => ({ id, level: r.level, ...findLesson(id) }))
    .filter(x => x.lesson);
}

/* ------------------------- عرض المحتوى ------------------------- */

function renderContent(blocks) {
  return blocks.map(b => {
    switch (b.t) {
      case "h": return `<h3>${b.text}</h3>`;
      case "p": return `<p>${b.text}</p>`;
      case "ul": return `<ul>${b.items.map(i => `<li>${i}</li>`).join("")}</ul>`;
      case "ol": return `<ol>${b.items.map(i => `<li>${i}</li>`).join("")}</ol>`;
      case "note": return `<div class="note ${b.kind}">${b.text}</div>`;
      case "cards":
        return `<div class="mini-cards">${b.items.map(c =>
          `<div class="mini-card"><h4>${c.title}</h4>${c.text ? `<p>${c.text}</p>` : ""}</div>`).join("")}</div>`;
      case "table":
        return `<div class="table-wrap"><table>
          <thead><tr>${b.head.map(h => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>`;
      default: return "";
    }
  }).join("");
}

/* ------------------------- الأنشطة التفاعلية ------------------------- */

function renderQuiz(container, questions, opts = {}) {
  const wrap = document.createElement("div");
  let score = 0;
  let answered = 0;

  wrap.innerHTML = questions.map((q, i) => `
    <div class="q" data-i="${i}">
      <div class="q-text"><span class="q-num">${i + 1}</span>${q.q}</div>
      <div class="opts">
        ${q.options.map((o, j) => `<button class="opt" data-j="${j}">${o}</button>`).join("")}
      </div>
      <div class="fb"></div>
    </div>`).join("");

  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".opt");
    if (!btn || btn.disabled) return;
    const qEl = btn.closest(".q");
    const i = +qEl.dataset.i;
    const j = +btn.dataset.j;
    const q = questions[i];
    const correct = j === q.a;

    $$(".opt", qEl).forEach(b => b.disabled = true);
    $$(".opt", qEl)[q.a].classList.add("correct");
    if (!correct) btn.classList.add("wrong");

    const fb = $(".fb", qEl);
    fb.innerHTML = `<div class="feedback ${correct ? "ok" : "no"}">
      ${correct ? "✅ إجابة صحيحة! " : "❌ إجابة غير دقيقة. "}
      <span>${q.why}</span></div>`;

    if (correct) score++;
    answered++;

    if (answered === questions.length) {
      const ratio = score / questions.length;
      const done = document.createElement("div");
      done.className = "feedback ok mt-1";
      done.innerHTML = `<b>نتيجتك: ${score} / ${questions.length}</b> — ${ratio >= .8 ? "ممتاز! أنت جاهز لهذا الجزء 🎉" : ratio >= .5 ? "جيد، راجع النقط التي أخطأت فيها." : "تحتاج مراجعة الدرس كاملًا ثم أعد المحاولة."}`;
      wrap.appendChild(done);
      if (opts.onFinish) opts.onFinish(ratio, score);
    }
  });

  container.appendChild(wrap);
}

function renderMatch(container, pairs, opts = {}) {
  const shuffled = [...pairs].sort(() => Math.random() - .5);
  const rights = pairs.map(p => p.right).sort(() => Math.random() - .5);

  container.innerHTML = `<div class="match-list">
    ${shuffled.map((p, i) => `
      <div class="match-item" data-left="${p.left}">
        <span class="m-left">${p.left}</span>
        <select data-correct="${p.right}">
          <option value="">— اختر التعريف —</option>
          ${rights.map(r => `<option>${r}</option>`).join("")}
        </select>
      </div>`).join("")}
  </div>
  <button class="btn btn-primary mt-2" id="matchCheck">تحقّق من الإجابات</button>
  <div id="matchResult" class="mt-2"></div>`;

  $("#matchCheck", container).onclick = () => {
    const items = $$(".match-item", container);
    let ok = 0;
    items.forEach(it => {
      const sel = $("select", it);
      const good = sel.value && sel.value === sel.dataset.correct;
      it.classList.toggle("ok", good);
      it.classList.toggle("bad", !good);
      if (good) ok++;
    });
    const ratio = ok / items.length;
    $("#matchResult", container).innerHTML =
      `<div class="feedback ${ratio === 1 ? "ok" : "no"}"><b>${ok} / ${items.length}</b> — ${ratio === 1 ? "مطابقة كاملة، أحسنت! 🎯" : "راجع التعريفات الملوّنة بالأحمر ثم أعد المحاولة."}</div>`;
    if (opts.onFinish) opts.onFinish(ratio, ok);
  };
}

function renderDrag(container, activity, opts = {}) {
  const items = activity.items.map((it, i) => ({ ...it, i }));
  container.innerHTML = `
    <div class="drag-zone" id="dragZone">
      ${items.map(it => `<span class="drag-chip" draggable="true" data-i="${it.i}">${it.text}</span>`).join("")}
    </div>
    <div class="drop-cols">
      ${activity.categories.map((c, ci) => `
        <div class="drop-col" data-cat="${ci}">
          <h4>${c}</h4>
          <div class="drop-body"></div>
        </div>`).join("")}
    </div>
    <div class="flash-nav">
      <button class="btn btn-primary" id="dragCheck">تحقّق من الإجابة</button>
      <button class="btn btn-outline" id="dragReset">إعادة</button>
    </div>
    <div id="dragResult" class="mt-2"></div>`;

  let dragged = null;

  const bindChip = chip => {
    chip.addEventListener("dragstart", () => { dragged = chip; chip.classList.add("dragging"); });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    // دعم اللمس: نقرة لاختيار ثم نقرة على الهدف
    chip.addEventListener("click", () => {
      if (dragged && dragged !== chip) return;
      $$(".drag-chip", container).forEach(c => c.style.outline = "");
      chip.style.outline = "3px solid var(--accent)";
      dragged = chip;
    });
  };

  $$(".drag-chip", container).forEach(bindChip);

  $$(".drop-col", container).forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", e => {
      e.preventDefault();
      col.classList.remove("over");
      if (dragged) $(".drop-body", col).appendChild(dragged);
      dragged = null;
      $$(".drag-chip", container).forEach(c => c.style.outline = "");
    });
    col.addEventListener("click", e => {
      if (e.target.closest(".drag-chip")) return;
      if (dragged) { $(".drop-body", col).appendChild(dragged); dragged = null; $$(".drag-chip", container).forEach(c => c.style.outline = ""); }
    });
  });

  $("#dragReset", container).onclick = () => {
    $$(".drag-chip", container).forEach(c => $("#dragZone", container).appendChild(c));
    $("#dragResult", container).innerHTML = "";
  };

  $("#dragCheck", container).onclick = () => {
    let ok = 0, placed = 0;
    $$(".drop-col", container).forEach(col => {
      const cat = +col.dataset.cat;
      $$(".drag-chip", col).forEach(chip => {
        placed++;
        const good = items[+chip.dataset.i].cat === cat;
        chip.classList.toggle("placed", good);
        chip.style.borderColor = good ? "var(--success)" : "var(--danger)";
        chip.style.color = good ? "var(--success)" : "var(--danger)";
        if (good) ok++;
      });
    });
    const total = items.length;
    const ratio = ok / total;
    $("#dragResult", container).innerHTML =
      `<div class="feedback ${ratio === 1 ? "ok" : "no"}"><b>${ok} / ${total}</b> — ${ratio === 1 ? "تصنيف ممتاز! 🎯" : placed < total ? "أكمل سحب جميع العناصر أولًا." : "راجع العناصر الملوّنة بالأحمر."}</div>`;
    if (placed === total && opts.onFinish) opts.onFinish(ratio, ok);
  };
}

/* ------------------------- الصفحات ------------------------- */

/* ===== الرئيسية ===== */
function viewHome() {
  const pct = progressPct();
  const total = allLessons().length;
  const done = Object.keys(state.completed).length;
  const due = dueReviews();

  app.innerHTML = `
    <section class="hero">
      <p class="hero-badge" style="border:none;background:none;padding:0;letter-spacing:.5px">${COURSE.subtitle} · ${COURSE.year}</p>
      <h1>${COURSE.title}</h1>
      <p>${COURSE.description}</p>
      <div class="hero-badges">
        <span class="hero-badge">📘 ${UNITS.length} وحدات</span>
        <span class="hero-badge">📖 ${total} درسًا</span>
        <span class="hero-badge">🃏 ${FLASHCARDS.length} بطاقة مراجعة</span>
        <span class="hero-badge">⏱️ ${COURSE.examInfo.minutes} دقيقة للامتحان</span>
      </div>
      <div class="mt-2" style="display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn-lg" style="background:#f59e0b;color:#422006" href="#/course">${pct ? "أكمل التعلّم ↙" : "ابدأ التعلّم الآن ↙"}</a>
        <a class="btn btn-lg btn-outline" style="color:#fff;border-color:rgba(255,255,255,.5)" href="#/exam">اختبر نفسك 📝</a>
      </div>
    </section>

    ${due.length ? `
    <section class="review-due mt-3">
      <h3>⏰ مراجعات مستحقة اليوم (${due.length})</h3>
      <p class="small muted">التكرار المتباعد يثبت المعلومة في ذاكرتك — راجعها الآن قبل نسيانها.</p>
      <div class="chips mt-1">
        ${due.map(d => `<a class="chip active" href="#/lesson/${d.id}">${d.lesson.title}</a>`).join("")}
      </div>
    </section>` : ""}

    <section class="grid grid-4 mt-3">
      <div class="stat"><b>${pct}%</b><span>نسبة الإنجاز</span></div>
      <div class="stat"><b>${done}/${total}</b><span>دروس مكتملة</span></div>
      <div class="stat"><b>${state.examHistory.length}</b><span>محاولات امتحان</span></div>
      <div class="stat"><b>${state.streak} 🔥</b><span>أيام متتالية</span></div>
    </section>

    <section class="mt-3">
      <h2>الأهداف التعليمية للمقرر</h2>
      <div class="card">
        <ol class="objectives">${COURSE.objectives.map(o => `<li>${o}</li>`).join("")}</ol>
      </div>
    </section>

    <section class="mt-3">
      <h2>وحدات المقرر</h2>
      <div class="grid grid-2">
        ${UNITS.map((u, i) => {
          const d = u.lessons.filter(l => state.completed[l.id]).length;
          return `<a class="unit-card" style="--uc:${u.color}" href="#/unit/${u.id}">
            <span class="unit-num">${i + 1}</span>
            <h3>${u.title.replace(/^الوحدة \S+:\s*/, "")}</h3>
            <p class="small muted" style="margin:.2em 0">${u.intro}</p>
            <div class="unit-meta">
              <span>📖 ${u.lessons.length} دروس</span>
              <span>✅ ${d} مكتمل</span>
              <span>⏱️ ${u.lessons.reduce((s, l) => s + l.duration, 0)} دقيقة</span>
            </div>
          </a>`;
        }).join("")}
      </div>
    </section>

    <section class="mt-3 grid grid-2">
      <div class="card">
        <h3>🃏 بطاقات المراجعة السريعة</h3>
        <p class="small muted">مراجعة نشطة بالمصطلحات الأساسية — أفضل وسيلة قبل الامتحان بيوم.</p>
        <a class="btn btn-primary" href="#/cards">ابدأ المراجعة</a>
      </div>
      <div class="card">
        <h3>📝 الاختبار الشامل</h3>
        <p class="small muted">${COURSE.examInfo.questions} سؤالًا في ${COURSE.examInfo.minutes} دقيقة مع تغذية راجعة فورية ونتيجة مفصلة.</p>
        <a class="btn btn-success" href="#/exam">ابدأ الاختبار</a>
      </div>
    </section>`;

  updateTopBar();
}

/* ===== صفحة المقرر ===== */
function viewCourse() {
  const total = allLessons().length;
  const done = Object.keys(state.completed).length;

  app.innerHTML = `
    <div class="card">
      <div class="crumb">الرئيسية / المقرر</div>
      <h1>${COURSE.title}</h1>
      <p class="muted">${COURSE.description}</p>
      <div class="grid grid-3 mt-2">
        <div class="stat"><b>${progressPct()}%</b><span>نسبة الإنجاز</span></div>
        <div class="stat"><b>${done}/${total}</b><span>دروس مكتملة</span></div>
        <div class="stat"><b>${Object.keys(state.cardsSeen).length}/${FLASHCARDS.length}</b><span>بطاقات تمت مراجعتها</span></div>
      </div>
      <div class="bar mt-2"><i style="width:${progressPct()}%"></i></div>
    </div>

    <div class="mt-3">
      ${UNITS.map((u, i) => `
        <div class="card mb-2" style="border-inline-start:6px solid ${u.color}">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
            <div>
              <span class="unit-num" style="--uc:${u.color};display:inline-grid">${i + 1}</span>
              <h3 style="display:inline-block;margin:0 8px">${u.title}</h3>
            </div>
            <span class="small muted">✅ ${u.lessons.filter(l => state.completed[l.id]).length}/${u.lessons.length}</span>
          </div>
          <p class="small muted">${u.intro}</p>
          <div class="grid" style="gap:8px">
            ${u.lessons.map((l, li) => {
              const c = state.completed[l.id];
              return `<a class="lesson-row ${c ? "done" : ""}" href="#/lesson/${l.id}">
                <span class="lr-status">${c ? "✓" : li + 1}</span>
                <span class="lr-title">
                  <b>${l.title}</b>
                  <small>${l.objective}</small>
                </span>
                <span class="lr-score">${c ? c.score + "%" : "⏱ " + l.duration + " د"}</span>
              </a>`;
            }).join("")}
          </div>
        </div>`).join("")}
    </div>

    <div class="pager">
      <span></span>
      <a class="btn btn-primary" href="#/lesson/${allLessons()[0].id}">ابدأ أول درس ←</a>
    </div>`;

  updateTopBar();
}

/* ===== صفحة الوحدة ===== */
function viewUnit(id) {
  const idx = UNITS.findIndex(u => u.id === id);
  if (idx < 0) return viewHome();
  const u = UNITS[idx];

  app.innerHTML = `
    <div class="card" style="border-inline-start:6px solid ${u.color}">
      <div class="crumb"><a href="#/course">المقرر</a> / ${u.title}</div>
      <h1>${u.title}</h1>
      <p class="muted">${u.intro}</p>
      <div class="unit-meta">
        <span>📖 ${u.lessons.length} دروس</span>
        <span>⏱️ ${u.lessons.reduce((s, l) => s + l.duration, 0)} دقيقة</span>
        <span>✅ ${u.lessons.filter(l => state.completed[l.id]).length} مكتمل</span>
      </div>
    </div>

    <div class="grid mt-3" style="gap:12px">
      ${u.lessons.map((l, i) => {
        const c = state.completed[l.id];
        return `<a class="lesson-row ${c ? "done" : ""}" href="#/lesson/${l.id}">
          <span class="lr-status">${c ? "✓" : i + 1}</span>
          <span class="lr-title"><b>${l.title}</b><small>${l.objective}</small></span>
          <span class="lr-score">${c ? c.score + "%" : "⏱ " + l.duration + " د"}</span>
        </a>`;
      }).join("")}
    </div>

    <div class="pager">
      <a class="btn btn-outline" href="#/course">→ قائمة الوحدات</a>
      <a class="btn btn-primary" href="#/lesson/${u.lessons[0].id}">ابدأ درس الوحدة ←</a>
    </div>`;

  updateTopBar();
}

/* ===== صفحة الدرس ===== */
function viewLesson(id) {
  const found = findLesson(id);
  if (!found) return viewHome();
  const { lesson, unit } = found;
  const idx = allLessons().findIndex(l => l.id === id);
  const all = allLessons();
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const done = state.completed[id];

  app.innerHTML = `
    <div class="lesson-header">
      <div class="crumb"><a href="#/course">المقرر</a> / <a href="#/unit/${unit.id}">${unit.title}</a></div>
      <h1>${lesson.title}</h1>
      <div class="lesson-meta">
        <span>⏱️ ${lesson.duration} دقائق</span>
        <span>📚 الدرس ${idx + 1} من ${all.length}</span>
        <span>${done ? `✅ مكتمل — أفضل نتيجة ${done.score}%` : "⬜ لم يكتمل بعد"}</span>
      </div>
      <div class="objective-box"><b>الهدف التعليمي:</b> ${lesson.objective}</div>
    </div>

    <article class="lesson-body">
      ${renderContent(lesson.content)}

      <section class="activity" id="activityBox">
        <span class="activity-label">🎯 نشاط تفاعلي</span>
        <p class="small muted">${lesson.activity.instruction}</p>
        <div id="activityMount"></div>
      </section>

      ${lesson.quiz ? `
      <section class="activity" id="quizBox">
        <span class="activity-label" style="background:#2563eb;color:#fff">📝 اختبار قصير</span>
        <p class="small muted">أجب عن الأسئلة لتحفظ الدرس وتُجدول مراجعته لاحقًا.</p>
        <div id="quizMount"></div>
      </section>` : ""}

      <section class="card mt-2">
        <h3>💡 ملخص الدرس</h3>
        <ul>${lesson.summary.map(s => `<li>${s}</li>`).join("")}</ul>
        <div class="mt-2" style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-outline" onclick="window.print()">🖨️ طباعة الملخص</button>
          <button class="btn btn-success" id="completeBtn">${done ? "✔ أكملت هذا الدرس" : "علّم الدرس كمكتمل"}</button>
        </div>
      </section>
    </article>

    <div class="pager">
      ${prev ? `<a class="btn btn-outline" href="#/lesson/${prev.id}">→ ${prev.title}</a>` : `<span></span>`}
      ${next ? `<a class="btn btn-primary" href="#/lesson/${next.id}">${next.title} ←</a>` : `<a class="btn btn-primary" href="#/exam">إلى الاختبار الشامل ←</a>`}
    </div>`;

  // ---- تحميل النشاط حسب نوعه ----
  const mount = $("#activityMount");
  const act = lesson.activity;
  const markDone = ratio => {
    const key = id;
    const prevBest = state.completed[key] ? state.completed[key].score : 0;
    const pctScore = Math.round(ratio * 100);
    if (pctScore > prevBest) state.completed[key] = { score: pctScore, at: Date.now() };
    scheduleReview(key, ratio);
    saveState();
    updateTopBar();
  };

  if (act.type === "quiz") renderQuiz(mount, act.questions, { onFinish: markDone });
  else if (act.type === "match") renderMatch(mount, act.pairs, { onFinish: markDone });
  else if (act.type === "drag") renderDrag(mount, act, { onFinish: markDone });

  // ---- الاختبار القصير ----
  if (lesson.quiz) {
    renderQuiz($("#quizMount"), lesson.quiz, { onFinish: ratio => markDone(ratio) });
  }

  // ---- زر الإكمال اليدوي ----
  $("#completeBtn").onclick = () => {
    if (!state.completed[id]) {
      state.completed[id] = { score: 60, at: Date.now() };
      scheduleReview(id, 0.6);
      saveState();
      toast("تم تسجيل الدرس كمكتمل ✅");
      confetti();
      viewLesson(id);
    } else {
      toast("الدرس مكتمل بالفعل ✔");
    }
  };

  updateTopBar();
}

/* ===== البطاقات التعليمية ===== */
let cardFilter = "all";
let cardIndex = 0;

function viewCards() {
  const filtered = cardFilter === "all" ? FLASHCARDS : FLASHCARDS.filter(c => c.unit === cardFilter);
  if (cardIndex >= filtered.length) cardIndex = 0;
  const card = filtered[cardIndex];
  const seenCount = Object.keys(state.cardsSeen).length;

  app.innerHTML = `
    <div class="card">
      <div class="crumb">الرئيسية / البطاقات التعليمية</div>
      <h1>🃏 بطاقات المراجعة النشطة</h1>
      <p class="muted">اضغط على البطاقة لعرض التعريف (استرجاع نشط) — ثم انتقل للتالية. رتّب حسب الوحدة أو راجع الكل.</p>
      <div class="chips mt-2">
        <button class="chip ${cardFilter === "all" ? "active" : ""}" data-f="all">الكل (${FLASHCARDS.length})</button>
        ${UNITS.map(u => `<button class="chip ${cardFilter === u.id ? "active" : ""}" data-f="${u.id}">${u.title.replace(/^الوحدة \S+:\s*/, "")} (${FLASHCARDS.filter(c => c.unit === u.id).length})</button>`).join("")}
      </div>
      <div class="bar mt-2"><i style="width:${Math.round(seenCount / FLASHCARDS.length * 100)}%"></i></div>
      <p class="small muted">تمت مراجعة ${seenCount} من ${FLASHCARDS.length} بطاقة</p>
    </div>

    <div class="flash-wrap mt-3">
      <div class="flashcard" id="flash">
        <div class="flash-face front">
          <div>
            <p class="small muted" style="margin:0">المصطلح</p>
            <h3>${card.term}</h3>
            <p class="small muted">اضغط لعرض التعريف</p>
          </div>
        </div>
        <div class="flash-face back">
          <div>
            <p class="small" style="opacity:.8;margin:0">التعريف</p>
            <p>${card.def}</p>
          </div>
        </div>
      </div>
      <p class="flash-hint">👆 اضغط البطاقة لقلبها</p>
    </div>

    <div class="flash-nav">
      <button class="btn btn-outline" id="cardPrev">→ السابقة</button>
      <span class="flash-count">${cardIndex + 1} / ${filtered.length}</span>
      <button class="btn btn-primary" id="cardNext">التالية ←</button>
    </div>

    <div class="mt-3 grid grid-3">
      <button class="btn btn-success" id="knownBtn">أتذكرها ✓</button>
      <button class="btn btn-danger" id="againBtn">أعيدها لاحقًا ↻</button>
      <a class="btn btn-outline" href="#/exam">اختبرني 📝</a>
    </div>`;

  const flash = $("#flash");
  flash.onclick = () => {
    flash.classList.toggle("flipped");
    if (flash.classList.contains("flipped")) {
      state.cardsSeen[card.term] = true;
      saveState();
    }
  };

  $("#cardPrev").onclick = () => { cardIndex = (cardIndex - 1 + filtered.length) % filtered.length; viewCards(); };
  $("#cardNext").onclick = () => { cardIndex = (cardIndex + 1) % filtered.length; viewCards(); };
  $("#knownBtn").onclick = () => {
    state.cardsSeen[card.term] = true; saveState();
    toast("أحسنت! سُجّلت البطاقة كمُتقنة 🎯");
    cardIndex = (cardIndex + 1) % filtered.length; viewCards();
  };
  $("#againBtn").onclick = () => {
    toast("لا بأس، ستظهر لك مجددًا في المراجعة القادمة");
    cardIndex = (cardIndex + 1) % filtered.length; viewCards();
  };

  $$(".chip[data-f]", app).forEach(ch => ch.onclick = () => {
    cardFilter = ch.dataset.f; cardIndex = 0; viewCards();
  });

  updateTopBar();
}

/* ===== الاختبار الشامل ===== */
let examTimer = null;
let examQuestions = [];
let examAnswers = [];
let examRemaining = 0;

function viewExam() {
  clearInterval(examTimer);
  const { questions: QN, minutes } = COURSE.examInfo;

  // اختيار أسئلة: نخلط بنك الأسئلة + أسئلة الدروس
  const pool = [...EXAM_BANK];
  allLessons().forEach(l => (l.quiz || []).forEach(q => pool.push({ ...q, unit: l.unit.id })));
  // إعطاء أولوية للأسئلة التي أُجيب عنها أقل مرة
  pool.sort((a, b) => (state.examSeen[a.q] || 0) - (state.examSeen[b.q] || 0) || Math.random() - .5);
  examQuestions = pool.slice(0, QN);
  examAnswers = new Array(QN).fill(null);

  app.innerHTML = `
    <div class="card">
      <div class="crumb">الرئيسية / الاختبار الشامل</div>
      <h1>📝 الاختبار الشامل</h1>
      <p class="muted">${QN} سؤالًا اختيار من متعدد · ${minutes} دقيقة · الدرجة الناجح ${COURSE.examInfo.passScore}%</p>
      <ul class="small muted">
        <li>الأسئلة مختارة من بنك شامل لكل وحدات المقرر.</li>
        <li>الإجابة تظهر لك فورًا مع التعليل بعد انتهاء الاختبار في المراجعة المفصلة.</li>
        <li>يمكنك إعادة الاختبار بأسئلة مختلفة في كل مرة.</li>
      </ul>
      <div class="grid grid-3 mt-2">
        <div class="stat"><b>${state.examHistory.length}</b><span>محاولة سابقة</span></div>
        <div class="stat"><b>${bestExam()}%</b><span>أفضل نتيجة</span></div>
        <div class="stat"><b>${QN}</b><span>عدد الأسئلة</span></div>
      </div>
      <button class="btn btn-success btn-lg btn-block mt-2" id="startExam">🚀 ابدأ الاختبار الآن</button>
    </div>`;

  $("#startExam").onclick = startExam;
  updateTopBar();
}

function bestExam() {
  if (!state.examHistory.length) return 0;
  return Math.round(Math.max(...state.examHistory.map(e => e.score / e.total * 100)));
}

function startExam() {
  examRemaining = COURSE.examInfo.minutes * 60;

  app.innerHTML = `
    <div class="exam-bar">
      <span class="timer" id="timer">⏳ ${fmtTime(examRemaining)}</span>
      <span class="exam-progress">
        <span class="small muted" id="ansCount">0 / ${examQuestions.length} مجاب</span>
        <span class="bar"><i id="examBar" style="width:0%"></i></span>
      </span>
      <button class="btn btn-danger btn-sm" id="finishBtn">إنهاء الاختبار</button>
    </div>

    <div class="mt-3" id="examQs">
      ${examQuestions.map((q, i) => `
        <div class="card q" data-i="${i}" style="margin-bottom:14px">
          <div class="q-text"><span class="q-num">${i + 1}</span>${q.q}</div>
          <div class="opts">
            ${q.options.map((o, j) => `<button class="opt" data-j="${j}">${o}</button>`).join("")}
          </div>
        </div>`).join("")}
    </div>`;

  $("#examQs").addEventListener("click", e => {
    const btn = e.target.closest(".opt");
    if (!btn) return;
    const qEl = btn.closest(".q");
    const i = +qEl.dataset.i;
    examAnswers[i] = +btn.dataset.j;
    $$(".opt", qEl).forEach(b => b.classList.remove("selected"));
    btn.style.borderColor = "var(--primary-2)";
    btn.style.background = "#dbe7ff";
    $$(".opt", qEl).forEach(b => { if (b !== btn) { b.style.borderColor = ""; b.style.background = ""; } });
    const answered = examAnswers.filter(a => a !== null).length;
    $("#ansCount").textContent = `${answered} / ${examQuestions.length} مجاب`;
    $("#examBar").style.width = (answered / examQuestions.length * 100) + "%";
  });

  $("#finishBtn").onclick = finishExam;

  examTimer = setInterval(() => {
    examRemaining--;
    const t = $("#timer");
    if (!t) return clearInterval(examTimer);
    t.textContent = "⏳ " + fmtTime(examRemaining);
    t.classList.toggle("low", examRemaining <= 60);
    if (examRemaining <= 0) { clearInterval(examTimer); finishExam(true); }
  }, 1000);
}

function fmtTime(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function finishExam(timeout = false) {
  clearInterval(examTimer);
  const total = examQuestions.length;
  let score = 0;
  examQuestions.forEach((q, i) => {
    if (examAnswers[i] === q.a) score++;
    state.examSeen[q.q] = (state.examSeen[q.q] || 0) + (examAnswers[i] === q.a ? 1 : 0);
  });

  state.examHistory.push({ score, total, at: Date.now(), timeout });
  if (state.examHistory.length > 20) state.examHistory.shift();

  // جدولة مراجعة للدروس التي أُجيب عنها خطأ
  const wrongUnits = new Set();
  examQuestions.forEach((q, i) => { if (examAnswers[i] !== q.a && q.unit) wrongUnits.add(q.unit); });
  wrongUnits.forEach(uid => {
    const u = UNITS.find(x => x.id === uid);
    if (u) u.lessons.forEach(l => { if (state.completed[l.id]) scheduleReview(l.id, 0.4); });
  });
  saveState();

  const pct = Math.round(score / total * 100);
  const passed = pct >= COURSE.examInfo.passScore;

  app.innerHTML = `
    <div class="card" style="text-align:center">
      <h1>${timeout ? "⏰ انتهى الوقت!" : "🎉 نتيجة الاختبار"}</h1>
      <div class="result-ring" style="--p:${pct}%"><b>${pct}%</b></div>
      <p class="stat" style="border:none;padding:0"><b>${score} / ${total}</b><span>إجابة صحيحة</span></p>
      <p class="muted">${passed ? "أحسنت! لقد تجاوزت درجة النجاح 👏" : "تحتاج مراجعة بعض الوحدات ثم أعد المحاولة 💪"}</p>
      <div class="grid grid-3 mt-2">
        <div class="stat"><b>${COURSE.examInfo.passScore}%</b><span>درجة النجاح</span></div>
        <div class="stat"><b>${bestExam()}%</b><span>أفضل نتيجة لك</span></div>
        <div class="stat"><b>${state.examHistory.length}</b><span>إجمالي المحاولات</span></div>
      </div>
      <div class="mt-2" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="reviewBtn">📋 مراجعة الإجابات</button>
        <button class="btn btn-success" id="retryBtn">🔁 اختبار جديد</button>
        <a class="btn btn-outline" href="#/home">الرئيسية</a>
      </div>
    </div>

    <div id="reviewArea" class="mt-3"></div>`;

  if (passed) confetti();

  $("#retryBtn").onclick = viewExam;
  $("#reviewBtn").onclick = () => {
    $("#reviewArea").innerHTML = `
      <div class="card">
        <h3>📋 مراجعة مفصلة</h3>
        ${examQuestions.map((q, i) => {
          const ok = examAnswers[i] === q.a;
          return `<div class="review-item ${ok ? "ok" : "no"}">
            <b><span class="q-num">${i + 1}</span> ${q.q}</b>
            <div class="rv-ans">إجابتك: ${examAnswers[i] === null ? "— لم تُجب —" : q.options[examAnswers[i]]} ${ok ? "✅" : "❌"}</div>
            ${ok ? "" : `<div class="rv-ans">الإجابة الصحيحة: <b style="color:var(--success)">${q.options[q.a]}</b></div>`}
            <div class="rv-ans">${q.why}</div>
          </div>`;
        }).join("")}
      </div>`;
    $("#reviewArea").scrollIntoView({ behavior: "smooth" });
  };

  updateTopBar();
}

/* ===== لوحة التقدم ===== */
function viewDashboard() {
  const all = allLessons();
  const done = Object.keys(state.completed).length;
  const avg = done ? Math.round(Object.values(state.completed).reduce((s, c) => s + c.score, 0) / done) : 0;
  const due = dueReviews();

  const badges = [
    { ico: "🌱", name: "أول درس", desc: "أكملت درسك الأول", got: done >= 1 },
    { ico: "🔥", name: "5 أيام", desc: "5 أيام دراسية متتالية", got: state.streak >= 5 },
    { ico: "⚡", name: "الوحدة الأولى", desc: "أنهيت وحدة المفاهيم", got: UNITS[0].lessons.every(l => state.completed[l.id]) },
    { ico: "🤝", name: "التعلم التعاوني", desc: "أنهيت وحدة التعلم التعاوني", got: UNITS[2].lessons.every(l => state.completed[l.id]) },
    { ico: "🧠", name: "الموجه ذاتيًا", desc: "أنهيت وحدة التعلم الموجه ذاتيًا", got: UNITS[3].lessons.every(l => state.completed[l.id]) },
    { ico: "🎯", name: "خبير العصف الذهني", desc: "أنهيت وحدة العصف الذهني", got: UNITS[4].lessons.every(l => state.completed[l.id]) },
    { ico: "🏆", name: "اجتياز الامتحان", desc: "حصلت على 80% أو أكثر", got: bestExam() >= 80 },
    { ico: "📚", name: "مكتمل", desc: "أنهيت كل دروس المقرر", got: done === all.length }
  ];

  app.innerHTML = `
    <div class="card">
      <div class="crumb">الرئيسية / لوحة التقدم</div>
      <h1>📊 لوحة تقدّمي</h1>
      <div class="grid grid-4 mt-2">
        <div class="stat"><b>${progressPct()}%</b><span>الإنجاز</span></div>
        <div class="stat"><b>${avg}%</b><span>متوسط الدرجات</span></div>
        <div class="stat"><b>${state.streak} 🔥</b><span>أيام متتالية</span></div>
        <div class="stat"><b>${Object.keys(state.cardsSeen).length}</b><span>بطاقات تمت</span></div>
      </div>
      <div class="bar mt-2"><i style="width:${progressPct()}%"></i></div>
    </div>

    ${due.length ? `
    <div class="review-due mt-3">
      <h3>⏰ مراجعاتك المستحقة</h3>
      <div class="grid mt-2" style="gap:8px">
        ${due.map(d => `<a class="lesson-row" href="#/lesson/${d.id}">
          <span class="lr-status">🔄</span>
          <span class="lr-title"><b>${d.lesson.title}</b><small>${d.unit.title}</small></span>
          <span class="lr-score">مراجعة</span>
        </a>`).join("")}
      </div>
    </div>` : `<div class="card mt-3"><p class="muted" style="margin:0">✅ لا توجد مراجعات مستحقة الآن — تقدّم في الدروس الجديدة.</p></div>`}

    <h2 class="mt-3">🏅 الإنجازات</h2>
    <div class="grid grid-4">
      ${badges.map(b => `<div class="badge-card ${b.got ? "" : "locked"}">
        <div class="b-ico">${b.ico}</div><b>${b.name}</b><span>${b.desc}</span>
      </div>`).join("")}
    </div>

    <h2 class="mt-3">📈 سجل الامتحانات</h2>
    <div class="card">
      ${state.examHistory.length ? `
        <div class="grid" style="gap:8px">
          ${[...state.examHistory].reverse().map(e => `
            <div class="lesson-row ${e.score / e.total >= .6 ? "done" : ""}">
              <span class="lr-status">${e.score / e.total >= .6 ? "✓" : "✗"}</span>
              <span class="lr-title"><b>${e.score} / ${e.total}</b><small>${new Date(e.at).toLocaleString("ar-EG")}</small></span>
              <span class="lr-score">${Math.round(e.score / e.total * 100)}%</span>
            </div>`).join("")}
        </div>` : `<p class="muted" style="margin:0">لم تجرِ اختبارًا بعد — <a href="#/exam">ابدأ الآن</a>.</p>`}
    </div>

    <h2 class="mt-3">📖 حالة الدروس</h2>
    <div class="grid" style="gap:8px">
      ${all.map(l => {
        const c = state.completed[l.id];
        return `<a class="lesson-row ${c ? "done" : ""}" href="#/lesson/${l.id}">
          <span class="lr-status">${c ? "✓" : "○"}</span>
          <span class="lr-title"><b>${l.title}</b><small>${l.unit.title}</small></span>
          <span class="lr-score">${c ? c.score + "%" : "—"}</span>
        </a>`;
      }).join("")}
    </div>

    <div class="mt-3 card" style="text-align:center">
      <p class="muted">تُحفظ جميع بياناتك على هذا الجهاز تلقائيًا.</p>
      <button class="btn btn-danger btn-sm" id="resetBtn">إعادة ضبط التقدم</button>
    </div>`;

  $("#resetBtn").onclick = () => {
    openModal("إعادة ضبط التقدم", "<p>سيتم حذف كل الدروس المكتملة والدرجات والبطاقات. هل أنت متأكد؟</p>");
    $("#modalClose").onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      $("#modal").hidden = true;
      toast("تمت إعادة الضبط");
      viewDashboard();
    };
  };

  updateTopBar();
}

/* ------------------------- التوجيه ------------------------- */

function updateTopBar() {
  $("#topProgress").style.width = progressPct() + "%";
  const route = (location.hash || "#/home").split("/")[1] || "home";
  $$("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === route));
}

function router() {
  clearInterval(examTimer);
  const hash = location.hash || "#/home";
  const parts = hash.slice(2).split("/");
  const [page, arg] = parts;

  window.scrollTo({ top: 0 });
  $("#main-nav")?.classList.remove("open");
  $(".main-nav")?.classList.remove("open");

  switch (page) {
    case "course": viewCourse(); break;
    case "unit": viewUnit(arg); break;
    case "lesson": viewLesson(arg); break;
    case "cards": viewCards(); break;
    case "exam": viewExam(); break;
    case "dashboard": viewDashboard(); break;
    default: viewHome();
  }
}

window.addEventListener("hashchange", router);

// قائمة الجوال
$("#menuBtn").onclick = () => {
  const nav = $(".main-nav");
  const open = nav.classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", open);
};

// إغلاق القائمة عند النقر على رابط
document.addEventListener("click", e => {
  if (e.target.closest(".main-nav a")) $(".main-nav").classList.remove("open");
});

// اختصارات لوحة المفاتيح في البطاقات
document.addEventListener("keydown", e => {
  if (!location.hash.startsWith("#/cards")) return;
  if (e.key === "ArrowLeft") $("#cardNext")?.click();
  if (e.key === "ArrowRight") $("#cardPrev")?.click();
  if (e.key === " ") { e.preventDefault(); $("#flash")?.click(); }
});

// بدء التشغيل
saveState();
router();

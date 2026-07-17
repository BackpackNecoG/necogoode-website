/* ═══════════════════════════════════════════════════════════════════════
   BYTE SIZED TRAINING — the lesson engine.
   Drives a lesson end-to-end: teach beats → multiple choice → drag-drop
   builders → finale (with COMPOUNDING review questions injected from
   earlier lessons) → fix-this free text → cheat card → progress save.

   The engine renders questions into a container and talks to the studio
   through a `stage` interface (Bryte's voice + the big screen):
     stage.say(text, done)        stage.screen({kick, head, code, note})
     stage.chips([{l,f,p,g}])     stage.celebrate()  stage.wave()
     stage.onQuestion(q)          stage.onAnswer(rec)  stage.onLessonDone(sum)
     stage.hintZone(el)           — where Bryte should walk for hints
   Persistence + AI feedback go through `net`:
     net.saveProgress(progress)   net.assess(payload) → Promise<feedback>
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.BST = window.BST || {};
  var T = function () { return window.BST.tokenize.apply(null, arguments); };

  var REVIEWS_PER_FINALE = 2;

  var E = {
    stage: null, net: null, box: null,
    progress: { lessons: {}, cards: [], feedback: [] },
    lesson: null, subIdx: 0, queue: [], current: null, qStart: 0, wrongStreak: 0,

    init: function (opts) {
      E.stage = opts.stage; E.net = opts.net; E.box = opts.box;
      if (opts.progress) E.progress = opts.progress;
      if (!E.progress.lessons) E.progress.lessons = {};
      if (!E.progress.cards) E.progress.cards = [];
      if (!E.progress.feedback) E.progress.feedback = [];
    },

    lessonState: function (id) {
      if (!E.progress.lessons[id]) E.progress.lessons[id] = { answers: {}, done: false, score: 0, total: 0 };
      return E.progress.lessons[id];
    },

    /* ── compounding: pull review MCs from earlier lessons ────────────── */
    reviewPool: function (uptoNum) {
      var pool = [];
      window.BST.LESSONS.forEach(function (l) {
        if (l.num >= uptoNum) return;
        l.subs.forEach(function (s) { s.quiz.forEach(function (q) { pool.push({ q: q, from: l }); }); });
      });
      return pool;
    },
    pickReviews: function (lesson) {
      var pool = E.reviewPool(lesson.num);
      if (!pool.length) return [];
      var picks = [], n = Math.min(REVIEWS_PER_FINALE, pool.length);
      /* deterministic-but-spread: stride through the pool seeded by lesson number */
      var stride = Math.max(1, Math.floor(pool.length / n));
      for (var i = 0; i < n; i++) {
        var item = pool[(lesson.num * 3 + i * stride + i) % pool.length];
        if (picks.indexOf(item) !== -1) item = pool[(lesson.num * 3 + i * stride + i + 1) % pool.length];
        picks.push(item);
      }
      return picks.map(function (p) {
        var q = JSON.parse(JSON.stringify(p.q));
        q.id = q.id + '-r' + lesson.num;              /* unique per finale */
        q.review = p.from.chip + ' · ' + p.from.title; /* badge text */
        return q;
      });
    },

    /* ── lesson flow: build a step queue, then walk it ────────────────── */
    startLesson: function (id) {
      var lesson = window.BST.LESSONS.filter(function (l) { return l.id === id; })[0];
      if (!lesson) return;
      E.lesson = lesson; E.subIdx = 0; E.queue = []; E.wrongStreak = 0;

      if (lesson.recap) E.queue.push({ t: 'recap', recap: lesson.recap });
      E.queue.push({ t: 'say', say: lesson.intro });
      lesson.subs.forEach(function (sub, si) {
        E.queue.push({ t: 'subtitle', sub: sub, si: si });
        sub.beats.forEach(function (b) { E.queue.push({ t: 'beat', beat: b }); });
        sub.quiz.forEach(function (q) { E.queue.push({ t: 'mc', q: q }); });
        E.queue.push({ t: 'dd', q: sub.build });
      });
      E.queue.push({ t: 'say', say: lesson.finale.say, kick: 'THE FINALE' });
      (lesson.finale.quiz || []).forEach(function (q) { E.queue.push({ t: 'mc', q: q }); });
      E.pickReviews(lesson).forEach(function (q) { E.queue.push({ t: 'mc', q: q }); });
      lesson.finale.fixes.forEach(function (f) { E.queue.push({ t: 'fix', q: f }); });
      E.queue.push({ t: 'done' });
      E.next();
    },

    next: function () {
      var step = E.queue.shift();
      if (!step) return;
      E.current = null;
      if (step.t === 'recap') return E.showRecap(step.recap);
      if (step.t === 'say') return E.showSay(step);
      if (step.t === 'subtitle') return E.showSubtitle(step);
      if (step.t === 'beat') return E.showBeat(step.beat);
      if (step.t === 'mc') return E.showMC(step.q);
      if (step.t === 'dd') return E.showDD(step.q);
      if (step.t === 'fix') return E.showFix(step.q);
      if (step.t === 'done') return E.finishLesson();
    },

    /* ── renderers ─────────────────────────────────────────────────────── */
    clearBox: function () { E.box.innerHTML = ''; },

    showRecap: function (recap) {
      E.clearBox();
      E.stage.screen({ kick: recap.title, head: 'Quick rewind before we roll', code: null,
        list: recap.lines });
      E.stage.say("Before tonight's story — a ten-second rewind of what you already own.", function () {
        E.stage.chips([{ l: '▶ Roll the lesson', p: 1, f: E.next }]);
      });
    },

    showSay: function (step) {
      E.clearBox();
      if (step.kick) E.stage.screen({ kick: step.kick, head: E.lesson.title, code: null });
      E.stage.say(step.say, function () {
        E.stage.chips([{ l: 'Let\'s go →', p: 1, f: E.next }]);
      });
    },

    showSubtitle: function (step) {
      E.clearBox();
      var n = step.si + 1, total = E.lesson.subs.length;
      E.stage.screen({ kick: 'SEGMENT ' + n + ' OF ' + total, head: step.sub.title, code: null });
      E.next();
    },

    showBeat: function (beat) {
      E.clearBox();
      if (beat.screen) E.stage.screen(beat.screen);
      E.stage.say(beat.say, function () {
        E.stage.chips([
          { l: 'Next →', p: 1, f: E.next },
          { l: '↺ Say that again', g: 1, f: function () { E.showBeat(beat); } }
        ]);
      });
    },

    record: function (q, type, correct, answerText) {
      var st = E.lessonState(E.lesson.id);
      var first = !st.answers[q.id];
      st.answers[q.id] = { type: type, correct: correct, answer: answerText, ts: Date.now() };
      if (first) st.total++;
      st.score = Object.keys(st.answers).reduce(function (a, k) { return a + (st.answers[k].correct ? 1 : 0); }, 0);
      E.net.saveProgress(E.progress);
      E.stage.onAnswer({ q: q, correct: correct, streak: E.wrongStreak });
      if (!correct) {
        E.wrongStreak++;
        E.queueAssess(q, type, answerText);
      } else E.wrongStreak = 0;
    },

    queueAssess: function (q, type, answerText, alwaysStore) {
      var payload = {
        lesson: E.lesson.chip + ' — ' + E.lesson.title,
        concept: q.concept || '',
        question: q.q || q.brief || '',
        provided: (q.code || '') + (q.note ? '\n' + q.note : ''),
        expected: q.model || (q.opts ? q.opts[q.a] : (q.answers || []).join(' ')),
        answer: answerText, type: type
      };
      E.net.assess(payload).then(function (fb) {
        if (fb && fb.text) {
          E.progress.feedback.push({ qid: q.id, lesson: E.lesson.id, text: fb.text, ts: Date.now() });
          E.net.saveProgress(E.progress);
          E.stage.onFeedback && E.stage.onFeedback(q, fb.text);
        }
      }).catch(function () {});
    },

    showMC: function (q) {
      E.clearBox(); E.current = q; E.qStart = Date.now();
      var html = '';
      if (q.review) html += '<div class="q-review">📼 REVIEW · ' + q.review + '</div>';
      html += '<div class="q-prompt">' + q.q + '</div>';
      if (q.code) html += window.BST.codeBlock(q.code);
      html += '<div class="q-opts">';
      q.opts.forEach(function (o, i) {
        html += '<button class="q-opt" data-i="' + i + '"><span class="q-letter">' + 'ABCD'[i] + '</span> ' +
          (o.indexOf('(') !== -1 || /[=\[\]{}"]/.test(o) ? '<code>' + T(o) + '</code>' : o) + '</button>';
      });
      html += '</div><div class="q-why" hidden></div>';
      E.box.innerHTML = html;
      E.stage.hintZone(E.box);
      E.stage.onQuestion(q);

      var opts = E.box.querySelectorAll('.q-opt');
      opts.forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (E.box.querySelector('.q-opt.right')) return; /* already answered */
          var i = Number(btn.getAttribute('data-i'));
          var correct = i === q.a;
          btn.classList.add(correct ? 'right' : 'wrong');
          opts[q.a].classList.add('right');
          var why = E.box.querySelector('.q-why');
          why.hidden = false;
          why.innerHTML = (correct ? '✅ ' : '❌ ') + q.why;
          E.record(q, 'mc', correct, q.opts[i]);
          E.stage.say(correct ? E.praise() : "Not this time — read my note under the options, it names exactly what happened. On to the next one when you're ready.",
            function () { E.stage.chips([{ l: 'Next →', p: 1, f: E.next }]); });
          if (correct) E.stage.celebrate();
        });
      });
      E.stage.chips([]);
    },

    praise: function () {
      var lines = ["Correct — clean as a live broadcast.", "That's it. The control room approves.",
        "Right answer. You'd survive my code review.", "Nailed it — next clip.",
        "Correct. Somewhere, a production bug just gave up."];
      return lines[Math.floor(Math.random() * lines.length)];
    },

    showDD: function (q) {
      E.clearBox(); E.current = q; E.qStart = Date.now();
      var html = '<div class="q-kicker">🧩 BUILD IT — drag (or tap) the pieces into the code line</div>';
      html += '<div class="q-prompt">' + q.q + '</div>';
      if (q.note) html += '<div class="q-note">' + q.note + '</div>';
      html += '<div class="dd-line"><code>';
      q.parts.forEach(function (p) {
        if (p.t !== undefined) html += '<span class="dd-lit">' + T(p.t) + '</span>';
        else html += '<span class="dd-slot" data-slot="' + p.s + '" data-filled=""></span>';
      });
      html += '</code></div><div class="dd-bank"></div>' +
        '<div class="dd-actions"><button class="bst-btn dd-check" disabled>Check my line ✓</button>' +
        '<button class="bst-btn ghost dd-reset">↺ Reset</button></div><div class="q-why" hidden></div>';
      E.box.innerHTML = html;
      E.stage.hintZone(E.box);
      E.stage.onQuestion(q);

      var bank = E.box.querySelector('.dd-bank');
      var tokens = q.answers.concat(q.bank || []);
      /* stable shuffle (seeded by id) so retakes look the same */
      var seed = 0; for (var c = 0; c < q.id.length; c++) seed = (seed * 31 + q.id.charCodeAt(c)) % 9973;
      tokens = tokens.map(function (t, i) { return { t: t, k: (seed * (i + 7) * 13) % 1009 }; })
        .sort(function (a, b) { return a.k - b.k; }).map(function (x) { return x.t; });
      tokens.forEach(function (t) {
        var chip = document.createElement('button');
        chip.className = 'dd-chip'; chip.draggable = true;
        chip.innerHTML = '<code>' + T(t) + '</code>'; chip.dataset.val = t;
        bank.appendChild(chip);
      });

      var slots = [].slice.call(E.box.querySelectorAll('.dd-slot'));
      var check = E.box.querySelector('.dd-check');

      function firstEmpty() { return slots.filter(function (s) { return !s.dataset.filled; })[0]; }
      function refresh() { check.disabled = !!firstEmpty(); }
      function place(slot, chip) {
        if (!slot || !chip) return;
        if (slot.dataset.filled) unplace(slot);
        slot.dataset.filled = chip.dataset.val;
        slot.innerHTML = '<code>' + T(chip.dataset.val) + '</code>';
        slot.classList.add('filled'); chip.classList.add('used'); chip.disabled = true;
        slot._chip = chip; refresh();
      }
      function unplace(slot) {
        if (!slot.dataset.filled) return;
        slot._chip.classList.remove('used'); slot._chip.disabled = false;
        slot.dataset.filled = ''; slot.innerHTML = ''; slot.classList.remove('filled', 'ok', 'bad');
        slot._chip = null; refresh();
      }

      bank.addEventListener('click', function (e) {
        var chip = e.target.closest('.dd-chip');
        if (chip && !chip.disabled) place(firstEmpty(), chip);
      });
      slots.forEach(function (slot) {
        slot.addEventListener('click', function () { unplace(slot); });
        slot.addEventListener('dragover', function (e) { e.preventDefault(); slot.classList.add('over'); });
        slot.addEventListener('dragleave', function () { slot.classList.remove('over'); });
        slot.addEventListener('drop', function (e) {
          e.preventDefault(); slot.classList.remove('over');
          var val = e.dataTransfer.getData('text/plain');
          var chip = [].slice.call(bank.querySelectorAll('.dd-chip')).filter(function (ch) {
            return ch.dataset.val === val && !ch.disabled; })[0];
          place(slot, chip);
        });
      });
      bank.addEventListener('dragstart', function (e) {
        var chip = e.target.closest('.dd-chip');
        if (chip && !chip.disabled) e.dataTransfer.setData('text/plain', chip.dataset.val);
      });

      E.box.querySelector('.dd-reset').addEventListener('click', function () { slots.forEach(unplace); });

      check.addEventListener('click', function () {
        var allRight = true, given = [];
        slots.forEach(function (slot) {
          var want = q.answers[Number(slot.dataset.slot)];
          var got = slot.dataset.filled; given.push(got);
          var ok = got === want;
          slot.classList.add(ok ? 'ok' : 'bad');
          if (!ok) allRight = false;
        });
        var why = E.box.querySelector('.q-why');
        why.hidden = false;
        why.innerHTML = (allRight ? '✅ ' : '❌ ') + q.why +
          (allRight ? '' : '<div class="q-model">The line: <code>' + T(q.parts.map(function (p) {
            return p.t !== undefined ? p.t : q.answers[p.s]; }).join('')) + '</code></div>');
        check.disabled = true;
        E.record(q, 'dd', allRight, given.join(' | '));
        E.stage.say(allRight ? "Built like a professional. That line ships." :
          "Close — see the red slot? My note under the line explains the piece that belongs there.",
          function () { E.stage.chips([{ l: 'Next →', p: 1, f: E.next }]); });
        if (allRight) E.stage.celebrate();
      });
      E.stage.chips([]);
    },

    showFix: function (q) {
      E.clearBox(); E.current = q; E.qStart = Date.now();
      var html = '<div class="q-kicker">🔧 FIX THIS — open text, real review</div>' +
        '<div class="q-prompt">' + q.brief + '</div>' +
        window.BST.codeBlock(q.code) +
        '<textarea class="fix-input" spellcheck="false" placeholder="Write the fixed code (or bugs + fixed code) here…"></textarea>' +
        '<div class="dd-actions"><button class="bst-btn fix-submit">Submit to the control room ▶</button></div>' +
        '<div class="q-why" hidden></div>';
      E.box.innerHTML = html;
      E.stage.hintZone(E.box);
      E.stage.onQuestion(q);

      var ta = E.box.querySelector('.fix-input');
      E.box.querySelector('.fix-submit').addEventListener('click', function () {
        var ans = ta.value.trim();
        if (!ans) { E.stage.say("Give me something to grade first — even a rough fix beats a blank page."); return; }
        var pass = q.must.every(function (m) { return new RegExp(m, 'm').test(ans); }) &&
          (q.mustNot || []).every(function (m) { return !new RegExp(m, 'm').test(ans); });
        var why = E.box.querySelector('.q-why');
        why.hidden = false;
        why.innerHTML = (pass ? '✅ Local checks passed — the key repairs are all present.' :
          '❌ Local checks say something\'s missing.') +
          '<div class="q-model">Model answer:</div>' + window.BST.codeBlock(q.model);
        this.disabled = true; ta.readOnly = true;
        E.record(q, 'fix', pass, ans);
        /* every fix goes to the AI control room for a written review */
        E.queueAssess(q, 'fix', ans, true);
        E.stage.say(pass ?
          "Local checks pass — and the AI control room is writing you a full review for the report card. Take a look at the model while it works." :
          "The control room will tell you exactly what was missed and how to think about it — that lands on your report card. Compare with the model answer meanwhile.",
          function () { E.stage.chips([{ l: 'Next →', p: 1, f: E.next }]); });
        if (pass) E.stage.celebrate();
      });
      E.stage.chips([]);
    },

    finishLesson: function () {
      var st = E.lessonState(E.lesson.id);
      st.done = true;
      /* auto-populate the cheat-sheet card */
      var have = E.progress.cards.some(function (c) { return c.id === E.lesson.id; });
      if (!have) E.progress.cards.push({ id: E.lesson.id, title: E.lesson.card.title, lines: E.lesson.card.lines, ts: Date.now() });
      E.net.saveProgress(E.progress);
      E.clearBox();
      var pct = st.total ? Math.round(100 * st.score / st.total) : 0;
      E.stage.screen({ kick: 'THAT\'S A WRAP', head: E.lesson.title + ' — ' + st.score + '/' + st.total + ' (' + pct + '%)',
        list: ['Cheat card ' + E.lesson.num + ' added to your notebook',
               'Wrong answers → AI reviews on your report card',
               pct >= 80 ? 'Broadcast grade: cleared for the next channel' : 'Tip: rewatch this channel before moving on'] });
      E.stage.onLessonDone({ lesson: E.lesson, score: st.score, total: st.total, pct: pct });
    },

    /* summary across all lessons (for the report + resume) */
    summary: function () {
      var out = [];
      window.BST.LESSONS.forEach(function (l) {
        var st = E.progress.lessons[l.id];
        out.push({ id: l.id, num: l.num, chip: l.chip, title: l.title,
          done: !!(st && st.done), score: st ? st.score : 0, total: st ? st.total : 0 });
      });
      return out;
    }
  };

  window.BST.Engine = E;
})();

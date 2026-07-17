/* ═══════════════════════════════════════════════════════════════════════
   BYTE SIZED TRAINING v2 — the paginated week engine.
   Days → numbered pages (1.0, 1.1 …) with prev/next/jump and resume.
   Question pages lock the NEXT arrow until answered. Every completed
   page knocks a pin; a perfect day is a STRIKE. Reviews from earlier
   days are injected before each day's fixes (compounding). {{you}} is
   replaced everywhere with the trainee's chosen name.
   stage: caption(t) screen(o) onBoard(adds) onPage(info) onAnswer(rec)
          onDayDone(sum) celebrate()
   net:   saveProgress(p) · assess(payload)→Promise
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.BST = window.BST || {};
  var T = function (c) { return window.BST.tokenize(c); };

  var E = {
    stage: null, net: null, box: null,
    progress: {}, day: null, pages: [], idx: 0,

    init: function (o) {
      E.stage = o.stage; E.net = o.net; E.box = o.box;
      E.progress = o.progress || {};
      ['days', 'cards', 'feedback'].forEach(function (k) { if (!E.progress[k]) E.progress[k] = k === 'days' ? {} : []; });
      if (!E.progress.profile) E.progress.profile = {};
    },
    you: function () { return (E.progress.profile && E.progress.profile.name) || 'you'; },
    setName: function (n) { E.progress.profile.name = String(n).trim().slice(0, 24); E.save(); },
    px: function (s) { return String(s == null ? '' : s).replace(/\{\{you\}\}/g, E.you()); },
    save: function () { E.net.saveProgress(E.progress); },

    dstate: function (id) {
      if (!E.progress.days[id]) E.progress.days[id] = { page: 0, maxPage: 0, answers: {}, done: false, score: 0, total: 0 };
      return E.progress.days[id];
    },
    dayById: function (id) { return window.BST.WEEK.days.filter(function (d) { return d.id === id; })[0]; },
    dayNum: function (id) { return window.BST.WEEK.days.indexOf(E.dayById(id)) + 1; },
    unlockedThrough: function () {
      var n = 1;
      window.BST.WEEK.days.forEach(function (d, i) {
        if (E.progress.days[d.id] && E.progress.days[d.id].done) n = Math.max(n, i + 2);
      });
      return n;
    },

    /* compounding reviews: 2 MCs from earlier days, injected before fixes */
    buildPages: function (day) {
      var num = E.dayNum(day.id);
      var pages = day.pages.slice();
      if (num > 1) {
        var pool = [];
        window.BST.WEEK.days.slice(0, num - 1).forEach(function (d) {
          d.pages.forEach(function (p) { if (p.t === 'mc') pool.push({ p: p, from: d }); });
        });
        var firstFix = pages.findIndex(function (p) { return p.t === 'fix'; });
        if (firstFix < 0) firstFix = pages.length;
        var stride = Math.max(1, Math.floor(pool.length / 2)), used = {};
        for (var i = 1; i >= 0; i--) {
          var at = (num * 3 + i * stride + i) % pool.length;
          while (used[at]) at = (at + 1) % pool.length;
          used[at] = 1;
          var pick = pool[at];
          var q = JSON.parse(JSON.stringify(pick.p));
          q.id = q.id + '-r' + num + '-' + i;
          q.review = pick.from.dow + ' · ' + pick.from.title;
          pages.splice(firstFix, 0, q);
        }
      }
      pages.push({ t: 'wrap' });
      return pages;
    },

    startDay: function (id, atPage) {
      var day = E.dayById(id); if (!day) return;
      E.day = day; E.pages = E.buildPages(day);
      var st = E.dstate(id);
      var target = (atPage != null) ? atPage : Math.min(st.page || 0, E.pages.length - 1);
      E.goto(target);
    },

    pageLabel: function (i) { return E.dayNum(E.day.id) + '.' + i; },
    pageDone: function (i) {
      var p = E.pages[i], st = E.dstate(E.day.id);
      if (!p) return false;
      if (p.t === 'mc' || p.t === 'dd' || p.t === 'fix') return !!st.answers[p.id];
      return i < st.maxPage || st.done;
    },
    canLeave: function () {
      var p = E.pages[E.idx];
      if (!p) return true;
      if (p.t === 'mc' || p.t === 'dd' || p.t === 'fix') return !!E.dstate(E.day.id).answers[p.id];
      return true;
    },
    nav: function () {
      var st = E.dstate(E.day.id);
      return E.pages.map(function (p, i) {
        var label = p.t === 'wrap' ? 'Day wrap-up' :
          p.t === 'teach' ? (p.head || 'Story') :
          p.t === 'mc' ? 'Question' + (p.review ? ' (review)' : '') :
          p.t === 'dd' ? 'Build it' : 'Fix this';
        return { i: i, n: E.pageLabel(i), label: label, t: p.t, done: E.pageDone(i), current: i === E.idx,
          reachable: i <= Math.max(st.maxPage, E.idx) };
      });
    },
    next: function () { if (E.canLeave() && E.idx < E.pages.length - 1) E.goto(E.idx + 1); },
    prev: function () { if (E.idx > 0) E.goto(E.idx - 1); },

    goto: function (i) {
      i = Math.max(0, Math.min(i, E.pages.length - 1));
      var st = E.dstate(E.day.id);
      if (!st.done) { /* no skipping ahead: frontier = furthest visited (+1 if current page is clear) */
        var frontier = (st.maxPage || 0) + (E.canLeave() ? 1 : 0);
        if (i > frontier) i = frontier;
      }
      E.idx = i;
      st.page = i; st.maxPage = Math.max(st.maxPage || 0, i); E.save();
      var p = E.pages[i];
      E.stage.onPage({ day: E.day, idx: i, total: E.pages.length, page: p,
        canNext: E.canLeave() && i < E.pages.length - 1, canPrev: i > 0,
        pins: Math.min(10, E.nav().filter(function (x) { return x.done; }).length) });
      if (p.t === 'teach') E.renderTeach(p);
      else if (p.t === 'mc') E.renderMC(p);
      else if (p.t === 'dd') E.renderDD(p);
      else if (p.t === 'fix') E.renderFix(p);
      else E.renderWrap();
    },

    board: function () {
      /* every board entry from pages the trainee has reached, all days */
      var out = [];
      window.BST.WEEK.days.forEach(function (d) {
        var st = E.progress.days[d.id]; if (!st) return;
        d.pages.forEach(function (p, i) {
          if (p.board && (st.done || i <= st.maxPage)) p.board.forEach(function (b) {
            out.push({ k: E.px(b.k), v: E.px(b.v), day: d.dow });
          });
        });
      });
      return out;
    },

    /* ── renderers ─────────────────────────────────────────────────────── */
    clear: function () { E.box.innerHTML = ''; },

    renderTeach: function (p) {
      E.clear();
      var h = '<div class="s-kick">' + E.px(p.kick || '') + '</div><h2>' + E.px(p.head || '') + '</h2>';
      if (p.code) h += window.BST.codeBlock(E.px(p.code));
      if (p.visual) {
        var v = JSON.parse(E.px(JSON.stringify(p.visual)));
        h += window.BST.Worlds.visual(v);
      }
      if (p.note) h += '<div class="t-note">' + E.px(p.note) + '</div>';
      E.box.innerHTML = h;
      if (p.board) E.stage.onBoard(p.board.map(function (b) { return { k: E.px(b.k), v: E.px(b.v) }; }));
      E.stage.caption(E.px(p.cap || ''));
    },

    record: function (q, type, correct, answerText) {
      var st = E.dstate(E.day.id);
      if (!st.answers[q.id]) st.total++;
      st.answers[q.id] = { type: type, correct: correct, ts: Date.now() };
      st.score = Object.keys(st.answers).reduce(function (a, k) { return a + (st.answers[k].correct ? 1 : 0); }, 0);
      E.save();
      E.stage.onAnswer({ q: q, correct: correct });
      if (!correct || type === 'fix') E.assess(q, type, answerText);
    },
    assess: function (q, type, answerText) {
      E.net.assess({
        lesson: E.day.dow + ' — ' + E.px(E.day.title), concept: q.concept || '', type: type,
        question: E.px(q.q || q.brief || ''), provided: E.px((q.code || '') + (q.note ? '\n' + q.note : '')),
        expected: E.px(q.model || (q.opts ? q.opts[q.a] : (q.answers || []).join(' '))),
        answer: answerText
      }).then(function (fb) {
        if (fb && fb.text) {
          E.progress.feedback.push({ qid: q.id, day: E.day.id, text: fb.text, ts: Date.now() });
          E.save();
        }
      }).catch(function () {});
    },
    afterAnswer: function () {
      var st = E.dstate(E.day.id);
      E.stage.onPage({ day: E.day, idx: E.idx, total: E.pages.length, page: E.pages[E.idx],
        canNext: true, canPrev: E.idx > 0,
        pins: Math.min(10, E.nav().filter(function (x) { return x.done; }).length) });
    },

    renderMC: function (q) {
      E.clear();
      var st = E.dstate(E.day.id), prior = st.answers[q.id];
      var h = '';
      if (q.review) h += '<div class="q-review">📼 REVIEW · ' + q.review + '</div>';
      h += '<div class="q-prompt">' + E.px(q.q) + '</div>';
      if (q.code) h += window.BST.codeBlock(E.px(q.code));
      if (q.visual) h += window.BST.Worlds.visual(JSON.parse(E.px(JSON.stringify(q.visual))));
      h += '<div class="q-opts">';
      q.opts.forEach(function (o, i) {
        h += '<button class="q-opt" data-i="' + i + '"><span class="q-letter">' + 'ABCD'[i] + '</span> ' +
          (/[=\[\]{}("]/.test(o) ? '<code>' + T(E.px(o)) + '</code>' : E.px(o)) + '</button>';
      });
      h += '</div><div class="q-why" hidden></div>';
      E.box.innerHTML = h;
      var opts = E.box.querySelectorAll('.q-opt'), why = E.box.querySelector('.q-why');
      function show(pickIdx) {
        opts[q.a].classList.add('right');
        if (pickIdx !== q.a && pickIdx != null) opts[pickIdx].classList.add('wrong');
        why.hidden = false;
        why.innerHTML = ((pickIdx === q.a) ? '✅ ' : '❌ ') + E.px(q.why);
        opts.forEach(function (b) { b.disabled = true; });
      }
      if (prior) { show(prior.correct ? q.a : null); E.stage.caption('Already answered — the note below has the why. Arrow on when ready.'); }
      else {
        E.stage.caption(E.px(q.cap || 'Your call, {{you}} — pick one. The hint flag is there if you want it.'));
        opts.forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (why.hidden === false) return;
            var i = Number(btn.getAttribute('data-i')), correct = i === q.a;
            show(i);
            E.record(q, 'mc', correct, q.opts[i]);
            E.stage.caption(correct ? E.praise() : 'Not this one — my note under the options names exactly what happened.');
            if (correct) E.stage.celebrate();
            E.afterAnswer();
          });
        });
      }
    },

    praise: function () {
      var l = ['Clean pick.', 'That\'s it — next frame.', 'Correct. The league notices.', 'Right on the nose.'];
      return l[Math.floor(Math.random() * l.length)];
    },

    renderDD: function (q) {
      E.clear();
      var st = E.dstate(E.day.id), prior = st.answers[q.id];
      var h = '<div class="q-kicker">🧩 BUILD IT — drag or tap the pieces into place</div>' +
        '<div class="q-prompt">' + E.px(q.q) + '</div>' +
        (q.note ? '<div class="q-note">' + E.px(q.note) + '</div>' : '') +
        '<div class="dd-line"><code>';
      q.parts.forEach(function (p) {
        if (p.t !== undefined) h += '<span class="dd-lit">' + T(E.px(p.t)) + '</span>';
        else h += '<span class="dd-slot" data-slot="' + p.s + '" data-filled=""></span>';
      });
      h += '</code></div><div class="dd-bank"></div>' +
        '<div class="dd-actions"><button class="bst-btn dd-check" disabled>Check my line ✓</button>' +
        '<button class="bst-btn ghost dd-reset">↺ Reset</button></div><div class="q-why" hidden></div>';
      E.box.innerHTML = h;

      var bank = E.box.querySelector('.dd-bank');
      var tokens = q.answers.concat(q.bank || []), seed = 0;
      for (var c = 0; c < q.id.length; c++) seed = (seed * 31 + q.id.charCodeAt(c)) % 9973;
      tokens.map(function (t, i) { return { t: t, k: (seed * (i + 7) * 13) % 1009 }; })
        .sort(function (a, b) { return a.k - b.k; })
        .forEach(function (x) {
          var chip = document.createElement('button');
          chip.className = 'dd-chip'; chip.draggable = true;
          chip.innerHTML = '<code>' + T(x.t) + '</code>'; chip.dataset.val = x.t;
          bank.appendChild(chip);
        });
      var slots = [].slice.call(E.box.querySelectorAll('.dd-slot'));
      var check = E.box.querySelector('.dd-check');
      var why = E.box.querySelector('.q-why');
      var line = q.parts.map(function (p) { return p.t !== undefined ? p.t : q.answers[p.s]; }).join('');

      function finish(allRight) {
        why.hidden = false;
        why.innerHTML = (allRight ? '✅ ' : '❌ ') + E.px(q.why) +
          (allRight ? '' : '<div class="q-model">The line: <code>' + T(E.px(line)) + '</code></div>');
        check.disabled = true;
        E.box.querySelectorAll('.dd-chip,.dd-slot').forEach(function (el) { el.style.pointerEvents = 'none'; });
      }
      if (prior) {
        slots.forEach(function (s) { s.dataset.filled = q.answers[Number(s.dataset.slot)]; s.innerHTML = '<code>' + T(q.answers[Number(s.dataset.slot)]) + '</code>'; s.classList.add('filled', prior.correct ? 'ok' : 'bad'); });
        finish(prior.correct);
        E.stage.caption('Already built — the answer line is shown. Arrow on when ready.');
        return;
      }
      E.stage.caption(E.px(q.cap || 'Build the line piece by piece — tap a chip, it fills the next slot.'));

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
      bank.addEventListener('dragstart', function (e) {
        var chip = e.target.closest('.dd-chip');
        if (chip && !chip.disabled) e.dataTransfer.setData('text/plain', chip.dataset.val);
      });
      slots.forEach(function (slot) {
        slot.addEventListener('click', function () { unplace(slot); });
        slot.addEventListener('dragover', function (e) { e.preventDefault(); slot.classList.add('over'); });
        slot.addEventListener('dragleave', function () { slot.classList.remove('over'); });
        slot.addEventListener('drop', function (e) {
          e.preventDefault(); slot.classList.remove('over');
          var val = e.dataTransfer.getData('text/plain');
          var chip = [].slice.call(bank.querySelectorAll('.dd-chip')).filter(function (ch) { return ch.dataset.val === val && !ch.disabled; })[0];
          place(slot, chip);
        });
      });
      E.box.querySelector('.dd-reset').addEventListener('click', function () { slots.forEach(unplace); });
      check.addEventListener('click', function () {
        var allRight = true, given = [];
        slots.forEach(function (slot) {
          var ok = slot.dataset.filled === q.answers[Number(slot.dataset.slot)];
          slot.classList.add(ok ? 'ok' : 'bad'); given.push(slot.dataset.filled);
          if (!ok) allRight = false;
        });
        finish(allRight);
        E.record(q, 'dd', allRight, given.join(' | '));
        E.stage.caption(allRight ? 'Built like a pro — that line ships.' : 'Close — the red slot shows where. The full line is under the builder.');
        if (allRight) E.stage.celebrate();
        E.afterAnswer();
      });
    },

    renderFix: function (q) {
      E.clear();
      var st = E.dstate(E.day.id), prior = st.answers[q.id];
      E.box.innerHTML = '<div class="q-kicker">🔧 FIX THIS — open text, real review</div>' +
        '<div class="q-prompt">' + E.px(q.brief) + '</div>' +
        window.BST.codeBlock(E.px(q.code)) +
        '<textarea class="fix-input" spellcheck="false" placeholder="Write the fixed code here…"></textarea>' +
        '<div class="dd-actions"><button class="bst-btn fix-submit">Submit to the control room ▶</button></div>' +
        '<div class="q-why" hidden></div>';
      var ta = E.box.querySelector('.fix-input'), btn = E.box.querySelector('.fix-submit'), why = E.box.querySelector('.q-why');
      function finish(pass) {
        why.hidden = false;
        why.innerHTML = (pass ? '✅ Local checks passed — the key repairs are present.' : '❌ Local checks say something\'s missing.') +
          '<div class="q-model">Model answer:</div>' + window.BST.codeBlock(E.px(q.model));
        btn.disabled = true; ta.readOnly = true;
      }
      if (prior) { ta.value = '(submitted)'; finish(prior.correct); E.stage.caption('Already submitted — compare with the model. Arrow on when ready.'); return; }
      E.stage.caption(E.px(q.cap || 'Take your time — the control room reads every word you write.'));
      btn.addEventListener('click', function () {
        var ans = ta.value.trim();
        if (!ans) { E.stage.caption('Give me something to grade — a rough fix beats a blank page.'); return; }
        var pass = q.must.every(function (m) { return new RegExp(m, 'm').test(ans); }) &&
          (q.mustNot || []).every(function (m) { return !new RegExp(m, 'm').test(ans); });
        finish(pass);
        E.record(q, 'fix', pass, ans);
        E.stage.caption(pass ? 'Checks pass — and the control room is writing your full review for the report card.' :
          'The control room will write up exactly what was missed — it lands on your report card. Compare with the model meanwhile.');
        if (pass) E.stage.celebrate();
        E.afterAnswer();
      });
    },

    renderWrap: function () {
      var st = E.dstate(E.day.id);
      st.done = true;
      var strike = st.total > 0 && st.score === st.total;
      st.strike = strike;
      if (!E.progress.cards.some(function (c) { return c.id === E.day.id; })) {
        var c = E.day.card;
        E.progress.cards.push({ id: E.day.id, title: c.title, story: E.px(c.story), lines: c.lines.map(E.px), ts: Date.now() });
      }
      E.save();
      E.clear();
      var pct = st.total ? Math.round(100 * st.score / st.total) : 0;
      E.box.innerHTML =
        '<div class="wrap-big">' + (strike ? 'STRIKE! \ud83c\udfb3' : pct >= 70 ? 'SPARE! \ud83c\udfb3' : 'OPEN FRAME') + '</div>' +
        '<div class="wrap-sub">' + E.day.dow + ' \u00b7 ' + E.px(E.day.title) + ' \u2014 ' + st.score + '/' + st.total + ' (' + pct + '%)</div>' +
        '<div class="wrap-pins">' + '\ud83c\udfb3'.repeat(Math.max(1, Math.round(pct / 10))) + '</div>' +
        '<div class="t-note">Chapter card filed to your notebook \u00b7 ' +
        (pct >= 70 ? 'the next day just unlocked on the calendar' : 'tip: replay this day before moving on') + '</div>';
      E.stage.caption(strike ? 'A strike, ' + E.you() + '. Clean game \u2014 tomorrow\u2019s open on the calendar.' :
        'Day\u2019s a wrap. Your misses are with the control room; the card\u2019s in your notebook.');
      E.stage.onDayDone({ day: E.day, score: st.score, total: st.total, pct: pct, strike: strike });
    },

    summary: function () {
      return window.BST.WEEK.days.map(function (d, i) {
        var st = E.progress.days[d.id] || {};
        return { id: d.id, num: i + 1, dow: d.dow, title: d.title, world: d.world,
          done: !!st.done, strike: !!st.strike, score: st.score || 0, total: st.total || 0 };
      });
    }
  };
  window.BST.Engine = E;
})();

/* ═══════════════════════════════════════════════════════════════════════
   A WEEK WITH MR. BRYTE — v2 studio controller.
   Calendar home → paginated day view. Bryte is BOLTED to the bottom-left:
   no walking, no drag-away (he snaps back), and he speaks through the
   persistent caption bar so content is never covered. He still watches:
   idle on a question pulses the hint flag; two misses offer a recap;
   returning to the tab gets a welcome. Click him to ask anything.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var BASE = '/api/bst';
  var api = null, me = null, E = null, notesTimer = null;
  var BRYTE_HOME = { x: 5, y: 95 };

  function req(path, opts) {
    opts = opts || {};
    return fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 401) throw { auth: true };
      return r.json().catch(function () { return {}; });
    });
  }
  var saveQueue = Promise.resolve();
  var net = {
    saveProgress: function (p) {
      saveQueue = saveQueue.then(function () { return req('/progress', { method: 'POST', body: p }).catch(function () {}); });
      return saveQueue;
    },
    assess: function (p) { return req('/assess', { method: 'POST', body: p }); }
  };

  /* ── gate + name pick ────────────────────────────────────────────────── */
  function showGate(msg, isErr) {
    $('#gate').hidden = false;
    var m = $('#gate-msg');
    if (msg) { m.hidden = false; m.innerHTML = msg; m.classList.toggle('err', !!isErr); }
  }
  function wireGate() {
    var send = function () {
      var email = $('#gate-email').value.trim();
      if (!email || email.indexOf('@') === -1) return showGate("That doesn't look like an email — one more try.", true);
      $('#gate-send').disabled = true;
      req('/login', { method: 'POST', body: { email: email } }).then(function (r) {
        $('#gate-send').disabled = false;
        if (r.sent) showGate('📬 Magic link sent to <b>' + email + '</b> — good for 15 minutes.');
        else if (r.devLink) showGate('🔧 dev mode — <a href="' + r.devLink + '">enter the week</a>');
        else if (r.unknown) showGate("That email isn't on the guest list yet. Ask the producer (Neco) to add you.", true);
        else showGate('Something hiccuped — try again in a moment.', true);
      }).catch(function () { $('#gate-send').disabled = false; showGate('Network trouble — try again.', true); });
    };
    $('#gate-send').addEventListener('click', send);
    $('#gate-email').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  }
  function pickName(done) {
    $('#namepick').hidden = false;
    var input = $('#name-input'), msg = $('#name-msg');
    var say = function (t, isErr) { if (!msg) return; msg.hidden = false; msg.textContent = t; msg.classList.toggle('err', !!isErr); };
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
    var save = function () {
      var n = (input.value || '').trim();
      if (!n) { say('Type a name first — even a nickname works. It’s what Bryte calls you all week.', true); input.focus(); return; }
      try {
        E.setName(n);
        $('#namepick').hidden = true;
        done();
      } catch (err) {
        say('Something glitched saving that — give it one more tap. (' + (err && err.message || err) + ')', true);
      }
    };
    $('#name-save').addEventListener('click', save);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
  }

  /* ── views ───────────────────────────────────────────────────────────── */
  function show(view) {
    ['calendar', 'dayview', 'reportview'].forEach(function (v) { $('#' + v).hidden = v !== view; });
  }

  /* ── calendar ────────────────────────────────────────────────────────── */
  function renderCalendar() {
    show('calendar');
    var grid = $('#cal-grid'); grid.innerHTML = '';
    var open = E.unlockedThrough();
    window.BST.WEEK.days.forEach(function (d, i) {
      var w = window.BST.Worlds.get(d.world), st = E.progress.days[d.id] || {};
      var num = i + 1, locked = num > open, current = num === Math.min(open, 8) && !st.done;
      var tile = document.createElement('button');
      tile.className = 'cal-tile' + (st.done ? ' done' : '') + (current ? ' current' : '') + (locked ? ' locked' : '');
      tile.innerHTML = '<div class="ct-dow">' + d.dow + ' · DAY ' + num + '</div>' +
        '<div class="ct-icon">' + w.icon + '</div>' +
        '<div class="ct-name">' + E.px(d.title) + '</div>' +
        '<div class="ct-sub">' + d.concepts + '</div>' +
        '<div class="ct-status">' + (st.done ? (st.strike ? '✓ STRIKE — ' : '✓ done — ') + st.score + '/' + st.total :
          locked ? '🔒 finish ' + window.BST.WEEK.days[i - 1].dow + ' first' :
          (st.maxPage ? '▶ resume page ' + num + '.' + st.page : '▶ start')) + '</div>';
      tile.addEventListener('click', function () {
        if (locked) { caption('That day\'s still locked — the week builds. Finish ' + window.BST.WEEK.days[i - 1].dow + ' first.'); return; }
        openDay(d.id);
      });
      grid.appendChild(tile);
    });
    /* the reusable-worlds / custom-training placeholder */
    var cw = window.BST.Worlds.all.custom;
    var custom = document.createElement('button');
    custom.className = 'cal-tile custom';
    custom.innerHTML = '<div class="ct-dow">ANY WEEK · ANY TOPIC</div><div class="ct-icon">' + cw.icon + '</div>' +
      '<div class="ct-name">' + cw.name + '</div><div class="ct-sub">Craft a custom training with Mr. Bryte</div>' +
      '<div class="ct-status">+ learn more</div>';
    custom.addEventListener('click', function () {
      var p = $('#custom-panel');
      p.hidden = !p.hidden;
      p.innerHTML = '<b>' + cw.icon + ' ' + cw.name + ' — ' + cw.tag + '</b><br>' + cw.blurb +
        '<br><br>These eight worlds (the lanes, the kitchen, game night…) are reusable sets: the same week can host Java, .NET, SQL, onboarding — any curriculum, mounted on the same story, cast, and engine.';
    });
    grid.appendChild(custom);
    updateBoard([]);
  }

  /* ── day view ────────────────────────────────────────────────────────── */
  var newBoardKeys = {};
  function openDay(id) {
    show('dayview');
    var d = E.dayById(id), w = window.BST.Worlds.get(d.world);
    $('#day-world').textContent = w.icon;
    $('#day-name').textContent = d.dow + ' — ' + E.px(d.title);
    monitor.reset();
    E.startDay(id);
    caption(E.px(d.intro));
  }
  function caption(t) {
    $('#cap-text').textContent = t || '';
  }
  function renderRail() {
    var rail = $('#pagerail');
    rail.innerHTML = '<div class="pr-head">PAGES</div>';
    E.nav().forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'pr-item' + (p.done ? ' done' : '') + (p.current ? ' current' : '');
      b.disabled = !p.reachable;
      b.innerHTML = '<span class="pr-n">' + p.n + '</span><span class="pr-tick">' + (p.done ? '✓' : '○') + '</span><span>' + E.px(p.label) + '</span>';
      b.addEventListener('click', function () { E.goto(p.i); });
      rail.appendChild(b);
    });
  }
  function wirePager() {
    $('#pg-prev').addEventListener('click', function () { E.prev(); });
    $('#pg-next').addEventListener('click', function () {
      if (!E.canLeave()) { caption('Answer this one first — the week builds, no skipping. The 🚩 hint is right there if you need it.'); return; }
      E.next();
    });
    $('#pg-jump').addEventListener('click', function () {
      var m = $('#jumpmenu');
      if (!m.hidden) { m.hidden = true; return; }
      m.innerHTML = '';
      E.nav().forEach(function (p) {
        var b = document.createElement('button');
        b.className = 'pr-item' + (p.done ? ' done' : '') + (p.current ? ' current' : '');
        b.disabled = !p.reachable;
        b.innerHTML = '<span class="pr-n">' + p.n + '</span><span>' + E.px(p.label) + '</span>';
        b.addEventListener('click', function () { m.hidden = true; E.goto(p.i); });
        m.appendChild(b);
      });
      var r = $('#pg-jump').getBoundingClientRect();
      m.style.left = Math.max(8, r.right - 280) + 'px'; m.style.top = (r.bottom + 6) + 'px';
      m.hidden = false;
    });
  }

  /* ── week board ──────────────────────────────────────────────────────── */
  function updateBoard(newAdds) {
    (newAdds || []).forEach(function (b) { newBoardKeys[b.k] = Date.now(); });
    var items = $('#board-items'); items.innerHTML = '';
    var seen = {};
    E.board().forEach(function (b) {
      if (seen[b.k]) return; seen[b.k] = 1;
      var isNew = newBoardKeys[b.k] && (Date.now() - newBoardKeys[b.k] < 60000);
      var el = document.createElement('span');
      el.className = 'bb-item' + (isNew ? ' new' : '');
      el.innerHTML = '<span class="bb-k">' + b.k + '</span> = <span class="bb-v">' + b.v + '</span>' + (isNew ? ' <small>NEW</small>' : '');
      items.appendChild(el);
    });
    if (!items.children.length) items.innerHTML = '<span class="bb-item"><span class="bb-v">the board fills as the story does — start Sunday</span></span>';
  }

  /* ── report card ─────────────────────────────────────────────────────── */
  function renderReport() {
    show('reportview');
    var v = $('#reportview');
    var sum = E.summary(), sc = 0, tot = 0, done = 0, strikes = 0;
    var h = '<div class="s-kick">📊 SEASON SCORECARD · ' + E.you() + '</div><h2 style="font-family:var(--serif);font-weight:600">The week so far</h2>';
    sum.forEach(function (s) {
      sc += s.score; tot += s.total; if (s.done) done++; if (s.strike) strikes++;
      h += '<div class="rp-row' + (s.done || s.total ? '' : ' locked') + '"><span>' + s.dow + ' — ' + E.px(s.title) + '</span>' +
        '<span class="rp-score">' + (s.total ? s.score + '/' + s.total + (s.strike ? ' · X' : s.done ? ' ✓' : ' · rolling') : 'not started') + '</span></div>';
    });
    h += '<div class="rp-row"><span><b>SEASON</b> — ' + done + '/8 days · ' + strikes + ' strike' + (strikes === 1 ? '' : 's') + '</span><span class="rp-score">' +
      sc + '/' + tot + (tot ? ' (' + Math.round(100 * sc / tot) + '%)' : '') + '</span></div>';
    var fb = (E.progress.feedback || []).slice(-12).reverse();
    h += '<div class="s-kick" style="margin-top:18px">🧠 CONTROL-ROOM REVIEWS — what you got right, and the one thought to adjust</div>';
    if (fb.length) fb.forEach(function (f) { h += '<div class="rp-fb"><b>' + f.qid + '</b> · ' + f.text + '</div>'; });
    else h += '<div class="rp-fb">Reviews appear here when the control room analyzes a miss or a fix-this submission.</div>';
    v.innerHTML = h;
  }

  /* ── notebook + legend ───────────────────────────────────────────────── */
  function renderCards() {
    var box = $('#nb-cards');
    var cards = E.progress.cards || [];
    if (!cards.length) { box.innerHTML = '<div class="nb-empty">Finish Sunday and the first chapter card files itself here.</div>'; return; }
    box.innerHTML = cards.map(function (c) {
      return '<div class="nb-card"><h4>' + c.title + '</h4>' +
        (c.story ? '<div class="nb-story">“' + c.story + '”</div>' : '') +
        '<ul>' + c.lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
    }).join('');
  }
  function wirePanels() {
    $('#legend-body').innerHTML = window.BST.legendHTML();
    $('#go-legend').addEventListener('click', function () { $('#legend').hidden = !$('#legend').hidden; $('#notebook').hidden = true; });
    $('#go-notebook').addEventListener('click', function () { $('#notebook').hidden = !$('#notebook').hidden; $('#legend').hidden = true; renderCards(); });
    document.querySelectorAll('.panel-x').forEach(function (x) {
      x.addEventListener('click', function () { $('#' + x.getAttribute('data-x')).hidden = true; });
    });
    $('#nb-notes').addEventListener('input', function () {
      $('#nb-status').textContent = 'typing…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(function () {
        req('/notebook', { method: 'POST', body: { notes: $('#nb-notes').value } })
          .then(function () { $('#nb-status').textContent = 'saved ✓'; })
          .catch(function () { $('#nb-status').textContent = 'save failed — will retry'; });
      }, 800);
    });
    $('#go-calendar').addEventListener('click', renderCalendar);
    $('#go-report').addEventListener('click', renderReport);
  }

  /* ── attention monitor (no walking — flag pulses, caption nudges) ────── */
  var monitor = {
    q: null, answered: true, idleSec: 0, hinted: {}, wrongs: 0,
    reset: function () { monitor.q = null; monitor.answered = true; monitor.idleSec = 0; },
    onQuestion: function (q) { monitor.q = q; monitor.answered = false; monitor.idleSec = 0; $('#hintflag').classList.remove('pulse'); },
    onAnswer: function (rec) {
      monitor.answered = true;
      $('#hintflag').classList.remove('pulse');
      monitor.wrongs = rec.correct ? 0 : monitor.wrongs + 1;
      if (!rec.correct && monitor.wrongs >= 2) {
        monitor.wrongs = 0;
        setTimeout(function () { caption('Two in a row — happens to every bowler. Tap 🚩 and I\'ll give you the ten-second version of this concept.'); }, 2500);
      }
    },
    tick: function () {
      if (monitor.answered || !monitor.q || document.hidden) return;
      monitor.idleSec++;
      if (monitor.idleSec === 25 && !monitor.hinted[monitor.q.id]) {
        monitor.hinted[monitor.q.id] = 1;
        $('#hintflag').classList.add('pulse');
        caption("I can see this one's got you thinking — the good kind of stuck. The 🚩 flag has a nudge when you want it.");
      }
    }
  };
  setInterval(monitor.tick, 1000);
  ['pointermove', 'keydown', 'scroll', 'pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, function () { monitor.idleSec = 0; }, { passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && me && monitor.q && !monitor.answered) caption("Welcome back — the question's right where you left it. No clock in this league.");
  });

  function hintFor(q) {
    var c = (q && q.concept || '').toLowerCase();
    if (/alias|cop/.test(c)) return 'Arrow Rule: b = a puts two labels on ONE list — Sunday\'s hot-sauce incident. A real copy is cart[:].';
    if (/range|off-by/.test(c)) return 'The stop never plays: 1 through 10 needs range(1, 11). Same law as Monday\'s slices.';
    if (/sort|none/.test(c)) return 'In-place methods (sort, append, reverse) return None. Want a list back? sorted().';
    if (/default/.test(c)) return 'A default list in def is ONE shared bowl, built once. Default to None, build fresh inside.';
    if (/get|dict|key/.test(c)) return 'd[missing] crashes; d.get(label, fallback) never does. And `in` checks labels, not counts.';
    if (/truthiness|or-trap|membership/.test(c)) return 'Empty means false. And `x == "a" or "b"` is ALWAYS true — write x in ("a", "b").';
    if (/return|print|photo/.test(c)) return 'print is a photo; return hands back the plate. Assigned result = must return.';
    if (/slice|step/.test(c)) return 'Count the colons: [:3] stops, [::3] steps, [::-1] reverses.';
    if (/except|error|bare/.test(c)) return 'The error NAME is the diagnosis. Catch SPECIFIC exceptions — bare except is duct tape.';
    if (/floor|modulo|division/.test(c)) return '/ always floats · // floors downward (−7 // 2 = −4) · % is the remainder.';
    if (/enumerate|counting|accumulator|progress|mutation/.test(c)) return 'Loops: init totals BEFORE, make progress EVERY pass, and never delete from a list mid-loop — filter it.';
    return 'Trace it by hand with a tiny input — say each line out loud and track what every label holds NOW.';
  }

  /* ── stage interface ─────────────────────────────────────────────────── */
  function makeStage() {
    return {
      caption: caption,
      screen: function () {},
      onBoard: function (adds) { updateBoard(adds); },
      onPage: function (info) {
        $('#pg-num').textContent = E.pageLabel(info.idx);
        $('#pg-prev').disabled = !info.canPrev;
        $('#pg-next').disabled = !info.canNext;
        $('#day-pins').textContent = '🎳 ' + info.pins + '/10 pins';
        renderRail(); updateBoard([]);
        var p = info.page;
        if (p && (p.t === 'mc' || p.t === 'dd' || p.t === 'fix')) monitor.onQuestion(p);
        else monitor.reset();
      },
      onAnswer: function (rec) {
        monitor.onAnswer(rec);
        $('#pg-next').disabled = false;
        renderRail();
      },
      onDayDone: function (sum) {
        renderRail(); renderCards();
        $('#pg-next').disabled = true;
        if (api) { if (sum.strike) api.celebrate(); else api.wave(); }
        setTimeout(renderCalendar, 2600);
      },
      celebrate: function () { if (api) api.celebrate(); }
    };
  }

  /* ── Bryte, bolted down ──────────────────────────────────────────────── */
  function mountBryte() {
    api = EmceeConcept.mount({
      world: '#world', x: BRYTE_HOME.x, y: BRYTE_HOME.y, yMin: 55, yMax: 96, width: 132, scaleMin: .95,
      askLine: "Ask me anything from the week — the Arrow Rule, slices, the counting pattern, why sort returned None. Past my notes, I say so honestly."
    });
    try { if (window.Emcee && Emcee.kb) Emcee.kb.load('/ByteSizedTraining/kb/training.yaml'); } catch (e) {}
    /* bolted to the desk: any drag snaps him home, floor-walks impossible */
    document.addEventListener('pointerup', function () {
      setTimeout(function () { if (api) api.jumpTo(BRYTE_HOME.x, BRYTE_HOME.y); }, 60);
    });
  }

  /* ── boot ────────────────────────────────────────────────────────────── */
  function enterStudio(user, saved) {
    me = user; E = window.BST.Engine;
    $('#gate').hidden = true; $('#studio').hidden = false;
    $('#whoami').textContent = '🎙 ' + user.email;
    $('#signout').addEventListener('click', function (e) {
      e.preventDefault(); req('/logout', { method: 'POST' }).then(function () { location.reload(); });
    });
    E.init({ stage: makeStage(), net: net, box: $('#pagebox'), progress: saved || {} });
    wirePanels(); wirePager();
    if (saved && saved.notes) $('#nb-notes').value = saved.notes;
    mountBryte();
    $('#hintflag').addEventListener('click', function () {
      $('#hintflag').classList.remove('pulse');
      caption('🚩 ' + hintFor(monitor.q || (E.pages && E.pages[E.idx]) || {}));
    });
    $('#askbtn').addEventListener('click', function () { if (api) api.askMode(function () { api.hideTalk(); }); });

    var start = function () {
      renderCalendar();
      var open = Math.min(E.unlockedThrough(), 8);
      var d = window.BST.WEEK.days[open - 1];
      caption(open === 1 && !(E.progress.days.d1 && E.progress.days.d1.maxPage) ?
        'Welcome to the week, ' + E.you() + '. Sunday starts at the grocery store — Addy\'s already got a cart. Pick the first tile.' :
        'Welcome back, ' + E.you() + '. ' + d.dow + ' is glowing on the calendar — right where you left off.');
      setTimeout(function () { if (api) api.wave(); }, 600);
    };
    if (!E.you() || E.you() === 'you') pickName(start); else start();
  }

  window.addEventListener('load', function () {
    wireGate();
    req('/me').then(function (r) {
      if (r && r.email) {
        req('/progress').then(function (p) { enterStudio(r, p || {}); }).catch(function () { enterStudio(r, {}); });
      } else showGate();
    }).catch(function () { showGate(); });
  });
})();

/* ═══════════════════════════════════════════════════════════════════════
   BYTE SIZED TRAINING — the studio controller.
   Owns: magic-link sign-in, Mr. Bryte (concept-core rig), the big screen,
   the remote (8 channels + report), the ticker, the notebook + cheat cards,
   the color legend, and the ATTENTION MONITOR — Bryte watches where you
   are on screen (idle time on a question, repeated misses, tab switches,
   proximity zones) and walks over to help before you have to ask.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var BASE = '/api/bst';
  var api = null;      /* Bryte (concept-core api) */
  var me = null;       /* {email} */
  var currentCh = null;
  var notesTimer = null;

  /* ── network ─────────────────────────────────────────────────────────── */
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
    saveProgress: function (progress) {
      saveQueue = saveQueue.then(function () {
        return req('/progress', { method: 'POST', body: progress }).catch(function () {});
      });
      return saveQueue;
    },
    assess: function (payload) {
      return req('/assess', { method: 'POST', body: payload });
    }
  };

  /* ── sign-in gate ────────────────────────────────────────────────────── */
  function showGate(msg, isErr) {
    $('#gate').hidden = false; $('#studio').hidden = true;
    var m = $('#gate-msg');
    if (msg) { m.hidden = false; m.innerHTML = msg; m.classList.toggle('err', !!isErr); }
  }
  function wireGate() {
    var send = function () {
      var email = $('#gate-email').value.trim();
      if (!email || email.indexOf('@') === -1) return showGate('That doesn\'t look like an email — one more try.', true);
      $('#gate-send').disabled = true;
      req('/login', { method: 'POST', body: { email: email } }).then(function (r) {
        $('#gate-send').disabled = false;
        if (r.sent) showGate('📬 Magic link sent to <b>' + email + '</b> — it\'s good for 15 minutes. Check your inbox (and the spam folder; even magic gets filtered).');
        else if (r.devLink) showGate('🔧 development mode — your link: <a href="' + r.devLink + '">enter the studio</a>');
        else if (r.unknown) showGate('That email isn\'t on the guest list yet. Ask the producer (Neco) to add you.', true);
        else showGate('Something hiccuped — try again in a moment.', true);
      }).catch(function () { $('#gate-send').disabled = false; showGate('Network trouble — try again.', true); });
    };
    $('#gate-send').addEventListener('click', send);
    $('#gate-email').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  }

  /* ── the big screen ──────────────────────────────────────────────────── */
  function seg(id) {
    ['teach', 'quizbox', 'report'].forEach(function (s) { $('#' + s).classList.toggle('on', s === id); });
  }
  function screen(o) {
    seg('teach');
    $('#t-kick').textContent = o.kick || '';
    $('#t-head').textContent = o.head || '';
    $('#t-code').innerHTML = o.code ? window.BST.codeBlock(o.code) : '';
    var list = $('#t-list'); list.innerHTML = '';
    (o.list || []).forEach(function (l) { var li = document.createElement('li'); li.textContent = l; list.appendChild(li); });
    $('#t-note').textContent = o.note || '';
  }
  function lower3(kick, main) {
    $('#l3kick').textContent = kick; $('#l3main').textContent = main;
    var l3 = $('#lower3'); l3.classList.remove('in'); void l3.offsetWidth; l3.classList.add('in');
  }

  /* ── ticker: compounding reminders from finished lessons ─────────────── */
  function updateTicker() {
    var lines = ['WELCOME TO BYTE SIZED TRAINING — EIGHT CHANNELS, ONE DATASET, ZERO MERCY FOR PLANTED BUGS +++ '];
    (window.BST.Engine.progress.cards || []).forEach(function (c) {
      c.lines.slice(0, 3).forEach(function (l) { lines.push(c.title.replace(/CARD (\d+).*/, 'CH·$1') + ': ' + l.toUpperCase() + ' +++ '); });
    });
    if (lines.length === 1) lines.push('LESSON 1 IS OPEN ON THE REMOTE — THE ARROW RULE AWAITS +++ ',
      'CLICK BRYTE ANY TIME TO ASK A QUESTION +++ ', 'YOUR NOTEBOOK FILLS ITS OWN CHEAT CARDS AS YOU LEARN +++ ');
    var W = lines.join('');
    $('#tk1').textContent = W; $('#tk2').textContent = W;
  }

  /* ── remote rail ─────────────────────────────────────────────────────── */
  function unlockedThrough() {
    var n = 1;
    window.BST.LESSONS.forEach(function (l) {
      var st = window.BST.Engine.progress.lessons[l.id];
      if (st && st.done) n = Math.max(n, l.num + 1);
    });
    return n;
  }
  function renderRemote() {
    var box = $('#rm-lessons'); box.innerHTML = '';
    var open = unlockedThrough();
    window.BST.LESSONS.forEach(function (l) {
      var st = window.BST.Engine.progress.lessons[l.id];
      var b = document.createElement('button');
      b.textContent = l.chip + ' ' + (st && st.done ? '✓ ' : '') + l.title.split('—')[0].split(' & ')[0].toUpperCase().slice(0, 14);
      b.className = (currentCh === l.id ? 'on ' : '') + (st && st.done ? 'done ' : '') + (l.num > open ? 'locked' : '');
      b.addEventListener('click', function () {
        if (l.num > open) {
          api.say("That channel's still dark — finish " + 'CH·' + (l.num - 1) + " first. Compounding is the whole point: each lesson stands on the last one.");
          return;
        }
        startChannel(l.id);
      });
      box.appendChild(b);
    });
  }

  function startChannel(id) {
    currentCh = id; renderRemote();
    var l = window.BST.LESSONS.filter(function (x) { return x.id === id; })[0];
    lower3(l.chip + ' · ' + l.kick, l.title.toUpperCase() + ' — ~' + l.minutes + ' MIN');
    monitor.reset();
    api.walkTo(24, 84, function () { window.BST.Engine.startLesson(id); });
  }

  /* ── report card ─────────────────────────────────────────────────────── */
  function showReport() {
    currentCh = 'report'; renderRemote();
    seg('report');
    lower3('THE CONTROL ROOM', 'YOUR SEASON REPORT CARD');
    var E = window.BST.Engine;
    var html = '<div class="s-kick">📊 REPORT CARD · ' + (me ? me.email : '') + '</div>';
    var sum = E.summary(), doneCt = 0, sc = 0, tot = 0;
    sum.forEach(function (s) {
      if (s.done) doneCt++;
      sc += s.score; tot += s.total;
      html += '<div class="rp-row' + (s.done || s.total ? '' : ' locked') + '"><span>' + s.chip + ' — ' + s.title + '</span>' +
        '<span class="rp-score">' + (s.total ? s.score + '/' + s.total + (s.done ? ' ✓' : ' · in progress') : 'not started') + '</span></div>';
    });
    html += '<div class="rp-row"><span><b>SEASON</b> — ' + doneCt + '/8 lessons</span><span class="rp-score">' +
      sc + '/' + tot + (tot ? ' (' + Math.round(100 * sc / tot) + '%)' : '') + '</span></div>';
    var fb = (E.progress.feedback || []).slice(-12).reverse();
    if (fb.length) {
      html += '<div class="s-kick" style="margin-top:.6vw">🧠 CONTROL-ROOM REVIEWS — what you got right, and how to think about the rest</div>';
      fb.forEach(function (f) { html += '<div class="rp-fb"><b>' + f.qid + '</b> · ' + f.text + '</div>'; });
    } else {
      html += '<div class="rp-fb">No AI reviews yet — they appear here when the control room analyzes a missed answer or a fix-this submission.</div>';
    }
    $('#report').innerHTML = html;
    api.walkTo(70, 86, function () {
      api.say(doneCt === 8 ? "Eight for eight. The season's yours — this report card is the broadcast I'm proudest of." :
        "The report card. Every miss gets a written review from the control room — what you got right, and the one thought to adjust. Confidence plus correction, that's the recipe.",
        function () { api.buttons([{ l: '↩ Back to the show', g: 1, f: function () { api.hideTalk(); } }]); });
    });
  }

  /* ── notebook + legend panels ────────────────────────────────────────── */
  function renderCards() {
    var box = $('#nb-cards');
    var cards = window.BST.Engine.progress.cards || [];
    if (!cards.length) { box.innerHTML = '<div class="nb-empty">Finish lesson 1 and your first index card appears here — automatically.</div>'; return; }
    box.innerHTML = cards.map(function (c) {
      return '<div class="nb-card"><h4>' + c.title + '</h4><ul>' +
        c.lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
    }).join('');
  }
  function wirePanels() {
    $('#legend-body').innerHTML = window.BST.legendHTML();
    $('#rm-legend').addEventListener('click', function () { $('#legend').hidden = !$('#legend').hidden; $('#notebook').hidden = true; });
    $('#rm-notebook').addEventListener('click', function () { $('#notebook').hidden = !$('#notebook').hidden; $('#legend').hidden = true; renderCards(); });
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
  }

  /* ── THE ATTENTION MONITOR ───────────────────────────────────────────── */
  var monitor = {
    zone: null, question: null, answered: true, idleSec: 0,
    hinted: {}, lastMove: Date.now(), wrongs: 0,
    reset: function () { monitor.idleSec = 0; monitor.answered = true; monitor.question = null; },
    onQuestion: function (q) { monitor.question = q; monitor.answered = false; monitor.idleSec = 0; },
    onAnswer: function (rec) {
      monitor.answered = true;
      monitor.wrongs = rec.correct ? 0 : monitor.wrongs + 1;
      if (!rec.correct && monitor.wrongs >= 2) {
        monitor.wrongs = 0;
        setTimeout(function () {
          api.say("Two in a row — happens to every anchor. Want the ten-second version of this concept before the next one?", function () {
            api.buttons([
              { l: 'Yes — quick recap', p: 1, f: function () {
                  api.say(conceptRecap(rec.q), function () { api.buttons([{ l: 'Got it →', p: 1, f: function () { api.hideTalk(); } }]); });
                } },
              { l: 'No, keep rolling', g: 1, f: function () { api.hideTalk(); } }
            ]);
          });
        }, 2600);
      }
    },
    tick: function () {
      if (monitor.answered || !monitor.question || document.hidden) return;
      monitor.idleSec++;
      var q = monitor.question;
      if (monitor.idleSec === 25 && !monitor.hinted[q.id]) {
        monitor.hinted[q.id] = 1;
        /* he notices you've stalled, walks toward the screen, and offers help */
        api.walkTo(30, 78, function () {
          api.say("I can see this one's got you thinking — that's the good kind of stuck. Hint: it's a " + (q.concept || 'core') + " question. Want me to narrow it down?", function () {
            api.buttons([
              { l: 'Give me the hint', p: 1, f: function () { api.say(hintFor(q), function () { api.buttons([{ l: 'Back to it →', p: 1, f: function () { api.hideTalk(); } }]); }); } },
              { l: 'I\'ve got this', g: 1, f: function () { api.hideTalk(); } }
            ]);
          });
        });
      }
    }
  };
  function hintFor(q) {
    if (q.why) {
      /* first clause of the explanation, spoiler-trimmed */
      var first = q.why.split(/[.!]/)[0];
      return "Without giving it away: " + (first.length > 110 ? 'think about ' + (q.concept || 'the concept') + ' — say the code out loud, line by line.' : first + '.');
    }
    return "Trace it by hand with a tiny input — the answer falls out on paper.";
  }
  function conceptRecap(q) {
    var c = (q.concept || '').toLowerCase();
    if (c.indexOf('alias') !== -1 || c.indexOf('cop') !== -1) return "Arrow Rule: b = a puts two labels on ONE list. A real copy is nums[:]. If two names can see one list, an edit through either shows in both.";
    if (c.indexOf('range') !== -1 || c.indexOf('off-by-one') !== -1) return "range's stop is EXCLUDED — 1 through n needs range(1, n + 1). Same law as slices.";
    if (c.indexOf('none') !== -1 || c.indexOf('sort') !== -1) return "In-place methods — sort, reverse, append — return None. Want a value back? sorted(nums) returns a NEW list.";
    if (c.indexOf('default') !== -1) return "A default list in def is built ONCE and shared by every call. Default to None, then build a fresh list inside.";
    if (c.indexOf('get') !== -1 || c.indexOf('key') !== -1 || c.indexOf('dict') !== -1) return "d[key] crashes on a missing key; d.get(key, fallback) never does. And `in` checks KEYS.";
    if (c.indexOf('truthiness') !== -1 || c.indexOf('or-trap') !== -1) return "Empty means false: 0, \"\", [], None. And `x == 1 or 2` is ALWAYS true — write x in (1, 2).";
    if (c.indexOf('return') !== -1 || c.indexOf('print') !== -1) return "print shows; return HANDS BACK. If the caller assigns the result, the function must return — or the caller gets None.";
    if (c.indexOf('slice') !== -1 || c.indexOf('step') !== -1) return "Count the colons: [:3] stops at 3, [::3] steps by 3, [::-1] reverses. Stop is never included.";
    if (c.indexOf('except') !== -1 || c.indexOf('error') !== -1) return "Read the exception name like a headline — it names the crime. Catch SPECIFIC exceptions; bare except hides bugs.";
    return "Say the code out loud line by line, and track what each variable holds NOW. Most planted bugs surface on the second read.";
  }
  setInterval(monitor.tick, 1000);
  ['pointermove', 'keydown', 'scroll', 'pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, function () { monitor.idleSec = 0; }, { passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && me && api && monitor.question && !monitor.answered) {
      api.say("Welcome back — the question's right where you left it. No clock in this studio.");
    }
  });

  /* ── the stage interface the engine drives ───────────────────────────── */
  function makeStage() {
    return {
      say: function (t, done) { api.say(t, done); },
      screen: screen,
      chips: function (list) { api.buttons((list || []).concat([{ l: '? Ask Bryte', g: 1, f: function () { api.askMode(function () { api.hideTalk(); }); } }])); },
      celebrate: function () { api.celebrate(); },
      wave: function () { api.wave(); },
      onQuestion: function (q) { seg('quizbox'); monitor.onQuestion(q); },
      onAnswer: function (rec) { monitor.onAnswer(rec); },
      onFeedback: function (q, text) { /* lands on the report card; nudge once */ },
      hintZone: function (el) { monitor.zone = el; },
      onLessonDone: function (sum) {
        updateTicker(); renderRemote(); renderCards();
        var next = window.BST.LESSONS.filter(function (l) { return l.num === sum.lesson.num + 1; })[0];
        api.walkTo(52, 86, function () {
          api.celebrate();
          api.say(sum.pct >= 80 ?
            "That's a wrap on " + sum.lesson.chip + " — " + sum.score + " of " + sum.total + ". Your cheat card just filed itself in the notebook." + (next ? " " + next.chip + " is now live on the remote." : " And that… was the season finale. Take a bow.") :
            "A wrap on " + sum.lesson.chip + " — " + sum.score + " of " + sum.total + ". The card's in your notebook; the control room wrote up your misses on the report card. Rewatching this channel before " + (next ? next.chip : 'the finale') + " is the pro move.",
            function () {
              var chips = [];
              if (next) chips.push({ l: '▶ ' + next.chip + ' — ' + next.title.split('—')[0], p: 1, f: function () { startChannel(next.id); } });
              chips.push({ l: '📊 Report card', f: showReport });
              chips.push({ l: '↺ Replay this lesson', g: 1, f: function () { startChannel(sum.lesson.id); } });
              api.buttons(chips);
            });
        });
      }
    };
  }

  /* ── boot ────────────────────────────────────────────────────────────── */
  function enterStudio(user, saved) {
    me = user;
    $('#gate').hidden = true; $('#studio').hidden = false;
    $('#whoami').textContent = '🎙 ' + user.email;
    $('#signout').addEventListener('click', function (e) {
      e.preventDefault(); req('/logout', { method: 'POST' }).then(function () { location.reload(); });
    });

    /* Bryte takes the set */
    api = EmceeConcept.mount({
      world: '#world', x: 22, y: 84, yMin: 58, yMax: 92, width: 220, scaleMin: .6,
      askLine: "You're live — ask me anything about the Python we've covered: slices, the Arrow Rule, sort versus sorted, the counting pattern. If it's past my notes, I'll say so honestly."
    });
    /* Bryte answers from the TRAINING knowledge base */
    try { if (window.Emcee && Emcee.kb) Emcee.kb.load('/ByteSizedTraining/kb/training.yaml'); } catch (e) {}

    /* proximity zones: he offers context when you drag him near set pieces */
    api.setZones([
      { id: 'desk', x: 12, y: 86, r: 12, enter: function (a) {
          if (monitor.hinted.deskzone) return; monitor.hinted.deskzone = 1;
          a.say("My desk. The mug is decorative — I run on curiosity and a 60Hz refresh rate."); } },
      { id: 'remote', x: 90, y: 70, r: 14, enter: function (a) {
          if (monitor.hinted.remotezone) return; monitor.hinted.remotezone = 1;
          a.say("The remote: eight channels, one per lesson. They unlock in order — the quizzes compound, so each channel leans on the last."); } }
    ]);

    window.BST.Engine.init({ stage: makeStage(), net: net, box: $('#quizbox'), progress: saved || {} });

    wirePanels(); renderRemote(); updateTicker(); renderCards();
    if (saved && saved.notes) $('#nb-notes').value = saved.notes;

    var open = unlockedThrough();
    var resumeLesson = window.BST.LESSONS.filter(function (l) { return l.num === Math.min(open, 8); })[0];
    setTimeout(function () {
      api.wave();
      api.say(open === 1 ?
        "Good evening — you're LIVE on Byte Sized Training. I'm Mr. Bryte: anchor, floor manager, and the only coworker who narrates everything you learn. Eight channels on the remote, one continuing dataset, and a notebook that writes its own cheat cards. Shall we roll lesson one?" :
        "Welcome back to the studio — your progress is right where you left it. " + resumeLesson.chip + " is queued on the remote, your cards are in the notebook, and the control room kept your report card warm.",
        function () {
          api.buttons([
            { l: '▶ Roll ' + resumeLesson.chip + ' — ' + resumeLesson.title.split('—')[0], p: 1, f: function () { startChannel(resumeLesson.id); } },
            { l: '🎨 How do the colors work?', f: function () {
                $('#legend').hidden = false;
                api.say("The Legend, bottom left. One color, one meaning, everywhere in the studio: purple is Python's own words, blue is built-in tools, teal is dot-methods, gold is YOUR variables, green is text, orange is numbers. Read code by its colors and half the confusion evaporates.", function () {
                  api.buttons([{ l: '▶ Roll the lesson', p: 1, f: function () { startChannel(resumeLesson.id); } }]);
                });
              } },
            { l: '📊 Report card', g: 1, f: showReport },
            { l: "I'll look around first", g: 1, f: function () { api.hideTalk(); } }
          ]);
        });
    }, 700);

    $('#rm-report').addEventListener('click', showReport);
  }

  window.addEventListener('load', function () {
    wireGate();
    /* magic-link token in the URL? the API redirects here after setting the cookie */
    req('/me').then(function (r) {
      if (r && r.email) {
        req('/progress').then(function (p) { enterStudio(r, p || {}); })
          .catch(function () { enterStudio(r, {}); });
      } else showGate();
    }).catch(function () { showGate(); });
  });
})();

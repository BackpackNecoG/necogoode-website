/* ═══════════════════════════════════════════════════════════════════════
   EMCEE CONCEPT CORE — free-roam character engine for the /concepts pages.
   The one rule every concept obeys: BRYTE ROAMS ANYWHERE, ALWAYS.
   Zones are suggestions — proximity makes him OFFER a topic; nothing locks.

   Usage (each concept page):
     <script src="/dist/emcee.js" defer></script>          // passive: Emcee.kb
     <script src="/concepts/concept-core.js" defer></script>
     EmceeConcept.mount({ world:'#world', ... }) → api

   api:
     say(text, done, {mono})        typed speech, mouth flap
     buttons([{l,f,p,g,href}])      his choice chips (under the bubble)
     askMode(backFn)                question mode wired to Emcee.kb.answerSmart
     walkTo(xPct, yPct, cb)         he walks (waddle + depth scale); reduced → hop
     jumpTo(xPct, yPct)             instant placement
     pos()                          {x,y} in percent of world
     setZones([{id, x, y, r, enter(api), leave(api)}])   proximity suggestions
     wave() celebrate() sleep(bool) hideTalk()
     onTap(fn)                      override tap-on-him (default: askMode)
     el                             his wrapper element (for page effects)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SVG = '<svg viewBox="0 0 240 300" aria-hidden="true">' +
    '<defs>' +
    '<linearGradient id="ecc-sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dfe4ee"/></linearGradient>' +
    '<linearGradient id="ecc-shD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f5fb"/><stop offset="1" stop-color="#cfd6e4"/></linearGradient>' +
    '<linearGradient id="ecc-scr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1830"/><stop offset="1" stop-color="#0B1220"/></linearGradient>' +
    '</defs>' +
    '<ellipse class="ecc-shadow" cx="120" cy="286" rx="62" ry="9" fill="#000" opacity=".22"/>' +
    '<g class="ecc-bryte">' +
    '<g><path d="M78 178 q-30 12 -26 50" stroke="url(#ecc-shD)" stroke-width="17" fill="none" stroke-linecap="round"/><circle cx="55" cy="230" r="11" fill="url(#ecc-sh)"/><circle cx="78" cy="178" r="13" fill="url(#ecc-shD)"/></g>' +
    '<g class="ecc-armr"><path d="M162 178 q30 12 26 50" stroke="url(#ecc-shD)" stroke-width="17" fill="none" stroke-linecap="round"/><circle cx="185" cy="230" r="11" fill="url(#ecc-sh)"/><circle cx="162" cy="178" r="13" fill="url(#ecc-shD)"/></g>' +
    '<rect x="92" y="242" width="20" height="26" rx="10" fill="url(#ecc-shD)"/><rect x="128" y="242" width="20" height="26" rx="10" fill="url(#ecc-shD)"/>' +
    '<ellipse cx="102" cy="270" rx="15" ry="8" fill="url(#ecc-sh)"/><ellipse cx="138" cy="270" rx="15" ry="8" fill="url(#ecc-sh)"/>' +
    '<rect x="72" y="162" width="96" height="92" rx="34" fill="url(#ecc-sh)"/>' +
    '<circle cx="120" cy="212" r="7" fill="#1eb8cf" opacity=".9"/><circle cx="120" cy="212" r="3" fill="#dffaff"/>' +
    '<rect x="52" y="40" width="136" height="132" rx="48" fill="url(#ecc-sh)"/>' +
    '<rect x="44" y="88" width="12" height="34" rx="6" fill="url(#ecc-shD)"/><rect x="184" y="88" width="12" height="34" rx="6" fill="url(#ecc-shD)"/>' +
    '<line x1="120" y1="40" x2="120" y2="22" stroke="#cfd6e4" stroke-width="5" stroke-linecap="round"/>' +
    '<circle class="ecc-ant ecc-glow" cx="120" cy="17" r="6" fill="#38e8ff"/>' +
    '<rect x="68" y="60" width="104" height="86" rx="28" fill="url(#ecc-scr)"/>' +
    '<rect x="68" y="60" width="104" height="86" rx="28" fill="none" stroke="#39456b" stroke-width="2"/>' +
    '<g class="ecc-eyes ecc-glow"><rect x="88" y="84" width="18" height="24" rx="9" fill="#38e8ff"/><rect x="134" y="84" width="18" height="24" rx="9" fill="#38e8ff"/></g>' +
    '<g class="ecc-glow"><path class="ecc-mouthC" d="M104 124 q16 12 32 0" stroke="#38e8ff" stroke-width="5" fill="none" stroke-linecap="round"/><rect class="ecc-mouthO" x="106" y="118" width="28" height="16" rx="8" fill="#38e8ff"/></g>' +
    '<g transform="translate(120,166)"><path d="M0 0 L-14 -8 L-14 8 Z" fill="#C9A86A"/><path d="M0 0 L14 -8 L14 8 Z" fill="#C9A86A"/><circle r="4" fill="#e2c890"/></g>' +
    '</g></svg>';

  var CSS =
    '.ecc-b{position:absolute;z-index:50;cursor:grab;touch-action:none;background:none;border:none;padding:0;width:var(--ecc-w,180px)}' +
    '.ecc-b:active{cursor:grabbing}' +
    '.ecc-b:focus-visible{outline:2px solid #38e8ff;outline-offset:6px;border-radius:12px}' +
    '.ecc-b svg{width:100%;overflow:visible;display:block}' +
    '.ecc-bryte{transform-origin:120px 250px}' +
    '.ecc-awake .ecc-bryte{animation:ecc-bob 4.6s ease-in-out infinite}' +
    '@keyframes ecc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
    '.ecc-walking .ecc-bryte{animation:ecc-waddle .5s ease-in-out infinite}' +
    '@keyframes ecc-waddle{0%,100%{transform:rotate(-2.4deg) translateY(0)}50%{transform:rotate(2.4deg) translateY(-7px)}}' +
    '.ecc-eyes{transition:transform .07s}' +
    '.ecc-blink .ecc-eyes{transform:scaleY(.08);transform-origin:120px 96px}' +
    '.ecc-mouthO{opacity:0}' +
    '.ecc-talkopen .ecc-mouthO{opacity:1}.ecc-talkopen .ecc-mouthC{opacity:0}' +
    '.ecc-glow{filter:drop-shadow(0 0 5px rgba(56,232,255,.5))}' +
    '.ecc-ant{animation:ecc-pl 2.8s ease-in-out infinite}' +
    '@keyframes ecc-pl{0%,100%{opacity:.5}50%{opacity:1}}' +
    '.ecc-wave .ecc-armr{animation:ecc-wv 1.7s ease-in-out 1;transform-origin:162px 178px}' +
    '@keyframes ecc-wv{0%{transform:rotate(0)}18%{transform:rotate(-118deg)}32%{transform:rotate(-96deg)}46%{transform:rotate(-124deg)}60%{transform:rotate(-98deg)}74%{transform:rotate(-120deg)}100%{transform:rotate(0)}}' +
    '.ecc-hop .ecc-bryte{animation:ecc-hopk .8s ease-in-out 1}' +
    '@keyframes ecc-hopk{0%,100%{transform:translateY(0)}35%{transform:translateY(-22px)}60%{transform:translateY(0)}80%{transform:translateY(-9px)}}' +
    '.ecc-asleep{opacity:.9}.ecc-asleep .ecc-bryte{animation:none}.ecc-asleep .ecc-glow{filter:none}' +
    '.ecc-asleep .ecc-eyes{transform:scaleY(.14)!important;transform-origin:120px 96px}' +
    '.ecc-talk{position:absolute;z-index:60;display:none;flex-direction:column;gap:9px;width:min(360px,86vw);font-family:Urbanist,system-ui,sans-serif}' +
    '.ecc-talk.ecc-on{display:flex}' +
    '.ecc-bub{background:rgba(11,18,32,.96);border:1px solid #C9A86A;border-radius:13px;border-bottom-left-radius:2px;padding:13px 16px;font-size:14.5px;line-height:1.6;color:#EDE6D6;box-shadow:0 14px 44px rgba(0,0,0,.45)}' +
    '.ecc-who{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#C9A86A;margin-bottom:5px;display:flex;justify-content:space-between;gap:10px}' +
    '.ecc-who .ecc-tag{color:#38e8ff}' +
    '.ecc-caret{display:inline-block;width:.5em;height:1em;background:#38e8ff;vertical-align:-2px;animation:ecc-cr 1s steps(1) infinite}' +
    '@keyframes ecc-cr{50%{opacity:0}}' +
    '.ecc-mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;color:#9fe8f2}' +
    '.ecc-choices{display:flex;gap:8px;flex-wrap:wrap}' +
    '.ecc-btn{font-size:12.5px;font-weight:700;border:1px solid #C9A86A;background:rgba(11,18,32,.95);color:#EDE6D6;border-radius:16px;padding:9px 15px;cursor:pointer;font-family:Urbanist,system-ui,sans-serif}' +
    '.ecc-btn:hover{background:#C9A86A;color:#0B1220}' +
    '.ecc-btn.ecc-p{background:#C9A86A;color:#0B1220}' +
    '.ecc-btn.ecc-g{border-color:rgba(237,230,214,.2);color:#8aa0c4;font-weight:600}' +
    '.ecc-btn.ecc-g:hover{border-color:#C9A86A;color:#EDE6D6;background:transparent}' +
    '.ecc-askrow{display:none;gap:8px}' +
    '.ecc-askrow.ecc-on{display:flex}' +
    '.ecc-askrow input{flex:1;min-width:0;font-family:Urbanist,system-ui,sans-serif;font-size:13.5px;background:#131d33;border:1px solid rgba(237,230,214,.2);color:#EDE6D6;border-radius:9px;padding:10px 12px}' +
    '.ecc-askrow input:focus{border-color:#38e8ff;outline:none}' +
    '@media (prefers-reduced-motion:reduce){.ecc-awake .ecc-bryte,.ecc-walking .ecc-bryte,.ecc-ant,.ecc-caret{animation:none!important}}';

  function mount(opts) {
    opts = opts || {};
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var world = typeof opts.world === 'string' ? document.querySelector(opts.world) : opts.world;
    if (!world) throw new Error('EmceeConcept: no world');
    var yMin = opts.yMin != null ? opts.yMin : 55;   /* walkable band, % of world height (his feet) */
    var yMax = opts.yMax != null ? opts.yMax : 94;
    var scaleMin = opts.scaleMin != null ? opts.scaleMin : 0.55;
    var baseW = opts.width || 180;
    var name = opts.name || 'Mr. Bryte';

    var style = document.createElement('style');
    style.textContent = CSS; document.head.appendChild(style);

    var b = document.createElement('button');
    b.className = 'ecc-b';
    b.style.setProperty('--ecc-w', baseW + 'px');
    b.setAttribute('aria-label', name + ' — click to ask him a question; drag him anywhere');
    b.innerHTML = SVG;
    world.appendChild(b);

    var talk = document.createElement('div');
    talk.className = 'ecc-talk';
    talk.innerHTML = '<div class="ecc-bub"><div class="ecc-who"><span></span><span class="ecc-tag"></span></div>' +
      '<span class="ecc-txt"></span><span class="ecc-caret"></span></div>' +
      '<div class="ecc-choices"></div>' +
      '<div class="ecc-askrow"><input placeholder="ask me anything…"/><button class="ecc-btn ecc-p">Ask</button></div>';
    world.appendChild(talk);
    var txtEl = talk.querySelector('.ecc-txt'), chEl = talk.querySelector('.ecc-choices'),
        tagEl = talk.querySelector('.ecc-tag'), askRow = talk.querySelector('.ecc-askrow'),
        askIn = askRow.querySelector('input'), askBtn = askRow.querySelector('button');

    var st = { x: 50, y: 80, walking: false, asleep: false, awake: true, zones: [], inZone: null, tapFn: null, idleT: null };

    function wrect() { return world.getBoundingClientRect(); }
    function scaleFor(y) {
      var k = (y - yMin) / Math.max(1, (yMax - yMin));
      return scaleMin + (1 - scaleMin) * Math.min(1, Math.max(0, k));
    }
    function place() {
      var r = wrect(), s = scaleFor(st.y);
      var w = baseW * s;
      b.style.width = w + 'px';
      b.style.left = (st.x / 100 * r.width - w / 2) + 'px';
      b.style.top = (st.y / 100 * r.height - w * 1.42) + 'px';  /* feet at y */
      b.style.zIndex = String(40 + Math.round(st.y));            /* nearer = on top */
      placeTalk();
    }
    function placeTalk() {
      if (!talk.classList.contains('ecc-on')) return;
      var r = wrect(), br = b.getBoundingClientRect();
      var w = talk.offsetWidth || 340;
      var x = br.left - r.left + br.width * 0.7;
      if (x + w > r.width - 8) x = br.left - r.left - w + br.width * 0.3;
      if (x < 8) x = 8;
      var bottom = r.height - (br.top - r.top) + 12;
      if (bottom > r.height - 60) bottom = r.height - 60;
      talk.style.left = x + 'px';
      talk.style.bottom = bottom + 'px';
    }
    window.addEventListener('resize', place);

    /* speech */
    var sayT = null;
    function say(text, done, o) {
      o = o || {};
      talk.classList.add('ecc-on'); placeTalk();
      if (sayT) clearTimeout(sayT);
      b.classList.remove('ecc-talkopen');
      txtEl.className = 'ecc-txt' + (o.mono ? ' ecc-mono' : '');
      if (o.tag != null) tagEl.textContent = o.tag;
      if (reduced) { txtEl.textContent = text; if (done) done(); return; }
      var i = 0, flip = 0;
      (function stp() {
        if (i <= text.length) {
          txtEl.textContent = text.slice(0, i); i++;
          if (++flip % 3 === 0) b.classList.toggle('ecc-talkopen');
          sayT = setTimeout(stp, o.mono ? 12 : 19);
        } else { b.classList.remove('ecc-talkopen'); sayT = null; if (done) done(); }
      })();
    }
    function buttons(list) {
      chEl.innerHTML = '';
      (list || []).forEach(function (c) {
        var e = document.createElement('button');
        e.className = 'ecc-btn' + (c.p ? ' ecc-p' : '') + (c.g ? ' ecc-g' : '');
        e.textContent = c.l;
        e.onclick = c.href ? function () { location.href = c.href; } : c.f;
        chEl.appendChild(e);
      });
      placeTalk();
    }
    function hideTalk() { talk.classList.remove('ecc-on'); askRow.classList.remove('ecc-on'); }

    /* walking — full 2D, eased, depth-scaled */
    function walkTo(tx, ty, cb) {
      tx = Math.min(96, Math.max(4, tx)); ty = Math.min(yMax, Math.max(yMin, ty));
      if (reduced) { st.x = tx; st.y = ty; place(); b.classList.add('ecc-hop'); setTimeout(function(){b.classList.remove('ecc-hop');},850); if (cb) cb(); return; }
      st.walking = true; b.classList.add('ecc-walking'); hideTalk();
      var sx = st.x, sy = st.y, dx = tx - sx, dy = ty - sy;
      var dur = Math.max(450, Math.hypot(dx, dy) * 26), t0 = null;
      (function step(ts) {
        if (!t0) t0 = ts;
        var k = Math.min(1, (ts - t0) / dur);
        var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        st.x = sx + dx * e; st.y = sy + dy * e; place(); checkZones(false);
        if (k < 1) requestAnimationFrame(step);
        else { st.walking = false; b.classList.remove('ecc-walking'); if (cb) cb(); }
      })(0); requestAnimationFrame(step);
    }
    function jumpTo(x, y) { st.x = x; st.y = y; place(); }

    /* zones = suggestions, never locks */
    function checkZones(fireLeave) {
      var found = null;
      st.zones.forEach(function (z) {
        if (Math.hypot(z.x - st.x, (z.y - st.y) * 1.6) <= z.r) found = found || z;
      });
      if (found !== st.inZone) {
        if (st.inZone && st.inZone.leave) st.inZone.leave(api);
        st.inZone = found;
        if (found && found.enter) found.enter(api);
      }
    }

    /* drag anywhere + click = ask (default) */
    var drag = null;
    b.addEventListener('pointerdown', function (e) {
      if (st.asleep && !opts.allowAsleepDrag) return;
      var r = wrect();
      drag = { sx: e.clientX, sy: e.clientY, x: st.x, y: st.y, moved: false, r: r };
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      hideTalk();
      st.x = Math.min(96, Math.max(4, drag.x + dx / drag.r.width * 100));
      st.y = Math.min(yMax, Math.max(yMin, drag.y + dy / drag.r.height * 100));
      place();
    });
    b.addEventListener('pointerup', function () {
      var moved = drag && drag.moved; drag = null;
      if (st.asleep) { if (opts.onAsleepTap && !moved) opts.onAsleepTap(api); if (moved) checkZones(true); return; }
      if (moved) { checkZones(true); if (opts.onDrop) opts.onDrop(api); return; }
      (st.tapFn || askMode)();
    });
    /* click the floor → he walks there (never while a menu press) */
    world.addEventListener('pointerdown', function (e) {
      if (st.asleep || st.walking) return;
      if (e.target !== world && !e.target.classList.contains('ecc-floor')) return;
      var r = wrect();
      var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
      if (y < yMin) y = yMin;
      walkTo(x, y, function () { checkZones(true); if (opts.onWalkEnd) opts.onWalkEnd(api); });
    });

    /* life */
    (function blinkLoop() { if (reduced) return;
      setTimeout(function () { if (st.awake && !st.asleep) { b.classList.add('ecc-blink'); setTimeout(function () { b.classList.remove('ecc-blink'); }, 130); } blinkLoop(); }, 2400 + Math.random() * 2600);
    })();
    document.addEventListener('pointermove', function (e) {
      if (reduced || st.asleep) return;
      var box = b.getBoundingClientRect();
      var cx = box.left + box.width / 2, cy = box.top + box.height * 0.34;
      var dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 300)), dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 300));
      b.querySelector('.ecc-eyes').setAttribute('transform', 'translate(' + (dx * 6) + ',' + (dy * 4) + ')');
    });
    function wave() { if (reduced) return; b.classList.add('ecc-wave'); setTimeout(function () { b.classList.remove('ecc-wave'); }, 1800); }
    function celebrate() { if (reduced) return; b.classList.add('ecc-hop', 'ecc-wave'); setTimeout(function () { b.classList.remove('ecc-hop', 'ecc-wave'); }, 1800); }

    /* ask mode — the live retriever through HIM */
    var kbReady = false;
    function ensureKb() {
      if (kbReady || !window.Emcee || !Emcee.kb) return;
      if (Emcee.kb.ready()) { kbReady = true; return; }
      Emcee.kb.load('/kb/emcee.yaml').then(function () { kbReady = true; }).catch(function () {});
    }
    setTimeout(ensureKb, 1200);
    function askMode(backFn) {
      ensureKb();
      var back = typeof backFn === 'function' ? backFn : function () { hideTalk(); };
      say(opts.askLine || "Ask away — pricing, setup, where your information lives. If I don't know, I'll say so and hand you a human.", function () { /* COPY:PENDING */
        buttons([{ l: '↩ Back', g: 1, f: function () { askRow.classList.remove('ecc-on'); back(); } }]);
        askRow.classList.add('ecc-on'); placeTalk(); askIn.focus();
      }, { tag: '❓ ask me' });
      function doAsk() {
        var q = (askIn.value || '').trim(); askIn.value = '';
        if (!q) return;
        ensureKb();
        if (!window.Emcee || !Emcee.kb || !Emcee.kb.ready()) { say("One blink — still doing the reading. Try me again in a second."); return; }
        say('…thinking it over…');
        Emcee.kb.answerSmart(q).then(function (r) {
          if (r.kind === 'answer') {
            say(r.a, function () {
              buttons((r.related || []).slice(0, 2).map(function (f) {
                return { l: f.q, g: 1, f: function () { say(f.a, function () { buttons([{ l: '↩ Back', g: 1, f: back }]); askRow.classList.add('ecc-on'); }); } };
              }).concat([{ l: '↩ Back', g: 1, f: back }]));
              askRow.classList.add('ecc-on'); placeTalk();
            });
          } else if (r.kind === 'disambiguate') {
            say('I might have that — did you mean one of these?', function () {
              buttons((r.options || []).map(function (f) {
                return { l: f.q, f: function () { say(f.a, function () { buttons([{ l: '↩ Back', g: 1, f: back }]); askRow.classList.add('ecc-on'); }); } };
              }).concat([{ l: '↩ Back', g: 1, f: back }]));
              askRow.classList.add('ecc-on'); placeTalk();
            });
          } else {
            say("That one's past my notes — honestly. A human has it: me@necogoode.com.", function () {
              buttons([{ l: '✉ Email Neco', href: 'mailto:me@necogoode.com' }, { l: '↩ Back', g: 1, f: back }]);
              askRow.classList.add('ecc-on'); placeTalk();
            });
          }
        });
      }
      askBtn.onclick = doAsk;
      askIn.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doAsk(); } };
    }

    var api = {
      el: b, world: world, reduced: reduced,
      say: say, buttons: buttons, hideTalk: hideTalk, askMode: askMode,
      walkTo: walkTo, jumpTo: jumpTo,
      pos: function () { return { x: st.x, y: st.y }; },
      setZones: function (z) { st.zones = z || []; },
      currentZone: function () { return st.inZone; },
      wave: wave, celebrate: celebrate,
      sleep: function (on) { st.asleep = !!on; b.classList.toggle('ecc-asleep', !!on); b.classList.toggle('ecc-awake', !on); },
      onTap: function (fn) { st.tapFn = fn; },
      isBusy: function () { return st.walking; },
      tag: function (t) { tagEl.textContent = t || ''; }
    };
    b.classList.add('ecc-awake');
    jumpTo(opts.x != null ? opts.x : 50, opts.y != null ? opts.y : 80);
    return api;
  }

  window.EmceeConcept = { mount: mount };
})();

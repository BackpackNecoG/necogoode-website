/* ═══════════════════════════════════════════════════════════════════════
   BYTE SIZED TRAINING — THE WORLDS. Reusable venues Mr. Bryte takes
   trainees to. A world is scenery + visual kit, NOT curriculum: any
   training (Python today; Java, .NET, SQL, anything tomorrow) can book
   the same worlds and mount its own lessons inside them. Worlds render
   through generic visual builders so new trainings need zero new UI.
   BST.Worlds.get(id) · BST.Worlds.visual({type,...}) → HTML
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.BST = window.BST || {};
  var T = function (c) { return window.BST.tokenize(c); };
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  var WORLDS = {
    grocery:  { id: 'grocery',  icon: '🛒', name: 'The Grocery Run',     tag: 'SUNDAY RESET',
      blurb: 'Carts, shared shopping lists, and a budget. Where labels, lists, and the shared-list trap live.' },
    chat:     { id: 'chat',     icon: '💬', name: 'The Group Chat',      tag: 'PLANS & PLAYLISTS',
      blurb: 'Messages, invites, and the playlist. Text lives here — slicing, cleaning, and label-maker strings.' },
    kitchen:  { id: 'kitchen',  icon: '🌮', name: 'The Kitchen',         tag: 'PANTRY & PREP',
      blurb: 'Shelf labels → contents. Lookups, sealed recipe steps, and the spice rack with a no-duplicates policy.' },
    lanes:    { id: 'lanes',    icon: '🎳', name: 'Bryte Lanes',         tag: 'LEAGUE NIGHT',
      blurb: 'Frames, turns, and the scoreboard. Everything that repeats, repeats here.' },
    dinner:   { id: 'dinner',   icon: '🍳', name: 'Taco Night HQ',       tag: 'THE BIG COOK',
      blurb: 'Recipes are machines: ingredients in, plates out. Functions live in this kitchen.' },
    gamenight:{ id: 'gamenight',icon: '🃏', name: 'Game Night',          tag: 'HOUSE RULES',
      blurb: 'Cards, house rules, and judgment calls. Every yes/no decision the language can make.' },
    fixit:    { id: 'fixit',    icon: '🔧', name: 'Fix-It Saturday',     tag: 'THE TOOLBOX',
      blurb: 'Things break on Saturday. Reading what broke — and catching it before it floods — lives here.' },
    tournament:{ id:'tournament',icon:'🏆', name: 'The Tournament',      tag: 'BACK AT THE LANES',
      blurb: 'Season finale. Every world\'s lessons show up at once — plus away games on unfamiliar turf.' },
    /* ── the placeholder every Mr. Bryte deployment ships with ─────────── */
    custom:   { id: 'custom',   icon: '✨', name: 'Your World',          tag: 'CRAFT YOUR OWN', placeholder: true,
      blurb: 'Worlds are reusable sets — this same week can host Java, .NET, SQL, onboarding, anything. ' +
             'Crafting custom trainings with Mr. Bryte (your story, your worlds, your curriculum) is a standard ' +
             'Bryte capability. Talk to the producer: me@necogoode.com' }
  };

  /* ── generic visual kit — any training reuses these ─────────────────── */
  var V = {
    /* pins: {down:7} → the 10-pin rack, knocked pins dimmed */
    pins: function (o) {
      var rows = [[7,8,9,10],[4,5,6],[2,3],[1]], down = o.down || 0;
      return '<div class="vz-pins">' + rows.map(function (r) {
        return '<div>' + r.map(function (n) {
          return '<span class="' + (n <= down ? 'pin-up' : 'pin-down') + '">●</span>';
        }).join('') + '</div>';
      }).join('') + '</div>' + (o.note ? '<div class="vz-note">' + esc(o.note) + '</div>' : '');
    },
    /* scorecard: {title, head:[...], rows:[[...],...], hi:{r,c}} */
    scorecard: function (o) {
      var h = '<div class="vz-card"><div class="vz-k">' + esc(o.title || '') + '</div><table class="vz-table"><tr>' +
        o.head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr>';
      o.rows.forEach(function (row, ri) {
        h += '<tr>' + row.map(function (cell, ci) {
          var hi = o.hi && o.hi.r === ri && o.hi.c === ci;
          return '<td class="' + (hi ? 'vz-hi' : '') + '">' + esc(cell) + '</td>';
        }).join('') + '</tr>';
      });
      return h + '</table></div>';
    },
    /* chat: {msgs:[{who,txt,me}]} */
    chat: function (o) {
      return '<div class="vz-card">' + o.msgs.map(function (m) {
        return '<div class="vz-msg' + (m.me ? ' me' : '') + '"><b>' + esc(m.who) + '</b> ' + esc(m.txt) + '</div>';
      }).join('') + '</div>';
    },
    /* shelf: {title, items:{label:qty}} — pantry/dict view */
    shelf: function (o) {
      var h = '<div class="vz-card"><div class="vz-k">' + esc(o.title || '') + '</div><div class="vz-shelf">';
      Object.keys(o.items).forEach(function (k) {
        h += '<span class="vz-jar"><b>' + esc(k) + '</b>' + esc(String(o.items[k])) + '</span>';
      });
      return h + '</div></div>';
    },
    /* list: {title, items:[...], glow:idx} — paper list view */
    list: function (o) {
      var h = '<div class="vz-card vz-paper"><div class="vz-k">' + esc(o.title || '') + '</div><ul>';
      o.items.forEach(function (it, i) {
        h += '<li class="' + (i === o.glow ? 'vz-glow' : '') + '">' + esc(it) + '</li>';
      });
      return h + '</ul></div>';
    },
    /* rules: {title, lines:[...]} — house-rules card / checklist */
    rules: function (o) {
      return '<div class="vz-card"><div class="vz-k">' + esc(o.title || '') + '</div>' +
        o.lines.map(function (l) { return '<div class="vz-rule">' + esc(l) + '</div>'; }).join('') + '</div>';
    },
    /* code: {code} — tokenized snippet inside a visual slot */
    code: function (o) { return '<pre class="bst-code">' + T(o.code) + '</pre>'; }
  };

  window.BST.Worlds = {
    all: WORLDS,
    get: function (id) { return WORLDS[id] || WORLDS.custom; },
    visual: function (o) { return (o && V[o.type]) ? V[o.type](o) : ''; }
  };
})();

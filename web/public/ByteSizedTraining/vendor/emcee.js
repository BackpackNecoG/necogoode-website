/*! emcee.js v0.1.0 — the embeddable AI demo guide (Phase 1)
 *  One script tag + one tour file = a guided, narrated product demo.
 *  Zero dependencies. https://necogoode.com — me@necogoode.com
 *  Built 2026-07-18T18:47:57.344Z from: 00-core.js, 10-yaml.js, 20-skin-rig.js, 30-chrome.js, 50-tour.js, 60-targeting.js, 70-session.js, 80-interceptor.js, 90-telemetry.js, 95-knowledge.js, 97-insights.js, 98-nudge.js, 99-boot.js
 */
(function () {
'use strict';

/* ══════════ 00-core.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   00-core — namespace, utils, event bus, reduced-motion, SPA URL watch
   See docs/INTERNAL_API.md. Every other module builds on this file.
   ═══════════════════════════════════════════════════════════════════════ */

var E = {
  mod: {},                                   // module registry
  state: { skin: null, rig: null, tour: null, session: null, reduced: false },
  version: '0.1.0'
};

/* public facade */
var Emcee = window.Emcee = window.Emcee || {};
Emcee.version = E.version;

/* ── event bus ─────────────────────────────────────────────────────── */
E.bus = (function () {
  var map = {};
  return {
    on: function (evt, fn) { (map[evt] = map[evt] || []).push(fn); return fn; },
    off: function (evt, fn) {
      var a = map[evt]; if (!a) return;
      var i = a.indexOf(fn); if (i > -1) a.splice(i, 1);
    },
    emit: function (evt, data) {
      (map[evt] || []).slice().forEach(function (fn) {
        try { fn(data); } catch (e) { console.error('[emcee] handler error on', evt, e); }
      });
    }
  };
})();

/* ── utils ─────────────────────────────────────────────────────────── */
E.util = {
  qs: function (sel, root) { return (root || document).querySelector(sel); },
  qsa: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },

  el: function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  },

  clamp: function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); },

  uid: function () {
    /* crypto-random 8-char session/id token */
    var a = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(36)).slice(-2); }).join('').slice(0, 8);
  },

  sha256: function (str) {
    if (window.crypto && window.crypto.subtle) {
      var buf = new TextEncoder().encode(str);
      return window.crypto.subtle.digest('SHA-256', buf).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }
    /* insecure-context fallback: non-cryptographic hash, still never the raw value */
    var h = 5381, i;
    for (i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return Promise.resolve('djb2-' + h.toString(16));
  },

  store: {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? (fallback === undefined ? null : fallback) : JSON.parse(raw);
      } catch (e) { return fallback === undefined ? null : fallback; }
    },
    set: function (key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode etc. */ }
    },
    remove: function (key) { try { localStorage.removeItem(key); } catch (e) {} }
  },

  escapeHtml: function (s) {
    var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML;
  },

  onReady: function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
};

/* ── reduced motion (live) ─────────────────────────────────────────── */
(function () {
  var mq = matchMedia('(prefers-reduced-motion: reduce)');
  E.reduced = mq.matches;
  E.state.reduced = mq.matches;
  var onChange = function () { E.reduced = mq.matches; E.state.reduced = mq.matches; };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
})();

/* ── single injected stylesheet ────────────────────────────────────── */
E.css = (function () {
  var styleEl = null;
  return function (text) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'emcee-style';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.appendChild(document.createTextNode('\n' + text));
  };
})();

/* ── SPA URL watch: modules listen to route:changed, never patch history ── */
(function () {
  var lastPath = null;
  function current() { return location.pathname + location.search + location.hash; }
  function check() {
    var p = current();
    if (p !== lastPath) {
      lastPath = p;
      E.bus.emit('route:changed', { path: location.pathname, hash: location.hash, full: p });
    }
  }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      check();
      return r;
    };
  });
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  E.routeCheck = check; /* boot calls once after init so the first route fires */
})();


/* ══════════ 10-yaml.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   10-yaml — Emcee.yaml.parse / Emcee.yaml.stringify
   The locked tour-YAML dialect (docs/INTERNAL_API.md § 'Tour YAML dialect').
   Handles: # comments (outside quotes only), blank lines, 2-space indent,
   '- ' list items with inline first key, key: value maps, double-quoted
   strings with \" and \n escapes, unquoted scalars, ints, true/false.
   Legacy `gate: take-the-wheel` normalizes to `type: gate`.
   ROUND-TRIP GUARANTEE (DoD): parse(stringify(parse(x))) deep-equals parse(x).
   stringify's quote rule is a strict superset of every form parse treats
   specially (colon/hash/quote/newline/edge-space, plus int/bool/empty
   look-alikes), so every emitted scalar reads back as the same value.
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.yaml = (function () {

  /* ── parse ──────────────────────────────────────────────────────────── */

  function fail(msg, n) { throw new Error('emcee yaml: ' + msg + ' (line ' + n + ')'); }

  /* Strip a # comment — only when the # sits OUTSIDE double quotes and is
     at line start or preceded by whitespace (so `url: /#/tickets` survives). */
  function stripComment(line) {
    var inQ = false, i, c;
    for (i = 0; i < line.length; i++) {
      c = line.charAt(i);
      if (inQ) {
        if (c === '\\') i++;
        else if (c === '"') inQ = false;
      } else if (c === '"') {
        inQ = true;
      } else if (c === '#' && (i === 0 || line.charAt(i - 1) === ' ' || line.charAt(i - 1) === '\t')) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  /* text → [{n: 1-based source line, indent, text}] — blank/comment lines dropped */
  function lex(text) {
    var raw = String(text).split(/\r\n|\r|\n/), out = [], i, line, indent;
    for (i = 0; i < raw.length; i++) {
      line = stripComment(raw[i]);
      if (!line.trim()) continue;
      indent = 0;
      while (line.charAt(indent) === ' ') indent++;
      if (line.charAt(indent) === '\t') fail('tabs are not allowed for indentation', i + 1);
      out.push({ n: i + 1, indent: indent, text: line.slice(indent).replace(/\s+$/, '') });
    }
    return out;
  }

  function parseScalar(s, n) {
    s = s.replace(/^\s+|\s+$/g, '');
    if (s === '') return null;
    if (s.charAt(0) === '"') {
      var out = '', i = 1, c, e;
      for (;;) {
        if (i >= s.length) fail('unterminated string', n);
        c = s.charAt(i);
        if (c === '\\') {
          e = s.charAt(i + 1);
          if (e === 'n') out += '\n';
          else if (e === 't') out += '\t';
          else if (e === '"') out += '"';
          else if (e === '\\') out += '\\';
          else out += e;
          i += 2;
        } else if (c === '"') {
          if (s.slice(i + 1).replace(/^\s+|\s+$/g, '') !== '') fail('unexpected text after closing quote', n);
          return out;
        } else { out += c; i++; }
      }
    }
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    return s;
  }

  var KEY_RE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;

  function isListLine(t) { return t === '-' || (t.charAt(0) === '-' && t.charAt(1) === ' '); }

  function parseBlock(lines, pos, indent) {
    return isListLine(lines[pos.i].text) ? parseList(lines, pos, indent) : parseMap(lines, pos, indent);
  }

  /* empty value after `key:` → nested block at deeper indent, or null */
  function readValue(rest, lines, pos, indent, n) {
    if (rest !== undefined && rest.replace(/^\s+|\s+$/g, '') !== '') return parseScalar(rest, n);
    if (pos.i < lines.length && lines[pos.i].indent > indent) {
      return parseBlock(lines, pos, lines[pos.i].indent);
    }
    return null;
  }

  function parseMap(lines, pos, indent) {
    var map = {}, ln, m;
    while (pos.i < lines.length) {
      ln = lines[pos.i];
      if (ln.indent < indent) break;
      if (ln.indent > indent) fail('bad indentation', ln.n);
      if (isListLine(ln.text)) fail('unexpected list item', ln.n);
      m = KEY_RE.exec(ln.text);
      if (!m) fail('expected "key: value"', ln.n);
      pos.i++;
      map[m[1]] = readValue(m[2], lines, pos, indent, ln.n);
    }
    return map;
  }

  function parseList(lines, pos, indent) {
    var arr = [], ln, inline, itemIndent, m, item, l2, m2;
    while (pos.i < lines.length) {
      ln = lines[pos.i];
      if (ln.indent !== indent || !isListLine(ln.text)) break;
      pos.i++;
      inline = ln.text === '-' ? '' : ln.text.slice(2).replace(/^\s+/, '');
      itemIndent = indent + 2;
      if (inline === '') {
        /* bare '-' → nested block item */
        if (pos.i < lines.length && lines[pos.i].indent > indent) arr.push(parseBlock(lines, pos, lines[pos.i].indent));
        else arr.push(null);
        continue;
      }
      m = KEY_RE.exec(inline);
      if (!m) { arr.push(parseScalar(inline, ln.n)); continue; }
      /* map item — inline first key on the dash line, rest 2 deeper */
      item = {};
      item[m[1]] = readValue(m[2], lines, pos, itemIndent, ln.n);
      while (pos.i < lines.length && lines[pos.i].indent === itemIndent && !isListLine(lines[pos.i].text)) {
        l2 = lines[pos.i];
        m2 = KEY_RE.exec(l2.text);
        if (!m2) fail('expected "key: value"', l2.n);
        pos.i++;
        item[m2[1]] = readValue(m2[2], lines, pos, itemIndent, l2.n);
      }
      if (pos.i < lines.length && lines[pos.i].indent > itemIndent) fail('bad indentation', lines[pos.i].n);
      arr.push(item);
    }
    return arr;
  }

  /* legacy `gate: take-the-wheel` → canonical `type: gate` */
  function normalize(doc) {
    if (doc && Object.prototype.toString.call(doc.steps) === '[object Array]') {
      doc.steps.forEach(function (s) {
        if (s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, 'gate')) {
          delete s.gate;
          s.type = 'gate';
        }
      });
    }
    return doc;
  }

  function parse(text) {
    var lines = lex(text);
    if (!lines.length) return {};
    if (lines[0].indent !== 0) fail('document must start at column 0', lines[0].n);
    var pos = { i: 0 };
    var doc = parseBlock(lines, pos, 0);
    if (pos.i < lines.length) fail('bad indentation', lines[pos.i].n);
    return normalize(doc);
  }

  /* ── stringify (canonical form) ─────────────────────────────────────── */

  /* canonical key order for step/faq maps; top level is tour…others…steps */
  var KEY_ORDER = ['label', 'url', 'type', 'say', 'button', 'instruct', 'advance', 'faq', 'q', 'a'];
  var ALWAYS_QUOTE = { say: 1, button: 1, q: 1, a: 1 };
  var NEVER_QUOTE = { advance: 1 };             /* `advance: seconds:5` stays bare */

  function needsQuote(s) {
    return s === '' ||
      /[:#"\n\t]/.test(s) ||                     /* chars the parser treats specially */
      /^\s|\s$/.test(s) ||                       /* leading/trailing space */
      s === 'true' || s === 'false' ||           /* bool look-alikes */
      /^-?\d+$/.test(s) ||                       /* int look-alikes */
      s.charAt(0) === '-';                       /* dash-ambiguity safety */
  }

  function escapeStr(s) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  }

  function scalarText(v, key) {
    if (v === null || v === undefined) return '';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return String(v);
    var s = String(v);
    if (key && NEVER_QUOTE[key]) return s;
    if ((key && ALWAYS_QUOTE[key]) || needsQuote(s)) return escapeStr(s);
    return s;
  }

  function isScalar(v) { return v === null || v === undefined || typeof v !== 'object'; }
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function keyOrder(obj, top) {
    var keys = Object.keys(obj), out = [], i;
    if (top) {
      if (keys.indexOf('tour') > -1) out.push('tour');
      for (i = 0; i < keys.length; i++) if (keys[i] !== 'tour' && keys[i] !== 'steps') out.push(keys[i]);
      if (keys.indexOf('steps') > -1) out.push('steps');
      return out;
    }
    for (i = 0; i < KEY_ORDER.length; i++) if (keys.indexOf(KEY_ORDER[i]) > -1) out.push(KEY_ORDER[i]);
    for (i = 0; i < keys.length; i++) if (out.indexOf(keys[i]) === -1) out.push(keys[i]);
    return out;
  }

  function pad(n) { return new Array(n + 1).join(' '); }

  function writePair(key, val, indent, out) {
    if (isScalar(val)) {
      var t = scalarText(val, key);
      out.push(pad(indent) + key + ':' + (t === '' ? '' : ' ' + t));
    } else if (isArray(val)) {
      out.push(pad(indent) + key + ':');
      writeList(val, indent + 2, out);
    } else {
      out.push(pad(indent) + key + ':');
      writeMap(val, indent + 2, out, false);
    }
  }

  function writeMap(obj, indent, out, top) {
    keyOrder(obj, top).forEach(function (k) { writePair(k, obj[k], indent, out); });
  }

  function writeList(arr, indent, out) {
    arr.forEach(function (item) {
      if (isScalar(item)) {
        var t = scalarText(item, null);
        out.push(pad(indent) + '-' + (t === '' ? '' : ' ' + t));
        return;
      }
      if (isArray(item)) {                       /* not in the dialect; emitted safely anyway */
        out.push(pad(indent) + '-');
        writeList(item, indent + 2, out);
        return;
      }
      var keys = keyOrder(item, false);
      if (!keys.length) { out.push(pad(indent) + '-'); return; }
      if (isScalar(item[keys[0]])) {             /* canonical: first key inline on the dash */
        var t2 = scalarText(item[keys[0]], keys[0]);
        out.push(pad(indent) + '- ' + keys[0] + ':' + (t2 === '' ? '' : ' ' + t2));
        keys.slice(1).forEach(function (k) { writePair(k, item[k], indent + 2, out); });
      } else {
        out.push(pad(indent) + '-');
        writeMap(item, indent + 2, out, false);
      }
    });
  }

  function stringify(obj) {
    if (isScalar(obj)) return scalarText(obj, null) + '\n';
    var out = [];
    if (isArray(obj)) writeList(obj, 0, out);
    else writeMap(obj, 0, out, true);
    return out.join('\n') + '\n';
  }

  return { init: function () {}, parse: parse, stringify: stringify };
})();

/* public facade */
Emcee.yaml = { parse: E.mod.yaml.parse, stringify: E.mod.yaml.stringify };


/* ══════════ 20-skin-rig.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   20-skin-rig — skin loader + the ONE shared character rig
   Contract: docs/INTERNAL_API.md (§ Skin contract, § Rig API), spec §2.
   The rig owns BEHAVIOR only; every coordinate it animates around comes
   from the skin manifest's anchors — zero skin-specific numbers here.

   say()/walkTo() host wiring (referenced by 30-chrome and test pages):
     rig.onSay(fn)  — the host (chrome, or a test page) registers
                      fn(partialText, isDone). The rig owns typing cadence
                      (manifest.voice.cps, opts.cps override) and mouth flap
                      (manifest.voice.flapEveryNChars); it calls fn on every
                      typed character, then fn(fullText, true) once when the
                      line completes — immediately, with no flap, under
                      prefers-reduced-motion.
     rig.onWalk(fn) — the host registers fn(xPercent); rig.walkTo() plays a
                      little bounce and delegates actual box movement to the
                      host. The rig never positions the overlay itself.
   ═══════════════════════════════════════════════════════════════════════ */

var rigCssInjected = false;

function rigInjectCss() {
  if (rigCssInjected) return;
  rigCssInjected = true;
  E.css(
    /* idle bob — origin set inline per skin from manifest anchors */
    '.emcee-part-body{animation:emcee-bob 4.6s ease-in-out infinite}' +
    '@keyframes emcee-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
    /* hop (also the body half of wave, as in the mockup) */
    '.emcee-part-body.emcee-wave,.emcee-part-body.emcee-hop{animation:emcee-hop-k 1.7s ease-in-out 1}' +
    '@keyframes emcee-hop-k{0%,100%{transform:translateY(0)}20%{transform:translateY(-12px)}40%{transform:translateY(-3px)}55%{transform:translateY(-10px)}75%{transform:translateY(0)}}' +
    /* wave — right-arm rotation about the manifest shoulder anchor */
    '.emcee-wave .emcee-part-arm-r{animation:emcee-wv 1.7s ease-in-out 1}' +
    '@keyframes emcee-wv{0%{transform:rotate(0)}18%{transform:rotate(-118deg)}32%{transform:rotate(-96deg)}46%{transform:rotate(-124deg)}60%{transform:rotate(-98deg)}74%{transform:rotate(-120deg)}100%{transform:rotate(0)}}' +
    /* point poses — held until rest()/next pose; transitions eased */
    '.emcee-part-arm-l,.emcee-part-arm-r{transition:transform .35s ease}' +
    '.emcee-point-l .emcee-part-arm-l{transform:rotate(90deg)}' +
    '.emcee-point-r .emcee-part-arm-r{transform:rotate(-90deg)}' +
    '.emcee-point-u .emcee-part-arm-r{transform:rotate(-140deg)}' +
    '.emcee-point-d .emcee-part-arm-r{transform:rotate(-30deg)}' +
    /* eyes: cursor tracking transition (attribute transform) + moods */
    '.emcee-part-eyes{transition:transform .07s ease}' +
    '.emcee-part-mouth-closed{transition:transform .2s ease}' +
    '.emcee-mood-thinking .emcee-part-eyes{transform:translateY(-3px)}' +
    '.emcee-mood-thinking .emcee-part-mouth-closed{transform:scaleX(.55)}' +
    '.emcee-mood-proud .emcee-part-eyes{transform:scaleY(.72)}' +
    '.emcee-mood-happy .emcee-part-mouth-closed{transform:scaleY(1.3)}' +
    /* blink last so it wins over mood eye transforms */
    '.emcee-blink .emcee-part-eyes{transform:scaleY(.08)}' +
    /* mouth flap */
    '.emcee-part-mouth-open{opacity:0}' +
    '.emcee-talk-open .emcee-part-mouth-open{opacity:1}' +
    '.emcee-talk-open .emcee-part-mouth-closed{opacity:0}' +
    /* accent pulse (antenna tip etc.) */
    '.emcee-part-accent-glow{animation:emcee-pulse 2.8s ease-in-out infinite}' +
    '@keyframes emcee-pulse{0%,100%{opacity:.5}50%{opacity:1}}' +
    /* reduced motion: static character, poses land instantly (final states) */
    '@media (prefers-reduced-motion:reduce){' +
    '.emcee-part-body,.emcee-part-arm-l,.emcee-part-arm-r,.emcee-part-eyes,' +
    '.emcee-part-mouth-closed,.emcee-part-accent-glow{animation:none!important;transition:none!important}' +
    '}'
  );
}

function rigFail(msg) { throw new Error('[emcee] ' + msg); }

function rigValidateManifest(m, src) {
  function bad(detail) { rigFail('invalid skin manifest (' + src + '): ' + detail); }
  if (!m || typeof m !== 'object') bad('not an object');
  if (!m.name || typeof m.name !== 'string') bad('missing "name"');
  if (m.format !== 'svg' && m.format !== 'png-layers') bad('"format" must be "svg" or "png-layers"');
  if (!m.anchors || typeof m.anchors !== 'object') bad('missing "anchors"');
  ['shoulderL', 'shoulderR', 'eyeCenter', 'mouth'].forEach(function (k) {
    var v = m.anchors[k];
    if (!v || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number') {
      bad('anchors.' + k + ' must be [x, y]');
    }
  });
  if (typeof m.anchors.groundY !== 'number') bad('anchors.groundY must be a number');
  if (!m.palette || !m.palette.accent || !m.palette.trim) bad('palette needs "accent" and "trim"');
  if (!m.voice || typeof m.voice.cps !== 'number' || m.voice.cps <= 0) bad('voice.cps must be a positive number');
  if (typeof m.voice.flapEveryNChars !== 'number' || m.voice.flapEveryNChars < 1) bad('voice.flapEveryNChars must be >= 1');
}

/* (Unverified) PNG-layers skins ("format":"png-layers") are accepted by the
   contract but NOT implemented in Phase 1 — SVG is the launch path (spec §7
   risk 2: the PNG-layer path stays unverified until real layered renders are
   cut). This stub exists so the failure is loud and self-explaining instead
   of a half-mounted character. */
function rigPngLayersStub(manifest) {
  rigFail('skin "' + manifest.name + '" uses format "png-layers" — contract-accepted but not implemented in Phase 1. Use an SVG skin (art.svg); PNG-layer support lands with the first real layered-PNG skin.');
}

/* loadSkin(url) — url may be a directory ending in "/" (skin.json appended)
   or a direct skin.json URL. art.svg resolves relative to the manifest.
   → Promise<{manifest, artText}> */
function rigLoadSkin(url) {
  var manifestUrl = String(url);
  if (/\/$/.test(manifestUrl)) manifestUrl += 'skin.json';
  var abs = new URL(manifestUrl, location.href);
  var manifest = null;
  return fetch(abs.toString()).then(function (r) {
    if (!r.ok) rigFail('skin manifest fetch failed (' + r.status + '): ' + abs);
    return r.json();
  }).then(function (m) {
    manifest = m;
    rigValidateManifest(manifest, abs.toString());
    if (manifest.format === 'png-layers') rigPngLayersStub(manifest);
    var artUrl = new URL(manifest.art || 'art.svg', abs);
    return fetch(artUrl.toString());
  }).then(function (r) {
    if (!r.ok) rigFail('skin art fetch failed (' + r.status + ') for "' + manifest.name + '"');
    return r.text();
  }).then(function (artText) {
    return { manifest: manifest, artText: artText };
  });
}

/* mount(container, manifest, artText) → rigHandle */
function rigMount(container, manifest, artText) {
  rigValidateManifest(manifest, manifest && manifest.name ? manifest.name : 'inline');
  if (manifest.format === 'png-layers') rigPngLayersStub(manifest);
  rigInjectCss();

  /* palette → CSS vars the art references */
  container.style.setProperty('--emcee-accent', manifest.palette.accent);
  container.style.setProperty('--emcee-trim', manifest.palette.trim);

  /* inject the SVG inline so vars + part selection work */
  var holder = document.createElement('div');
  holder.innerHTML = artText;
  var svg = holder.querySelector('svg');
  if (!svg) rigFail('skin art for "' + manifest.name + '" has no <svg> root');
  container.appendChild(svg);

  var a = manifest.anchors;
  function part(name, required) {
    var p = svg.querySelector('[data-emcee-part="' + name + '"]');
    if (!p && required) rigFail('skin art for "' + manifest.name + '" missing required part "' + name + '"');
    if (p) p.classList.add('emcee-part-' + name);
    return p;
  }
  var body = part('body', true);
  var armL = part('arm-l', true);
  var armR = part('arm-r', true);
  var eyes = part('eyes', true);
  var mouthOpen = part('mouth-open', true);
  var mouthClosed = part('mouth-closed', true);
  part('shadow', false);
  E.util.qsa('[data-emcee-part="accent-glow"]', svg).forEach(function (g) {
    g.classList.add('emcee-part-accent-glow');
  });

  /* ALL animation geometry from manifest anchors */
  body.style.transformOrigin = ((a.shoulderL[0] + a.shoulderR[0]) / 2) + 'px ' + a.groundY + 'px';
  armL.style.transformOrigin = a.shoulderL[0] + 'px ' + a.shoulderL[1] + 'px';
  armR.style.transformOrigin = a.shoulderR[0] + 'px ' + a.shoulderR[1] + 'px';
  eyes.style.transformOrigin = a.eyeCenter[0] + 'px ' + a.eyeCenter[1] + 'px';
  mouthOpen.style.transformOrigin = a.mouth[0] + 'px ' + a.mouth[1] + 'px';
  mouthClosed.style.transformOrigin = a.mouth[0] + 'px ' + a.mouth[1] + 'px';

  var vb = svg.viewBox && svg.viewBox.baseVal;
  var eyeFrac = (vb && vb.height) ? a.eyeCenter[1] / vb.height : 0.34;

  var pointDirs = ['l', 'r', 'u', 'd'];
  var moodNames = ['happy', 'thinking', 'proud'];
  var sayHandlers = [];
  var walkHandlers = [];
  var sayTimer = null, blinkTimer = null, winkTimer = null, mini = false;

  function emitSay(partial, isDone) {
    sayHandlers.slice().forEach(function (fn) {
      try { fn(partial, isDone); } catch (e) { /* host render errors must not kill typing */ }
    });
  }

  function clearWink() {
    if (winkTimer) { clearTimeout(winkTimer); winkTimer = null; }
    var eye = eyes.lastElementChild;
    if (eye) eye.style.transform = '';
  }

  function clearPoses() {
    pointDirs.forEach(function (d) { body.classList.remove('emcee-point-' + d); });
    moodNames.forEach(function (m) { body.classList.remove('emcee-mood-' + m); });
    clearWink();
  }

  function wink() {
    var eye = eyes.lastElementChild || eyes;
    var b = null;
    try { b = eye.getBBox(); } catch (e) { /* not rendered yet */ }
    if (b) eye.style.transformOrigin = (b.x + b.width / 2) + 'px ' + (b.y + b.height / 2) + 'px';
    eye.style.transform = 'scaleY(.12)';
    winkTimer = setTimeout(function () { eye.style.transform = ''; winkTimer = null; }, 450);
  }

  var handle = {
    container: container,
    svg: svg,
    manifest: manifest,

    onSay: function (fn) { if (typeof fn === 'function') sayHandlers.push(fn); return handle; },
    onWalk: function (fn) { if (typeof fn === 'function') walkHandlers.push(fn); return handle; },

    /* typed text + mouth flap; rig owns timing, host renders via onSay */
    say: function (text, opts) {
      opts = opts || {};
      handle.stopSay();
      text = String(text == null ? '' : text);
      var done = typeof opts.done === 'function' ? opts.done : null;
      if (E.reduced) { /* live re-check: instant text, no flap */
        emitSay(text, true);
        if (done) done();
        return handle;
      }
      var cps = (opts.cps > 0) ? opts.cps : manifest.voice.cps;
      var flapN = manifest.voice.flapEveryNChars;
      var delay = Math.max(8, Math.round(1000 / cps));
      var i = 0, flip = 0;
      (function step() {
        if (i < text.length) {
          i++;
          emitSay(text.slice(0, i), false);
          if (++flip % flapN === 0) body.classList.toggle('emcee-talk-open');
          sayTimer = setTimeout(step, delay);
        } else {
          body.classList.remove('emcee-talk-open');
          sayTimer = null;
          emitSay(text, true);
          if (done) done();
        }
      })();
      return handle;
    },

    stopSay: function () {
      if (sayTimer) { clearTimeout(sayTimer); sayTimer = null; }
      body.classList.remove('emcee-talk-open');
      return handle;
    },

    wave: function () {
      if (E.reduced) return handle;
      body.classList.add('emcee-wave');
      setTimeout(function () { body.classList.remove('emcee-wave'); }, 1800);
      return handle;
    },

    hop: function () {
      if (E.reduced) return handle;
      body.classList.add('emcee-hop');
      setTimeout(function () { body.classList.remove('emcee-hop'); }, 1800);
      return handle;
    },

    /* pose held until rest()/next pose — final state survives reduced motion */
    point: function (dir) {
      if (pointDirs.indexOf(dir) === -1) return handle;
      pointDirs.forEach(function (d) { body.classList.remove('emcee-point-' + d); });
      body.classList.add('emcee-point-' + dir);
      return handle;
    },

    mood: function (m) {
      moodNames.forEach(function (n) { body.classList.remove('emcee-mood-' + n); });
      clearWink();
      if (m === 'wink') {
        if (!E.reduced) wink(); /* transient — no final state to preserve */
        return handle;
      }
      if (moodNames.indexOf(m) > -1) body.classList.add('emcee-mood-' + m);
      return handle;
    },

    /* chrome moves the box (onWalk); the rig just bounces */
    walkTo: function (xPercent) {
      var x = E.util.clamp(Number(xPercent) || 0, 0, 100);
      if (!E.reduced) handle.hop();
      walkHandlers.slice().forEach(function (fn) { try { fn(x); } catch (e) {} });
      return handle;
    },

    rest: function () {
      handle.stopSay();
      clearPoses();
      body.classList.remove('emcee-wave', 'emcee-hop', 'emcee-blink');
      return handle;
    },

    celebrate: function () {
      handle.wave(); /* wave includes the hop half, per the mockup */
      if (!E.reduced) setTimeout(function () { handle.hop(); }, 1850);
      return handle;
    },

    setMini: function (on) {
      mini = !!on;
      container.classList.toggle('emcee-rig-mini', mini);
      return handle;
    },

    destroy: function () {
      handle.stopSay();
      if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
      if (winkTimer) { clearTimeout(winkTimer); winkTimer = null; }
      document.removeEventListener('pointermove', rigTrackMove);
      if (svg.parentNode) svg.parentNode.removeChild(svg);
      return null;
    }
  };

  /* autonomous blink loop — random 2.4–5s, live reduced-motion re-check */
  (function blinkLoop() {
    blinkTimer = setTimeout(function () {
      if (!svg.isConnected) return; /* unmounted → loop dies */
      if (!E.reduced) {
        body.classList.add('emcee-blink');
        setTimeout(function () { body.classList.remove('emcee-blink'); }, 130);
      }
      blinkLoop();
    }, 2400 + Math.random() * 2600);
  })();

  /* autonomous eye cursor tracking, capped ±6px/±4px (mockup semantics) */
  function rigTrackMove(e) {
    if (!svg.isConnected) { document.removeEventListener('pointermove', rigTrackMove); return; }
    if (E.reduced) return;
    var box = container.getBoundingClientRect();
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height * eyeFrac;
    var dx = E.util.clamp((e.clientX - cx) / 300, -1, 1);
    var dy = E.util.clamp((e.clientY - cy) / 300, -1, 1);
    eyes.setAttribute('transform', 'translate(' + (dx * 6) + ',' + (dy * 4) + ')');
  }
  document.addEventListener('pointermove', rigTrackMove);

  E.bus.emit('skin:mounted', { manifest: manifest, container: container, rig: handle });
  return handle;
}

E.mod.rig = {
  loadSkin: rigLoadSkin,
  mount: rigMount
};


/* ══════════ 30-chrome.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   30-chrome — overlay chrome: character box + speech bubble, drag/park/
   persist/flip, ask panel, keyboard, shared modal shell.
   Contract: docs/INTERNAL_API.md (§ Overlay chrome). Look is a 1:1 port of
   the approved experience mockup's overlay CSS (emcee-experience-mockup.html
   lines 92–170), every class emcee- prefixed, fonts as graceful stacks —
   no font loading, the overlay inherits whatever the page ships.

   rig.onSay wiring: init() registers chrome's renderer with the rig. The
   RIG owns typing cadence + mouth flap; chrome only paints the partial
   string into the bubble text span. rig.onWalk is wired the same way —
   the rig bounces, chrome moves the whole overlay box.
   ═══════════════════════════════════════════════════════════════════════ */

var chromeCssInjected = false;

var chromeSt = {
  inited: false, manifest: null, rig: null,
  root: null, box: null, bubble: null, btEl: null, controlsEl: null,
  askEl: null, chipsEl: null, askInput: null, miniBtn: null,
  controls: [], tapFns: [], deferral: '', modalCount: 0, drag: null,
  keysWired: false
};

var CHROME_DEFAULT_DEFERRAL = 'Great question — that one’s for Neco: me@necogoode.com';

function chromeInjectCss() {
  if (chromeCssInjected) return;
  chromeCssInjected = true;
  E.css(
    '#emcee-root{position:fixed;left:18px;bottom:0;z-index:999990;display:flex;align-items:flex-end;gap:0;pointer-events:none;font-family:"Urbanist",system-ui,sans-serif}' +
    '#emcee-root.emcee-flip{flex-direction:row-reverse}' +
    '#emcee-root.emcee-flip .emcee-bubble{margin:0 -6px 96px 0;border-bottom-left-radius:12px;border-bottom-right-radius:2px}' +
    '.emcee-char-box{width:150px;flex:none;pointer-events:auto;cursor:grab;touch-action:none}' +
    '.emcee-char-box:active{cursor:grabbing}' +
    '.emcee-char-box svg{display:block;width:100%;overflow:visible}' +
    '#emcee-root.emcee-mini .emcee-bubble{display:none}' +
    '#emcee-root.emcee-mini .emcee-char-box{width:64px}' +
    '#emcee-root.emcee-mini .emcee-char-box svg{filter:drop-shadow(0 4px 14px rgba(56,232,255,.35))}' +
    '.emcee-bubble{pointer-events:auto;box-sizing:border-box;margin:0 0 96px -6px;max-width:380px;background:#0B1220;color:#EDE6D6;border:1px solid var(--emcee-trim,#C9A86A);border-radius:12px;border-bottom-left-radius:2px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.35);font-size:14.5px;line-height:1.55}' +
    '.emcee-bubble *{box-sizing:border-box}' +
    '.emcee-who-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}' +
    '.emcee-who{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--emcee-trim,#C9A86A);margin-bottom:6px}' +
    '.emcee-mini-btn{background:none;border:1px solid rgba(237,230,214,.3);color:#EDE6D6;border-radius:4px;font-size:11px;line-height:1;padding:3px 9px;cursor:pointer;flex:none}' +
    '.emcee-mini-btn:hover{border-color:var(--emcee-trim,#C9A86A);color:var(--emcee-trim,#C9A86A)}' +
    '.emcee-caret{display:inline-block;width:.5em;height:1em;background:var(--emcee-accent,#38e8ff);vertical-align:-2px;animation:emcee-cr 1s steps(1) infinite}' +
    '@keyframes emcee-cr{50%{opacity:0}}' +
    '.emcee-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}' +
    '.emcee-btn{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:12px;border:1px solid var(--emcee-trim,#C9A86A);background:transparent;color:#EDE6D6;padding:8px 13px;border-radius:6px;cursor:pointer;transition:all .15s ease}' +
    '.emcee-btn:hover{background:var(--emcee-trim,#C9A86A);color:#0B1220}' +
    '.emcee-btn.emcee-primary{background:var(--emcee-trim,#C9A86A);color:#0B1220;font-weight:700}' +
    '.emcee-btn.emcee-primary:hover{filter:brightness(1.08)}' +
    '.emcee-tagline{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:9.5px;color:#8aa0c4;margin-top:10px}' +
    '.emcee-ask{display:none;margin-top:12px;border-top:1px solid rgba(237,230,214,.15);padding-top:12px}' +
    '.emcee-ask.emcee-on{display:block}' +
    '.emcee-chip{display:inline-block;font-size:12px;border:1px solid rgba(237,230,214,.3);border-radius:16px;padding:6px 11px;margin:0 6px 6px 0;cursor:pointer;color:#cfd8e6}' +
    '.emcee-chip:hover{border-color:var(--emcee-accent,#38e8ff);color:var(--emcee-accent,#38e8ff)}' +
    '.emcee-ask-row{display:flex;gap:8px;margin-top:8px}' +
    '.emcee-ask-input{flex:1;font-family:"Urbanist",system-ui,sans-serif;font-size:13px;background:#131d33;border:1px solid rgba(237,230,214,.2);color:#EDE6D6;border-radius:6px;padding:8px 10px}' +
    /* dim helper (glow lives in 60-targeting) — below the overlay, above the page */
    '.emcee-dim::after{content:"";position:fixed;inset:0;background:rgba(11,18,32,.45);z-index:999960;pointer-events:none}' +
    /* shared modal shell — 70-session (gate) and 80-interceptor reuse this */
    '.emcee-scrim{position:fixed;inset:0;background:rgba(11,18,32,.6);z-index:999995;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Urbanist",system-ui,sans-serif}' +
    '.emcee-modal{background:#0B1220;color:#EDE6D6;border:1px solid var(--emcee-trim,#C9A86A);border-radius:14px;max-width:460px;width:100%;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.5);box-sizing:border-box}' +
    '.emcee-modal *{box-sizing:border-box}' +
    '.emcee-modal-who{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--emcee-trim,#C9A86A);margin-bottom:10px}' +
    '.emcee-modal h3{margin:0 0 8px;font-size:19px}' +
    '.emcee-modal p{font-size:14px;line-height:1.55;color:#d9d2c2;margin:0 0 10px}' +
    '.emcee-modal input{width:100%;font-family:"Urbanist",system-ui,sans-serif;font-size:14px;background:#131d33;border:1px solid rgba(237,230,214,.25);color:#EDE6D6;border-radius:8px;padding:11px 12px;margin:6px 0 4px}' +
    '.emcee-consent{font-size:11.5px;color:#8aa0c4;margin:6px 0 14px}' +
    '.emcee-modal-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}' +
    '.emcee-payload{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:12px;background:#131d33;border-left:2px solid var(--emcee-accent,#38e8ff);border-radius:0 6px 6px 0;padding:10px 12px;margin:10px 0;color:#cfe9f2;word-break:break-word}' +
    '.emcee-steps{margin:10px 0 14px;padding-left:0;list-style:none}' +
    '.emcee-steps li{font-size:13.5px;padding:5px 0 5px 22px;position:relative;color:#d9d2c2}' +
    '.emcee-steps li::before{content:"→";position:absolute;left:0;color:var(--emcee-accent,#38e8ff)}' +
    /* responsive (mockup media query) */
    '@media(max-width:700px){' +
    '#emcee-root{left:8px;right:8px}' +
    '.emcee-char-box{width:104px}' +
    '.emcee-bubble{max-width:none;flex:1;margin-bottom:70px}' +
    '}' +
    /* reduced motion: no caret blink, no transitions */
    '@media (prefers-reduced-motion:reduce){' +
    '.emcee-caret{animation:none}' +
    '#emcee-root,#emcee-root *,.emcee-scrim,.emcee-scrim *{transition:none!important}' +
    '}'
  );
}

function chromeBuildDom(manifest) {
  var el = E.util.el;
  var root = el('div', { id: 'emcee-root', 'aria-live': 'polite' });
  root.style.setProperty('--emcee-accent', manifest.palette.accent);
  root.style.setProperty('--emcee-trim', manifest.palette.trim);

  var box = el('div', { 'class': 'emcee-char-box', 'aria-hidden': 'true' });

  /* no speaker-name header — it's obvious who's talking (Neco, 2026-07-15) */
  var who = el('div', { 'class': 'emcee-who', text: '' });
  var miniBtn = el('button', {
    'class': 'emcee-mini-btn', text: '— park',
    title: 'Minimize ' + manifest.name + ' — parks right where you leave it'
  });
  var whoRow = el('div', { 'class': 'emcee-who-row' }, [who, miniBtn]);

  var btEl = el('span', { 'class': 'emcee-bt' });
  var caret = el('span', { 'class': 'emcee-caret' });
  var textEl = el('div', { 'class': 'emcee-text' }, [btEl, caret]);

  var controlsEl = el('div', { 'class': 'emcee-controls' });

  var chipsEl = el('div', { 'class': 'emcee-chips' });
  var askInput = el('input', { 'class': 'emcee-ask-input', placeholder: 'Ask me anything about this…' });
  var askSend = el('button', { 'class': 'emcee-btn', text: 'Ask' });
  var askRow = el('div', { 'class': 'emcee-ask-row' }, [askInput, askSend]);
  var askEl = el('div', { 'class': 'emcee-ask' }, [chipsEl, askRow]);

  var tagline = el('div', { 'class': 'emcee-tagline', text: 'Guided demo · powered by Emcee' });

  var bubble = el('div', { 'class': 'emcee-bubble' }, [whoRow, textEl, controlsEl, askEl, tagline]);
  root.appendChild(box);
  root.appendChild(bubble);
  document.body.appendChild(root);

  /* park → mini (head-only); tap on the parked head restores (see drag wiring) */
  miniBtn.addEventListener('click', function () {
    root.classList.add('emcee-mini');
    if (chromeSt.rig) chromeSt.rig.setMini(true);
    chromeSavePos();
    E.bus.emit('chrome:parked');
  });

  /* free-input ask → knowledge base (retrieve → confidence gate → answer,
     disambiguate, or defer). No KB loaded → deferral line, as before. */
  function chromeSetChips(pairs) {
    chromeSt.chipsEl.innerHTML = '';
    (pairs || []).forEach(function (f) {
      var c = E.util.el('span', { 'class': 'emcee-chip', text: f.q });
      c.addEventListener('click', function () {
        if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log('ask:chip', { q: f.q });
        E.mod.chrome.say(f.a);
      });
      chromeSt.chipsEl.appendChild(c);
    });
  }
  function send() {
    var q = askInput.value.trim();
    askInput.value = '';
    if (!q) return;
    var kb = E.mod.kb;
    if (!kb || !kb.ready()) {
      if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log('ask:free', { q: q });
      E.mod.chrome.say(chromeSt.deferral);
      return;
    }
    E.mod.chrome.setText('…thinking it over…'); /* COPY:PENDING */
    kb.answerSmart(q).then(function (r) {
      if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log('ask:kb', { q: q, kind: r.kind, live: !!r.live, score: Math.round((r.score || 0) * 100) / 100 });
      if (r.kind === 'answer') {
        E.mod.chrome.say(r.a);
        if (r.related && r.related.length) chromeSetChips(r.related);
      } else if (r.kind === 'disambiguate') {
        E.mod.chrome.say('I might have that — did you mean one of these?'); /* COPY:PENDING */
        chromeSetChips(r.options);
      } else {
        E.mod.chrome.say(kb.deferral() || chromeSt.deferral);
      }
    });
  }
  askSend.addEventListener('click', send);
  askInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });

  chromeSt.root = root; chromeSt.box = box; chromeSt.bubble = bubble;
  chromeSt.btEl = btEl; chromeSt.controlsEl = controlsEl; chromeSt.askEl = askEl;
  chromeSt.chipsEl = chipsEl; chromeSt.askInput = askInput; chromeSt.miniBtn = miniBtn;
}

/* position persistence — mockup lines 602–650 semantics, key 'emcee.pos' */
function chromeSavePos() {
  var r = chromeSt.root.getBoundingClientRect();
  E.util.store.set('emcee.pos', {
    left: r.left,
    bottom: Math.max(0, window.innerHeight - r.bottom),
    mini: chromeSt.root.classList.contains('emcee-mini')
  });
}

function chromeLoadPos() {
  var p = E.util.store.get('emcee.pos');
  if (p && typeof p.left === 'number') {
    chromeSt.root.style.left = E.util.clamp(p.left, 0, window.innerWidth - 90) + 'px';
    chromeSt.root.style.bottom = E.util.clamp(p.bottom || 0, 0, window.innerHeight - 140) + 'px';
    if (p.mini) {
      chromeSt.root.classList.add('emcee-mini');
      if (chromeSt.rig) chromeSt.rig.setMini(true);
    }
  }
  chromeFlipCheck();
}

/* bubble flips sides when the box center crosses the viewport midline */
function chromeFlipCheck(leftOpt) {
  if (!chromeSt.root) return;
  var left = typeof leftOpt === 'number' ? leftOpt : chromeSt.root.getBoundingClientRect().left;
  chromeSt.root.classList.toggle('emcee-flip', left > window.innerWidth * 0.5);
}

function chromeWireDrag() {
  var st = chromeSt, box = st.box, root = st.root;
  box.addEventListener('pointerdown', function (e) {
    var r = root.getBoundingClientRect();
    st.drag = { sx: e.clientX, sy: e.clientY, left: r.left, bottom: window.innerHeight - r.bottom, moved: false };
    try { box.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }
  });
  box.addEventListener('pointermove', function (e) {
    var d = st.drag;
    if (!d) return;
    var dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true; /* >6px = drag, suppresses tap */
    if (!d.moved) return;
    root.style.left = E.util.clamp(d.left + dx, 0, window.innerWidth - 90) + 'px';
    root.style.bottom = E.util.clamp(d.bottom - dy, 0, window.innerHeight - 140) + 'px';
    chromeFlipCheck();
  });
  box.addEventListener('pointerup', function () {
    var wasDrag = st.drag && st.drag.moved;
    st.drag = null;
    if (wasDrag) { chromeSavePos(); return; } /* a drag is not a click */
    if (root.classList.contains('emcee-mini')) { /* parked → tap wakes the character */
      root.classList.remove('emcee-mini');
      if (st.rig) { st.rig.setMini(false); st.rig.wave(); }
      chromeSavePos();
      /* tour renders the "Where were we?" resume controls — chrome just emits */
      E.bus.emit('chrome:restored');
      return;
    }
    st.tapFns.slice().forEach(function (fn) { try { fn(); } catch (e2) {} });
  });
  box.addEventListener('pointercancel', function () { st.drag = null; });
}

/* Enter → primary control · a/A → key:'a' · r/R → key:'r'
   Skipped while focus is in an input/textarea/contenteditable or a modal is open. */
function chromeWireKeys() {
  if (chromeSt.keysWired) return;
  chromeSt.keysWired = true;
  document.addEventListener('keydown', function (e) {
    if (chromeSt.modalCount > 0) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var hit = null;
    if (e.key === 'Enter') hit = chromeFindControl(function (c) { return !!c.primary; });
    else if (e.key === 'a' || e.key === 'A') hit = chromeFindControl(function (c) { return c.key === 'a'; });
    else if (e.key === 'r' || e.key === 'R') hit = chromeFindControl(function (c) { return c.key === 'r'; });
    if (hit) { e.preventDefault(); chromeActivate(hit); }
  });
}

function chromeFindControl(pred) {
  var list = chromeSt.controls || [];
  for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i];
  return null;
}

function chromeActivate(c) {
  E.mod.chrome.hideAsk();
  if (c && typeof c.fn === 'function') c.fn();
}

/* rig.walkTo → chrome moves the overlay box (rig only bounces) */
function chromeOnWalk(xPercent) {
  var st = chromeSt;
  if (!st.root) return;
  var w = st.box.getBoundingClientRect().width || 150;
  var target = E.util.clamp(window.innerWidth * (xPercent / 100) - w / 2, 0, window.innerWidth - 90);
  if (!E.reduced) {
    st.root.style.transition = 'left .9s ease';
    setTimeout(function () { st.root.style.transition = ''; chromeSavePos(); }, 950);
  }
  st.root.style.left = target + 'px';
  chromeFlipCheck(target);
  if (E.reduced) chromeSavePos();
}

E.mod.chrome = {

  /* init({manifest, artText}) — builds the overlay, mounts the rig into the
     character box, wires rig.onSay/onWalk, restores 'emcee.pos'. */
  init: function (opts) {
    if (chromeSt.inited) return E.mod.chrome;
    if (!document.body) {
      E.util.onReady(function () { E.mod.chrome.init(opts); });
      return E.mod.chrome;
    }
    opts = opts || {};
    if (!opts.manifest || !opts.artText) {
      throw new Error('[emcee] chrome.init needs {manifest, artText} (use E.mod.rig.loadSkin)');
    }
    chromeInjectCss();
    chromeBuildDom(opts.manifest);
    chromeSt.manifest = opts.manifest;
    chromeSt.deferral = CHROME_DEFAULT_DEFERRAL;

    chromeSt.rig = E.mod.rig.mount(chromeSt.box, opts.manifest, opts.artText);
    chromeSt.rig.onSay(function (partial) { chromeSt.btEl.textContent = partial; });
    chromeSt.rig.onWalk(chromeOnWalk);
    E.state.skin = opts.manifest;
    E.state.rig = chromeSt.rig;

    chromeWireDrag();
    chromeWireKeys();
    chromeLoadPos();
    window.addEventListener('resize', function () { chromeFlipCheck(); });

    chromeSt.inited = true;
    return E.mod.chrome;
  },

  /* instant text (no typing) */
  setText: function (t) {
    if (!chromeSt.inited) return E.mod.chrome;
    chromeSt.rig.stopSay();
    chromeSt.btEl.textContent = String(t == null ? '' : t);
    return E.mod.chrome;
  },

  /* typed speech — delegates timing + flap to the rig */
  say: function (text, opts, done) {
    if (typeof opts === 'function') { done = opts; opts = null; }
    if (!chromeSt.inited || !chromeSt.rig) { if (done) done(); return E.mod.chrome; }
    chromeSt.rig.say(text, { cps: opts && opts.cps, done: done });
    return E.mod.chrome;
  },

  /* [{label, primary?, key?, fn}] — key drives the a/r keyboard shortcuts */
  setControls: function (list) {
    chromeSt.controls = list || [];
    if (!chromeSt.controlsEl) return E.mod.chrome;
    chromeSt.controlsEl.innerHTML = '';
    chromeSt.controls.forEach(function (c) {
      var b = E.util.el('button', { 'class': 'emcee-btn' + (c.primary ? ' emcee-primary' : ''), text: c.label });
      b.addEventListener('click', function () { chromeActivate(c); });
      chromeSt.controlsEl.appendChild(b);
    });
    return E.mod.chrome;
  },

  /* per-step faq chips + free input; free questions get the deferral line */
  showAsk: function (faq, opts) {
    if (!chromeSt.inited) return E.mod.chrome;
    chromeSt.deferral = (opts && opts.deferral) || CHROME_DEFAULT_DEFERRAL;
    chromeSt.chipsEl.innerHTML = '';
    (faq || []).forEach(function (f) {
      var c = E.util.el('span', { 'class': 'emcee-chip', text: f.q });
      c.addEventListener('click', function () { E.mod.chrome.say(f.a); });
      chromeSt.chipsEl.appendChild(c);
    });
    chromeSt.askEl.classList.add('emcee-on');
    return E.mod.chrome;
  },

  hideAsk: function () {
    if (chromeSt.askEl) chromeSt.askEl.classList.remove('emcee-on');
    return E.mod.chrome;
  },

  /* tap context menu (▶ Resume · ↺ Start over · ? Ask) — tour supplies the
     items; chrome renders them into the controls row */
  contextMenu: function (items) {
    E.mod.chrome.hideAsk();
    return E.mod.chrome.setControls(items || []);
  },

  /* spotlight dim — glow itself lives in 60-targeting */
  dim: function (on) {
    document.body.classList.toggle('emcee-dim', !!on);
    return E.mod.chrome;
  },

  charBox: function () { return chromeSt.box; },
  root: function () { return chromeSt.root; },

  /* fired on non-drag pointerup when not parked (tour wires the tap-state rule) */
  onTap: function (fn) {
    if (typeof fn === 'function') chromeSt.tapFns.push(fn);
    return E.mod.chrome;
  },

  /* shared modal shell — {who, title, bodyNode, buttons:[{label, primary?, fn(api)}]}
     → {close, el}. Reused by 70-session (Gate 1) and 80-interceptor. */
  modal: function (opts) {
    opts = opts || {};
    chromeInjectCss();
    var el = E.util.el;
    var scrim = el('div', { 'class': 'emcee-scrim' });
    if (chromeSt.manifest) {
      scrim.style.setProperty('--emcee-accent', chromeSt.manifest.palette.accent);
      scrim.style.setProperty('--emcee-trim', chromeSt.manifest.palette.trim);
    }
    var m = el('div', { 'class': 'emcee-modal' });
    if (opts.who) m.appendChild(el('div', { 'class': 'emcee-modal-who', text: opts.who }));
    if (opts.title) m.appendChild(el('h3', { text: opts.title }));
    if (opts.bodyNode) m.appendChild(opts.bodyNode);
    var closed = false;
    var api = {
      el: m,
      close: function () {
        if (closed) return;
        closed = true;
        chromeSt.modalCount = Math.max(0, chromeSt.modalCount - 1);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      }
    };
    var row = el('div', { 'class': 'emcee-modal-row' });
    (opts.buttons || []).forEach(function (b) {
      var btn = el('button', { 'class': 'emcee-btn' + (b.primary ? ' emcee-primary' : ''), text: b.label });
      btn.addEventListener('click', function () { if (typeof b.fn === 'function') b.fn(api); });
      row.appendChild(btn);
    });
    m.appendChild(row);
    scrim.appendChild(m);
    document.body.appendChild(scrim);
    chromeSt.modalCount++;
    return api;
  }
};

/* public facade: Emcee.say proxies to rig+chrome */
Emcee.say = function (text, opts, done) { return E.mod.chrome.say(text, opts, done); };

/* debug surface for tests */
Emcee._debug = { rig: E.mod.rig, chrome: E.mod.chrome };


/* ══════════ 50-tour.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   50-tour — the URL-keyed tour engine (spec §3, BINDING)
   Steps advance by Next → / seconds:3|5|10 / their-click. Controls always
   offer ? Ask and ↺ Repeat. NO hidden auto-advance beyond authored seconds.
   TAP-STATE RULE (hard): a tap on the character NEVER restarts dialogue
   when the session has progress — it opens ▶ Resume · ↺ Start over · ? Ask.
   Restart is ALWAYS an explicit visitor choice.
   Progress persists to 'emcee.tour.<name>' = {step,…}; combined with the
   ?emcee= session in the URL (70-session) share links resume mid-tour, and
   multi-page navigation reloads simply resume at the persisted step.
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.tour = (function () {
  var DEFAULT_DEFERRAL = "Great question — that one's for Neco: me@necogoode.com";
  var VALID_ADVANCE = ['next', 'their-click', 'seconds:3', 'seconds:5', 'seconds:10'];

  var tour = null;            /* normalized tour object (also E.state.tour) */
  var name = 'tour';
  var index = -1;
  var started = false;
  var done = false;

  /* live step machinery */
  var waitingUrl = false;     /* current step is URL-anchored, awaiting arrival */
  var clickEl = null, clickFn = null;
  var timer = null;
  var tapHooked = false;

  /* ── small helpers ──────────────────────────────────────────────────── */

  function chrome() { return E.mod.chrome || null; }

  function log(evt, data) {
    if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log(evt, data);
  }

  function say(text, doneFn) {
    var c = chrome();
    if (c && c.say) c.say(text, {}, doneFn || function () {});
    else if (doneFn) doneFn();
  }

  function setControls(list) {
    var c = chrome();
    if (c && c.setControls) c.setControls(list);
  }

  function progressKey() { return 'emcee.tour.' + name; }
  function readProgress() { return E.util.store.get(progressKey()); }
  function saveProgress() { E.util.store.set(progressKey(), { step: index, started: started, done: done }); }

  /* ── load + normalize ───────────────────────────────────────────────── */

  function normalize(obj) {
    var t = {}, k, prevUrl = null, warned = false;
    for (k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) t[k] = obj[k]; }
    t.steps = (obj.steps || []).map(function (raw) {
      var step = {}, k2;
      for (k2 in raw) { if (Object.prototype.hasOwnProperty.call(raw, k2)) step[k2] = raw[k2]; }
      /* legacy `gate: take-the-wheel` (already handled by the parser; this
         covers plain objects handed straight to load()) */
      if (Object.prototype.hasOwnProperty.call(step, 'gate')) { delete step.gate; step.type = 'gate'; }
      if (!step.type) step.type = step.say ? 'say' : 'show';
      if (step.url === undefined || step.url === null) {
        if (prevUrl !== null) step.url = prevUrl;            /* inherit previous step's url */
      } else {
        prevUrl = step.url;
      }
      if (!step.advance) step.advance = step.type === 'click' ? 'their-click' : 'next';
      if (VALID_ADVANCE.indexOf(step.advance) === -1) {
        if (!warned) {
          warned = true;
          console.warn('[emcee] invalid advance "' + step.advance + '" — using "next" (allowed: ' + VALID_ADVANCE.join(', ') + ')');
        }
        step.advance = 'next';
      }
      if (!step.faq) step.faq = [];
      return step;
    });
    return t;
  }

  function load(urlOrObj) {
    var p = typeof urlOrObj === 'string'
      ? fetch(urlOrObj).then(function (r) {
          if (!r.ok) throw new Error('emcee: tour fetch failed (' + r.status + ') ' + urlOrObj);
          return r.text();
        }).then(function (text) { return Emcee.yaml.parse(text); })
      : Promise.resolve(urlOrObj);
    return p.then(function (obj) {
      tour = normalize(obj || {});
      name = tour.tour || 'tour';
      E.state.tour = tour;
      E.bus.emit('tour:loaded', tour);
      return tour;
    });
  }

  /* ── URL matching: exact path, prefix, hash (spec §3) ───────────────── */

  function urlMatches(u) {
    if (u === undefined || u === null || u === '') return true;
    var path = location.pathname, hash = location.hash;
    var uPath = u, uHash = '', hi = u.indexOf('#');
    if (hi > -1) { uPath = u.slice(0, hi); uHash = u.slice(hi); }
    if (uHash && !(hash === uHash || hash.indexOf(uHash) === 0)) return false;
    if (!uPath) return true;                                  /* pure-hash step url */
    if (path === uPath) return true;
    if (uPath !== '/' && path.indexOf(uPath) === 0) return true;   /* step url is a prefix */
    if (uPath === '/' && /^\/(index\.html?)?$/.test(path)) return true;
    return false;
  }

  /* ── step lifecycle ─────────────────────────────────────────────────── */

  function stopTimer() {
    if (!timer) return false;
    clearTimeout(timer);
    timer = null;
    return true;
  }

  function cleanup() {
    stopTimer();
    if (clickEl && clickFn) clickEl.removeEventListener('click', clickFn);
    clickEl = null;
    clickFn = null;
    waitingUrl = false;
    if (E.mod.target && E.mod.target.unglow) E.mod.target.unglow();
    var c = chrome();
    if (c && c.hideAsk) c.hideAsk();
  }

  function gotoStep(i) {
    if (!tour) return;
    cleanup();
    index = E.util.clamp(i, 0, tour.steps.length);
    started = true;
    if (index >= tour.steps.length) { finish(); return; }
    done = false;
    saveProgress();
    runStep();
  }

  function finish() {
    done = true;
    saveProgress();
    log('tour:done', { tour: name });
    E.bus.emit('tour:done', { tour: name });
  }

  function advance(cause) {
    log('tour:advance', { index: index, cause: cause });
    E.bus.emit('tour:advanced', { index: index, cause: cause });
    gotoStep(index + 1);
  }

  function runStep() {
    var step = tour.steps[index];
    E.bus.emit('tour:step', { index: index, step: step });
    log('tour:step', { index: index, label: step.label || '', type: step.type });
    if (step.url && !urlMatches(step.url)) { waitForUrl(step); return; }
    waitingUrl = false;
    presentStep(step);
  }

  /* ── controls (contract: Next → only for advance:next or degradation;
        ? Ask and ↺ Repeat always; Enter/A/R keys) ─────────────────────── */

  function openAsk() {
    var c = chrome();
    var step = (tour && tour.steps[index]) || null;
    log('tour:ask', { index: index });
    if (c && c.showAsk) c.showAsk((step && step.faq) || [], { deferral: (tour && tour.deferral) || DEFAULT_DEFERRAL });
  }

  function buildControls(step, forceNext) {
    var list = [];
    if (step.advance === 'next' || forceNext) {
      list.push({ label: 'Next →', primary: true, key: 'Enter', fn: function () {
        log('tour:choice', { index: index, choice: 'next' });
        advance('next');
      } });
    }
    list.push({ label: '? Ask', key: 'a', fn: function () {
      log('tour:choice', { index: index, choice: 'ask' });
      openAsk();
    } });
    list.push({ label: '↺ Repeat', key: 'r', fn: function () {
      log('tour:choice', { index: index, choice: 'repeat' });
      gotoStep(index);                                        /* re-runs say + glow */
    } });
    return list;
  }

  /* any control interaction cancels an armed countdown; after a cancel the
     Next arrow appears so the tour can never stall (spec §3) */
  function wrapControls(list, step) {
    return list.map(function (b) {
      return { label: b.label, primary: b.primary, key: b.key, fn: function () {
        if (stopTimer()) setControls(wrapControls(buildControls(step, true), step));
        b.fn();
      } };
    });
  }

  function armSeconds(step, n, base) {
    var left = n;
    var render = function () {
      /* subtle countdown chip; pressing it just cancels the timer */
      setControls(wrapControls(base, step).concat([{ label: '⏱ ' + left, fn: function () {
        stopTimer();
        log('tour:choice', { index: index, choice: 'cancel-timer' });
        setControls(wrapControls(buildControls(step, true), step));
      } }]));
    };
    var tick = function () {
      timer = setTimeout(function () {
        left--;
        if (left <= 0) { timer = null; advance('seconds'); }
        else { render(); tick(); }
      }, 1000);
    };
    render();
    tick();
  }

  function showControls(step, forceNext) {
    var sec = /^seconds:(\d+)$/.exec(step.advance || '');
    if (sec && !forceNext) armSeconds(step, parseInt(sec[1], 10), buildControls(step, false));
    else setControls(wrapControls(buildControls(step, forceNext), step));
  }

  /* ── URL-anchored steps: wait for arrival + offer navigation ─────────── */

  function navigateTo(u) {
    log('tour:navigate', { to: u });
    /* Multi-page sites reload here — that's the design: progress lives in
       localStorage, so the engine resumes at THIS step on arrival.
       Same-page hash targets just fire hashchange → route:changed. */
    location.href = u;
  }

  function waitForUrl(step) {
    waitingUrl = true;
    var line = step.instruct ||
      ('Next stop: ' + (step.label || step.url) + ' — shall we head over?');
    say(line, function () {
      if (!waitingUrl) return;                                /* arrived while typing */
      setControls(wrapControls([
        { label: 'Take me there →', primary: true, key: 'Enter', fn: function () {
          log('tour:choice', { index: index, choice: 'navigate' });
          navigateTo(step.url);
        } },
        { label: '? Ask', key: 'a', fn: openAsk },
        { label: '↺ Repeat', key: 'r', fn: function () { gotoStep(index); } }
      ], step));
    });
  }

  /* ── presenting a step whose URL already matches ────────────────────── */

  function presentStep(step) {
    if (step.type === 'gate') { presentGate(step); return; }

    var degraded = false;
    if (step.type === 'click' || step.advance === 'their-click') {
      var el = (E.mod.target && E.mod.target.resolve) ? E.mod.target.resolve(step) : null;
      if (el) {
        E.mod.target.glow(el);
        clickEl = el;
        clickFn = function () {
          clickFn = null;
          log('tour:choice', { index: index, choice: 'their-click' });
          advance('their-click');
        };
        el.addEventListener('click', clickFn, { once: true });
      } else {
        /* targeting doctrine degradation: NO error, NO stall — the dialogue
           carries the pointing and the Next arrow appears */
        degraded = true;
      }
    }
    var fin = function () { showControls(step, degraded); };
    if (step.say) say(step.say, fin);
    else fin();
  }

  function presentGate(step) {
    var at = index;
    var openGate = function () {
      if (!E.mod.session || !E.mod.session.gate) {            /* degrade to a say step */
        setControls(wrapControls(buildControls(step, true), step));
        return;
      }
      E.mod.session.gate({ consent: (tour && tour.consent) || null }).then(function (res) {
        if (at !== index || !started || !tour) return;        /* visitor moved on */
        if (res && res.passed) { advance('gate'); return; }
        /* keep-watching keeps the controls: the wheel stays offered, and
           watching stays free (gate steps default to advance: next) */
        log('tour:choice', { index: index, choice: 'keep-watching' });
        setControls(wrapControls([
          { label: '🏁 Take the wheel', primary: true, key: 'Enter', fn: openGate },
          { label: 'Next →', fn: function () {
            log('tour:choice', { index: index, choice: 'next' });
            advance('next');
          } },
          { label: '? Ask', key: 'a', fn: openAsk },
          { label: '↺ Repeat', key: 'r', fn: function () { gotoStep(index); } }
        ], step));
      });
    };
    if (step.say) say(step.say, openGate);
    else openGate();
  }

  /* ── route watching: arrival advances/unblocks (spec §3) ────────────── */

  function onRoute() {
    if (!tour || !started || done) return;
    var step = tour.steps[index];
    if (!step) return;
    if (waitingUrl) {
      if (urlMatches(step.url)) { waitingUrl = false; runStep(); }
      return;
    }
    /* their-click assist: if the click navigated, arrival at the NEXT
       step's url also advances — never leave the visitor stranded */
    if (step.advance === 'their-click') {
      var nxt = tour.steps[index + 1];
      if (nxt && nxt.url && urlMatches(nxt.url)) advance('route-arrival');
    }
  }

  /* ── start / resume / restart (tap-state rule, spec §3 — HARD) ──────── */

  function start() {
    if (!tour) return;
    var prog = readProgress();
    if (prog && prog.done && !started) {
      /* completed earlier: never auto-replay; taps open the context menu */
      started = true;
      done = true;
      index = tour.steps.length;
      return;
    }
    if (started || (prog && prog.started)) { resume(); return; }   /* progress → resume, NEVER restart */
    gotoStep(0);                                               /* zero progress → fresh greeting */
  }

  function resume() {
    if (!tour) return;
    var prog = readProgress();
    var i = prog && typeof prog.step === 'number' ? prog.step : (index >= 0 ? index : 0);
    gotoStep(Math.min(i, tour.steps.length - 1));
  }

  function restart() {
    /* ONLY reachable through an explicit visitor choice ('↺ Start over') */
    E.util.store.remove(progressKey());
    done = false;
    log('tour:choice', { choice: 'start-over' });
    gotoStep(0);
  }

  function state() {
    return {
      tour: name,
      index: index,
      total: tour ? tour.steps.length : 0,
      started: started,
      done: done
    };
  }

  function hasAnyProgress() {
    var prog = readProgress();
    return started || !!(prog && prog.started);
  }

  function onTap() {
    if (!tour) return;
    /* TAP-STATE RULE: zero progress + never started → fresh start.
       Anything else → context menu; restarting is the visitor's call. */
    if (!hasAnyProgress()) { start(); return; }
    var c = chrome();
    var items = [
      { label: '▶ Resume', primary: true, fn: function () {
        log('tour:choice', { choice: 'resume' });
        resume();
      } },
      { label: '↺ Start over', fn: restart },
      { label: '? Ask', fn: openAsk }
    ];
    if (c && c.contextMenu) c.contextMenu(items);
    else setControls(items);
  }

  function onRestored() {
    /* unparked: "Where were we?" + explicit Resume / Start-over choice */
    if (!tour) return;
    if (!hasAnyProgress()) { start(); return; }
    say("I'm back! Where were we?", function () {
      setControls([
        { label: '▶ Resume', primary: true, key: 'Enter', fn: function () {
          log('tour:choice', { choice: 'resume' });
          resume();
        } },
        { label: '↺ Start over', fn: restart },
        { label: '? Ask', key: 'a', fn: openAsk }
      ]);
    });
  }

  function hookTap() {
    if (tapHooked) return;
    var c = chrome();
    if (c && c.onTap) {
      c.onTap(onTap);
      tapHooked = true;
    }
  }

  function init() {
    E.bus.on('route:changed', onRoute);
    E.bus.on('chrome:restored', onRestored);
    hookTap();
    E.bus.on('skin:mounted', hookTap);   /* in case chrome mounts after us */
  }

  return {
    init: init,
    load: load,
    start: start,
    resume: resume,
    goto: gotoStep,
    state: state
  };
})();

/* public facade (contract: {start, resume, goto, state}) */
Emcee.tour = {
  start: E.mod.tour.start,
  resume: E.mod.tour.resume,
  goto: E.mod.tour.goto,
  state: E.mod.tour.state
};


/* ══════════ 60-targeting.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   60-targeting — E.mod.target: element targeting + glow
   Targeting doctrine (BINDING — docs/INTERNAL_API.md, spec §3):
     Tier 1  customer-owned [data-emcee] attributes (step.emcee, or the
             step's button text matching a data-emcee value verbatim).
     Tier 2  visible-text match, case/whitespace-insensitive, over
             button, a, [role=button], input[type=submit|button].
     NEVER raw CSS selectors from tour files. No recorders. Ever.
   resolve() returns Element or null — degradation is the CALLER's job
   (no glow, no error, no stall; dialogue carries the pointing).
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.target = (function () {
  var glowEl = null, cssDone = false;

  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    /* mockup .spot/.dim, emcee- prefixed; z-index sits under #emcee-root (999990) */
    E.css(
      '.emcee-spot{position:relative;z-index:999961 !important;outline:3px solid #38e8ff;outline-offset:4px;' +
      'border-radius:10px;box-shadow:0 0 0 6px rgba(56,232,255,.18),0 0 34px rgba(56,232,255,.35)}\n' +
      '.emcee-dim::after{content:"";position:fixed;inset:0;background:rgba(11,18,32,.45);z-index:999960;pointer-events:none}'
    );
  }

  function norm(s) { return String(s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase(); }

  function visible(el) {
    if (!el) return false;
    if (el.offsetParent) return true;                       /* normal flow */
    var r = el.getClientRects();                            /* fixed/other */
    return !!(r.length && r[0].width > 0 && r[0].height > 0);
  }

  /* exact attribute-value match, no selector string interpolation */
  function byAttr(v) {
    if (v === null || v === undefined || v === '') return null;
    var els = E.util.qsa('[data-emcee]'), i;
    for (i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-emcee') === String(v)) return els[i];
    }
    return null;
  }

  function resolve(step) {
    if (!step) return null;

    /* Tier 1 — [data-emcee] hooks the customer owns */
    var el = byAttr(step.emcee);
    if (el) return el;
    el = byAttr(step.button);
    if (el) return el;

    /* Tier 2 — what the button SAYS (case/whitespace-insensitive) */
    var want = norm(step.button);
    if (!want) return null;
    var cands = E.util.qsa('button, a, [role=button], input[type=submit], input[type=button]');
    var contains = null, i, c, txt;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      if (!visible(c)) continue;
      txt = norm(c.tagName === 'INPUT' ? c.value : c.textContent);
      if (!txt) continue;
      if (txt === want) return c;                           /* exact match preferred */
      if (!contains && txt.indexOf(want) > -1) contains = c;
    }
    return contains;                                        /* trimmed-contains, else null */
  }

  function glow(el) {
    if (!el) return;
    unglow();
    injectCss();
    el.classList.add('emcee-spot');
    document.body.classList.add('emcee-dim');
    try {
      el.scrollIntoView({ block: 'center', behavior: E.reduced ? 'auto' : 'smooth' });
    } catch (e) {
      el.scrollIntoView();
    }
    glowEl = el;
  }

  function unglow() {
    if (glowEl) glowEl.classList.remove('emcee-spot');
    document.body.classList.remove('emcee-dim');
    glowEl = null;
  }

  return { init: function () {}, resolve: resolve, glow: glow, unglow: unglow };
})();


/* ══════════ 70-session.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   70-session — session id, Gate 1 (email), provisioner stub
   docs/INTERNAL_API.md § 'Session & Gate' + spec §8.
   Session id: URL ?emcee= param wins (shareable links), else localStorage
   'emcee.session', else null. ensure() mints via E.util.uid(), persists,
   serializes ?emcee={id} into the URL, emits 'session:created'.
   PRIVACY (hard rule, spec §8): the visitor's raw email NEVER touches
   localStorage, the console, or telemetry. Only its SHA-256 hash is kept.
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.session = (function () {
  var STORE_KEY = 'emcee.session';
  var DEFAULT_CONSENT = 'By continuing you agree the site owner may contact you about this demo. ' +
    'Session data auto-deletes when your session expires.';
  var cssDone = false;

  function fromUrl() {
    var m = /[?&]emcee=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* id(): URL param first (share links win), then stored record, else null */
  function id() {
    var u = fromUrl();
    if (u) return u;
    var rec = E.util.store.get(STORE_KEY);
    return (rec && rec.id) || null;
  }

  function serialize(sid) {
    try {
      var u = new URL(location.href);
      if (u.searchParams.get('emcee') === sid) return;
      u.searchParams.set('emcee', sid);
      /* triggers 00-core's patched replaceState → route:changed; the path is
         unchanged, so tour URL matching is unaffected — by design */
      history.replaceState(history.state, '', u.toString());
    } catch (e) { /* about:blank / opaque origins — session still works locally */ }
  }

  function ensure() {
    var existing = id();
    if (existing) {
      var rec = E.util.store.get(STORE_KEY);
      if (!rec || rec.id !== existing) E.util.store.set(STORE_KEY, { id: existing, ts: Date.now() });
      E.state.session = E.state.session || {};
      E.state.session.id = existing;
      serialize(existing);
      return existing;
    }
    var sid = E.util.uid();
    E.util.store.set(STORE_KEY, { id: sid, ts: Date.now() });
    E.state.session = { id: sid };
    serialize(sid);
    E.bus.emit('session:created', { id: sid });
    return sid;
  }

  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    E.css(
      '.emcee-gate-line{font-size:14px;line-height:1.55;color:#d9d2c2;margin:0 0 10px}\n' +
      '.emcee-gate-email{width:100%;box-sizing:border-box;font-family:inherit;font-size:14px;background:#131d33;' +
      'border:1px solid rgba(237,230,214,.25);color:#EDE6D6;border-radius:8px;padding:11px 12px;margin:6px 0 4px}\n' +
      '.emcee-gate-consent{font-size:11.5px;color:#8aa0c4;margin:6px 0 14px}\n' +
      ".emcee-gate-status{display:none;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#38e8ff;margin-top:8px}\n" +
      '.emcee-gate-status.emcee-on{display:block}'
    );
  }

  /* ── Gate 1: "Take the wheel" email gate ──────────────────────────────
     gate(opts) → Promise<{passed:boolean, emailHash?:string}>.
     Consent line precedence: opts.consent → tour-level `consent:` → default. */
  function gate(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var c = E.mod.chrome;
      if (!c || !c.modal) { resolve({ passed: false }); return; }   /* chrome not mounted → degrade */
      injectCss();

      var skinName = (E.state.skin && E.state.skin.name) || 'Mr. Bryte';
      var consent = opts.consent || (E.state.tour && E.state.tour.consent) || DEFAULT_CONSENT;

      var input = E.util.el('input', {
        type: 'email', 'class': 'emcee-gate-email', placeholder: 'you@company.com',
        autocomplete: 'email', 'aria-label': 'Your email'
      });
      var status = E.util.el('div', { 'class': 'emcee-gate-status' });
      var body = E.util.el('div', {}, [
        E.util.el('p', {
          'class': 'emcee-gate-line',
          text: "I'll set you up with your own workspace — a real user account, minted just for you. " +
            'Where should I send your session link?'
        }),
        input,
        E.util.el('div', { 'class': 'emcee-gate-consent', text: consent }),
        status
      ]);

      var settled = false, busy = false, handle;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (handle && handle.close) handle.close();
        resolve(result);
      }

      /* ── PHASE2:WIRE — server-minted session ────────────────────────────
         This whole handler is the Phase-1 local stub. In Phase 2 the email
         goes to POST /session, the server mints the session keyed to the
         email, and the lead record lives in the CUSTOMER's database
         (resident-only data plane). The local flow below keeps the exact
         same seams: hash → provision → gate:passed. */
      function onGo() {
        if (busy) return;
        var email = (input.value || '').replace(/^\s+|\s+$/g, '');
        if (!email || email.indexOf('@') < 1) { input.focus(); return; }
        busy = true;
        status.classList.add('emcee-on');
        status.textContent = '→ minting your workspace…';
        /* PRIVACY — LOUD AND CLEAR: `email` is a transient local variable.
           It is NEVER stored (localStorage gets only the SHA-256 hash),
           NEVER console.logged, NEVER handed to telemetry. Ever. */
        E.util.sha256(email).then(function (hash) {
          var sid = ensure();
          var rec = E.util.store.get(STORE_KEY) || { id: sid, ts: Date.now() };
          rec.emailHash = hash;                    /* hash only — never the raw email */
          E.util.store.set(STORE_KEY, rec);
          return Emcee.provisioner.createDemoUser(email).then(function (res) {
            status.textContent = '✓ workspace ready — ' + res.userId;
            E.state.session = { id: sid, emailHash: hash, userId: res.userId };
            if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log('gate:passed', { userId: res.userId });
            E.bus.emit('gate:passed', { emailHash: hash });
            setTimeout(function () { finish({ passed: true, emailHash: hash }); }, E.reduced ? 0 : 500);
          });
        })['catch'](function () {
          busy = false;
          status.textContent = 'hmm — that didn’t take. Try again?';
        });
      }

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); onGo(); }
      });

      handle = c.modal({
        who: skinName,
        title: 'Take the wheel 🏁',
        bodyNode: body,
        buttons: [
          { label: 'Create my workspace →', primary: true, fn: onGo },
          { label: 'Just keep watching', fn: function () {
            if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log('gate:declined', {});
            finish({ passed: false });
          } }
        ]
      });
      E.bus.emit('gate:open', {});
      if (E.mod.telemetry && E.mod.telemetry.log) E.mod.telemetry.log('gate:open', {});
      try { input.focus(); } catch (e) {}
    });
  }

  function init() {
    /* boot adoption: a shared link's ?emcee= wins over any stored session */
    var u = fromUrl();
    if (u) {
      var rec = E.util.store.get(STORE_KEY);
      if (!rec || rec.id !== u) E.util.store.set(STORE_KEY, { id: u, ts: Date.now() });
      E.state.session = { id: u, emailHash: (rec && rec.id === u && rec.emailHash) || undefined };
    } else {
      var rec2 = E.util.store.get(STORE_KEY);
      if (rec2 && rec2.id) E.state.session = { id: rec2.id, emailHash: rec2.emailHash };
    }
  }

  return { init: init, id: id, ensure: ensure, gate: gate };
})();

/* public facade */
Emcee.session = { id: E.mod.session.id, ensure: E.mod.session.ensure };

/* ── provisioner stub ────────────────────────────────────────────────────
   PHASE3: Model P — real user API call. See DEMO_ACCOUNT_CHECKLIST.md.
   Phase 3 replaces the body with a call to the customer's user-creation
   API (vault-stored provisioner credential, server-side): mint
   demo-{sessionId}, assign the customer-authored "Demo Visitor" role,
   TTL-deactivate on expiry. The signature below is the locked interface. */
Emcee.provisioner = {
  createDemoUser: function (email) {
    /* STUB — `email` is accepted per the Phase-3 interface but is NOT used,
       NOT stored, and NOT logged here (privacy rule, spec §8). */
    void email;
    var sid = (E.mod.session && E.mod.session.id()) || E.util.uid();
    return new Promise(function (resolve) {
      setTimeout(function () { resolve({ userId: 'demo-' + sid }); }, E.reduced ? 0 : 600);
    });
  }
};


/* ══════════ 80-interceptor.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   80-interceptor — Emcee.intercept: hold → explain → checkpoint → release
   Spec §4 (signature LOCKED) · INTERNAL_API.md "Interceptor (80)".
   Wraps window.fetch + XMLHttpRequest.prototype.open/send exactly once,
   on the FIRST registration; also intercepts <form data-emcee-intercept>.
   ═══════════════════════════════════════════════════════════════════════ */

/* PHASE3: credentials model — customer-provided demo credentials to THEIR
   test environment, vault-stored server-side, never shipped client-side.
   We log in with what they provide; scoping is their call — coached via
   DEMO_ACCOUNT_CHECKLIST.md (least-privilege demo account, disable
   outbound email/webhooks, scheduled reset recipe, why each matters).
   We do not architect for their failure; we teach. */

/* Model S (spec §8, in the contract from day one): `tag(sessionId, payload)`
   on every intercepted create-payload + client-side list filtering by the
   same tag IS the shared-environment concurrency answer. Honest framing:
   cosmetic scoping for showroom cleanliness, not security isolation. */

E.mod.interceptor = (function () {
  var configs = [];
  var installed = false;
  var releasing = null;   /* cfg whose release is in flight (form path) */
  var warned = false;
  var DEFERRAL = 'Great question — that one\'s for Neco: me@necogoode.com';

  E.css(
    '.emcee-int-payload{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
    'font-size:12px;background:#131d33;border-left:2px solid var(--emcee-accent,#38e8ff);' +
    'border-radius:0 6px 6px 0;padding:10px 12px;margin:10px 0;color:#cfe9f2;' +
    'word-break:break-word;white-space:pre-wrap}' +
    '.emcee-int-lines{margin:10px 0 4px;padding-left:0;list-style:none}' +
    '.emcee-int-lines li{font-size:13.5px;line-height:1.45;padding:5px 0 5px 22px;' +
    'position:relative;color:#d9d2c2}' +
    '.emcee-int-lines li::before{content:"\\2192";position:absolute;left:0;' +
    'color:var(--emcee-accent,#38e8ff)}' +
    '.emcee-int-defer{display:none;font-size:13px;color:#d9d2c2;' +
    'border-top:1px dashed rgba(237,230,214,.25);padding-top:10px;margin-top:10px}' +
    '.emcee-int-defer.emcee-on{display:block}'
  );

  function chromeMod() { return E.mod.chrome || null; }

  function warnOnce() {
    if (warned) return;
    warned = true;
    console.warn('[emcee] interceptor: chrome module unavailable — matched requests pass through untouched');
  }

  function sessionId() {
    return (E.mod.session && E.mod.session.id && E.mod.session.id()) || null;
  }

  function guideName() {
    var s = E.state.skin;
    return (s && (s.name || (s.manifest && s.manifest.name))) || 'Your guide';
  }

  function tele(evt, data) {
    if (E.mod.telemetry) E.mod.telemetry.log(evt, data);
  }

  /* ── matching: url substring/prefix + method (default POST) ───────── */
  function findConfig(url, method) {
    var m = String(method || 'GET').toUpperCase();
    for (var i = 0; i < configs.length; i++) {
      var c = configs[i];
      if (m !== String((c.match && c.match.method) || 'POST').toUpperCase()) continue;
      var u = (c.match && c.match.url) || '';
      if (u && String(url || '').indexOf(u) !== -1) return c;
    }
    return null;
  }

  /* ── payload capture / re-serialization ────────────────────────────── */
  function capture(body) {
    if (body === undefined || body === null) return { kind: 'empty', payload: {} };
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var obj = {};
      body.forEach(function (v, k) { obj[k] = v; });
      return { kind: 'form', payload: obj };
    }
    if (typeof body === 'string') {
      try { return { kind: 'json', payload: JSON.parse(body) }; }
      catch (e) { return { kind: 'string', payload: body }; }
    }
    return { kind: 'other', payload: body };
  }

  function serialize(kind, value) {
    if (kind === 'json') return JSON.stringify(value);
    if (kind === 'form') {
      var fd = new FormData();
      Object.keys(value || {}).forEach(function (k) { fd.append(k, value[k]); });
      return fd;
    }
    if (kind === 'string') return typeof value === 'string' ? value : JSON.stringify(value);
    return undefined;   /* empty/other: keep the original body untouched */
  }

  function defaultDisplay(info) {
    var p = info.payload;
    var body = typeof p === 'string' ? p : JSON.stringify(p);
    return info.method + ' ' + info.url + '  ' + body;
  }

  function abortError() {
    var err;
    try { err = new DOMException('Emcee checkpoint: the visitor chose not to send this request.', 'AbortError'); }
    catch (e) {
      err = new Error('Emcee checkpoint: the visitor chose not to send this request.');
      err.name = 'AbortError';
    }
    return err;
  }

  /* ── hold: explain, then checkpoint modal; the request stays pending ── */
  function hold(cfg, info, io) {
    E.bus.emit('intercept:hold', { url: info.url, method: info.method, via: info.via });
    tele('intercept:hold', { url: info.url, method: info.method, via: info.via });
    /* PHASE3: tiered answer system replaces scripted explain() text */
    Promise.resolve()
      .then(function () { return cfg.explain ? cfg.explain(info.payload) : null; })
      .then(function (exp) { showCheckpoint(cfg, info, exp || {}, io); })
      .catch(function () { showCheckpoint(cfg, info, {}, io); });
  }

  function showCheckpoint(cfg, info, exp, io) {
    var ch = chromeMod();
    var labels = cfg.checkpoint || ['Send it', 'Change it', 'Ask'];
    var body = E.util.el('div', { 'class': 'emcee-int-body' }, [
      E.util.el('div', { 'class': 'emcee-int-payload', text: exp.payload || defaultDisplay(info) })
    ]);
    if (exp.lines && exp.lines.length) {
      var ul = E.util.el('ul', { 'class': 'emcee-int-lines' });
      exp.lines.forEach(function (l) { ul.appendChild(E.util.el('li', { text: String(l) })); });
      body.appendChild(ul);
    }
    var defer = E.util.el('div', { 'class': 'emcee-int-defer' });
    body.appendChild(defer);

    var handle = null;
    var buttons = [{
      label: labels[0] || 'Send it',
      primary: true,
      fn: function () {
        if (handle) handle.close();
        commit(cfg, info, io);
      }
    }];
    if (labels[1]) buttons.push({
      label: labels[1],
      fn: function () {
        /* cancel/change: close, reject/return — the caller form gets control back */
        if (handle) handle.close();
        tele('intercept:change', { url: info.url, method: info.method, via: info.via });
        io.cancel();
      }
    });
    if (labels[2]) buttons.push({
      label: labels[2],
      fn: function () {
        /* Ask never releases or cancels — the request stays held */
        tele('intercept:ask', { url: info.url, method: info.method, via: info.via });
        var faq = null;
        try { faq = E.state.tour && E.state.tour.step && E.state.tour.step.faq; } catch (e) {}
        if (E.state.tour && ch && ch.showAsk) {
          ch.showAsk(faq || []);
          defer.textContent = 'Ask panel is open in my bubble — I\'ll hold this right here until you decide.';
        } else {
          defer.textContent = DEFERRAL;
        }
        defer.classList.add('emcee-on');
      }
    });

    handle = ch.modal({
      who: guideName() + ' · before this goes through…',
      title: exp.title || 'Here\'s what\'s about to happen',
      bodyNode: body,
      buttons: buttons
    });
  }

  /* ── commit: tag (Model S), release the ORIGINAL request ───────────── */
  function commit(cfg, info, io) {
    var sid = sessionId();
    var payload = info.payload;
    var tagged = false;
    if (cfg.tag && sid) {
      try {
        var out = cfg.tag(sid, payload);
        if (out !== undefined && out !== null) { payload = out; tagged = true; }
      } catch (e) { console.error('[emcee] tag() failed — sending untagged', e); }
    }
    E.bus.emit('intercept:commit', { url: info.url, method: info.method, via: info.via, tagged: tagged });
    tele('intercept:commit', { url: info.url, method: info.method, via: info.via, tagged: tagged });
    io.commit(payload);
  }

  /* ── after the response: onCommit navigation, then narration ───────── */
  function finish(cfg, json, raw) {
    var oc = cfg.onCommit;
    if (oc && typeof oc === 'object' && oc.navigate) {
      var target = String(oc.navigate).replace(/\{([\w.-]+)\}/g, function (m, k) {
        return (json && json[k] !== undefined && json[k] !== null) ? String(json[k]) : m;
      });
      if (target.charAt(0) === '#') location.hash = target;
      else history.pushState(null, '', target);   /* core emits route:changed */
    }
    /* onCommit 'follow-redirect' (or absent): do nothing — the site handles it */
    if (cfg.narrateResult) {
      var line = null;
      try { line = cfg.narrateResult(json !== undefined && json !== null ? json : raw); } catch (e) {}
      var ch = chromeMod();
      if (line && ch && ch.say) ch.say(String(line));
    }
  }

  function followFetch(cfg, promise) {
    promise.then(function (res) {
      res.clone().json().then(
        function (json) { finish(cfg, json, res); },
        function () { finish(cfg, null, res); }
      );
    }).catch(function () { /* network errors belong to the caller */ });
  }

  /* ── fetch wrap ─────────────────────────────────────────────────────── */
  function installFetch() {
    var orig = window.fetch;
    if (!orig) return;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : ((input && input.url) || String(input || ''));
      var method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
      var cfg = findConfig(url, method);
      if (!cfg) return orig.apply(window, arguments);
      if (releasing === cfg) {
        /* form-path release: pass through untouched, but still follow the
           response so onCommit/narrateResult run for the form path too */
        var passed = orig.apply(window, arguments);
        followFetch(cfg, passed);
        return passed;
      }
      var ch = chromeMod();
      if (!ch || !ch.modal) { warnOnce(); return orig.apply(window, arguments); }

      /* Phase 1: payload comes from init.body (string JSON / FormData / raw).
         Request-object bodies are opaque here and release untouched. */
      var info = capture(init && init.body);
      info.url = url;
      info.method = String(method).toUpperCase();
      info.via = 'fetch';

      /* HOLD: the caller's promise stays pending while the checkpoint is up */
      return new Promise(function (resolve, reject) {
        hold(cfg, info, {
          commit: function (payload) {
            var body = serialize(info.kind, payload);
            var nextInit = init ? Object.assign({}, init) : {};
            if (body !== undefined) nextInit.body = body;
            var released = orig.call(window, input, nextInit);
            released.then(resolve, reject);
            followFetch(cfg, released);
          },
          cancel: function () { reject(abortError()); }
        });
      });
    };
  }

  /* ── XHR wrap: queue send() until the checkpoint decides ───────────── */
  function installXhr() {
    if (typeof XMLHttpRequest === 'undefined') return;
    var proto = XMLHttpRequest.prototype;
    var oOpen = proto.open;
    var oSend = proto.send;
    proto.open = function (method, url) {
      this.__emceeMethod = method;
      this.__emceeUrl = url;
      return oOpen.apply(this, arguments);
    };
    proto.send = function (body) {
      var cfg = findConfig(this.__emceeUrl, this.__emceeMethod);
      if (!cfg || releasing === cfg) return oSend.apply(this, arguments);
      var ch = chromeMod();
      if (!ch || !ch.modal) { warnOnce(); return oSend.apply(this, arguments); }
      var xhr = this;
      var info = capture(body);
      info.url = String(this.__emceeUrl || '');
      info.method = String(this.__emceeMethod || 'GET').toUpperCase();
      info.via = 'xhr';
      hold(cfg, info, {
        commit: function (payload) {
          var next = serialize(info.kind, payload);
          xhr.addEventListener('load', function () {
            var json = null;
            try { json = JSON.parse(xhr.responseText); } catch (e) {}
            finish(cfg, json, xhr);
          });
          oSend.call(xhr, next !== undefined ? next : body);
        },
        cancel: function () {
          /* send() was never called, so abort() alone may not notify —
             dispatch the abort event so the caller's handlers fire */
          try { xhr.abort(); } catch (e) {}
          try { xhr.dispatchEvent(new Event('abort')); } catch (e2) {}
        }
      });
    };
  }

  /* ── <form data-emcee-intercept> path ──────────────────────────────── */
  function onFormSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;
    var attr = form.getAttribute('data-emcee-intercept');
    if (attr === null) return;
    var url = attr || form.getAttribute('action') || location.pathname;
    var method = form.getAttribute('method') || 'POST';
    var cfg = findConfig(url, method);
    if (!cfg) return;                                   /* unregistered: form behaves normally */
    var ch = chromeMod();
    if (!ch || !ch.modal) { warnOnce(); return; }       /* chrome absent: pass through */
    e.preventDefault();
    var obj = {};
    try { new FormData(form).forEach(function (v, k) { obj[k] = v; }); } catch (err) {}
    var info = { kind: 'form', payload: obj, url: url, method: String(method).toUpperCase(), via: 'form' };
    hold(cfg, info, {
      commit: function (payload) {
        /* Release = hand the (possibly tagged) payload back to the page's
           own JS via 'emcee:commit'. dispatchEvent is synchronous: any
           fetch/XHR the handler fires DURING the event passes through the
           wrappers (release mode) but is still followed for
           onCommit/narrateResult. Handlers must call synchronously. */
        releasing = cfg;
        try {
          form.dispatchEvent(new CustomEvent('emcee:commit', { detail: { payload: payload } }));
        } finally {
          releasing = null;
        }
      },
      cancel: function () { /* modal closed — the visitor is back at the form */ }
    });
  }

  /* ── install (exactly once, on FIRST registration) ─────────────────── */
  function install() {
    if (installed) return;
    installed = true;
    installFetch();
    installXhr();
    document.addEventListener('submit', onFormSubmit, true);
  }

  function register(cfg) {
    if (!cfg || !cfg.match || !cfg.match.url) {
      console.warn('[emcee] Emcee.intercept: cfg.match.url is required');
      return;
    }
    configs.push(cfg);
    install();
  }

  return {
    init: function () {},
    register: register
  };
})();

/* public facade — signature per spec §4, locked */
Emcee.intercept = function (cfg) { return E.mod.interceptor.register(cfg); };


/* ══════════ 90-telemetry.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   90-telemetry — console + localStorage ring buffer (cap 200, FIFO)
   Spec §3 telemetry stub · INTERNAL_API.md "Telemetry (90)".
   Shape: { t: Date.now(), evt, data, session }
   ═══════════════════════════════════════════════════════════════════════ */

/* PHASE2: POST the same records to the /telemetry endpoint — this interface
   is already shaped for it. Intended payload:

     POST /telemetry
     {
       session: 'a1b2c3d4' | null,
       records: [
         { t: 1767225600000, evt: 'intercept:hold',   data: { url: '/api/tickets', method: 'POST', via: 'fetch' } },
         { t: 1767225604210, evt: 'intercept:commit', data: { url: '/api/tickets', method: 'POST', tagged: true } }
       ]
     }

   Flush strategy: batch every N records plus navigator.sendBeacon on
   pagehide; the localStorage ring buffer doubles as the offline/retry
   queue, so nothing here gets rewritten — only a flusher gets added.
   Resident note: from Phase 2 these records land in the CUSTOMER's
   database per the resident-only data plane. */

E.mod.telemetry = (function () {
  var KEY = 'emcee.telemetry';
  var CAP = 200;

  /* NEVER log raw emails — defensively replace any 'email' key, at any
     nesting depth, before the record touches console or localStorage. */
  function redact(data, depth) {
    if (!data || typeof data !== 'object' || (depth || 0) > 4) return data;
    var out = Array.isArray(data) ? [] : {};
    Object.keys(data).forEach(function (k) {
      if (k.toLowerCase() === 'email') out[k] = '[redacted]';
      else out[k] = redact(data[k], (depth || 0) + 1);
    });
    return out;
  }

  function sessionId() {
    return (E.mod.session && E.mod.session.id && E.mod.session.id()) || null;
  }

  return {
    init: function () {},

    log: function (evt, data) {
      var safe = redact(data);
      console.debug('[emcee]', evt, safe);
      var buf = E.util.store.get(KEY, []);
      if (!Array.isArray(buf)) buf = [];
      buf.push({ t: Date.now(), evt: evt, data: safe, session: sessionId() });
      while (buf.length > CAP) buf.shift();   /* FIFO: oldest records drop first */
      E.util.store.set(KEY, buf);
    },

    dump: function () {
      var buf = E.util.store.get(KEY, []);
      return Array.isArray(buf) ? buf : [];
    },

    clear: function () {
      E.util.store.remove(KEY);
    }
  };
})();


/* ══════════ 95-knowledge.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   95-knowledge — the self-knowledge retriever (E.mod.kb / Emcee.kb)

   Layered lexical retrieval with a calibrated confidence gate:
     1. normalize      lowercase, strip punctuation, light stemming
     2. fuzzy match    bigram-Dice similarity absorbs typos ("instal", "pricng")
     3. scoring        BM25-flavored: field weights (q > tags > answer) × IDF
                       over the KB corpus, + adjacency (phrase) boosts
     4. context carry  short follow-ups ("how much is it?") inherit the last
                       matched entry's topic tokens at reduced weight
     5. gate           high → answer + related chips
                       mid  → DISAMBIGUATE (did-you-mean chips), never guess
                       low  → defer to the human (deferral line)

   Honesty contract: this is deterministic information retrieval, not an LLM.
   It answers verbatim from the KB or it defers. PHASE2: resident inference
   (Anthropic / Azure OpenAI adapters, customer-owned deployment) replaces
   the retriever behind this same interface — retrieve → answer → confidence
   gate → speak or defer stays the visible behavior (the SoloLift Knowledge
   Service loop; this module is its static precursor).
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.kb = (function () {

  var st = { loaded: false, name: null, deferral: null, entries: [], idf: {}, lastEntry: null };

  var STOP = {};
  ('a an and are as at be but by can do does for from has have how i in is it its me my of on or so ' +
   'that the this to was we what when where which who why will with you your').split(' ').forEach(function (w) { STOP[w] = 1; });

  /* light stemmer — enough for a docs corpus, no false confidence */
  function stem(w) {
    if (w.length <= 3) return w;
    if (/(sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);
    if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);
    if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    return String(text || '').toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9À-ɏ]+/g, ' ')
      .split(' ')
      .filter(function (w) { return w && !STOP[w]; })
      .map(stem);
  }

  /* bigram-Dice similarity — typo tolerance without a dictionary */
  function bigrams(w) {
    var set = {}, i;
    for (i = 0; i < w.length - 1; i++) set[w.slice(i, i + 2)] = 1;
    return set;
  }
  function dice(a, b) {
    if (a === b) return 1;
    if (a.length < 3 || b.length < 3) return 0;
    var A = bigrams(a), B = bigrams(b), inter = 0, sa = 0, sb = 0, k;
    for (k in A) { sa++; if (B[k]) inter++; }
    for (k in B) sb++;
    return (2 * inter) / (sa + sb || 1);
  }

  /* ── index build ─────────────────────────────────────────────────── */
  var FIELD_W = { q: 3.0, tags: 2.0, a: 1.0 };

  function buildIndex(doc) {
    st.name = doc.kb || 'kb';
    st.deferral = doc.deferral || null;
    st.entries = (doc.entries || []).map(function (e, i) {
      var fields = { q: tokenize(e.q), tags: tokenize(e.tags), a: tokenize(e.a) };
      var weights = {}, order = [];
      ['q', 'tags', 'a'].forEach(function (f) {
        fields[f].forEach(function (t) {
          weights[t] = Math.max(weights[t] || 0, FIELD_W[f]);
        });
      });
      order = fields.q.concat(fields.tags); /* adjacency source */
      return { i: i, q: e.q, a: e.a, tokens: weights, seq: order };
    });
    /* corpus IDF */
    var df = {}, N = st.entries.length || 1;
    st.entries.forEach(function (e) {
      Object.keys(e.tokens).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    st.idf = {};
    Object.keys(df).forEach(function (t) { st.idf[t] = Math.log(1 + N / df[t]); });
    st.loaded = true;
  }

  /* ── scoring ─────────────────────────────────────────────────────── */
  function scoreEntry(entry, qTokens, ctxTokens) {
    var score = 0, matched = 0, qFieldHits = 0;
    qTokens.forEach(function (qt) {
      var idf = st.idf[qt] || 1.2; /* unseen tokens: mild default */
      if (entry.tokens[qt]) {
        score += entry.tokens[qt] * idf; matched++;
        if (entry.tokens[qt] >= 3.0) qFieldHits++;   /* hit lives in the entry's own question */
        return;
      }
      /* fuzzy: best Dice against this entry's vocabulary */
      var best = 0, bestW = 0, t;
      for (t in entry.tokens) {
        var d = dice(qt, t);
        if (d > best) { best = d; bestW = entry.tokens[t]; }
      }
      if (best >= 0.72) { score += 0.7 * bestW * (st.idf[qt] || 1.2); matched += 0.7; }
    });
    /* adjacency boost: consecutive query tokens adjacent in q/tags */
    for (var i = 0; i < qTokens.length - 1; i++) {
      var pos = entry.seq.indexOf(qTokens[i]);
      if (pos > -1 && entry.seq[pos + 1] === qTokens[i + 1]) score += 1.5;
    }
    /* context carry — ONLY a tie-breaker: it never creates a match from
       nothing (entry must already hit the query), and it's capped so a
       previous topic can't drown out the current question */
    if (matched >= 1) {
      var ctxBoost = 0;
      (ctxTokens || []).forEach(function (ct) {
        if (entry.tokens[ct]) ctxBoost += 0.4 * (st.idf[ct] || 1);
      });
      score += Math.min(1.0, ctxBoost);
    }
    /* coverage bonus: every query token found inside the entry's QUESTION —
       the visitor asked this entry's question, possibly reworded */
    if (qTokens.length && qFieldHits === qTokens.length) score += 2.5;
    /* mild length normalization so verbose entries don't dominate */
    return { score: score / Math.sqrt(Math.max(1, qTokens.length)), matched: matched };
  }

  function search(query, n) {
    if (!st.loaded) return [];
    var qTokens = tokenize(query);
    if (!qTokens.length) return [];
    var ctx = (st.lastEntry && qTokens.length <= 3) ? Object.keys(st.lastEntry.tokens).slice(0, 12) : null;
    var results = st.entries.map(function (e) {
      var s = scoreEntry(e, qTokens, ctx);
      return { entry: e, score: s.score, matched: s.matched };
    }).filter(function (r) { return r.score > 0; });
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, n || 5);
  }

  /* ── the gate ────────────────────────────────────────────────────── */
  var T_HIGH = 2.1;   /* answer */
  var T_MID = 1.0;    /* disambiguate — never guess */

  function answer(query) {
    var top = search(query, 4);
    if (!top.length || top[0].score < T_MID) {
      return { kind: 'defer', score: top.length ? top[0].score : 0 };
    }
    var first = top[0], second = top[1];
    var clearMargin = !second ||
      (first.score - second.score) >= 0.15 * first.score ||   /* clear lead */
      second.score < T_HIGH * 0.55 ||                          /* runner-up weak */
      first.score >= 2.2 * T_HIGH;                             /* dominant absolute score */
    if (first.score >= T_HIGH && clearMargin) {
      st.lastEntry = first.entry;
      return {
        kind: 'answer',
        q: first.entry.q, a: first.entry.a,
        score: first.score,
        related: top.slice(1, 3).filter(function (r) { return r.score >= T_MID * 0.8; })
          .map(function (r) { return { q: r.entry.q, a: r.entry.a }; })
      };
    }
    /* confident-ish but ambiguous → offer choices instead of guessing */
    return {
      kind: 'disambiguate',
      score: first.score,
      options: top.slice(0, 3).map(function (r) { return { q: r.entry.q, a: r.entry.a }; })
    };
  }

  /* the live answer line: try /api/ask (grounded LLM phrasing over the same
     notes, server-side key) and FALL BACK to the local gate on any miss.
     The discipline is identical in both states: grounded or deferred. */
  function answerSmart(query) {
    var local = answer(query);
    var emitOnce = function (r) { try { E.bus.emit('kb:asked', { q: query, kind: r.kind, live: !!r.live }); } catch (e) {} return r; };
    var cands = search(query, 8).map(function (r) { return { q: r.entry.q, a: r.entry.a }; });
    if (!cands.length || typeof fetch !== 'function') return Promise.resolve(emitOnce(local));
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    return fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: String(query).slice(0, 400), candidates: cands }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        clearTimeout(timer);
        if (j && j.answer) {
          if (local.kind === 'answer') st.lastEntry = st.lastEntry; /* context already set by answer() */
          return emitOnce({ kind: 'answer', a: j.answer, live: true, score: local.score || 0,
                   related: local.kind === 'answer' ? (local.related || []) : (local.options || []).slice(0, 2) });
        }
        return emitOnce(local);
      })
      .catch(function () { clearTimeout(timer); return emitOnce(local); });
  }

  function load(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('kb fetch failed: ' + r.status);
      return r.text();
    }).then(function (text) {
      buildIndex(Emcee.yaml.parse(text));
      E.bus.emit('kb:loaded', { name: st.name, entries: st.entries.length });
      return E.mod.kb;
    });
  }

  return {
    init: function () {},
    load: load,
    loadFromObject: function (doc) { buildIndex(doc); return E.mod.kb; },
    ready: function () { return st.loaded; },
    deferral: function () { return st.deferral; },
    count: function () { return st.entries.length; },
    search: search,
    answer: answer,
    answerSmart: answerSmart
  };
})();

/* public facade */
Emcee.kb = {
  load: E.mod.kb.load,
  search: E.mod.kb.search,
  answer: E.mod.kb.answer,
  answerSmart: E.mod.kb.answerSmart,
  ready: E.mod.kb.ready
};


/* ══════════ 97-insights.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   97-insights — the Intelligence layer (E.mod.insights / Emcee.insights)

   The guide sees what analytics tools can't: where visitors linger, what
   they ASK, where intent shows (pricing views, reserve clicks), and who
   comes back. All anonymous, first-party, no cookies, no PII — the visitor
   id is the same crypto-random session id the tour system already mints,
   and question text is defensively scrubbed of anything email-shaped.

   Events batch in memory and flush via navigator.sendBeacon to /api/beacon
   (same host). No endpoint configured / customer without the API → the
   fetch fails silently and the site behaves exactly as before.

   Default ON (our deployment is the pilot and our setup = a customer's).
   Opt out per page: data-emcee-insights="off" on the engine script tag.
   Docs disclosure: /emcee/docs.html § data. Owner surface: /emcee/boss.html.
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.insights = (function () {
  var enabled = false, queue = [], flushT = null;
  var page = null, pageT0 = 0, dwellMs = 0, lastVis = 0, maxScroll = 0;
  var sections = {}, secObs = null, secVis = {};
  var vid = null, visitN = 1, returning = false, ft = null, lt = null;

  /* ── attribution: FIRST touch is persisted per VISITOR and never changes —
     a thousand revisits can't re-credit a vendor. Last touch updates per
     visit (for the comparison toggle in the deck). ── */
  function touchInfo() {
    var q = new URLSearchParams(location.search);
    var src = q.get('utm_source') || '', cmp = q.get('utm_campaign') || '', med = q.get('utm_medium') || '';
    var ref = (document.referrer || '').split('/')[2] || '';
    if (ref === location.hostname) ref = '';                 /* internal nav isn't a touch */
    if (!src && !cmp && !med && !ref) return null;
    return { s: src.slice(0, 60), c: cmp.slice(0, 60), m: med.slice(0, 40), r: ref.slice(0, 80), t: now() };
  }
  function initTouch() {
    ft = E.util.store.get('emcee.firsttouch', null);
    var cur = touchInfo();
    if (!ft && cur) { ft = cur; E.util.store.set('emcee.firsttouch', ft); }
    if (!ft) { ft = { s: '', c: '', m: '', r: '', t: now(), direct: true };
      E.util.store.set('emcee.firsttouch', ft); }
    if (cur) { lt = cur; E.util.store.set('emcee.lasttouch', lt); }
    else lt = E.util.store.get('emcee.lasttouch', null);
  }

  function now() { return Date.now(); }
  function scrub(s) {
    return String(s || '').slice(0, 220)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'); /* never ship an address */
  }

  /* ── visit accounting: same id later = returning visitor ── */
  function initVisit() {
    var rec = E.util.store.get('emcee.visits', null);
    var t = now();
    if (!rec || typeof rec.n !== 'number') rec = { n: 1, last: t, first: t };
    else if (t - rec.last > 30 * 60 * 1000) { rec.n += 1; returning = true; }
    else if (rec.n > 1) returning = true;
    rec.last = t;
    E.util.store.set('emcee.visits', rec);
    visitN = rec.n;
    var sess = E.util.store.get('emcee.session', null);
    vid = (sess && sess.id) || E.util.store.get('emcee.vid', null);
    if (!vid) { vid = E.util.uid(); E.util.store.set('emcee.vid', vid); }
  }

  /* ── event queue + beacon ── */
  function push(type, data) {
    if (!enabled) return;
    var ev = { t: now(), type: type, path: location.pathname, vid: vid, vn: visitN, ret: returning, data: data || {} };
    if (type === 'pageview' || type === 'intent' || type === 'ask') { ev.ft = ft; if (lt) ev.lt = lt; }
    queue.push(ev);
    if (queue.length >= 20) flush();
    else if (!flushT) flushT = setTimeout(flush, 15000);
  }
  function flush() {
    if (flushT) { clearTimeout(flushT); flushT = null; }
    if (!queue.length) return;
    var body = JSON.stringify({ events: queue.splice(0, 25) });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/beacon', new Blob([body], { type: 'application/json' }));
      else fetch('/api/beacon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* the guide never breaks the page */ }
  }

  /* ── dwell (visibility-aware) + scroll depth ── */
  function startPage() {
    page = location.pathname; pageT0 = now(); dwellMs = 0; lastVis = now(); maxScroll = 0; sections = {};
    push('pageview', { ref: (document.referrer || '').split('/')[2] || '' });
    /* auto intent: pricing + reserve pages are opportunity signals */
    if (/pricing/i.test(page)) push('intent', { kind: 'pricing-view' });
    if (/login/i.test(page)) push('intent', { kind: 'reserve-view' });
    watchSections();
  }
  function accrue() { if (!document.hidden) { dwellMs += now() - lastVis; } lastVis = now(); }
  function endPage() {
    accrue();
    var top = Object.keys(sections).map(function (k) { return { s: k, ms: sections[k] }; })
      .sort(function (a, b) { return b.ms - a.ms; }).slice(0, 5)
      .map(function (x) { return { s: x.s.slice(0, 60), sec: Math.round(x.ms / 1000) }; });
    push('dwell', { sec: Math.round(dwellMs / 1000), scroll: maxScroll, sections: top });
    flush();
  }
  document.addEventListener('visibilitychange', function () {
    accrue();
    if (document.hidden) flush();
  });
  window.addEventListener('pagehide', endPage);
  window.addEventListener('scroll', function () {
    var h = document.documentElement;
    var d = h.scrollHeight - innerHeight;
    if (d <= 40) return;
    var pct = Math.min(100, Math.round(h.scrollTop / d * 100));
    var bucket = pct >= 90 ? 100 : pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0;
    if (bucket > maxScroll) maxScroll = bucket;
  }, { passive: true });

  /* ── section attention: [data-emcee-section] first, headed sections second ── */
  function watchSections() {
    if (secObs) { secObs.disconnect(); secObs = null; }
    if (typeof IntersectionObserver !== 'function') return;
    var els = E.util.qsa('[data-emcee-section]');
    if (!els.length) {
      els = E.util.qsa('main h2, article h2, section h2').slice(0, 12)
        .map(function (h) { return h.closest('section') || h.parentElement; })
        .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    }
    if (!els.length) return;
    var timers = {};
    secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var el = en.target;
        var label = el.getAttribute('data-emcee-section') ||
          (el.querySelector('h2') && el.querySelector('h2').textContent.trim()) || 'section';
        if (en.isIntersecting) { timers[label] = now(); }
        else if (timers[label]) { sections[label] = (sections[label] || 0) + (now() - timers[label]); delete timers[label]; }
      });
    }, { threshold: 0.5 });
    els.forEach(function (el) { secObs.observe(el); });
  }

  function init() {
    /* per-page opt-out on the engine script tag */
    var tag = document.querySelector('script[data-emcee-insights]');
    if (tag && tag.getAttribute('data-emcee-insights') === 'off') return;
    if (enabled) return;
    enabled = true;
    initVisit();
    initTouch();
    E.util.onReady(startPage);
    /* SPA navigation counts as a new page */
    E.bus.on('route:changed', function () {
      if (page && page !== location.pathname) { endPage(); startPage(); }
    });
    /* the crown jewel: what visitors ASK, where, and whether he could answer */
    E.bus.on('kb:asked', function (d) {
      push('ask', { q: scrub(d.q), kind: d.kind, live: !!d.live });
    });
    E.bus.on('gate:open', function () { push('intent', { kind: 'gate-open' }); });
    E.bus.on('gate:passed', function () { push('intent', { kind: 'gate-passed' }); });
    E.bus.on('tour:advanced', function (d) { push('tour', d || {}); });
    E.bus.on('nudge:offered', function (d) { push('nudge', { id: (d && d.id) || '' }); }); /* assists — proof the guide guides */
    /* reserve/pricing CTA clicks anywhere */
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var h = a.getAttribute('href') || '';
      if (/login/i.test(h)) push('intent', { kind: 'reserve-click' });
      else if (/pricing/i.test(h)) push('intent', { kind: 'pricing-click' });
    }, true);
  }

  return {
    init: init,
    enable: function () { init(); },
    track: push,
    /* Bryte's in-session party trick: what he saw with his own eyes */
    session: function () {
      accrue();
      return { page: page, seconds: Math.round(dwellMs / 1000), scroll: maxScroll, visit: visitN, returning: returning };
    }
  };
})();

Emcee.insights = { enable: E.mod.insights.enable, track: E.mod.insights.track, session: E.mod.insights.session };


/* ══════════ 98-nudge.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   98-nudge — the attentive-tour-guide reflex (E.mod.nudge / Emcee.nudge)

   A human guide notices when someone stands staring at one exhibit and
   walks over to offer more. This module is that reflex: when a visitor's
   VISIBLE time on a marked part of the page passes its threshold, Bryte
   speaks up once — an offer, never an interruption loop.

   Markup (the whole public API for site owners):
     <section data-emcee-nudge="pricing"
              data-emcee-nudge-after="45"                  seconds, default 45
              data-emcee-nudge-say="Staring at the price? Fair. Ask me anything —
                                    or the short version: $100 a month, everything included.">

   Rules of the reflex:
   · fires once per nudge id per visit (sessionStorage) — never nags
   · at most ONE nudge per page load, and never within 25s of arriving
   · stays silent while a tour step is talking or ask-mode is open
   · costs nothing: one IntersectionObserver + one 5s heartbeat
   · programmatic: Emcee.nudge.watch({selector, id, after, say, fn})
   · every fire emits bus 'nudge:offered' {id} and an insights event, so
     assists show up in the Monday deck as proof the guide guides
   ═══════════════════════════════════════════════════════════════════════ */

E.mod.nudge = (function () {
  var watches = [];          /* {el, id, after, say, fn, ms, since} */
  var obs = null, beat = null, firedThisLoad = false, t0 = 0, busy = false;
  var SKEY = 'emcee.nudged';

  function done() { try { return JSON.parse(sessionStorage.getItem(SKEY) || '{}'); } catch (e) { return {}; } }
  function markDone(id) {
    try { var d = done(); d[id] = 1; sessionStorage.setItem(SKEY, JSON.stringify(d)); } catch (e) {}
  }
  function now() { return Date.now(); }

  /* stay polite: no nudging over a talking tour or an open ask box */
  function quiet() {
    if (busy) return true;
    try {
      if (E.mod.tour && E.mod.tour.active && E.mod.tour.active()) return true;
      var ask = document.querySelector('.emcee-ask-input');
      if (ask && document.activeElement === ask) return true;
    } catch (e) {}
    return false;
  }

  function offer(w) {
    if (firedThisLoad || done()[w.id] || quiet()) return;
    if (now() - t0 < 25000) return;                 /* let them settle in first */
    firedThisLoad = true;
    markDone(w.id);
    E.bus.emit('nudge:offered', { id: w.id });
    if (typeof w.fn === 'function') { try { w.fn(w); } catch (e) {} return; }
    var line = w.say ||
      "You've been on this part a while — that's usually a question forming. Ask me; short answers only."; /* COPY:PENDING */
    try {
      if (E.mod.chrome && E.mod.chrome.say) {
        busy = true;
        E.mod.chrome.say(line, function () { busy = false; });
      }
    } catch (e) { busy = false; }
  }

  function heartbeat() {
    watches.forEach(function (w) {
      if (w.since) { w.ms += now() - w.since; w.since = now(); }
      if (w.ms >= w.after * 1000) offer(w);
    });
  }

  function observe() {
    if (typeof IntersectionObserver !== 'function') return;
    obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var w = watches.filter(function (x) { return x.el === en.target; })[0];
        if (!w) return;
        if (en.isIntersecting && !document.hidden) { w.since = now(); }
        else if (w.since) { w.ms += now() - w.since; w.since = 0; }
      });
    }, { threshold: 0.5 });
    watches.forEach(function (w) { obs.observe(w.el); });
    beat = setInterval(heartbeat, 5000);
    document.addEventListener('visibilitychange', function () {
      watches.forEach(function (w) {
        if (document.hidden && w.since) { w.ms += now() - w.since; w.since = 0; }
      });
    });
  }

  function watch(opts) {
    opts = opts || {};
    var el = opts.el || (opts.selector && document.querySelector(opts.selector));
    if (!el) return E.mod.nudge;
    watches.push({
      el: el,
      id: opts.id || opts.selector || ('nudge-' + watches.length),
      after: Number(opts.after) > 0 ? Number(opts.after) : 45,
      say: opts.say || null,
      fn: opts.fn || null,
      ms: 0, since: 0
    });
    if (obs) obs.observe(el);
    return E.mod.nudge;
  }

  function init() {
    t0 = now();
    E.util.onReady(function () {
      E.util.qsa('[data-emcee-nudge]').forEach(function (el) {
        watch({
          el: el,
          id: el.getAttribute('data-emcee-nudge') || undefined,
          after: el.getAttribute('data-emcee-nudge-after'),
          say: el.getAttribute('data-emcee-nudge-say')
        });
      });
      if (watches.length) observe();
      else { /* still expose watch(); observer attaches lazily */ 
        observe();
      }
    });
  }

  return { init: init, watch: watch, _state: function () { return { watches: watches.length, fired: firedThisLoad }; } };
})();

Emcee.nudge = { watch: function (o) { return E.mod.nudge.watch(o); } };


/* ══════════ 99-boot.js ══════════ */
/* ═══════════════════════════════════════════════════════════════════════
   99-boot — auto-init from the install snippet (docs/INTERNAL_API.md):

   <script src="/dist/emcee.js" defer
     data-emcee-tour="/tours/necogoode.yaml"
     data-emcee-skin="/skins/bryte/"
     data-emcee-kb="/kb/emcee.yaml"
     data-emcee-autostart="true"></script>

   No attributes → the engine loads and does nothing (programmatic use via
   Emcee.init). data-emcee-autostart defaults to true when a tour is given.
   ═══════════════════════════════════════════════════════════════════════ */

/* capture our own tag NOW — currentScript is null later in callbacks */
var bootScript = document.currentScript;

Emcee.init = function (opts) {
  opts = opts || {};

  if (E.mod.telemetry) E.mod.telemetry.init();
  if (E.mod.insights) E.mod.insights.init();     /* anonymous, first-party; docs § data */
  if (E.mod.session) E.mod.session.init();       /* adopts ?emcee= share links */
  if (E.mod.nudge) E.mod.nudge.init();           /* the attentive-guide reflex (data-emcee-nudge) */
  if (E.mod.interceptor) E.mod.interceptor.init();
  if (E.mod.tour) E.mod.tour.init();             /* bus hooks; safe pre-chrome */

  var chain = Promise.resolve();

  if (opts.kb && E.mod.kb) {
    /* non-blocking: the tour must never wait on the knowledge base */
    E.mod.kb.load(opts.kb).catch(function (err) {
      console.warn('[emcee] kb load failed (Ask falls back to deferral):', err.message);
    });
  }

  if (opts.skin) {
    chain = chain
      .then(function () { return E.mod.rig.loadSkin(opts.skin); })
      .then(function (loaded) {
        return new Promise(function (resolve) {
          E.util.onReady(function () {
            E.mod.chrome.init({ manifest: loaded.manifest, artText: loaded.artText });
            resolve();
          });
        });
      });
  }

  if (opts.tour) {
    chain = chain
      .then(function () { return E.mod.tour.load(opts.tour); })
      .then(function () {
        if (opts.autostart !== false) {
          E.util.onReady(function () { E.mod.tour.start(); });  /* resume-aware */
        }
      });
  }

  return chain
    .then(function () {
      E.routeCheck();                             /* fire the first route */
      console.debug('[emcee] v' + E.version + ' ready');
      return Emcee;
    })
    .catch(function (err) {
      /* the guide must never take the page down with it */
      console.error('[emcee] init failed:', err);
      return Emcee;
    });
};

/* auto-boot from the script tag */
(function () {
  if (!bootScript || !bootScript.getAttribute) return;
  var tour = bootScript.getAttribute('data-emcee-tour');
  var skin = bootScript.getAttribute('data-emcee-skin');
  var kb = bootScript.getAttribute('data-emcee-kb');
  if (E.mod.insights) E.mod.insights.init();      /* insights run even on passive loads */
  if (!tour && !skin && !kb) return;              /* passive load */
  var auto = bootScript.getAttribute('data-emcee-autostart');
  Emcee.init({
    tour: tour || null,
    skin: skin || null,
    kb: kb || null,
    autostart: auto === null ? true : auto !== 'false'
  });
})();

})();

/* PMOFlow product site: prices from pricing.json (the single source), the cost estimator,
   and the Book a demo form. No dependencies, no third-party requests. */
(function () {
  'use strict';
  var PRICING_URL = '/pmoflow/pricing.json';
  var API = '/api/pmoflow/buyer/demo-request';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n, cur) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n); }
    catch (e) { return '$' + Math.round(n).toLocaleString('en-US'); }
  }

  /* ---------- pricing ---------- */
  var pricingPromise = null;
  function loadPricing() {
    if (!pricingPromise) pricingPromise = fetch(PRICING_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('pricing ' + r.status);
      return r.json();
    });
    return pricingPromise;
  }
  function planById(p, id) { return p.plans.filter(function (x) { return x.id === id; })[0]; }
  function lowestEditorPrice(p) {
    return Math.min.apply(null, p.plans.filter(function (x) { return x.perEditorMonthly; }).map(function (x) { return x.perEditorMonthly; }));
  }

  /* Fill every [data-price] placeholder: "pilot.price", "pilot.days", "pilot.note", "plan.<id>.monthly", "from" */
  function fillPrices(p) {
    $all('[data-price]').forEach(function (el) {
      var k = el.getAttribute('data-price'), v = null;
      if (k === 'pilot.price') v = money(p.pilot.price, p.currency);
      else if (k === 'pilot.days') v = String(p.pilot.days);
      else if (k === 'pilot.note') v = p.pilot.note;
      else if (k === 'from') v = money(lowestEditorPrice(p), p.currency);
      else if (k === 'billing') v = p.billing;
      else if (/^plan\.\w+\.monthly$/.test(k)) { var pl = planById(p, k.split('.')[1]); if (pl && pl.perEditorMonthly) v = money(pl.perEditorMonthly, p.currency); }
      else if (/^plan\.\w+\.max$/.test(k)) { var pm = planById(p, k.split('.')[1]); if (pm && pm.maxEditors) v = String(pm.maxEditors); }
      if (v != null) el.textContent = v;
    });
  }

  /* JSON-LD offers come from the same file, so search engines never see a stale price */
  function fillJsonLd(p) {
    var s = $('script[type="application/ld+json"][data-offers]');
    if (!s) return;
    try {
      var j = JSON.parse(s.textContent);
      j.offers = p.plans.filter(function (x) { return x.perEditorMonthly; }).map(function (x) {
        return { '@type': 'Offer', name: x.name, price: String(x.perEditorMonthly), priceCurrency: p.currency,
          description: 'Per editor per month, ' + p.billing + '. Viewers and approvers are free.' };
      });
      s.textContent = JSON.stringify(j);
    } catch (e) { /* leave the static block as is */ }
  }

  function featureHtml(f) {
    if (typeof f === 'string') return '<li>' + esc(f) + '</li>';
    return '<li>' + esc(f.text) + (f.planned ? ' <span class="tag planned">Planned</span>' : '') + '</li>';
  }

  function renderPlans(p) {
    var host = $('#plans'); if (!host) return;
    var free = p.freeSeats;
    var html = '<article class="card plan" data-plan="' + esc(free.id) + '"><h3>' + esc(free.name) + '</h3>' +
      '<div class="price">' + esc(free.priceLabel) + '</div><div class="per">' + esc(free.unit) + '</div>' +
      '<ul>' + free.includes.map(featureHtml).join('') + '</ul></article>';
    html += p.plans.map(function (pl) {
      var price = pl.custom ? esc(pl.priceLabel || 'Custom') : esc(money(pl.perEditorMonthly, p.currency));
      var per = pl.custom ? 'Talk to us about your organisation' : 'per editor / month, ' + esc(p.billing) + (pl.maxEditors ? ' · up to ' + pl.maxEditors + ' editors' : '');
      var cta = pl.custom
        ? '<a class="btn ghost" href="/pmoflow/demo?plan=' + esc(pl.id) + '">Talk to us</a>'
        : '<a class="btn' + (pl.highlight ? '' : ' ghost') + '" href="/pmoflow/demo?plan=' + esc(pl.id) + '">Book a demo</a>';
      return '<article class="card plan' + (pl.highlight ? ' hl' : '') + '" data-plan="' + esc(pl.id) + '">' +
        (pl.highlight ? '<span class="tag now badge">Most teams start here</span>' : '') +
        '<h3>' + esc(pl.name) + '</h3><div class="price">' + price + '</div><div class="per">' + per + '</div>' +
        '<p class="small soft">' + esc(pl.summary || '') + '</p>' +
        '<ul>' + pl.includes.map(featureHtml).join('') + '</ul>' + cta + '</article>';
    }).join('');
    host.innerHTML = html;
  }

  function initEstimator(p) {
    var form = $('#estimator'); if (!form) return;
    var sel = $('#est-plan'), num = $('#est-editors'), out = $('#est-total'), detail = $('#est-detail'), note = $('#est-note');
    sel.innerHTML = p.plans.filter(function (x) { return x.perEditorMonthly; }).map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.highlight ? ' selected' : '') + '>' + esc(x.name) + ' · ' + esc(money(x.perEditorMonthly, p.currency)) + ' per editor / month</option>';
    }).join('');
    /* R11: the estimate and the input always agree. Fewer than 1 editor becomes 1 in the box too (an empty box while
       typing is left alone and filled with 1 when the visitor leaves the field). */
    function update(e) {
      var pl = planById(p, sel.value);
      var raw = String(num.value).trim();
      var n = Math.floor(Number(raw));
      if (!isFinite(n) || n < 1) { n = 1; }
      if (n > 10000) { n = 10000; }
      if ((raw !== '' || (e && e.type === 'change')) && String(n) !== raw) num.value = String(n);
      var annual = n * pl.perEditorMonthly * 12;
      out.textContent = money(annual, p.currency) + ' a year';
      detail.textContent = n + ' editor' + (n === 1 ? '' : 's') + ' × ' + money(pl.perEditorMonthly, p.currency) + ' × 12 months';
      if (pl.maxEditors && n > pl.maxEditors) {
        var next = p.plans.filter(function (x) { return x.perEditorMonthly && !x.maxEditors; })[0];
        note.textContent = pl.name + ' covers up to ' + pl.maxEditors + ' editors.' + (next ? ' For ' + n + ' editors, choose ' + next.name + '.' : '');
      } else note.textContent = '';
    }
    sel.addEventListener('change', update);
    num.addEventListener('input', update);
    num.addEventListener('change', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); update({ type: 'change' }); });
    update();
  }

  /* ---------- demo form ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icsStamp(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
  function addBusinessDays(d, n) { var x = new Date(d.getTime()); while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) n--; } return x; }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }

  /* A tentative 30-minute hold in the visitor's own local time (floating time, no time zone) */
  function buildIcs(lead) {
    var hours = { morning: 10, midday: 12, afternoon: 14, any: 10 }[lead.preferredWindow] || 10;
    var day;
    if (lead.preferredDate) { var parts = lead.preferredDate.split('-'); day = new Date(+parts[0], +parts[1] - 1, +parts[2]); }
    else day = addBusinessDays(new Date(), 2);
    var start = day.getFullYear() + pad(day.getMonth() + 1) + pad(day.getDate()) + 'T' + pad(hours) + '0000';
    var end = day.getFullYear() + pad(day.getMonth() + 1) + pad(day.getDate()) + 'T' + pad(hours) + '3000';
    var uid = (lead.id || String(Date.now())) + '@pmoflow.necogoode.com';
    var desc = 'A hold for your PMOFlow demo. We will confirm the exact time by email and update this hold. ' +
      'Live demo: https://www.necogoode.com/concepts/pmoflow/';
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PMOFlow//Demo hold//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + icsStamp(new Date()), 'DTSTART:' + start, 'DTEND:' + end,
      'SUMMARY:' + icsEscape('Hold: PMOFlow demo (to be confirmed)'), 'DESCRIPTION:' + icsEscape(desc),
      'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n');
  }

  function initDemoForm() {
    var form = $('#demo-form'); if (!form) return;
    var params = new URLSearchParams(location.search);
    var plan = params.get('plan') || '';
    if (/^[a-z]{2,20}$/.test(plan)) form.elements.plan.value = plan;
    if (plan === 'pilot') { form.elements.interest.value = 'pilot'; var h = $('#demo-title'); if (h) h.textContent = 'Start a pilot'; }
    /* R11: "Request our security packet" links here with topic=security; it is a demo request with the ask pre-filled */
    if (params.get('topic') === 'security') {
      var ht = $('#demo-title'); if (ht) ht.textContent = 'Request our security packet';
      if (form.elements.fix && !form.elements.fix.value) form.elements.fix.value = 'Please send the PMOFlow security packet.';
      var sb = form.querySelector('button[type=submit]'); if (sb) sb.textContent = 'Request the packet';
    }
    var dateEl = form.elements.preferredDate;
    if (dateEl) { var t = new Date(); dateEl.min = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
    var status = $('#form-status');

    function setErr(name, msg) {
      var el = form.querySelector('[data-err="' + name + '"]');
      var inputs = $all('[name="' + name + '"]', form);
      if (el) el.textContent = msg || '';
      inputs.forEach(function (i) { if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
    }
    function collect() {
      var f = form.elements;
      return {
        name: f.name.value, email: f.email.value, company: f.company.value, role: f.role.value, teamSize: f.teamSize.value,
        tools: $all('input[name="tools"]:checked', form).map(function (c) { return c.value; }), toolsOther: f.toolsOther.value,
        fix: f.fix.value, preferredDate: f.preferredDate.value, preferredWindow: f.preferredWindow.value, timesNote: f.timesNote.value,
        timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), interest: f.interest.value, plan: f.plan.value, website: f.website.value
      };
    }
    function localCheck(d) {
      var e = {};
      if (d.name.trim().length < 2) e.name = 'Please enter your name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = 'Please enter a valid work email.';
      if (d.company.trim().length < 2) e.company = 'Please enter your company.';
      if (d.role.trim().length < 2) e.role = 'Please enter your role.';
      if (!d.teamSize) e.teamSize = 'Please choose a team size.';
      if (d.fix.trim().length < 5) e.fix = 'Please tell us briefly what you want to fix.';
      return e;
    }
    function showErrors(errs) {
      ['name', 'email', 'company', 'role', 'teamSize', 'tools', 'fix', 'preferredDate', 'preferredWindow'].forEach(function (k) { setErr(k, errs[k]); });
      var first = Object.keys(errs)[0];
      if (first) { var el = form.querySelector('[name="' + first + '"]'); if (el) el.focus(); }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = '';
      var data = collect();
      var errs = localCheck(data);
      showErrors(errs);
      if (Object.keys(errs).length) { status.textContent = 'Please check the highlighted fields.'; return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Sending…';
      fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          if (res.status === 201) return done(Object.assign({ id: res.body.id }, data));
          if (res.status === 400 && res.body.fields) showErrors(res.body.fields);
          status.textContent = (res.body && res.body.error) || 'Something went wrong. Please try again.';
        })
        .catch(function () { status.textContent = 'We could not send your request. Check your connection and try again.'; })
        .then(function () { btn.disabled = false; btn.textContent = form.elements.interest.value === 'pilot' ? 'Request a pilot' : params.get('topic') === 'security' ? 'Request the packet' : 'Book my demo'; });
    });

    function done(lead) {
      var ics = buildIcs(lead);
      var a = $('#ics-link');
      a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      a.setAttribute('download', 'pmoflow-demo-hold.ics');
      var when = $('#thanks-when');
      if (when) {
        var label = { morning: 'a morning', midday: 'around midday', afternoon: 'an afternoon', any: 'any time' }[lead.preferredWindow] || 'any time';
        var dayText = '';
        if (lead.preferredDate) {
          var dp = lead.preferredDate.split('-');
          dayText = new Date(+dp[0], +dp[1] - 1, +dp[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ', ';
        }
        when.textContent = 'You asked for ' + dayText + label + '.';
      }
      form.hidden = true;
      var intro = $('#demo-intro'); if (intro) intro.hidden = true;
      var aside = $('#demo-aside'); if (aside) aside.hidden = true;
      var thanks = $('#thanks'); thanks.hidden = false;
      var h = $('#thanks-title'); h.setAttribute('tabindex', '-1'); h.focus();
      window.scrollTo(0, 0);
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    initDemoForm();
    if ($('[data-price]') || $('#plans') || $('#estimator') || $('script[data-offers]')) {
      loadPricing().then(function (p) { fillPrices(p); renderPlans(p); initEstimator(p); fillJsonLd(p); })
        .catch(function () { var h = $('#plans'); if (h) h.innerHTML = '<p class="soft">Prices could not be loaded. Please refresh, or <a href="/pmoflow/demo">ask us directly</a>.</p>'; });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.PMOFlowSite = { buildIcs: buildIcs };
}());

/* ═══════════════════════════════════════════════════════════════════════
   BYTE SIZED TRAINING — Python tokenizer + THE LEGEND.
   Every piece of code on screen is colored by WHAT KIND of thing it is,
   and the legend explains each color in plain words. One tokenizer,
   used everywhere, so the colors always mean the same thing.
   window.BST.tokenize(code) → HTML string of colored <span>s
   window.BST.LEGEND → the legend entries (id, color-class, name, plain)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.BST = window.BST || {};

  /* The legend — id doubles as the CSS class (tk-<id>). Plain-words
     descriptions are written for a smart teenager, on purpose. */
  var LEGEND = [
    { id: 'kw',  name: 'Python words',   plain: 'Words Python itself owns — def, for, if, return, None. You can\'t rename these; they ARE the language.' },
    { id: 'fn',  name: 'Built-in tools', plain: 'Functions Python gives you for free — print(), len(), sorted(), int(). Always followed by ( ).' },
    { id: 'mth', name: 'Methods',        plain: 'Abilities that belong to a value, called with a dot — nums.append(), s.strip(). The dot means "do YOUR trick".' },
    { id: 'var', name: 'Your variables', plain: 'Names YOU invented — nums, s, ages, score. Just labels pointing at values. Rename them and nothing else changes.' },
    { id: 'str', name: 'Text values',    plain: 'Anything in quotes — "DataPipeline". Even "5" in quotes is text, not a number.' },
    { id: 'num', name: 'Number values',  plain: 'Real numbers — 3, 94.5678, -1. No quotes. These you can do math with.' },
    { id: 'op',  name: 'Operators',      plain: 'The action symbols — = assigns, == compares, + adds or glues, * multiplies or repeats.' },
    { id: 'cm',  name: 'Comments',       plain: 'Notes after a # sign. Python skips them completely — they exist only for humans.' },
    { id: 'out', name: 'Output',         plain: 'What the program prints — shown after a #→ marker so you can tell it apart from the code.' }
  ];

  var KEYWORDS = ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is',
    'None', 'True', 'False', 'break', 'continue', 'pass', 'try', 'except', 'finally', 'raise', 'lambda',
    'global', 'import', 'from', 'as', 'with', 'class', 'del', 'yield'];
  var BUILTINS = ['print', 'len', 'range', 'sorted', 'reversed', 'enumerate', 'zip', 'sum', 'min', 'max',
    'abs', 'round', 'int', 'float', 'str', 'list', 'dict', 'set', 'tuple', 'type', 'input', 'any', 'all',
    'isinstance', 'repr', 'id', 'bool'];

  var KW = {}, BI = {};
  KEYWORDS.forEach(function (k) { KW[k] = 1; });
  BUILTINS.forEach(function (k) { BI[k] = 1; });

  function esc(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function span(cls, text) { return '<span class="tk-' + cls + '">' + esc(text) + '</span>'; }

  /* Tokenize one line of Python-ish code into colored HTML. */
  function tokenizeLine(line) {
    var out = '', i = 0, n = line.length;

    /* output marker: everything after  #→  is program output */
    var om = line.indexOf('#→');
    if (om === -1) om = line.indexOf('#->');
    if (om !== -1) {
      return tokenizeLine(line.slice(0, om)) + span('out', line.slice(om).replace('#->', '#→'));
    }

    while (i < n) {
      var ch = line[i];

      /* comment to end of line */
      if (ch === '#') { out += span('cm', line.slice(i)); break; }

      /* strings (with f-string brace highlighting) */
      if (ch === '"' || ch === "'" || ((ch === 'f' || ch === 'F') && (line[i + 1] === '"' || line[i + 1] === "'"))) {
        var isF = (ch === 'f' || ch === 'F');
        var qi = isF ? i + 1 : i, q = line[qi], j = qi + 1;
        while (j < n && line[j] !== q) j++;
        var whole = line.slice(i, Math.min(j + 1, n));
        if (isF) {
          /* color {expr} inside f-strings as variables */
          var inner = whole.replace(/\{([^}]*)\}/g, '$1');
          var parts = inner.split(/([^]*)/g);
          out += '<span class="tk-str">';
          parts.forEach(function (p) {
            if (p[0] === '') out += '</span><span class="tk-var">{' + esc(p.slice(1, -1)) + '}</span><span class="tk-str">';
            else out += esc(p);
          });
          out += '</span>';
        } else out += span('str', whole);
        i = j + 1; continue;
      }

      /* numbers */
      if (/[0-9]/.test(ch) && !/[A-Za-z0-9_]/.test(line[i - 1] || '')) {
        var m = /^[0-9]+(?:\.[0-9]+)?/.exec(line.slice(i));
        out += span('num', m[0]); i += m[0].length; continue;
      }

      /* words: keyword / builtin / method / variable */
      if (/[A-Za-z_]/.test(ch)) {
        var w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i))[0];
        var prev = line[i - 1];
        var nextCh = line[i + w.length];
        if (KW[w]) out += span('kw', w);
        else if (prev === '.') out += span('mth', w);
        else if (BI[w] && nextCh === '(') out += span('fn', w);
        else out += span('var', w);
        i += w.length; continue;
      }

      /* operators + punctuation */
      if (/[=+\-*/%<>!&|]/.test(ch)) {
        var om2 = /^(==|!=|<=|>=|\/\/|\*\*|\+=|-=|\*=|\/=|->|[=+\-*/%<>!&|])/.exec(line.slice(i));
        out += span('op', om2[0]); i += om2[0].length; continue;
      }

      out += esc(ch); i++;
    }
    return out;
  }

  function tokenize(code) {
    return String(code).split('\n').map(tokenizeLine).join('\n');
  }

  /* Render a code block: <pre class="bst-code">…tokens…</pre> */
  function codeBlock(code) {
    return '<pre class="bst-code">' + tokenize(code) + '</pre>';
  }

  /* Render the legend panel body */
  function legendHTML() {
    return LEGEND.map(function (e) {
      return '<div class="lg-row"><span class="lg-chip tk-' + e.id + '">' + e.name + '</span><span class="lg-plain">' + e.plain + '</span></div>';
    }).join('');
  }

  window.BST.tokenize = tokenize;
  window.BST.codeBlock = codeBlock;
  window.BST.LEGEND = LEGEND;
  window.BST.legendHTML = legendHTML;
})();

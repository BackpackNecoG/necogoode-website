/* ═══════════════════════════════════════════════════════════════════════
   BYTE SIZED TRAINING — the full 8-lesson curriculum. One continuing
   dataset travels through every lesson (the "studio dataset"):

     name  = "Neco"                          score = 94.5678
     s     = "DataPipeline"                  nums  = [3, 1, 4, 1, 5]
     ages  = {"amy": 31, "bo": 27}           rows  = ["ok","fail","ok","ok","fail"]
     pairs = [("etl", 3), ("api", 1), ("db", 2)]

   Lesson N's questions build on values created in lessons 1..N-1, and the
   engine additionally injects REVIEW questions from earlier lessons into
   every finale (the compounding rule). All code facts in this file were
   verified by executing them in Python before shipping.

   Shapes:
     beat  {say, screen:{kick, head, code, note}}
     mc    {id, q, code?, opts[4], a:idx, why, concept}
     dd    {id, q, note?, parts:[{t:'literal'}|{s:answerIdx}], answers[], bank[], why, concept}
     fix   {id, brief, code, must:[regexSrc], mustNot:[regexSrc], model, concept}
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.BST = window.BST || {};

  var DATASET =
    'name  = "Neco"\n' +
    'score = 94.5678\n' +
    's     = "DataPipeline"\n' +
    'nums  = [3, 1, 4, 1, 5]\n' +
    'ages  = {"amy": 31, "bo": 27}\n' +
    'pairs = [("etl", 3), ("api", 1), ("db", 2)]\n' +
    'rows  = ["ok", "fail", "ok", "ok", "fail"]';

  window.BST.LESSONS = [

  /* ═══════════ LESSON 1 — VARIABLES & THE ARROW RULE ═══════════ */
  {
    id: 'l1', num: 1, chip: 'CH·1', title: 'Variables & the Arrow Rule', kick: 'THE HEADLINES', minutes: 10,
    recap: null,
    intro: "Good evening — you're LIVE on Byte Sized Training, and I'm your anchor, Mr. Bryte. Tonight's top story: what a variable actually IS. Get this one idea right and half of all Python bugs can't touch you. Our studio dataset is on the big screen — those exact values travel with us for all eight lessons. Let's roll.",
    subs: [
      {
        id: 'l1a', title: 'Names are labels, not boxes',
        beats: [
          { say: "Meet the dataset. Four stars of the show: a text value, a number, a string, and a list. When you write name equals Neco, you are NOT filling a box — you're sticking a label on a value. The label points at the value. That's the Arrow Rule.",
            screen: { kick: 'THE STUDIO DATASET', head: 'Labels pointing at values', code: DATASET, note: 'A variable is an arrow: name ──▶ "Neco". You invented the label; Python owns the value.' } },
          { say: "Now watch two different kinds of change. Numbers and strings are IMMUTABLE — they never change; the label just moves to a NEW value. Lists are MUTABLE — the value itself can be edited in place while every label keeps pointing at it. Say it with me: labels move, lists change.",
            screen: { kick: 'TWO KINDS OF CHANGE', head: 'Rebind vs. mutate', code:
              'score = score + 5      # label MOVES to a brand-new number\n' +
              'nums.append(9)         # the list ITSELF changes, in place\n' +
              's = s + "X"            # strings never change — new string, label moves',
              note: 'Immutable: int, float, str, tuple. Mutable: list, dict, set.' } }
        ],
        quiz: [
          { id: 'l1a-q1', q: 'After this runs, what is x?', code: 'x = 10\ny = x\ny = 99',
            opts: ['10', '99', 'Error — x was reused', '109'], a: 0,
            why: 'y = x pointed y at the number 10. y = 99 then MOVED the y label to a new number. Numbers are immutable — x never budged.', concept: 'rebinding immutable values' },
          { id: 'l1a-q2', q: 'Which of these values can be changed IN PLACE (mutable)?',
            opts: ['nums = [3, 1, 4, 1, 5]', 's = "DataPipeline"', 'score = 94.5678', 'name = "Neco"'], a: 0,
            why: 'Lists are mutable — append/remove edit the same list. Strings and numbers are immutable; every "change" is really a new value.', concept: 'mutable vs immutable' }
        ],
        build: { id: 'l1a-b1', q: 'Add the value 9 to the END of our list, in place.',
          note: 'Remember: abilities that belong to a value are called with a dot.',
          parts: [{ s: 0 }, { t: '.' }, { s: 1 }, { t: '(9)' }],
          answers: ['nums', 'append'], bank: ['s', 'extend', 'add', 'push'],
          why: 'nums.append(9) — the dot means "nums, do YOUR trick". append adds one item to the end of the same list.', concept: 'list mutation with append' }
      },
      {
        id: 'l1b', title: 'The arrow trap — aliasing & real copies',
        beats: [
          { say: "Breaking news, and it's the biggest trap in Python: b equals nums does NOT copy the list. It sticks a SECOND label on the SAME list. Two arrows, one list. Change it through either label and BOTH see it.",
            screen: { kick: 'THE ARROW TRAP', head: 'Two labels, ONE list', code:
              'b = nums               # second label, same list!\n' +
              'b.append(9)\n' +
              'print(nums)            #→ [3, 1, 4, 1, 5, 9]   ← nums changed too!',
              note: 'b = nums copies the ARROW, never the list.' } },
          { say: "The fix is a real copy. Square brackets colon square brackets — a fresh list with the same contents. Now the arrows point at different lists and my edits stay mine. For lists inside lists you'd need copy.deepcopy, but the slice copy covers most days.",
            screen: { kick: 'THE REAL COPY', head: 'nums[:] makes a NEW list', code:
              'nums = [3, 1, 4, 1, 5]\n' +
              'c = nums[:]            # independent copy\n' +
              'c.append(7)\n' +
              'print(nums)            #→ [3, 1, 4, 1, 5]   ← untouched\n' +
              'print(c)               #→ [3, 1, 4, 1, 5, 7]',
              note: 'Copies: nums[:]  ·  list(nums)  ·  nums.copy()' } }
        ],
        quiz: [
          { id: 'l1b-q1', q: 'What prints?', code: 'a = [1, 2, 3]\nb = a\nb += [4]\nprint(a)',
            opts: ['[1, 2, 3, 4]', '[1, 2, 3]', '[4]', 'Error'], a: 0,
            why: 'b = a is two labels on one list, and += on a list edits it in place. a sees the 4. (This exact question fooled our anchor once. Once.)', concept: 'aliasing + in-place +=' },
          { id: 'l1b-q2', q: 'Which line gives you an INDEPENDENT copy of nums?',
            opts: ['c = nums[:]', 'c = nums', 'c == nums', 'c = nums.sort()'], a: 0,
            why: 'nums[:] slices the whole list into a new one. c = nums is the trap (one list), == just compares, and .sort() returns None — lesson 3 has more on that one.', concept: 'copying lists' }
        ],
        build: { id: 'l1b-b1', q: 'Make c an independent copy of nums (so editing c never touches nums).',
          parts: [{ s: 0 }, { t: ' = ' }, { s: 1 }, { t: '[' }, { s: 2 }, { t: ']' }],
          answers: ['c', 'nums', ':'], bank: ['b', '0', 'copy', '1:'],
          why: 'c = nums[:] — the full-slice copy. A new list, same contents, separate arrows.', concept: 'slice copy' }
      }
    ],
    finale: {
      say: "Finale time — two broken clips from the field. Fix them in the box, plain Python, and I'll have our AI control room review your work word by word. Remember the Arrow Rule and you'll be fine.",
      quiz: [
        { id: 'l1f-q1', q: 'Strings are immutable. So what does this do?', code: 's = "DataPipeline"\ns[0] = "X"',
          opts: ['TypeError — strings can\'t be edited in place', 'Changes s to "XataPipeline"', 'Silently does nothing', 'Makes a copy with X'], a: 0,
          why: "Immutable means NO in-place edits — item assignment on a string raises TypeError. To 'change' a string you build a new one: s = \"X\" + s[1:].", concept: 'string immutability' }
      ],
      fixes: [
        { id: 'l1f-f1', brief: 'This swap is broken — after it runs, both labels point at 27. Fix the swap so amy_age is 27 and bo_age is 31. (Python has a one-line trick.)',
          code: 'amy_age = 31\nbo_age = 27\n\n# broken swap:\namy_age = bo_age\nbo_age = amy_age',
          must: ['amy_age\\s*,\\s*bo_age\\s*=\\s*bo_age\\s*,\\s*amy_age|temp|tmp'], mustNot: [],
          model: 'amy_age, bo_age = bo_age, amy_age', concept: 'tuple swap / assignment order' },
        { id: 'l1f-f2', brief: "backup is supposed to preserve the ORIGINAL list before we edit nums — but after this runs, backup has the 9 in it too. Fix one line so backup stays [3, 1, 4, 1, 5].",
          code: 'nums = [3, 1, 4, 1, 5]\nbackup = nums        # ← the problem line\nnums.append(9)\nprint(backup)        #→ [3, 1, 4, 1, 5, 9]  ✗ wanted [3, 1, 4, 1, 5]',
          must: ['backup\\s*=\\s*(nums\\[\\s*:\\s*\\]|list\\(\\s*nums\\s*\\)|nums\\.copy\\(\\))'], mustNot: [],
          model: 'backup = nums[:]', concept: 'aliasing vs copying' }
      ]
    },
    card: { title: 'CARD 1 · Variables', lines: [
      'A variable is a LABEL with an arrow to a value',
      'b = a copies the ARROW, not the list (aliasing!)',
      'Real copy: nums[:]  ·  list(nums)  ·  nums.copy()',
      'Immutable (never change): int, float, str, tuple',
      'Mutable (change in place): list, dict, set',
      's[0] = "X" on a string → TypeError',
      'Swap trick: a, b = b, a'
    ] }
  },

  /* ═══════════ LESSON 2 — STRINGS & FORMATTING ═══════════ */
  {
    id: 'l2', num: 2, chip: 'CH·2', title: 'Strings & Formatting', kick: 'THE WORD DESK', minutes: 10,
    recap: { title: 'PREVIOUSLY ON BYTE SIZED TRAINING', lines: [
      'Variables are LABELS with arrows — b = a shares one list',
      'Real copies: nums[:] — strings & numbers are immutable',
      'The dataset lives on: s = "DataPipeline", score = 94.5678' ] },
    intro: "Welcome back. Last lesson you learned the Arrow Rule and made real copies. Tonight the Word Desk takes over: we slice our string s, we clean text like a pro, and we print numbers that look like they belong on television. Same dataset, same s equals DataPipeline.",
    subs: [
      {
        id: 'l2a', title: 'Slicing DataPipeline',
        beats: [
          { say: "Every character in s has a seat number, starting at ZERO. Square brackets grab one seat. Negative numbers count from the back row. And a slice grabs a range — start included, end EXCLUDED. That exclusion is the number-one off-by-one in the business.",
            screen: { kick: 'SEAT NUMBERS', head: 's = "DataPipeline"  (12 seats, 0–11)', code:
              's[0]      #→ \'D\'        first seat\n' +
              's[-1]     #→ \'e\'        last seat, counted from the back\n' +
              's[4:8]    #→ \'Pipe\'     seats 4,5,6,7 — the 8 is EXCLUDED\n' +
              's[:4]     #→ \'Data\'     from the start\n' +
              's[-4:]    #→ \'line\'     the last four',
              note: 'Slice rule: [start : stop : step] — stop is never included.' } },
          { say: "Third slot in a slice is the STEP — and slot position is everything. s bracket colon 3 means STOP at 3: Dat. s bracket colon colon 3 means STEP by 3: Dapi. Same digit, different slot, different answer. And step minus one walks backward — the famous full reverse.",
            screen: { kick: 'STOP vs STEP', head: 'Count the colons before the number', code:
              's[:3]     #→ \'Dat\'      one colon before → STOP at 3\n' +
              's[::3]    #→ \'Dapi\'     two colons before → STEP by 3\n' +
              's[::-1]   #→ \'enilepiPataD\'   step -1 = reverse (memorize!)',
              note: '[:3] first three · [::3] every third · [::-1] reversed' } }
        ],
        quiz: [
          { id: 'l2a-q1', q: 'With s = "DataPipeline", what is s[-4:]?',
            opts: ["'line'", "'Data'", "'eni l'", "'e'"], a: 0,
            why: '-4 starts four seats from the end and runs to the finish: l-i-n-e.', concept: 'negative slicing' },
          { id: 'l2a-q2', q: 'Stop vs step: what is s[::3]?',
            opts: ["'Dapi' — every 3rd character", "'Dat' — the first three", "'aPp' — starting at 3", 'Error'], a: 0,
            why: 'Two colons before the 3 put it in the STEP slot: seats 0, 3, 6, 9 → D, a, p, i. The first-three answer belongs to s[:3].', concept: 'slice step vs stop' }
        ],
        build: { id: 'l2a-b1', q: 'Build rev as the REVERSED copy of s.',
          parts: [{ s: 0 }, { t: ' = ' }, { s: 1 }, { t: '[' }, { s: 2 }, { t: ']' }],
          answers: ['rev', 's', '::-1'], bank: [':3', '3:', ':-1', 'nums'],
          why: 'rev = s[::-1] — empty start, empty stop, step -1: walk the whole string backwards.', concept: 'reverse slice' }
      },
      {
        id: 'l2b', title: 'Methods return NEW strings',
        beats: [
          { say: "Strings are immutable — lesson 1! — so every string method hands you a NEW string. Call strip and throw the result away? Nothing happened. You must CATCH the new string, usually by re-labeling the same name. This is the most common silent bug in text cleanup.",
            screen: { kick: 'CATCH THE RESULT', head: 'Methods never edit — they return', code:
              'raw = "  Data Pipeline  "\n' +
              'raw.strip()            # new string created… and DROPPED\n' +
              'print(raw)             #→ \'  Data Pipeline  \'   unchanged!\n' +
              'raw = raw.strip()      # ✓ catch it\n' +
              'print(raw)             #→ \'Data Pipeline\'',
              note: 'Chain them: raw.strip().lower() — left to right, each returns a new string.' } },
          { say: "The everyday toolbelt: lower for case-proofing, split to chop text into a list, and join to glue a list back — careful, the GLUE goes first. Plus the in test for 'does it contain'. These five do most of the work in every assessment.",
            screen: { kick: 'THE TOOLBELT', head: 'Five methods, most of the job', code:
              's.lower()              #→ \'datapipeline\'\n' +
              '"a,b,c".split(",")     #→ [\'a\', \'b\', \'c\']\n' +
              '"-".join(["a","b"])    #→ \'a-b\'    glue goes FIRST\n' +
              '"Pipe" in s            #→ True\n' +
              's.count("a")           #→ 2',
              note: 'split: string → list · join: list → string' } }
        ],
        quiz: [
          { id: 'l2b-q1', q: 'After this runs, what is s?', code: 's = "DataPipeline"\ns.upper()',
            opts: ['"DataPipeline" — unchanged', '"DATAPIPELINE"', '"datapipeline"', 'None'], a: 0,
            why: '.upper() built a new string that nobody caught. Strings are immutable — without s = s.upper(), s keeps its old value.', concept: 'discarded method result' },
          { id: 'l2b-q2', q: 'What does "-".join(["etl", "api", "db"]) return?',
            opts: ["'etl-api-db'", "'-etlapidb'", "['etl-api-db']", "'etl api db'"], a: 0,
            why: 'join glues the list items using the string it was called ON — the glue goes first, between every pair.', concept: 'join direction' }
        ],
        build: { id: 'l2b-b1', q: 'Normalize messy user input: trim the spaces, then lowercase — caught back into clean.',
          note: 'Methods chain left to right, each with its own ( ).',
          parts: [{ s: 0 }, { t: ' = raw.' }, { s: 1 }, { t: '().' }, { s: 2 }, { t: '()' }],
          answers: ['clean', 'strip', 'lower'], bank: ['tolower', 'trim', 'split'],
          why: 'clean = raw.strip().lower() — strip the edges, then lowercase the result. (tolower and trim are other languages — Python says lower and strip.)', concept: 'method chaining + normalization' }
      },
      {
        id: 'l2c', title: 'f-strings — the label maker',
        beats: [
          { say: "The f in front of a string turns it into a LABEL MAKER: anything in curly braces gets evaluated and dropped in; everything outside the braces prints exactly as written. After the colon comes the format spec — point-2-f means 'fixed decimal, two places', and yes, it ROUNDS.",
            screen: { kick: 'THE LABEL MAKER', head: 'f"…{value:spec}…"', code:
              'print(f"{name} scored {score:.2f}")\n' +
              '#→ Neco scored 94.57      ← .2f ROUNDS 94.5678\n' +
              'print(f"Total: {score:.1f}")\n' +
              '#→ Total: 94.6            ← literal text prints too!',
              note: 'No f prefix? The braces print literally: "{name}".' } },
          { say: "One more spec: a number before the dot is the total WIDTH — pad with spaces to fill it, and the arrow picks the side. Width 5 holding a one-character 7 means FOUR spaces of padding. It exists to line numbers up in columns, nothing more.",
            screen: { kick: 'WIDTH & ALIGNMENT', head: 'spaces = width − length of value', code:
              'print(f"{7:>5}")       #→ \'    7\'   4 spaces then 7\n' +
              'print(f"{42:>6}")      #→ \'    42\'  right edge aligned\n' +
              'print(f"{score:>10.1f}") #→ \'      94.6\'',
              note: '> right · < left · ^ center' } }
        ],
        quiz: [
          { id: 'l2c-q1', q: 'What prints?', code: 'score = 94.5678\nprint(f"Total: {score:.1f}")',
            opts: ["Total: 94.6", "94.6", "Total: 94.5", "Total: {score:.1f}"], a: 0,
            why: 'Two-pass reading: literal text first (Total: ), then the brace — .1f rounds 94.5678 to 94.6. Dropping the literal text is the classic miss.', concept: 'f-string literals + rounding' },
          { id: 'l2c-q2', q: 'How many spaces print before the 7 in f"{7:>5}"?',
            opts: ['4', '5', '1', '0'], a: 0,
            why: '5 is the TOTAL width. The 7 fills one character; padding = 5 − 1 = 4 spaces.', concept: 'format width' }
        ],
        build: { id: 'l2c-b1', q: 'Build the broadcast line: Neco scored 94.57 — using the dataset variables, rounded to 2 decimals.',
          parts: [{ t: 'print(f"' }, { s: 0 }, { t: ' scored ' }, { s: 1 }, { t: '")' }],
          answers: ['{name}', '{score:.2f}'], bank: ['{score}', '{name:.2f}', '{score:.2}', 'name'],
          why: 'print(f"{name} scored {score:.2f}") — braces evaluate, .2f rounds to two places.', concept: 'f-string building' }
      }
    ],
    finale: {
      say: "Word Desk finale. Two field clips are broken — one crashes, one lies to the user. You know the Arrow Rule, you know methods return new strings, you know int and str never mix raw. Fix them.",
      quiz: [],
      fixes: [
        { id: 'l2f-f1', brief: 'This crashes with TypeError: can only concatenate str to str. Fix the print so it works (an f-string is the cleanest repair).',
          code: 'count = 3\nmsg = "Pipelines online: " + count   # ✗ TypeError\nprint(msg)',
          must: ['f"|f\'|str\\(\\s*count\\s*\\)'], mustNot: [],
          model: 'msg = f"Pipelines online: {count}"', concept: 'str + int mixing' },
        { id: 'l2f-f2', brief: 'The gate should accept " Yes ", "YES", and "yes" — right now only exact "yes" passes. Normalize the input before comparing.',
          code: 'answer = input("Deploy? ")\nif answer == "yes":\n    print("Deploying")\nelse:\n    print("Cancelled")',
          must: ['\\.strip\\(\\)', '\\.lower\\(\\)'], mustNot: [],
          model: 'if answer.strip().lower() == "yes":', concept: 'input normalization' }
      ]
    },
    card: { title: 'CARD 2 · Strings & f-strings', lines: [
      'Seats start at 0 · s[-1] is the last · stop is EXCLUDED',
      '[:3] first three · [::3] every third · [::-1] reversed',
      'Methods return NEW strings — catch them: s = s.strip()',
      'Normalize input: raw.strip().lower()',
      'glue.join(list) — the glue goes first',
      'f"{score:.2f}" rounds to 2 places · literal text prints as-is',
      'Width pads with spaces: f"{7:>5}" → four spaces then 7',
      'Never "text" + number — use f-strings or str()'
    ] }
  },

  /* ═══════════ LESSON 3 — COLLECTIONS ═══════════ */
  {
    id: 'l3', num: 3, chip: 'CH·3', title: 'Collections — Lists, Dicts, Sets & Tuples', kick: 'THE TOOLBOX', minutes: 10,
    recap: { title: 'PREVIOUSLY ON BYTE SIZED TRAINING', lines: [
      'Slices: [:3] stop · [::3] step · [::-1] reverse',
      'String methods return NEW strings — catch them (s = s.strip())',
      'f"{score:.2f}" → 94.57 — braces evaluate, text prints as-is' ] },
    intro: "Back in the studio. You can label values and slice text — tonight we open the toolbox: four containers, and knowing WHICH one is half the job. Lists keep order, dicts look things up, sets kill duplicates, tuples never change. Our nums, ages, and pairs are all waiting.",
    subs: [
      {
        id: 'l3a', title: 'The list toolbelt (and the sort() gotcha)',
        beats: [
          { say: "Our list nums has a toolbelt: append adds one, extend adds many, pop removes AND HANDS BACK, remove hunts a value. And the mirror pair everyone mixes up: nums bracket 2 asks WHAT'S AT seat 2 — that's 4. nums dot index of 4 asks WHERE IS the value 4 — that's seat 2. Mirror operations.",
            screen: { kick: 'THE TOOLBELT', head: 'nums = [3, 1, 4, 1, 5]', code:
              'nums.append(9)     # add one to the end\n' +
              'nums.extend([2,6]) # add each of these\n' +
              'last = nums.pop()  # remove the last AND hand it back\n' +
              'nums[2]            #→ 4   value AT seat 2\n' +
              'nums.index(4)      #→ 2   seat OF value 4  (mirror!)\n' +
              'nums.count(1)      #→ 2   how many 1s',
              note: 'Read x[n] as "what\'s at n" and x.index(n) as "where is n".' } },
          { say: "Now the classic gotcha, live on air: dot-sort sorts the list IN PLACE and returns NONE. Assign that and your variable holds nothing. The built-in sorted returns a NEW sorted list and leaves the original alone. In-place methods return None — sort, reverse, append, all of them.",
            screen: { kick: 'THE CLASSIC GOTCHA', head: 'sort() vs sorted()', code:
              'result = nums.sort()      # ✗ result is None!\n' +
              'result = sorted(nums)     # ✓ [1, 1, 3, 4, 5] — new list\n' +
              'sorted(nums, reverse=True)#→ [5, 4, 3, 1, 1]  descending\n' +
              'nums[::-1]                # ← that just FLIPS, no sorting',
              note: 'reverse=True = sort high→low. [::-1] = flip current order. Different jobs!' } }
        ],
        quiz: [
          { id: 'l3a-q1', q: 'What prints?', code: 'nums = [3, 1, 4, 1, 5]\nresult = nums.sort()\nprint(result)',
            opts: ['None', '[1, 1, 3, 4, 5]', '[3, 1, 4, 1, 5]', 'Error'], a: 0,
            why: '.sort() does its work inside nums and returns None. Want a value back? sorted(nums).', concept: 'in-place returns None' },
          { id: 'l3a-q2', q: 'With nums = [3, 1, 4, 1, 5]: what is nums.index(4)?',
            opts: ['2', '5', '4', '1'], a: 0,
            why: 'index(4) asks WHERE the value 4 lives → seat 2. (nums[4] would be the mirror question — what\'s AT seat 4 → 5.)', concept: 'index vs subscript' }
        ],
        build: { id: 'l3a-b1', q: 'Build top as a NEW list of nums sorted high-to-low — without touching nums.',
          parts: [{ s: 0 }, { t: ' = ' }, { s: 1 }, { t: '(nums, ' }, { s: 2 }, { t: '=True)' }],
          answers: ['top', 'sorted', 'reverse'], bank: ['sort', 'flip', 'nums.sort', 'descending'],
          why: 'top = sorted(nums, reverse=True) — sorted returns a new list; reverse=True makes it descending. nums.sort() would edit nums and return None.', concept: 'sorted with reverse' }
      },
      {
        id: 'l3b', title: 'Dicts — the label→value machine',
        beats: [
          { say: "A dict is a lookup table: every KEY points at exactly one VALUE. Square brackets fetch — but a missing key CRASHES with KeyError. The polite cousin is dot-get: give it a fallback and it can never crash. And the in test checks KEYS only — never values.",
            screen: { kick: 'LOOKUP RULES', head: 'ages = {"amy": 31, "bo": 27}', code:
              'ages["amy"]          #→ 31\n' +
              'ages["zed"]          # ✗ KeyError: \'zed\'\n' +
              'ages.get("zed")      #→ None    no crash\n' +
              'ages.get("zed", 0)   #→ 0       your fallback\n' +
              '"amy" in ages        #→ True    checks KEYS\n' +
              '31 in ages           #→ False!  31 is a value\n' +
              '31 in ages.values()  #→ True',
              note: 'Python\'s "nothing" is None — capital N. (Not null — that\'s other languages.)' } },
          { say: "Keys are UNIQUE — writing to an existing key silently overwrites, no warning. One key, one value… but that value can be a whole list. That's how one person holds many scores: the key points at a container.",
            screen: { kick: 'UNIQUE KEYS', head: 'Overwrite is silent — plan for it', code:
              'ages["cal"] = 40     # add\n' +
              'ages["amy"] = 32     # OVERWRITES 31 — no error, no mercy\n' +
              'scores = {"amy": [90, 85]}   # one key → list of values\n' +
              'scores["amy"].append(99)     # amy now has three',
              note: 'Need many values per key? Store a list AS the value.' } }
        ],
        quiz: [
          { id: 'l3b-q1', q: 'What does ages.get("zed", 0) return when "zed" is not in ages?',
            opts: ['0 — the fallback you supplied', 'None', 'KeyError', '"zed"'], a: 0,
            why: 'get\'s second argument is the answer for missing keys. No second argument → None. Square brackets → KeyError.', concept: 'dict get with default' },
          { id: 'l3b-q2', q: 'ages = {"amy": 31, "bo": 27}. Which expression is True?',
            opts: ['"amy" in ages', '31 in ages', 'ages.get("amy") == "31"', '"31" in ages.values()'], a: 0,
            why: 'in searches KEYS. 31 is a value (needs ages.values()), and get("amy") returns the NUMBER 31, not the text "31".', concept: 'in checks keys' }
        ],
        build: { id: 'l3b-b1', q: 'Fetch bo\'s age safely — 0 if "bo" ever goes missing. No crashes allowed.',
          parts: [{ t: 'age = ages.' }, { s: 0 }, { t: '(' }, { s: 1 }, { t: ', ' }, { s: 2 }, { t: ')' }],
          answers: ['get', '"bo"', '0'], bank: ['fetch', 'bo', 'None', '["bo"]'],
          why: 'ages.get("bo", 0) — get takes the key (in quotes — it\'s text!) and the fallback. Bracket access would crash on a missing key.', concept: 'safe dict access' }
      },
      {
        id: 'l3c', title: 'Tuples & sets — sealed boxes and no-duplicates',
        beats: [
          { say: "Our pairs list holds TUPLES — sealed boxes. Each box keeps its name and number together forever; sorting rearranges whole boxes, never the contents. Sort them BY the number with a key function — lambda p: p bracket 1 means 'for each pair, judge it by its second item'.",
            screen: { kick: 'SEALED BOXES', head: 'pairs = [("etl", 3), ("api", 1), ("db", 2)]', code:
              'sorted(pairs, key=lambda p: p[1])\n' +
              '#→ [(\'api\', 1), (\'db\', 2), (\'etl\', 3)]\n' +
              'sorted(pairs, key=lambda p: p[1], reverse=True)\n' +
              '#→ [(\'etl\', 3), (\'db\', 2), (\'api\', 1)]',
              note: 'lambda p: p[1] = a one-line unnamed function: takes p, returns p[1]. The pairs travel INTACT.' } },
          { say: "And sets: bags with a strict no-duplicates policy. Wrap any list in set and the repeats vanish — instant dedupe, instant 'how many DIFFERENT values'. One trap: empty curly braces make an empty DICT, not a set. Use set() for an empty one.",
            screen: { kick: 'NO DUPLICATES', head: 'set(nums) — the dedupe machine', code:
              'set(nums)          #→ {1, 3, 4, 5}   the two 1s collapsed\n' +
              'len(set(nums))     #→ 4              distinct values\n' +
              'unique = list(set(nums))   # back to a list\n' +
              'empty = set()      # ✓  ({} would be an empty DICT)',
              note: 'Membership is fast: 4 in set(nums) → True' } }
        ],
        quiz: [
          { id: 'l3c-q1', q: 'What is sorted(pairs, key=lambda p: p[1])[0]?', code: 'pairs = [("etl", 3), ("api", 1), ("db", 2)]',
            opts: ['("api", 1)', '("etl", 3)', '("api", 3)', '1'], a: 0,
            why: 'Sort ascending by each pair\'s second item → api\'s 1 is smallest, and the pair travels intact: ("api", 1). Never re-pair names with new numbers!', concept: 'key sorting, tuples intact' },
          { id: 'l3c-q2', q: 'nums = [3, 1, 4, 1, 5]. What is len(set(nums))?',
            opts: ['4', '5', '3', '1'], a: 0,
            why: 'set(nums) collapses the duplicate 1s → {1, 3, 4, 5} → four distinct values.', concept: 'set dedupe' }
        ],
        build: { id: 'l3c-b1', q: 'Count how many DIFFERENT values nums holds (duplicates don\'t count).',
          parts: [{ t: 'unique = ' }, { s: 0 }, { t: '(' }, { s: 1 }, { t: '(nums))' }],
          answers: ['len', 'set'], bank: ['count', 'list', 'sum', 'dict'],
          why: 'len(set(nums)) — set drops the duplicates, len counts what survived. Inside-out reading: set first, then len.', concept: 'len(set(...)) idiom' }
      }
    ],
    finale: {
      say: "Toolbox finale. Two clips from the field — one crashes on missing data, one loses a customer's order. Everything you need is on your cards: get with a fallback, extend versus append, and the sort that returns None.",
      quiz: [],
      fixes: [
        { id: 'l3f-f1', brief: 'This crashes with KeyError when a player is missing. Make it return 0 for unknown players instead of crashing.',
          code: 'def get_score(scores, player):\n    return scores[player] + 10\n\nprint(get_score({"amy": 90}, "bo"))   # ✗ KeyError: \'bo\'',
          must: ['\\.get\\(\\s*player\\s*,\\s*0\\s*\\)|in scores'], mustNot: [],
          model: 'return scores.get(player, 0) + 10', concept: 'KeyError → get with default' },
        { id: 'l3f-f2', brief: 'The order should end as [3, 1, 4, 1, 5, 99, 100] — seven items. Instead it ends with a LIST stuck inside the list (6 items, the last one is [99, 100]). Fix it.',
          code: 'order = [3, 1, 4, 1, 5]\norder.append([99, 100])      # ✗ nests the whole list as ONE item\nprint(len(order))            #→ 6, wanted 7',
          must: ['\\.extend\\(|\\+=\\s*\\['], mustNot: [],
          model: 'order.extend([99, 100])', concept: 'append vs extend' }
      ]
    },
    card: { title: 'CARD 3 · Collections', lines: [
      'x[2] = what\'s AT seat 2 · x.index(4) = WHERE is 4 (mirrors)',
      '.sort() edits in place and returns None · sorted() returns new',
      'reverse=True sorts high→low · [::-1] just flips',
      'd[key] crashes on missing · d.get(key, fallback) never does',
      '"amy" in ages checks KEYS · values need ages.values()',
      'Keys are unique — writing again overwrites silently',
      'Tuples are sealed boxes — sorting moves them whole',
      'set(nums) kills duplicates · len(set(nums)) counts distinct',
      'append adds ONE item · extend unpacks and adds EACH'
    ] }
  },

  /* ═══════════ LESSON 4 — LOOPS ═══════════ */
  {
    id: 'l4', num: 4, chip: 'CH·4', title: 'Loops — for, while & the Counting Pattern', kick: 'THE ENGINE ROOM', minutes: 10,
    recap: { title: 'PREVIOUSLY ON BYTE SIZED TRAINING', lines: [
      'x.index(4)=WHERE is 4 · x[2]=what\'s AT 2 · .sort() returns None',
      'ages.get(key, 0) never crashes · "amy" in ages checks keys',
      'Tuples travel intact · set(nums) dedupes' ] },
    intro: "The Engine Room — where code repeats itself so you don't have to. Tonight: for loops over our dataset, range and its off-by-one trap, the counting pattern every data job uses, and the while loop that runs forever if you forget one line. Read every loop asking three things: where does it start, where does it stop, what changes each pass?",
    subs: [
      {
        id: 'l4a', title: 'for + range — start, stop, step (again!)',
        beats: [
          { say: "A for loop visits every item, one per pass. The workhorse pattern is the ACCUMULATOR: a total that starts at zero BEFORE the loop and grows inside it. Our nums sum to 14 — watch the total climb.",
            screen: { kick: 'THE ACCUMULATOR', head: 'Init BEFORE, grow INSIDE', code:
              'total = 0              # before the loop — always\n' +
              'for n in nums:\n' +
              '    total += n         # 3 → 4 → 8 → 9 → 14\n' +
              'print(total)           #→ 14',
              note: 'total = 0 INSIDE the loop would reset every pass — classic planted bug.' } },
          { say: "range makes number sequences, and it obeys the same slice law from lesson 2: the stop is EXCLUDED. range 5 is zero through four. Want 1 through n inclusive? You must write n plus one. The missing plus-one is the single most planted bug in code assessments.",
            screen: { kick: 'STOP IS EXCLUDED', head: 'range(start, stop, step)', code:
              'range(5)         # 0, 1, 2, 3, 4\n' +
              'range(1, 6)      # 1, 2, 3, 4, 5\n' +
              'range(10, 0, -2) # 10, 8, 6, 4, 2\n' +
              '# sum 1..n INCLUSIVE:\n' +
              'for i in range(1, n + 1):   # ← the +1 is the whole game',
              note: 'Same law as slices — lesson 2\'s s[4:8] excluded the 8.' } }
        ],
        quiz: [
          { id: 'l4a-q1', q: 'sum_to(5) should return 15 (1+2+3+4+5). What does it ACTUALLY return?',
            code: 'def sum_to(n):\n    total = 0\n    for i in range(1, n):\n        total += i\n    return total',
            opts: ['10 — the 5 never joins', '15', '5', '0'], a: 0,
            why: 'range(1, n) stops BEFORE n, so 5 is excluded: 1+2+3+4 = 10. Fix: range(1, n + 1).', concept: 'range off-by-one' },
          { id: 'l4a-q2', q: 'Spot the planted bug:', code: 'for n in nums:\n    total = 0\n    total += n\nprint(total)',
            opts: ['total resets to 0 every pass — only the last item counts', 'nums is misspelled', 'The += should be =', 'Nothing — prints 14'], a: 0,
            why: 'total = 0 sits INSIDE the loop, wiping the sum each pass. It prints 5 (just the last item). Initialize before the loop.', concept: 'accumulator placement' }
        ],
        build: { id: 'l4a-b1', q: 'Build the loop that sums 1 through n INCLUSIVE.',
          parts: [{ t: 'for i in ' }, { s: 0 }, { t: '(1, ' }, { s: 1 }, { t: '):\n    total ' }, { s: 2 }, { t: ' i' }],
          answers: ['range', 'n + 1', '+='], bank: ['n', 'len', '=', 'n - 1'],
          why: 'range(1, n + 1) reaches n because stop is excluded; += grows the accumulator.', concept: 'inclusive range + accumulator' }
      },
      {
        id: 'l4b', title: 'enumerate, zip & the counting pattern',
        beats: [
          { say: "Need the seat number AND the item? enumerate hands you both — no bracket juggling. Two lists in lockstep? zip pairs them up and stops at the shorter one. These two make ninety percent of index math disappear.",
            screen: { kick: 'TWO HELPERS', head: 'enumerate & zip', code:
              'for i, r in enumerate(rows):\n' +
              '    print(i, r)          # 0 ok / 1 fail / 2 ok …\n' +
              'for pair, r in zip(pairs, rows):\n' +
              '    print(pair[0], r)    # etl ok / api fail / db ok',
              note: 'enumerate → (index, item) tuples. Unpack them right in the for line.' } },
          { say: "Now THE pattern of every data job — counting with a dict. For each row, get the current count with a fallback of zero — lesson 3! — add one, write it back. Our rows tally to ok three, fail two. Burn this one in; it appears in almost every assessment.",
            screen: { kick: 'THE COUNTING PATTERN', head: 'rows = ["ok","fail","ok","ok","fail"]', code:
              'counts = {}\n' +
              'for r in rows:\n' +
              '    counts[r] = counts.get(r, 0) + 1\n' +
              'print(counts)            #→ {\'ok\': 3, \'fail\': 2}\n' +
              'max(counts, key=counts.get)  #→ \'ok\'   the winner',
              note: '.get(r, 0) is why the first "ok" doesn\'t crash — no key yet, fallback 0.' } }
        ],
        quiz: [
          { id: 'l4b-q1', q: 'After the counting pattern runs on rows, what is counts["ok"]?',
            code: 'rows = ["ok", "fail", "ok", "ok", "fail"]',
            opts: ['3', '2', '5', 'KeyError'], a: 0,
            why: 'Three "ok" rows → counts = {"ok": 3, "fail": 2}. The get(r, 0) fallback handles each first sighting.', concept: 'counting pattern' },
          { id: 'l4b-q2', q: 'What does enumerate(["a", "b"]) give you each pass?',
            opts: ['(0, "a") then (1, "b") — index and item together', 'Just 0 then 1', 'Just "a" then "b"', '("a", "b") once'], a: 0,
            why: 'enumerate yields (index, item) pairs — unpack with for i, x in enumerate(...).', concept: 'enumerate' }
        ],
        build: { id: 'l4b-b1', q: 'Build the counting line — the heart of the pattern.',
          parts: [{ t: 'counts[r] = counts.' }, { s: 0 }, { t: '(r, ' }, { s: 1 }, { t: ') + ' }, { s: 2 }],
          answers: ['get', '0', '1'], bank: ['fetch', 'None', 'r', '2'],
          why: 'counts.get(r, 0) reads the current tally (0 if new), + 1 bumps it, and the assignment writes it back.', concept: 'get-based counting' }
      },
      {
        id: 'l4c', title: 'while, break & the continue trap',
        beats: [
          { say: "A while loop runs as long as its condition holds — so something INSIDE must push it toward false, or it runs forever. Coderbyte won't show an error for that; it just times out. Checklist: can the condition become false, does the body make progress, and can a continue ever SKIP that progress line?",
            screen: { kick: 'THE PROGRESS RULE', head: 'Every while needs an exit', code:
              'i = 5\n' +
              'while i > 0:\n' +
              '    print(i)\n' +
              '    i -= 1        # ← delete this line = infinite loop\n' +
              '# break = leave the loop NOW\n' +
              '# continue = skip straight to the next check',
              note: 'A continue placed BEFORE the i -= 1 line skips the progress → infinite.' } },
          { say: "And the pop-consume pattern from our earlier study sessions: loop while the list has anything in it — truthiness! — pop one item into a variable, inspect it, decide. Loop on the LIST being non-empty, never on the popped value, or you'll pop right off the end.",
            screen: { kick: 'THE CONSUME LOOP', head: 'while pages: — loop on emptiness', code:
              'kept = []\n' +
              'while rows:              # truthy while non-empty\n' +
              '    r = rows.pop()       # take one out, hold it\n' +
              '    if r == "fail":\n' +
              '        continue         # discard, next pass\n' +
              '    kept.append(r)',
              note: 'pop() both removes AND returns — catch it in a variable, once per pass.' } }
        ],
        quiz: [
          { id: 'l4c-q1', q: 'Why does this hang forever?', code: 'i = 5\nwhile i > 0:\n    if i == 3:\n        continue\n    print(i)\n    i -= 1',
            opts: ['At i == 3, continue skips the i -= 1 line — i stays 3 forever', 'while can\'t count down', 'print blocks the loop', 'i > 0 is always True for any i'], a: 0,
            why: 'continue jumps back to the condition BEFORE the decrement runs. Fix: decrement before the continue (or use a for loop, which can\'t forget to advance).', concept: 'continue skips progress' },
          { id: 'l4c-q2', q: 'In a nested loop, what does break do?',
            opts: ['Exits only the INNER loop it sits in', 'Exits every loop at once', 'Skips one pass', 'Ends the program'], a: 0,
            why: 'break leaves the nearest enclosing loop only — the outer loop keeps going.', concept: 'break scope' }
        ],
        build: { id: 'l4c-b1', q: 'Build the safe consume loop: run while rows still has items, popping one each pass.',
          parts: [{ s: 0 }, { t: ' ' }, { s: 1 }, { t: ':\n    r = rows.' }, { s: 2 }, { t: '()' }],
          answers: ['while', 'rows', 'pop'], bank: ['for', 'r', 'remove', 'len'],
          why: 'while rows: uses truthiness — an empty list is False, so the loop ends exactly when the list empties. pop() hands each item out.', concept: 'consume loop + truthiness' }
      }
    ],
    finale: {
      say: "Engine Room finale. One clip hangs forever, one quietly skips data — the two worst kinds of loop bug, because nothing turns red. Trace them by hand first, THEN fix.",
      quiz: [],
      fixes: [
        { id: 'l4f-f1', brief: 'This countdown should print 5 4 2 1 (skipping 3) — instead it hangs forever. Fix it so it still skips 3 but finishes.',
          code: 'i = 5\nwhile i > 0:\n    if i == 3:\n        continue          # ✗ skips the decrement below\n    print(i)\n    i -= 1',
          must: ['i\\s*-=\\s*1[\\s\\S]*continue|range\\('], mustNot: [],
          model: 'while i > 0:\n    if i == 3:\n        i -= 1\n        continue\n    print(i)\n    i -= 1', concept: 'progress before continue' },
        { id: 'l4f-f2', brief: 'Removing items from a list WHILE looping over it skips elements — trace [1, 3, 2, 4] and the 3 survives! Rewrite the cleanup so ALL odd numbers are removed (a comprehension is the pro move).',
          code: 'nums = [1, 3, 2, 4]\nfor n in nums:\n    if n % 2 == 1:\n        nums.remove(n)     # ✗ shifts the list under the loop\nprint(nums)                #→ [3, 2, 4]  the 3 escaped!',
          must: ['\\[\\s*n\\s+for\\s+n\\s+in|nums\\[\\s*:\\s*\\]'], mustNot: [],
          model: 'nums = [n for n in nums if n % 2 == 0]', concept: 'mutation during iteration' }
      ]
    },
    card: { title: 'CARD 4 · Loops', lines: [
      'Accumulator: total = 0 BEFORE the loop, += inside',
      'range stop is EXCLUDED — 1..n needs range(1, n + 1)',
      'enumerate → (index, item) · zip pairs two lists',
      'Counting: counts[r] = counts.get(r, 0) + 1',
      'while needs PROGRESS — and continue must not skip it',
      'break exits the inner loop only · timeout = infinite while',
      'Never remove from a list you\'re looping — filter instead:',
      '  nums = [n for n in nums if keep(n)]'
    ] }
  },

  /* ═══════════ LESSON 5 — FUNCTIONS & SCOPE ═══════════ */
  {
    id: 'l5', num: 5, chip: 'CH·5', title: 'Functions & Scope', kick: 'THE ASSEMBLY LINE', minutes: 10,
    recap: { title: 'PREVIOUSLY ON BYTE SIZED TRAINING', lines: [
      'Accumulators init BEFORE the loop · range stop excluded (+1!)',
      'Counting: counts[r] = counts.get(r, 0) + 1 → {"ok": 3, "fail": 2}',
      'while needs progress · continue can skip it · filter, don\'t remove' ] },
    intro: "The Assembly Line. Tonight we box up everything you've built into FUNCTIONS — def to build the machine, return to hand back the product. Plus the difference between returning and printing (they are NOT the same), the shared-default trap, and scope: which names a function can even see. Our dataset clocks in for another shift.",
    subs: [
      {
        id: 'l5a', title: 'def + return vs print',
        beats: [
          { say: "def builds a machine, parameters are its intake, and RETURN is the conveyor belt handing the product back. Print just shows a picture of the product — nothing comes down the belt. A function with no return hands back None, and None plus anything is a TypeError three lines later.",
            screen: { kick: 'RETURN vs PRINT', head: 'The conveyor belt rule', code:
              'def average(nums):\n' +
              '    return sum(nums) / len(nums)\n' +
              'avg = average([3, 1, 4, 1, 5])   #→ 2.8   caught!\n\n' +
              'def show(x):\n' +
              '    print(x * 2)       # shows 10, returns None\n' +
              'result = show(5)       # result is None!',
              note: 'If the caller ASSIGNS the result, the function must RETURN.' } },
          { say: "The sneakiest version: a return indented INSIDE the loop. The function bails on the very first pass. Check the indentation of the last line of every loop — it's the difference between averaging one item and averaging them all.",
            screen: { kick: 'THE EARLY EXIT', head: 'Indentation decides everything', code:
              'def average(nums):\n' +
              '    total = 0\n' +
              '    for n in nums:\n' +
              '        total += n\n' +
              '        return total / len(nums)   # ✗ leaves on pass 1!\n' +
              '# dedent one level → runs after the loop ✓',
              note: 'average([10, 20, 30]) with the bug → 3.33…, fixed → 20.0' } }
        ],
        quiz: [
          { id: 'l5a-q1', q: 'What is result?', code: 'def double(x):\n    print(x * 2)\n\nresult = double(5)',
            opts: ['None — the function printed but returned nothing', '10', '"10"', 'Error'], a: 0,
            why: 'print shows 10 on screen, but no return means the function hands back None. result + 1 later would raise TypeError.', concept: 'return vs print' },
          { id: 'l5a-q2', q: 'With the return INSIDE the loop, what does average([10, 20, 30]) give?',
            code: 'def average(nums):\n    total = 0\n    for n in nums:\n        total += n\n        return total / len(nums)',
            opts: ['3.33… — it exits on the first pass with total=10', '20.0', '60', 'None'], a: 0,
            why: 'return runs on pass one: 10 / 3. Dedent the return to sit AFTER the loop for 60 / 3 = 20.0.', concept: 'return placement' }
        ],
        build: { id: 'l5a-b1', q: 'Build the one-line average machine using two built-ins from your toolbelt.',
          parts: [{ t: 'def average(nums):\n    ' }, { s: 0 }, { t: ' ' }, { s: 1 }, { t: '(nums) / ' }, { s: 2 }, { t: '(nums)' }],
          answers: ['return', 'sum', 'len'], bank: ['print', 'count', 'max', 'total'],
          why: 'return sum(nums) / len(nums) — sum adds them all, len counts them, return puts the answer on the belt.', concept: 'building functions' }
      },
      {
        id: 'l5b', title: 'The shared-default trap',
        beats: [
          { say: "Defaults let callers skip arguments — port equals 8080 unless they say otherwise. But here's the trap that fools seniors: the default is built ONCE, when def runs. A default LIST is therefore one single list, shared by every call forever. Lesson 1's Arrow Rule, hiding in a function signature.",
            screen: { kick: 'BUILT ONCE', head: 'def log_run(job, runs=[])  ← ONE shared list', code:
              'def log_run(job, runs=[]):\n' +
              '    runs.append(job)\n' +
              '    return runs\n' +
              'print(log_run("j1"))   #→ [\'j1\']\n' +
              'print(log_run("j2"))   #→ [\'j1\', \'j2\']   ← j1 is STILL THERE',
              note: 'Every default-using call appends to the SAME list.' } },
          { say: "The professional fix, seen in every serious codebase: default to None — the safe immutable nothing — and build a FRESH list inside. Test for None with is, never double-equals. Spot def anything with equals-square-brackets in a review? That's a finding, every time.",
            screen: { kick: 'THE FIX', head: 'None default + fresh list inside', code:
              'def log_run(job, runs=None):\n' +
              '    if runs is None:\n' +
              '        runs = []          # brand-new list EVERY call\n' +
              '    runs.append(job)\n' +
              '    return runs',
              note: 'x is None — identity check, the one true way to test for None.' } }
        ],
        quiz: [
          { id: 'l5b-q1', q: 'What do the two calls print?', code: 'def tag(item, tags=[]):\n    tags.append(item)\n    return tags\n\nprint(tag("red"))\nprint(tag("blue"))',
            opts: ["['red'] then ['red', 'blue']", "['red'] then ['blue']", "['red', 'blue'] twice", 'Error'], a: 0,
            why: 'One default list, created at def time, shared across calls: blue lands next to red. The round-1 headliner!', concept: 'mutable default' },
          { id: 'l5b-q2', q: 'Which signature + first lines is the CORRECT fix?',
            opts: ['tags=None, then: if tags is None: tags = []', 'tags=[], then: tags.clear()', 'tags=None, then: if tags == []: tags = None', 'tags=list'], a: 0,
            why: 'None default means "nothing passed"; the function then builds a fresh list per call. is None is the proper identity test.', concept: 'None-default pattern' }
        ],
        build: { id: 'l5b-b1', q: 'Build the guard that makes the None-default pattern safe.',
          parts: [{ t: 'if runs ' }, { s: 0 }, { t: ' ' }, { s: 1 }, { t: ':\n    runs = ' }, { s: 2 }],
          answers: ['is', 'None', '[]'], bank: ['==', 'null', '{}', 'not'],
          why: 'if runs is None: runs = [] — identity check with is, then a brand-new list for this call only. (null is other languages; {} would be an empty dict.)', concept: 'is None guard' }
      },
      {
        id: 'l5c', title: 'Scope — pass in, return out',
        beats: [
          { say: "Scope is what a function can SEE. Reading an outer variable? Fine. ASSIGNING to one? Python instantly treats that name as local — and you get UnboundLocalError before the function even reads it. The clean pattern is a revolving door: pass the value IN as a parameter, return the new value OUT, re-label outside.",
            screen: { kick: 'THE REVOLVING DOOR', head: 'Pass in → return out', code:
              'count = 0\n' +
              'def bump_bad():\n' +
              '    count += 1        # ✗ UnboundLocalError\n\n' +
              'def bump(count):\n' +
              '    return count + 1  # ✓\n' +
              'count = bump(count)   # re-label outside',
              note: 'global count works but is a code-review smell — the door is cleaner.' } },
          { say: "One asymmetry worth a lower-third: REBINDING an outer name needs global, but MUTATING an outer list doesn't. A function can quietly append to a global list with no declaration at all — legal, and exactly the kind of hidden side effect a reviewer flags.",
            screen: { kick: 'THE ASYMMETRY', head: 'Rebind needs global · mutate doesn\'t', code:
              'log = []\n' +
              'def record(x):\n' +
              '    log.append(x)     # ✓ works — MUTATES, no global needed\n' +
              'def reset():\n' +
              '    log = []          # ✗ makes a LOCAL log; outer untouched',
              note: 'Arrow Rule again: append edits the shared list; = plants a new local label.' } }
        ],
        quiz: [
          { id: 'l5c-q1', q: 'What happens?', code: 'count = 0\ndef bump():\n    count += 1\nbump()',
            opts: ['UnboundLocalError — assignment makes count local', 'count becomes 1', 'count stays 0, silently', 'TypeError'], a: 0,
            why: 'count += 1 assigns, so Python marks count local for the WHOLE function — then trips reading it before assignment. Pass in, return out.', concept: 'UnboundLocalError' },
          { id: 'l5c-q2', q: 'Which line inside a function works on the OUTER list log = [] without any declaration?',
            opts: ['log.append("x") — mutation is allowed', 'log = ["x"] — rebinding is allowed', 'global log is always required to touch it', 'Neither works'], a: 0,
            why: 'Mutating through the existing label is fine; = would create a new LOCAL label. The asymmetry is the Arrow Rule in scope form.', concept: 'mutate vs rebind in scope' }
        ],
        build: { id: 'l5c-b1', q: 'Build the revolving door: bump the counter the clean way (no global).',
          parts: [{ t: 'def bump(count):\n    return count + 1\n\n' }, { s: 0 }, { t: ' = ' }, { s: 1 }, { t: '(' }, { s: 2 }, { t: ')' }],
          answers: ['count', 'bump', 'count'], bank: ['global', 'return', 'self'],
          why: 'count = bump(count) — in through the parameter, out through the return, re-labeled outside. No globals harmed.', concept: 'pass in return out' }
      }
    ],
    finale: {
      say: "Assembly Line finale — and this one's the big rework from your own round two. Build the validator from scratch: def, methods trail the object, convert before comparing, and a try/except for the garbage input. Then fix a print-instead-of-return. Take your time; the control room is watching.",
      quiz: [],
      fixes: [
        { id: 'l5f-f1', brief: 'Write check_qty from scratch. It gets raw (a string from a file, like " 15 ") and expected (an int). Return "match" if they agree numerically, "mismatch" if not, and "invalid" — without crashing — when raw isn\'t a number (like "n/a"). You\'ll need def, int(), .strip(), try/except ValueError.',
          code: '# your function:\ndef check_qty(raw, expected):\n    ...',
          must: ['def\\s+check_qty', 'int\\(', 'try', 'except\\s+ValueError', '"invalid"|\'invalid\''], mustNot: ['tolower', '^f\\s'],
          model: 'def check_qty(raw, expected):\n    try:\n        value = int(raw.strip())\n    except ValueError:\n        return "invalid"\n    return "match" if value == expected else "mismatch"', concept: 'full function build: convert + try/except' },
        { id: 'l5f-f2', brief: 'The caller needs the average VALUE — but result ends up None and the last line crashes. Fix the function (one word changes).',
          code: 'def team_average(scores):\n    print(sum(scores) / len(scores))   # ✗\n\nresult = team_average([90, 85, 99])\nprint(f"Rounded: {result:.1f}")        # TypeError: None',
          must: ['return\\s+sum\\(|return\\s+\\w'], mustNot: [],
          model: 'def team_average(scores):\n    return sum(scores) / len(scores)', concept: 'print → return' }
      ]
    },
    card: { title: 'CARD 5 · Functions & Scope', lines: [
      'return hands the value back · print only displays it',
      'No return → the function returns None',
      'return INSIDE a loop exits on pass 1 — check indentation',
      'def f(x, items=[]) = ONE shared list — the classic trap',
      'Fix: items=None → if items is None: items = []',
      'Assigning to an outer name → UnboundLocalError',
      'Mutating an outer list (append) needs no global — rebinding does',
      'Clean pattern: count = bump(count) — pass in, return out'
    ] }
  },

  /* ═══════════ LESSON 6 — DECISIONS ═══════════ */
  {
    id: 'l6', num: 6, chip: 'CH·6', title: 'Decisions — Comparisons, Truthiness & Division', kick: 'THE JUDGES’ TABLE', minutes: 10,
    recap: { title: 'PREVIOUSLY ON BYTE SIZED TRAINING', lines: [
      'return hands back · print displays · no return = None',
      'def f(x, log=[]) shares ONE list — default to None instead',
      'Scope: pass in, return out · count = bump(count)' ] },
    intro: "The Judges' Table — where code says yes or no. Tonight: double-equals versus is (they judge DIFFERENT things), what Python counts as false, the or-trap that's always true, and division's sharp corners. Small symbols, huge consequences.",
    subs: [
      {
        id: 'l6a', title: '== vs is',
        beats: [
          { say: "Double-equals asks: same VALUE? is asks: same OBJECT — literally the same arrow target from lesson 1. Two separate lists holding one-two are equal but not identical. The rule that survives every code review: double-equals for values, is for None. That's it.",
            screen: { kick: 'VALUE vs IDENTITY', head: 'Two questions, two answers', code:
              'a = [1, 2]\n' +
              'b = [1, 2]\n' +
              'a == b        #→ True    same value\n' +
              'a is b        #→ False   different lists!\n' +
              'c = a\n' +
              'a is c        #→ True    same arrow target\n' +
              'x is None     # ✓ THE way to test for None',
              note: 'is None / is not None — identity. Everything else: ==.' } }
        ],
        quiz: [
          { id: 'l6a-q1', q: 'a = [1, 2] and b = [1, 2]. What does print(a == b, a is b) show?',
            opts: ['True False', 'True True', 'False False', 'False True'], a: 0,
            why: 'Equal contents (==True) but two separate list objects (is False). After c = a, a is c would be True — one target, two labels.', concept: '== vs is' },
          { id: 'l6a-q2', q: 'Which is the correct test for "x has no value"?',
            opts: ['if x is None:', 'if x == None:', 'if x = None:', 'if not x == "None":'], a: 0,
            why: 'is None is the identity check — the standard. == None usually works but is bad style; = is assignment and won\'t even parse in an if.', concept: 'is None' }
        ],
        build: { id: 'l6a-b1', q: 'Build the guard: only build a fresh list when runs was never passed (lesson 5\'s pattern — you know this one).',
          parts: [{ t: 'if runs ' }, { s: 0 }, { t: ' ' }, { s: 1 }, { t: ':' }],
          answers: ['is', 'None'], bank: ['==', '!=', 'null', 'not'],
          why: 'if runs is None: — the identity test, compounding straight from lesson 5.', concept: 'identity check' }
      },
      {
        id: 'l6b', title: 'Truthiness & the or-trap',
        beats: [
          { say: "Python treats a handful of values as FALSE in an if: zero, empty string, empty list, empty dict, empty set, None, and False itself. EVERYTHING else is true — including the STRING zero, the STRING False, and a list holding a single zero. Empty means false; existing means true.",
            screen: { kick: 'THE FALSY SEVEN', head: '0 · 0.0 · "" · [] · {} · set() · None (+False)', code:
              'if rows:            # "rows is not empty" — idiomatic\n' +
              'if not name:        # empty or None\n' +
              'bool("0")           #→ True   text exists!\n' +
              'bool([0])           #→ True   the LIST isn\'t empty\n' +
              'if count == 0:      # be explicit when 0 vs None matters',
              note: 'Lesson 4\'s while rows: was truthiness working for you.' } },
          { say: "Now the or-trap, a lie detector special: if x equals one OR two does NOT mean what it reads like. Python sees two separate tests — x equals one… or the value 2, and a bare 2 is truthy, so the whole thing is ALWAYS true. Write x in parentheses-one-comma-two instead.",
            screen: { kick: 'THE OR-TRAP', head: 'if x == 1 or 2:   ← always True!', code:
              'x = 99\n' +
              'if x == 1 or 2:      # ✗ reads as (x==1) or (2) → truthy 2!\n' +
              '    print("fires for ANY x")\n' +
              'if x in (1, 2):      # ✓ what you meant\n' +
              'if x == 1 or x == 2: # ✓ also fine, just longer',
              note: 'Each side of or must be a COMPLETE test.' } }
        ],
        quiz: [
          { id: 'l6b-q1', q: 'Which value is TRUTHY?',
            opts: ['[0] — a list holding one zero', '""', '0', 'None'], a: 0,
            why: 'The list itself isn\'t empty — it holds an item (that the item is 0 doesn\'t matter). Empty string, 0, and None are all falsy.', concept: 'truthiness' },
          { id: 'l6b-q2', q: 'Why does this print "yes" for EVERY status?', code: 'if status == "ok" or "done":\n    print("yes")',
            opts: ['"done" is a truthy value on its own — the or sees it as a separate test', 'or is always True', '"ok" equals "done"', 'status is undefined'], a: 0,
            why: 'Python reads (status == "ok") or ("done") — and a non-empty string is truthy. Fix: status in ("ok", "done").', concept: 'or-trap' }
        ],
        build: { id: 'l6b-b1', q: 'Fix the or-trap properly: fire when status is "ok" OR "done".',
          parts: [{ t: 'if status ' }, { s: 0 }, { t: ' (' }, { s: 1 }, { t: ', ' }, { s: 2 }, { t: '):' }],
          answers: ['in', '"ok"', '"done"'], bank: ['==', 'or', 'ok', 'is'],
          why: 'if status in ("ok", "done"): — one complete membership test, no truthy strays.', concept: 'membership test' }
      },
      {
        id: 'l6c', title: 'Division’s sharp corners',
        beats: [
          { say: "Three division facts to memorize cold. Single slash ALWAYS gives a float — even 8 over 2 is 4-point-0. Double slash floors — toward NEGATIVE infinity, so minus 7 floor 2 is MINUS FOUR, not minus three. And percent gives the remainder — n percent 2 equals zero is the even test.",
            screen: { kick: 'THE CORNERS', head: '/  //  %', code:
              '7 / 2      #→ 3.5    always float\n' +
              '7 // 2     #→ 3      floor\n' +
              '-7 // 2    #→ -4     floors DOWNWARD (not -3!)\n' +
              '7 % 2      #→ 1      remainder\n' +
              'n % 2 == 0            # the even test\n' +
              '0.1 + 0.2 == 0.3  #→ False!  float precision',
              note: 'Indexes must be ints — len(x) // 2 for a midpoint, never /.' } }
        ],
        quiz: [
          { id: 'l6c-q1', q: 'What is -7 // 2?',
            opts: ['-4 — floor rounds DOWN, toward negative infinity', '-3', '-3.5', '3'], a: 0,
            why: '-3.5 floors downward to -4. Positive 7 // 2 is 3, but negatives keep falling.', concept: 'floor division' },
          { id: 'l6c-q2', q: 'mid = len(nums) / 2, then nums[mid]. What happens? (nums has 5 items)',
            opts: ['TypeError — 2.5 is a float, and indexes must be ints', 'Returns the middle item', 'IndexError', 'Returns nums[2]'], a: 0,
            why: '/ always makes floats. Use len(nums) // 2 → 2, a valid seat number.', concept: 'float index' }
        ],
        build: { id: 'l6c-b1', q: 'Build the even test — the one inside every filter you\'ve written.',
          parts: [{ t: 'if n ' }, { s: 0 }, { t: ' 2 ' }, { s: 1 }, { t: ' ' }, { s: 2 }, { t: ':' }],
          answers: ['%', '==', '0'], bank: ['//', '=', '/', '1'],
          why: 'n % 2 == 0 — remainder zero means evenly divisible. (% 2 == 1 catches the odds.)', concept: 'modulo even test' }
      }
    ],
    finale: {
      say: "Judges' Table finale. Two verdicts to overturn: one gate that lets everyone in, and one crash from a decimal seat number. The or-trap and the floor are both on your cards.",
      quiz: [],
      fixes: [
        { id: 'l6f-f1', brief: 'This admission gate approves EVERY status — even "denied". Fix the condition so only "ok" and "approved" pass.',
          code: 'status = "denied"\nif status == "ok" or "approved":     # ✗ always True\n    print("Access granted")',
          must: ['in\\s*\\(|==\\s*"ok"\\s+or\\s+status\\s*==|==\\s*\'ok\'\\s+or\\s+status\\s*=='], mustNot: [],
          model: 'if status in ("ok", "approved"):', concept: 'or-trap fix' },
        { id: 'l6f-f2', brief: 'Grabbing the middle reading crashes: list indices must be integers. Fix the midpoint math.',
          code: 'readings = [3, 1, 4, 1, 5]\nmid = len(readings) / 2       # ✗ 2.5 — a float\nprint(readings[mid])',
          must: ['//'], mustNot: [],
          model: 'mid = len(readings) // 2', concept: 'floor division for indexes' }
      ]
    },
    card: { title: 'CARD 6 · Decisions', lines: [
      '== compares VALUES · is compares IDENTITY (arrow targets)',
      'The one is rule: x is None / x is not None',
      'Falsy: 0 · 0.0 · "" · [] · {} · set() · None · False',
      '"0", "False", [0] are all TRUTHY — empty=false, existing=true',
      'if x == 1 or 2: is ALWAYS true → use x in (1, 2)',
      '/ always float · // floors (−7 // 2 = −4) · % remainder',
      'Even test: n % 2 == 0 · indexes need // never /',
      '0.1 + 0.2 != 0.3 — compare floats with a tolerance'
    ] }
  },

  /* ═══════════ LESSON 7 — WHEN THINGS BREAK ═══════════ */
  {
    id: 'l7', num: 7, chip: 'CH·7', title: 'When Things Break — Errors & try/except', kick: 'THE CRASH DESK', minutes: 10,
    recap: { title: 'PREVIOUSLY ON BYTE SIZED TRAINING', lines: [
      '== values · is None identity · falsy = empty/zero/None',
      'x == 1 or 2 is ALWAYS true → x in (1, 2)',
      '/ floats · // floors (−7//2=−4) · n % 2 == 0 even' ] },
    intro: "The Crash Desk — my favorite beat, because every red traceback is a confession. Tonight: reading exception names like headlines, catching them with try/except like a professional, and the sixty-second review sweep that finds planted bugs before they find you.",
    subs: [
      {
        id: 'l7a', title: 'Reading the red text',
        beats: [
          { say: "Every exception NAME tells you the crime. NameError: a label that doesn't exist — usually a typo. TypeError: right idea, wrong TYPE of value. ValueError: right type, impossible value. IndexError: seat number past the end. KeyError: dict label that isn't there. Read the name first; the line number second.",
            screen: { kick: 'THE RAP SHEET', head: 'Name → crime', code:
              'print(nmus)        # NameError   — typo\'d label\n' +
              '"5" + 3            # TypeError   — text + number\n' +
              'int("3.5")         # ValueError  — right type, bad value\n' +
              's[12]              # IndexError  — DataPipeline has seats 0–11\n' +
              'ages["zed"]        # KeyError    — lesson 3 taught the fix: .get',
              note: 'The LAST index is len(s) - 1 · slices never raise (s[10:99] just clips).' } },
          { say: "Two more with famous backstories. UnboundLocalError — lesson 5, assigning to an outer name. And the one with NO red text at all: the timeout. No error, no output, fans spinning — that's an infinite while, lesson 4. Silence is also a symptom.",
            screen: { kick: 'REPEAT OFFENDERS', head: 'You\'ve met these before', code:
              'def bump():\n' +
              '    count += 1     # UnboundLocalError (lesson 5)\n\n' +
              'while i > 0:\n' +
              '    if i == 3:\n' +
              '        continue   # …timeout: the invisible crash (lesson 4)',
              note: 'AttributeError = calling a method the type doesn\'t have — often a None snuck in.' } }
        ],
        quiz: [
          { id: 'l7a-q1', q: 'int("3.5") raises which exception?',
            opts: ['ValueError — right type (string), impossible value for int', 'TypeError', 'SyntaxError', 'None — it returns 3'], a: 0,
            why: 'int() accepts strings, so the TYPE is fine — but "3.5" isn\'t a whole number, so the VALUE fails. Route: float("3.5") first.', concept: 'ValueError vs TypeError' },
          { id: 'l7a-q2', q: 's = "DataPipeline" (12 characters). Which line crashes?',
            opts: ['s[12]', 's[11]', 's[10:99]', 's[-12]'], a: 0,
            why: 'Seats run 0–11, so s[12] is past the end → IndexError. s[11] is the last "e", s[-12] the first "D", and slices clip instead of crashing.', concept: 'IndexError bounds' }
        ],
        build: { id: 'l7a-b1', q: 'Grab the LAST character of s safely using len — no magic numbers.',
          parts: [{ t: 'last = s[' }, { s: 0 }, { t: '(s) ' }, { s: 1 }, { t: ' ' }, { s: 2 }, { t: ']' }],
          answers: ['len', '-', '1'], bank: ['count', '+', '0', 'size'],
          why: 's[len(s) - 1] — the last seat is always one less than the length. (s[-1] is the shortcut version.)', concept: 'last index' }
      },
      {
        id: 'l7b', title: 'try / except like a professional',
        beats: [
          { say: "try wraps the risky part; except catches a NAMED crash and answers it. Catch SPECIFIC exceptions — a bare except that swallows everything, especially with a pass, hides real bugs and is an automatic code-review finding. You met this pattern in lesson 5's validator; here's the full anatomy.",
            screen: { kick: 'THE SAFETY NET', head: 'Name what you catch', code:
              'try:\n' +
              '    value = int(raw)\n' +
              '    result = 100 / value\n' +
              'except ValueError:\n' +
              '    print("not a number")\n' +
              'except ZeroDivisionError:\n' +
              '    print("can\'t divide by zero")\n' +
              'else:\n' +
              '    print("clean run:", result)   # only if NO crash\n' +
              'finally:\n' +
              '    print("always runs")          # cleanup, either way',
              note: '✗ except: pass — the bug-hider. Name the exception, always.' } }
        ],
        quiz: [
          { id: 'l7b-q1', q: 'Why is this a code-review finding?', code: 'try:\n    total = compute(rows)\nexcept:\n    pass',
            opts: ['It silently swallows EVERY error — even typos — and hides them', 'try needs a finally', 'except needs parentheses', 'pass is not valid Python'], a: 0,
            why: 'A bare except catches everything including NameError from a typo, then pass throws the evidence away. Catch the specific exception and handle or log it.', concept: 'bare except smell' },
          { id: 'l7b-q2', q: 'When does the else block of a try/except run?',
            opts: ['Only when the try block finished with NO exception', 'Always', 'Only after an exception', 'Never — it\'s decoration'], a: 0,
            why: 'else = the success lane. finally = runs either way. except = the crash lane.', concept: 'try/except/else/finally' }
        ],
        build: { id: 'l7b-b1', q: 'Build the validator\'s safety net (lesson 5\'s check_qty, now formalized).',
          parts: [{ s: 0 }, { t: ':\n    value = int(raw)\n' }, { s: 1 }, { t: ' ' }, { s: 2 }, { t: ':\n    return "invalid"' }],
          answers: ['try', 'except', 'ValueError'], bank: ['catch', 'TypeError', 'if', 'error'],
          why: 'try wraps int(raw); except ValueError: catches exactly the garbage-text crash and answers "invalid". Catch is other languages — Python says except.', concept: 'try/except build' }
      },
      {
        id: 'l7c', title: 'The 60-second review sweep',
        beats: [
          { say: "When they hand you broken code, run this sweep in order — it catches ninety percent of planted bugs. One: syntax — colons, brackets, indentation. Two: variables — initialized? typo'd? shadowing a built-in? Three: loop bounds — the plus-one, while progress. Four: last-line indentation — is that return inside the loop? Five: types — str versus int, slash versus double-slash, None from a missing return. Six: edge cases — empty list, zero, one item.",
            screen: { kick: 'THE SWEEP', head: 'Six checks, sixty seconds', code:
              '1  SYNTAX      colons · brackets · indentation\n' +
              '2  VARIABLES   initialized? typo? shadowed built-in?\n' +
              '3  LOOP BOUNDS range +1 · while progress · continue\n' +
              '4  INDENTATION return/reset inside or outside the loop?\n' +
              '5  TYPES       str vs int · / vs // · None returns\n' +
              '6  EDGES       empty · zero · one item · ties',
              note: 'Every check maps to a lesson: 2→L1/L5 · 3→L4 · 4→L5 · 5→L2/L6 · 6→everywhere.' } }
        ],
        quiz: [
          { id: 'l7c-q1', q: 'sum = 0 at the top of a script, then later total = sum(nums) crashes with TypeError: \'int\' object is not callable. Sweep check #2 names the crime — what happened?',
            opts: ['sum was shadowed — the label now points at 0, not the built-in', 'nums is empty', 'sum() needs two arguments', 'total is a keyword'], a: 0,
            why: 'Assigning to sum re-labels the built-in — later calls hit the int. Never name variables sum, list, str, max…', concept: 'shadowed built-ins' }
        ],
        build: { id: 'l7c-b1', q: 'Guard the average against the classic edge: an empty list (sweep check #6).',
          parts: [{ t: 'def average(nums):\n    if ' }, { s: 0 }, { t: ' ' }, { s: 1 }, { t: ':\n        return 0\n    return ' }, { s: 2 }, { t: '(nums) / len(nums)' }],
          answers: ['not', 'nums', 'sum'], bank: ['len', '==', 'if', 'count'],
          why: 'if not nums: — truthiness (lesson 6!) catches the empty list before len(nums) divides by zero.', concept: 'empty-input guard' }
      }
    ],
    finale: {
      say: "Crash Desk finale. Two clips: one crashes on bad input AND on zero — your net needs two nets — and one hides its bugs behind a bare except. Show the control room a clean catch.",
      quiz: [],
      fixes: [
        { id: 'l7f-f1', brief: 'This crashes two ways: ValueError on "abc", ZeroDivisionError on "0". Wrap it so bad text returns "invalid" and zero returns "undefined" — everything else returns the result.',
          code: 'def rate(raw):\n    value = int(raw)\n    return 100 / value',
          must: ['try', 'except\\s+ValueError', 'except\\s+ZeroDivisionError'], mustNot: ['except\\s*:'],
          model: 'def rate(raw):\n    try:\n        value = int(raw)\n        return 100 / value\n    except ValueError:\n        return "invalid"\n    except ZeroDivisionError:\n        return "undefined"', concept: 'multiple specific excepts' },
        { id: 'l7f-f2', brief: 'The bare except hides a real bug (ages is misspelled inside!). Remove the bug-hider: fix the typo AND catch only KeyError, with .get as the cleaner alternative.',
          code: 'def lookup(ages, who):\n    try:\n        return agse[who]        # ← typo hiding behind the net\n    except:\n        return 0',
          must: ['ages\\[|ages\\.get'], mustNot: ['agse', 'except\\s*:'],
          model: 'def lookup(ages, who):\n    return ages.get(who, 0)', concept: 'bare except hides bugs' }
      ]
    },
    card: { title: 'CARD 7 · Errors', lines: [
      'NameError typo · TypeError wrong type · ValueError bad value',
      'IndexError past the end · KeyError missing dict key',
      'UnboundLocalError = assigned to outer name (L5)',
      'Timeout with no red text = infinite while (L4)',
      'Last seat: s[len(s)-1] or s[-1] · slices never raise',
      'Catch SPECIFIC exceptions · bare except: pass hides bugs',
      'try→risky · except→crash lane · else→success · finally→always',
      'The sweep: syntax → variables → bounds → indent → types → edges'
    ] }
  },

  /* ═══════════ LESSON 8 — THE CODE REVIEW CAPSTONE ═══════════ */
  {
    id: 'l8', num: 8, chip: 'CH·8', title: 'The Code Review Capstone', kick: 'SEASON FINALE', minutes: 10,
    recap: { title: 'THE SEASON SO FAR', lines: [
      'L1 arrows & copies · L2 slices & f-strings · L3 the toolbox',
      'L4 loops & counting · L5 return, defaults, scope',
      'L6 == vs is, truthiness, // · L7 exceptions & the sweep' ] },
    intro: "Season finale, live from the studio. No new rules tonight — just everything at once, the way a real assessment serves it. Two warm-up patterns, then full code reviews where YOU are the reviewer of record. The sweep is on your card. I'll be at the desk if you need me.",
    subs: [
      {
        id: 'l8a', title: 'Patterns on demand',
        beats: [
          { say: "Assessments love tiny composable patterns. Count the vowels in DataPipeline: walk the lowercased string, test membership in a-e-i-o-u, sum the hits — six of them. And 'most frequent': the counting pattern from lesson 4 plus max with key equals counts dot get. You've built every piece already.",
            screen: { kick: 'GREATEST HITS', head: 'Compose what you know', code:
              'def count_vowels(s):\n' +
              '    return sum(1 for ch in s.lower() if ch in "aeiou")\n' +
              'count_vowels("DataPipeline")   #→ 6\n\n' +
              'counts = {}\n' +
              'for r in rows:\n' +
              '    counts[r] = counts.get(r, 0) + 1\n' +
              'max(counts, key=counts.get)    #→ \'ok\'',
              note: 'L2 lower + membership · L4 counting · L3 key= — three lessons, one answer.' } }
        ],
        quiz: [
          { id: 'l8a-q1', q: 'count_vowels("DataPipeline") returns…',
            opts: ['6', '4', '5', '3'], a: 0,
            why: 'Lowercased: d-a-t-a-p-i-p-e-l-i-n-e → a, a, i, e, i, e = six vowels.', concept: 'pattern composition' },
          { id: 'l8a-q2', q: 'With counts = {"ok": 3, "fail": 2}, what is max(counts, key=counts.get)?',
            opts: ["'ok'", '3', "'fail'", '{"ok": 3}'], a: 0,
            why: 'max walks the KEYS, judging each by its count — "ok" wins with 3. The key= trick from lesson 3, on a dict from lesson 4.', concept: 'max with key' }
        ],
        build: { id: 'l8a-b1', q: 'Build the winner line: which row value appears most often?',
          parts: [{ t: 'winner = ' }, { s: 0 }, { t: '(counts, ' }, { s: 1 }, { t: '=counts.' }, { s: 2 }, { t: ')' }],
          answers: ['max', 'key', 'get'], bank: ['sorted', 'top', 'value', 'index'],
          why: 'max(counts, key=counts.get) — judge every key by its tally, return the champion.', concept: 'max key idiom' }
      },
      {
        id: 'l8b', title: 'The full review, live',
        beats: [
          { say: "Here's how a planted-bug review actually reads. The clean_batch clip on screen has THREE separate crimes: an append that should be extend — lesson 3. A remove inside a loop over the same list — lesson 4. And a value-at where the spec wants a position-of — lesson 3's mirror pair. Run the sweep and they surface in order.",
            screen: { kick: 'EXHIBIT A', head: 'Three bugs, one function', code:
              '# spec: add readings 99 & 100 individually; remove ALL -1;\n' +
              '#       return list + POSITION of the value 3\n' +
              'def clean_batch(batch):\n' +
              '    batch.append([99, 100])      # ✗ nests (L3)\n' +
              '    for v in batch:\n' +
              '        if v == -1:\n' +
              '            batch.remove(-1)     # ✗ skips (L4)\n' +
              '    first_pos = batch[3]         # ✗ mirror (L3)\n' +
              '    return batch, first_pos',
              note: 'Fixed: extend · comprehension filter · batch.index(3) → ([3,7,99,100], 0)' } }
        ],
        quiz: [
          { id: 'l8b-q1', q: 'In the fixed clean_batch, which line correctly reports WHERE the value 3 sits?',
            opts: ['batch.index(3)', 'batch[3]', 'batch.find(3)', 'index(batch, 3)'], a: 0,
            why: 'index(3) = "where is the value 3". batch[3] is the mirror (what\'s AT seat 3), and find belongs to strings, not lists.', concept: 'index vs subscript review' },
          { id: 'l8b-q2', q: 'The safe way to remove ALL the -1 values is…',
            opts: ['batch = [v for v in batch if v != -1]', 'for v in batch: batch.remove(-1)', 'batch.remove(-1) once', 'del batch[-1]'], a: 0,
            why: 'Filter into a fresh list — never mutate the list you\'re looping. remove also only takes the FIRST match. del batch[-1] removes the last ITEM (negative seat, not value).', concept: 'filter comprehension' }
        ],
        build: { id: 'l8b-b1', q: 'Build the filter that removes every -1 sentinel.',
          parts: [{ t: 'batch = [' }, { s: 0 }, { t: ' for v in ' }, { s: 1 }, { t: ' if v ' }, { s: 2 }, { t: ' -1]' }],
          answers: ['v', 'batch', '!='], bank: ['-1', '==', 'remove', 'not'],
          why: 'Keep every v whose value is NOT -1 — the keep-what-you-want filter, lesson 4\'s closing rule.', concept: 'comprehension filter build' }
      }
    ],
    finale: {
      say: "The final board. Three full reviews — find the bugs, name the lesson each one came from, write the fix. The control room grades every word, and your season report card prints when you're done. It's been an honor, reviewer. Make it clean.",
      quiz: [],
      fixes: [
        { id: 'l8f-f1', brief: 'THE CLASSIC (3 bugs). Spec: return the longest word; ties go to the FIRST. Find all three bugs (loop start, tie-breaking, print-vs-return) and write the fixed function.',
          code: 'def longest_word(sentence):\n    words = sentence.split(" ")\n    longest = ""\n    for i in range(1, len(words)):\n        if len(words[i]) >= len(longest):\n            longest = words[i]\n    print(longest)\n\nresult = longest_word("the quick brown fox")',
          must: ['def\\s+longest_word', 'return', '>(?!=)'], mustNot: ['print\\(longest\\)\\s*$'],
          model: 'def longest_word(sentence):\n    longest = ""\n    for word in sentence.split():\n        if len(word) > len(longest):\n            longest = word\n    return longest', concept: 'capstone: bounds + ties + return' },
        { id: 'l8f-f2', brief: 'TWO BUGS. Spec: remove ALL 0 readings, return the cleaned list AND the POSITION of the largest value. scrub([4, 0, 0, 9, 2]) should return ([4, 9, 2], 1).',
          code: 'def scrub(readings):\n    for r in readings:\n        if r == 0:\n            readings.remove(0)\n    return readings, readings[max(readings)]',
          must: ['for\\s+\\w+\\s+in|readings\\s*=\\s*\\[', '\\.index\\(\\s*max\\('], mustNot: [],
          model: 'def scrub(readings):\n    readings = [r for r in readings if r != 0]\n    return readings, readings.index(max(readings))', concept: 'capstone: filter + index-of-max' },
        { id: 'l8f-f3', brief: 'THE SEASON BUG HUNT (3 bugs, three different lessons). Spec: report should end [3, 1, 4, 1, 5] unchanged, top should be the descending sort, and the summary line should read "Neco: 94.57". Find all three.',
          code: 'nums = [3, 1, 4, 1, 5]\nreport = nums                  # bug 1 (L1)\ntop = report.sort(reverse=True)  # bug 2 (L3) — also mutates report!\nsummary = name + ": " + score    # bug 3 (L2)\nprint(summary)',
          must: ['\\[\\s*:\\s*\\]|list\\(\\s*nums\\s*\\)|\\.copy\\(\\)', 'sorted\\(', 'f"|f\'|str\\('], mustNot: [],
          model: 'report = nums[:]\ntop = sorted(nums, reverse=True)\nsummary = f"{name}: {score:.2f}"', concept: 'capstone: aliasing + sort None + str/int' }
      ]
    },
    card: { title: 'CARD 8 · The Reviewer\'s Creed', lines: [
      'Run the sweep: syntax → variables → bounds → indent → types → edges',
      'Trace by hand with a tiny input BEFORE changing anything',
      'Make the smallest fix that satisfies the spec',
      'Re-trace with the sample + one edge (empty, zero, tie)',
      'Every bug maps to a lesson — name it and the fix names itself',
      'b = a shares · .sort() returns None · range excludes stop',
      'return not print · is None · x in (1,2) · except ValueError',
      'Season complete. You review code now. 📺' ]
    }
  }
  ];
})();

// 「他の人の資料」タブ。追加参考資料.txt を見出しごとに区切り、用語集とは混ぜずに別に検索する。
(function (root) {
  'use strict';

  /* ---------- テキストを見出しごとに区切る ---------- */
  const IMG = /\.(jpe?g|png|gif|svg|webp)$/i;
  const BODY_START = /^([・･●■□◆◇▲▼※＊*\-ー]|例[）)：:]|[①-⑳]|[（(]|[0-9０-９]+[.．)）、]|【)/;
  function isHeading(line) {
    if (/^\s/.test(line) || /^　/.test(line)) return false;
    const s = line.trim();
    if (!s || s.length > (/^[★☆]/.test(s) ? 80 : 32)) return false; // ★付きの英語名などは長くても見出しにする
    if (/[。．]/.test(s) || /[、,，]$/.test(s)) return false;
    if (/[：:]/.test(s)) return false;
    if (/(ことも|ことが|ことは|ことで|という|である|であり|ならない|が望ましい|できる$|ている$)/.test(s) || /^[をにがはでとのも]/.test(s)) return false; // 文の途中の行は見出しにしない
    if (IMG.test(s)) return false;
    const body = s.replace(/^[★☆]+/, '');
    if (!body) return false;
    return !BODY_START.test(body);
  }
  function parse(raw) {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      while (cur.body.length && !cur.body[cur.body.length - 1]) cur.body.pop();
      if (cur.body.length) { cur.text = cur.body.join('\n'); out.push(cur); }
    };
    for (const line of lines) {
      const s = line.trim();
      if (!s) { if (cur) cur.body.push(''); continue; }
      if (IMG.test(s)) continue;
      if (isHeading(line)) {
        const title = s.replace(/^[★☆]+\s*/, '').replace(/\*+/g, '').trim();
        if (cur && cur.title === title && !cur.body.some(x => x)) continue; // 同じ見出しが続くときは1つにまとめる
        const emptyBody = cur && !cur.body.some(x => x);
        const parents = emptyBody ? cur.parents.concat([cur.title]) : [];
        if (!emptyBody) flush();
        cur = { title, parents, body: [], star: /^[★☆]/.test(s) };
        continue;
      }
      if (!cur) cur = { title: '（見出しなし）', parents: [], body: [], star: false };
      cur.body.push(s.replace(/\*\*/g, ''));
    }
    flush();
    out.forEach((x, i) => {
      x.id = i;
      x.path = x.parents.concat([x.title]).join(' › ');
      x.head = x.parents.concat([x.title]).join(' ');
    });
    return out;
  }

  /* ---------- 検索 ---------- */
  const G = root.GS;
  const DOCS = parse(typeof OTHERS_RAW === 'string' ? OTHERS_RAW : '').map(x => Object.assign(x, {
    fh: G.loose(x.head), fb: G.loose(x.text)
  }));

  // 用語集にある語なら、同じ語の別名（略語・英語名など）でも探す。結果は用語集と混ぜない
  function altsOf(word) {
    const alts = new Set([word]);
    G.TERMS.forEach(t => {
      if (t.names.some(n => n.l === word)) t.names.forEach(n => { if (n.l.length >= 2) alts.add(n.l); });
    });
    return [...alts];
  }
  function countOf(hay, w) {
    let n = 0, p = 0;
    while ((p = hay.indexOf(w, p)) >= 0) { n++; p += w.length; }
    return n;
  }
  function parseQuery(q) {
    const inc = [], exc = [];
    String(q || '').split(/[\s　]+/).filter(Boolean).forEach(t => {
      if (t.length > 1 && /^[-−－]/.test(t)) { const w = G.loose(t.slice(1)); if (w) exc.push(w); }
      else { const w = G.loose(t); if (w) inc.push(w); }
    });
    return { inc, exc };
  }
  function search(q, fuzzy) {
    const { inc, exc } = parseQuery(q);
    if (!inc.length) return { results: [], words: [], fuzzy: false, inc, exc };
    const words = new Set();
    const groups = inc.map(w => { const a = altsOf(w); a.forEach(x => words.add(x)); return a; });
    const run = useFuzzy => {
      const res = [];
      DOCS.forEach(d => {
        if (exc.some(w => d.fh.includes(w) || d.fb.includes(w))) return;
        let score = 0;
        for (const alts of groups) {
          let best = 0;
          for (const w of alts) {
            let s = 0;
            if (d.fh.includes(w)) s += 10 + (d.fh.startsWith(w) ? 2 : 0);
            const c = countOf(d.fb, w);
            if (c) s += Math.min(c, 5);
            if (!s && useFuzzy && w.length >= 3) {
              const lim = w.length >= 6 ? 2 : 1;
              if (G.fuzzyDistance(w, d.fh, lim) <= lim) s = 4;
              else if (G.fuzzyDistance(w, d.fb, lim) <= lim) s = 1;
            }
            if (s > best) best = s;
          }
          if (!best) return;
          score += best;
        }
        res.push({ d, score: score + (d.star ? 0.5 : 0) });
      });
      res.sort((a, b) => b.score - a.score || a.d.id - b.d.id);
      return res;
    };
    let results = run(false), usedFuzzy = false;
    if (!results.length && fuzzy) { results = run(true); usedFuzzy = results.length > 0; }
    return { results, words: [...words], fuzzy: usedFuzzy, inc, exc };
  }

  /* ---------- 画面 ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function paint(text, words) {
    const src = String(text);
    const ranges = (G.rangesOf(src, words) || []).slice().sort((a, b) => a[0] - b[0]);
    let out = '', p = 0;
    ranges.forEach(([s, e]) => {
      if (s < p) return;
      out += esc(src.slice(p, s)) + '<mark>' + esc(src.slice(s, e)) + '</mark>';
      p = e;
    });
    return out + esc(src.slice(p));
  }
  const LINES_SHOWN = 10;
  function card(d, words) {
    const lines = d.text.split('\n');
    let start = 0;
    if (words.length && lines.length > LINES_SHOWN) {
      const i = lines.findIndex(l => G.rangesOf(l, words).length);
      if (i >= LINES_SHOWN - 2) start = Math.max(0, i - 2);
    }
    const lineHtml = (l, i) => `<div class="ol${/^[・･●]/.test(l) ? ' li' : ''}${l ? '' : ' gap'}">${l ? paint(l, words) : ''}</div>`;
    const shown = lines.slice(start, start + LINES_SHOWN);
    const long = lines.length > shown.length;
    const hid = long ? `<div class="obody full" hidden>${lines.map(lineHtml).join('')}</div>` : '';
    return `<article class="card ocard">
      <div class="opath">${d.parents.length ? esc(d.parents.join(' › ')) + ' › ' : ''}</div>
      <h3 class="otitle">${paint(d.title, words)}${d.star ? '<span class="ostar" title="資料で★が付いている項目">★</span>' : ''}</h3>
      <div class="obody short">${start ? '<div class="ol muted">…</div>' : ''}${shown.map(lineHtml).join('')}${start + LINES_SHOWN < lines.length ? '<div class="ol muted">…</div>' : ''}</div>${hid}
      ${long ? `<button type="button" class="otoggle" aria-expanded="false" data-label="全文を表示（${lines.length}行）">全文を表示（${lines.length}行）</button>` : ''}
    </article>`;
  }

  const state = { shown: 30, last: null, only: null };
  if (typeof OTHERS_NAME === 'string' && $('oname')) $('oname').textContent = OTHERS_NAME;
  function render() {
    const q = $('oq').value;
    const out = $('olist'), info = $('oinfo');
    $('omore').hidden = true;
    if (!DOCS.length) { info.textContent = ''; out.innerHTML = '<div class="empty">資料が読み込まれていません。</div>'; return; }
    if (!q.trim()) {
      info.textContent = `${DOCS.length} 項目`;
      out.innerHTML = `<div class="empty">検索語を入力してください。下は項目の一覧です（押すとその項目を表示）。</div><div class="otoc">${DOCS.map(d => `<button type="button" class="chip" data-oid="${d.id}">${esc(d.title)}</button>`).join('')}</div>`;
      return;
    }
    if (state.only !== null && DOCS[state.only]) {
      // 項目一覧や年表から開いたときは、その項目だけを表示する
      const d = DOCS[state.only];
      info.textContent = '1 件（項目を指定して表示）';
      out.innerHTML = card(d, state.hl || []);
      return;
    }
    const r = search(q, $('ofuzzy').checked);
    state.last = r;
    if (!r.results.length) {
      info.textContent = '0 件';
      out.innerHTML = '<div class="empty">該当する項目がありません。語を減らすか、別の言い方をお試しください。</div>';
      return;
    }
    info.textContent = `${r.results.length} 件${r.fuzzy ? '（表記の近い項目を表示しています）' : ''}`;
    out.innerHTML = r.results.slice(0, state.shown).map(x => card(x.d, r.words)).join('');
    $('omore').hidden = r.results.length <= state.shown;
  }
  function showDoc(id, year) {
    const d = DOCS[id];
    if (!d) return;
    $('oq').value = d.title;
    state.shown = 30;
    state.only = id;
    state.hl = year ? [String(year)] : [];
    render();
  }

  let timer;
  $('oq').addEventListener('input', () => { clearTimeout(timer); state.shown = 30; state.only = null; timer = setTimeout(render, 80); });
  $('ofuzzy').addEventListener('change', render);
  $('oreset').addEventListener('click', () => { $('oq').value = ''; state.shown = 30; state.only = null; render(); $('oq').focus(); });
  $('omore').addEventListener('click', () => { state.shown += 30; render(); });
  $('panelOthers').addEventListener('click', e => {
    const c = e.target.closest('[data-oid]');
    if (c) { showDoc(Number(c.dataset.oid)); return; }
    const t = e.target.closest('.otoggle');
    if (t) {
      const card = t.closest('.ocard');
      const open = t.getAttribute('aria-expanded') !== 'true';
      card.querySelector('.short').hidden = open;
      card.querySelector('.full').hidden = !open;
      t.setAttribute('aria-expanded', String(open));
      t.textContent = open ? '折りたたむ' : t.dataset.label;
    }
  });
  render();

  root.GO = { parse, search, DOCS, render, show: showDoc };
})(typeof window !== 'undefined' ? window : this);

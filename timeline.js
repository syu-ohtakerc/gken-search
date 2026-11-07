// 「年表」タブ。資料の文中にある年（1956年、1950年代など）を集めて、年の順に並べる。
// 用語集・教材と、他の人の資料は混ぜず、切り替えて見る。
(function (root) {
  'use strict';

  const YEAR = /(?<![0-9０-９A-Za-zァ-ヶー.,/])((?:19|20)\d\d)(?![0-9\/])(年代?)?/g;
  // 「1950〜60年代」のように、後ろの年代を省略した書き方
  const RANGE = /(?<![0-9０-９A-Za-zァ-ヶー.,/])((?:19|20)\d\d)\s*[〜～~–-]\s*((?:19|20)?\d\d)年代?/g;
  // 文章を句点・改行で区切り、年が入った文を事象として拾う
  function yearsOf(text) {
    const out = [];
    const s = String(text == null ? '' : text);
    let m;
    YEAR.lastIndex = 0;
    while ((m = YEAR.exec(s))) {
      const y = Number(m[1]);
      if (y >= 1900 && y <= 2099 && !out.includes(y)) out.push(y);
    }
    RANGE.lastIndex = 0;
    while ((m = RANGE.exec(s))) {
      const a = Number(m[1]);
      let y = m[2].length === 4 ? Number(m[2]) : Math.floor(a / 100) * 100 + Number(m[2]);
      if (m[2].length < 4 && y <= a) y += 100;
      if (y > a && y <= 2099 && !out.includes(y)) out.push(y);
    }
    return out;
  }
  function clip(s, n) { s = s.trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
  function fromText(text, src, push) {
    String(text || '').split(/[。\n]/).forEach(clause => {
      const c = clause.trim();
      if (!c) return;
      const lead = (src.kind === '用語' || src.kind === '混同ポイント' || src.kind === '公式') && !c.includes(src.label) ? src.label + '：' : '';
      yearsOf(c).forEach(y => push({ y, text: clip(lead + c, 110), src }));
    });
  }

  function collectMain() {
    const ev = [];
    const seen = new Set();
    const push = e => {
      const k = e.y + '|' + e.text;
      if (seen.has(k)) return;
      seen.add(k);
      ev.push(e);
    };
    GLOSSARY.forEach(g => fromText(g.desc, { kind: '用語', label: g.term, q: g.term }, push));
    CONFUSIONS.forEach(c => fromText(c.diff, { kind: '混同ポイント', label: c.topic, q: c.topic }, push));
    TABLES.forEach(t => t.rows.forEach(r => {
      const line = r.join(' ／ ');
      yearsOf(line).forEach(y => push({ y, text: clip(t.name + '：' + line, 110), src: { kind: '比較表', label: t.name, q: t.name } }));
    }));
    NEWS.forEach(n => fromText([n.topic, n.result, n.basis].join('。'), { kind: '最新情報', label: n.topic, q: n.topic }, push));
    FORMULAS.forEach(f => fromText(f.note, { kind: '公式', label: f.name, q: f.name }, push));
    return ev;
  }
  function collectOthers() {
    const ev = [];
    const seen = new Set();
    const push = e => {
      const k = e.y + '|' + e.text + '|' + e.src.id;
      if (seen.has(k)) return;
      seen.add(k);
      ev.push(e);
    };
    (root.GO ? root.GO.DOCS : []).forEach(d => fromText(d.text, { kind: '資料', label: d.path, id: d.id, q: d.title }, push));
    return ev;
  }
  const SETS = { main: null, others: null };
  const eventsOf = k => SETS[k] || (SETS[k] = (k === 'main' ? collectMain() : collectOthers()).sort((a, b) => a.y - b.y || a.text.localeCompare(b.text)));

  /* ---------- 画面 ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DECADES = [1900, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
  const state = { shown: 80 };

  function markYears(text, words) {
    const G = root.GS;
    const ranges = [];
    let m;
    YEAR.lastIndex = 0;
    while ((m = YEAR.exec(text))) ranges.push([m.index, m.index + m[0].length, 'y']);
    (G.rangesOf(text, words) || []).forEach(([s, e]) => ranges.push([s, e, 'k']));
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = '', p = 0;
    ranges.forEach(([s, e, t]) => {
      if (s < p) return;
      out += esc(text.slice(p, s)) + (t === 'y' ? '<b class="yrmark">' : '<mark>') + esc(text.slice(s, e)) + (t === 'y' ? '</b>' : '</mark>');
      p = e;
    });
    return out + esc(text.slice(p));
  }

  function filtered() {
    const key = $('tsrc').value;
    const from = $('tfrom').value === '' ? -Infinity : Number($('tfrom').value);
    const to = $('tto').value === '' ? Infinity : Number($('tto').value);
    const G = root.GS;
    const words = String($('tq').value || '').split(/[\s　]+/).filter(Boolean).map(w => G.loose(w)).filter(Boolean);
    const list = eventsOf(key).filter(e => {
      if (e.y < from || e.y > to) return false;
      if (!words.length) return true;
      const hay = G.loose(e.text + ' ' + e.src.label);
      return words.every(w => hay.includes(w));
    });
    return { list, words, key };
  }
  function render() {
    const { list, words, key } = filtered();
    const out = $('tlist');
    $('tinfo').textContent = `${list.length} 件`;
    if (!list.length) { out.innerHTML = '<div class="empty">該当する年の記述がありません。</div>'; $('tmore').hidden = true; return; }
    let html = '', lastDec = null;
    list.slice(0, state.shown).forEach((e, i) => {
      const dec = Math.floor(e.y / 10) * 10;
      if (dec !== lastDec) { html += `<h3 class="tdec">${dec}年代</h3>`; lastDec = dec; }
      const attr = key === 'others' ? `data-tid="${e.src.id}" data-ty="${e.y}"` : `data-tq="${esc(e.src.q)}"`;
      html += `<div class="tev"><span class="tyear">${e.y}年</span><span class="ttext">${markYears(e.text, words)}</span><button type="button" class="tsrc" ${attr} title="${esc(e.src.label)}を開く">${esc(e.src.kind)}：${esc(clip(e.src.label, 22))}</button></div>`;
    });
    out.innerHTML = html;
    $('tmore').hidden = list.length <= state.shown;
    // 十年ごとのボタンの選択状態
    const f = $('tfrom').value, t = $('tto').value;
    document.querySelectorAll('#tdecs [data-dec]').forEach(b => {
      const d = Number(b.dataset.dec);
      const on = b.dataset.dec === 'all' ? (f === '' && t === '') : f !== '' && t !== '' && Number(f) === d && Number(t) === (d === 1900 ? 1939 : d + 9);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function showTab() {
    ['tabKeyword', 'tabQuestion', 'tabOthers'].forEach(id => { $(id).classList.remove('on'); $(id).setAttribute('aria-selected', 'false'); });
    $('tabTimeline').classList.add('on');
    $('tabTimeline').setAttribute('aria-selected', 'true');
    ['panelKeyword', 'panelQuestion', 'panelOthers'].forEach(id => { $(id).hidden = true; });
    $('panelTimeline').hidden = false;
    state.shown = 80;
    render();
    $("tq").focus();
  }
  function openYear(y) {
    $('tsrc').value = 'main';
    $('tfrom').value = String(y); $('tto').value = String(y); $('tq').value = '';
    showTab();
    window.scrollTo({ top: 0 });
  }

  $('tabTimeline').addEventListener('click', showTab);
  $('tdecs').innerHTML = '<button type="button" class="chip" data-dec="all">すべて</button>' + DECADES.map(d => `<button type="button" class="chip" data-dec="${d}">${d === 1900 ? '〜1939' : d + '年代'}</button>`).join('');
  $('tdecs').addEventListener('click', e => {
    const b = e.target.closest('[data-dec]');
    if (!b) return;
    const v = b.dataset.dec;
    if (v === 'all') { $('tfrom').value = ''; $('tto').value = ''; }
    else if (v === '1900') { $('tfrom').value = '1900'; $('tto').value = '1939'; }
    else { $('tfrom').value = v; $('tto').value = String(Number(v) + 9); }
    state.shown = 80; render();
  });
  ['tsrc', 'tfrom', 'tto'].forEach(id => $(id).addEventListener('input', () => { state.shown = 80; render(); }));
  let timer;
  $('tq').addEventListener('input', () => { clearTimeout(timer); state.shown = 80; timer = setTimeout(render, 80); });
  $('treset').addEventListener('click', () => { ['tfrom', 'tto', 'tq'].forEach(id => { $(id).value = ''; }); state.shown = 80; render(); });
  $('tmore').addEventListener('click', () => { state.shown += 80; render(); });
  $('tlist').addEventListener('click', e => {
    const b = e.target.closest('.tsrc');
    if (!b) return;
    if (b.dataset.tid !== undefined) {
      $('tabOthers').click();
      root.GO.show(Number(b.dataset.tid), Number(b.dataset.ty));
      $('olist').insertAdjacentHTML('afterbegin', '<div class="note soft"><button type="button" class="linkish" data-totl="1">← 年表に戻る</button></div>');
    } else {
      document.dispatchEvent(new CustomEvent('gk-search', { detail: b.dataset.tq }));
    }
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-totl]')) { $('tabTimeline').click(); return; }
    const b = e.target.closest('[data-year]');
    if (b) openYear(Number(b.dataset.year));
  });

  root.GT = { yearsOf, eventsOf, openYear };
})(typeof window !== 'undefined' ? window : this);

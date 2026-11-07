// 画面の処理。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PAGE = 50;
  // 推定順位の実測値。公式例題は改善の参考にもしたので、参考にする前の値も併記する
  const RANK_STATS = { jdla: '1位 68%（参考にする前は63%）、2位以内 84%（19問）', mock: '1位 89%、2位以内 92%（53問）' };
  const FIELD_VARS = ['--f1', '--f2', '--f3', '--f4', '--f5', '--f6'];
  const TYPE_LABEL = { all: 'すべて', term: '用語', conf: '混同ポイント', table: '比較表', form: '公式', news: '最新情報', kako: '過去問' };
  const state = { type: 'all', shown: PAGE, res: null, back: [] };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function paint(text, ranges) {
    const src = String(text == null ? '' : text);
    if (!ranges || !ranges.length) return esc(src);
    let out = '', p = 0;
    ranges.forEach(([s, e]) => { out += esc(src.slice(p, s)) + '<mark>' + esc(src.slice(s, e)) + '</mark>'; p = e; });
    return out + esc(src.slice(p));
  }
  const hl = (text, words) => paint(text, GS.rangesOf(text, words));
  function paintSlice(src, from, to, marks) {
    const clipped = marks.filter(([s, e]) => s < to && e > from).map(([s, e]) => [Math.max(s, from) - from, Math.min(e, to) - from]);
    return paint(src.slice(from, to), clipped);
  }
  // 文章の中の用語をリンクにする（検索語のハイライトも重ねる）。selfIdx は自分自身の用語で、リンクにしない
  const mentionCache = new Map();
  function mentionsOf(src) {
    if (!mentionCache.has(src)) mentionCache.set(src, GS.extractTerms(src).mentions.filter(m => m.name.l !== 'ai'));
    return mentionCache.get(src);
  }
  function rich(text, words, selfIdx) {
    const src = String(text == null ? '' : text);
    if (!src) return '';
    const marks = GS.rangesOf(src, words);
    let out = '', p = 0;
    mentionsOf(src).forEach(m => {
      if (m.s < p || m.t.idx === selfIdx) return;
      out += paintSlice(src, p, m.s, marks);
      out += `<button type="button" class="tlink" data-term="${esc(m.t.g.term)}" title="${esc(m.t.g.term)}の解説を見る">${paintSlice(src, m.s, m.e, marks)}</button>`;
      p = m.e;
    });
    return out + paintSlice(src, p, src.length, marks);
  }

  /* ---------- 付箋（このブラウザにだけ保存する） ---------- */
  const FLAG_KEY = 'gkentei-term-flags';
  const flagged = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(FLAG_KEY) || '[]');
    if (Array.isArray(saved)) saved.forEach(n => flagged.add(n));
  } catch (e) { /* 保存先が使えない場合は、開いている間だけ覚える */ }
  function saveFlags() {
    try { localStorage.setItem(FLAG_KEY, JSON.stringify([...flagged])); } catch (e) { /* 同上 */ }
  }
  function flagButton(no) {
    const on = flagged.has(no);
    return `<button type="button" class="flag${on ? ' on' : ''}" data-flag="${no}" aria-pressed="${on}" title="苦手な語に印を付けます">${on ? '付箋あり' : '付箋'}</button>`;
  }
  function updateFlagCount() { $('flagCount').textContent = String(flagged.size); }
  function fieldStyle(field) {
    const i = '①②③④⑤⑥'.indexOf(String(field || '')[0]);
    return i >= 0 ? ` style="--fc:var(${FIELD_VARS[i]})"` : '';
  }

  /* ---------- 絞り込みの選択肢 ---------- */
  function fill(id, items, allLabel) {
    $(id).innerHTML = `<option value="">${esc(allLabel)}</option>` + items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  }
  const uniq = k => [...new Set(GLOSSARY.map(t => t[k]))];
  const count = (k, v) => GLOSSARY.filter(t => t[k] === v).length;
  fill('fField', uniq('field').sort().map(v => [v, `${v}（用語${count('field', v)}）`]), 'すべて');
  fill('fImp', [['3', '★★★'], ['2', '★★'], ['2+', '★★以上'], ['0', '印なし']], 'すべて');
  const sylList = uniq('syl').filter(s => s !== '－').sort((a, b) => {
    const n = s => parseInt(s.replace(/\D+/, ''), 10);
    return a[0] === b[0] ? n(a) - n(b) : (a[0] === '技' ? -1 : 1);
  });
  fill('fSyl', [['技*', '技術分野（すべて）'], ['法*', '法律・倫理分野（すべて）'], ...sylList.map(s => [s, s]), ['－', '項目なし']], 'すべて');
  const kanaOrder = ['英字', 'あ行', 'か行', 'さ行', 'た行', 'な行', 'は行', 'ま行', 'や行', 'ら行', 'わ行', '補強'];
  fill('fKana', kanaOrder.filter(k => uniq('kana').includes(k)).map(k => [k, k === '補強' ? 'シラバス補強語' : k]), 'すべて');
  fill('fKind', uniq('kind').map(v => [v, `${v}（用語${count('kind', v)}）`]), 'すべて');

  const FILTER_IDS = { fField: 'field', fImp: 'imp', fSyl: 'syl', fKana: 'kana', fKind: 'kind' };
  function filters() {
    const f = {};
    Object.keys(FILTER_IDS).forEach(id => { f[FILTER_IDS[id]] = $(id).value; });
    if ($('fFlagged').checked) f.flags = flagged;
    return f;
  }

  /* ---------- 結果カード ---------- */
  // 解説に年が出てくる語は、年のボタンを付ける（押すと、その年の年表を開く）
  function yearLine(desc) {
    const ys = GT.yearsOf(desc);
    return ys.length ? `<div class="years">年：${ys.map(y => `<button type="button" class="tag" data-year="${y}" title="${y}年の年表を見る">${y}年</button>`).join('')}</div>` : '';
  }
  function termCard(r, words) {
    const t = r.item, g = t.g;
    const aliasLine = t.aliases.length ? `<div class="alias">別名：${t.aliases.map(a => hl(a, words)).join(' ／ ')}</div>` : '';
    const via = r.vias && r.vias.length ? `<span class="badge">「${esc(r.vias[0])}」で一致</span>` : '';
    const fuzzy = r.fuzzy ? '<span class="badge warn">あいまい一致</span>' : '';
    return `<article class="card"${fieldStyle(g.field)}>
      <h3>${hl(g.term, words)}${g.imp === '－' ? '' : ` <span class="imp" aria-label="重要度">${esc(g.imp)}</span>`} ${via}${fuzzy}</h3>
      <p>${rich(g.desc, words, t.idx)}</p>${aliasLine}${yearLine(g.desc)}
      <div class="tags">
        ${flagButton(g.no)}
        <button type="button" class="tag" data-k="fField" data-v="${esc(g.field)}">${esc(g.field)}</button>
        ${g.syl !== '－' ? `<button type="button" class="tag" data-k="fSyl" data-v="${esc(g.syl)}">${esc(g.syl)}</button>` : ''}
        <span class="meta">${esc(g.kind)}・No.${g.no}</span>
      </div></article>`;
  }
  function confCard(c, words) {
    return `<article class="card conf"${fieldStyle(c.field)}>
      <div class="kind">混同ポイント</div>
      <h3>${hl(c.topic, words)}</h3><p>${rich(c.diff, words)}</p>
      <div class="tags"><span class="meta">${esc(c.field)}・${esc(c.src)}</span></div></article>`;
  }
  function tableCard(t, words) {
    const rowHit = r => words && words.length && r.some(cell => GS.rangesOf(cell, words).length);
    const width = Math.max(t.headers.length, ...t.rows.map(r => r.length));
    const cells = (r, tag) => Array.from({ length: width }, (_, i) => `<${tag}>${tag === 'td' ? rich(r[i] || '', words) : hl(r[i] || '', words)}</${tag}>`).join('');
    return `<article class="card table">
      <div class="kind">比較表</div>
      <h3>${hl(t.name, words)}</h3>
      <div class="scroll"><table><thead><tr>${cells(t.headers, 'th')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr${rowHit(r) ? ' class="hit"' : ''}>${cells(r, 'td')}</tr>`).join('')}</tbody></table></div>
      <div class="tags"><span class="meta">${esc(t.section)}</span></div></article>`;
  }
  function formCard(f, words) {
    return `<article class="card form">
      <div class="kind">公式</div>
      <h3>${hl(f.name, words)}</h3>
      ${f.formula ? `<p class="formula">${hl(f.formula, words)}</p>` : ''}
      ${f.note ? `<p>${rich(f.note, words)}</p>` : ''}
      <div class="tags"><span class="meta">${esc(f.group)}</span></div></article>`;
  }
  function newsCard(n, words) {
    const links = n.urls.filter(u => /^https?:\/\//.test(u)).map(u => {
      let host = u;
      try { host = new URL(u).hostname; } catch (e) { /* そのまま表示 */ }
      return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a>`;
    }).join(' ／ ');
    return `<article class="card news">
      <div class="kind">最新情報（${esc(NEWS_DATE)}に確認）</div>
      <h3>${hl(n.topic, words)}</h3><p>${rich(n.result, words)}</p>
      <div class="tags"><span class="meta">根拠：${hl(n.basis, words)}</span>${links ? `<span class="meta">出典：${links}</span>` : ''}</div></article>`;
  }
  // 過去問・模擬問題。正解と解説は、解き直しの妨げにならないよう閉じておく
  function kakoCard(k, words) {
    const labels = ['A', 'B', 'C', 'D'];
    return `<article class="card kako">
      <div class="kind">${esc(k.src)}・問${k.no}${k.field ? `・${esc(k.field)}` : ''}</div>
      <p class="kakoq">${rich(k.q, words)}</p>
      <ol class="kakoopts">${k.opts.map((o, i) => `<li><span class="optlabel">${labels[i]}</span><span>${rich(o, words)}</span></li>`).join('')}</ol>
      <details><summary>正解${k.expl ? 'と解説' : ''}を見る</summary><p><b>正解：${esc(k.ans)}</b>${k.expl ? `<br>${rich(k.expl, words)}` : ''}</p></details></article>`;
  }
  function renderCard(r, words) {
    if (r.type === 'kako') return kakoCard(r.item, words);
    if (r.type === 'term') return termCard(r, words);
    if (r.type === 'conf') return confCard(r.item, words);
    if (r.type === 'table') return tableCard(r.item, words);
    if (r.type === 'news') return newsCard(r.item, words);
    return formCard(r.item, words);
  }

  /* ---------- キーワード検索 ---------- */
  function runSearch() {
    const res = GS.search($('q').value, filters(), { scope: $('fScope').value, sort: $('fSort').value, fuzzy: $('fFuzzy').checked });
    state.res = res;
    state.shown = PAGE;
    renderSearch();
  }
  function renderSearch() {
    const res = state.res;
    const counts = { all: res.results.length, term: 0, conf: 0, table: 0, form: 0, news: 0, kako: 0 };
    res.results.forEach(r => { counts[r.type]++; });
    $('types').innerHTML = Object.keys(TYPE_LABEL).map(k =>
      `<button type="button" role="tab" aria-selected="${state.type === k}" class="chip${state.type === k ? ' on' : ''}" data-type="${k}">${TYPE_LABEL[k]} <span class="n">${counts[k]}</span></button>`).join('');
    const list = state.type === 'all' ? res.results : res.results.filter(r => r.type === state.type);
    const hasQuery = !!$('q').value.trim();

    const notes = res.notes.map(n => `<div class="note">「${esc(n.raw)}」は見つからなかったので、近い語を探しました：${n.names.map(x => `<button type="button" class="linkish" data-q="${esc(x)}">${esc(x)}</button>`).join('、')}</div>`);
    if (state.back.length) {
      const prev = state.back[state.back.length - 1];
      const label = prev.mode === 'question' ? '問題文の検索' : prev.mode === 'timeline' ? '年表' : prev.mode === 'others' ? '他の人の資料' : prev.q ? `「${prev.q}」の検索` : '前の一覧';
      notes.unshift(`<div class="note soft"><button type="button" class="linkish" data-back="1">← ${esc(label)}に戻る</button></div>`);
    }
    if ($('fFlagged').checked && !flagged.size) notes.push('<div class="note">付箋を付けた用語はまだありません。用語カードの「付箋」ボタンで印を付けられます。</div>');
    if (res.hiddenExtras && state.type !== 'term') notes.push('<div class="note soft">分野で絞り込むと用語と混同ポイントだけ、重要度・シラバス項目・頭文字・区分・付箋で絞り込むと用語だけを表示します。</div>');
    const longPaste = $('q').value.trim().length >= 25;
    if (longPaste) notes.push('<div class="note">問題文を調べるなら、<button type="button" class="linkish" id="toQuestion">「問題文から検索」へこの文章を移す</button>のが便利です。</div>');
    $('notes').innerHTML = notes.join('');

    const box = $('list');
    if (!list.length) {
      const elsewhere = state.type !== 'all' && counts.all > 0;
      box.innerHTML = `<div class="empty">${elsewhere ? `${TYPE_LABEL[state.type]}には該当がありません。他の種類に${counts.all}件あります。` : hasQuery ? '該当するものがありません。語を減らすか、絞り込みを解除してみてください。' : '条件に合うものがありません。'}</div>`;
      $('more').hidden = true;
    } else {
      box.innerHTML = list.slice(0, state.shown).map(r => renderCard(r, res.words)).join('');
      const rest = list.length - state.shown;
      $('more').hidden = rest <= 0;
      $('more').textContent = `さらに表示（残り${rest}件）`;
    }
    $('status').textContent = `${list.length} 件` + (state.type === 'all' ? '' : `（${TYPE_LABEL[state.type]}）`);
  }

  /* ---------- 問題文から検索 ---------- */
  function termRow(t, opts) {
    const o = opts || {};
    const g = t.g;
    if (o.brief) return `<button type="button" class="termchip" data-term="${esc(g.term)}">${esc(g.term)}</button>`;
    return `<div class="trow"${fieldStyle(g.field)}>
      <button type="button" class="tname" data-term="${esc(g.term)}">${esc(g.term)}</button>
      ${g.imp === '－' ? '' : `<span class="imp">${esc(g.imp)}</span>`}
      ${flagButton(g.no)}
      <span class="tdesc">${rich(g.desc, [], t.idx)}</span></div>`;
  }
  const TYPE_BADGE = {
    negative: ['neg', '「誤り・不適切」を選ぶ問題の可能性があります。設問をよく確認してください'],
    combo: ['', '組み合わせ問題'],
    blank: ['', '空欄補充'],
    calc: ['', '計算問題の可能性']
  };
  function renderQuestion() {
    const text = $('qtext').value;
    const out = $('qresult');
    if (!text.trim()) {
      out.innerHTML = '<div class="empty">問題文と選択肢をまとめて貼り付けると、含まれる用語の解説を選択肢ごとに表示します。</div>';
      return;
    }
    const a = GS.analyzeQuestion(text);
    const parts = [];
    if (a.types.length) parts.push(`<div class="badges">${a.types.map(k => `<span class="qtype ${TYPE_BADGE[k][0]}">${esc(TYPE_BADGE[k][1])}${k === 'calc' && a.related.forms.length ? '（下に公式を表示）' : ''}</span>`).join('')}</div>`);

    const rk = a.ranking;
    if (rk.ranked) {
      // 一目で分かる要約。最有力の選択肢と、その根拠になった用語の一行
      const pick = n => a.items.find(i => i.rank === n);
      const why = it => {
        const t = (it.ex.terms[0] || it.similar[0] || {}).t;
        if (!t) return '';
        const d = String(t.g.desc || '');
        return `${t.g.term}：${d.length > 70 ? d.slice(0, 70) + '…' : d}`;
      };
      const first = pick(1), second = pick(2);
      if (first) {
        parts.push(`<div class="quick"><div class="qk-h">${rk.inverted ? '「不適切」の候補（資料と最も合わない。精度は低め・要確認）' : '最有力（推定）'}</div>
          <div class="qk-main"><span class="optlabel">${esc(first.label)}</span><span>${esc(first.text)}</span></div>
          ${why(first) ? `<div class="qk-why">${esc(why(first))}</div>` : ''}
          ${second ? `<div class="qk-2nd">次点：${esc(second.label)}　${esc(second.text.length > 40 ? second.text.slice(0, 40) + '…' : second.text)}</div>` : ''}
          <div class="qk-note">正解の判定ではありません</div></div>`);
      }
    }
    if (rk.ranked) {
      parts.push(`<div class="rankinfo"><b>推定順位について：</b>資料との文字の重なりから選択肢に順位を付けています。正解の判定ではありません。${rk.inverted ? '「不適切」を選ぶ問題なので、資料と合わない順に並べています。この型の問題は精度が低く、公式例題で試した4問のうち1位が合ったのは2問でした。必ず自分で確かめてください。' : ''}<br>実測の一致率：公式例題 ${esc(RANK_STATS.jdla)}／模擬問題 ${esc(RANK_STATS.mock)}（模擬問題は資料と同じノートが元なので高めに出ます）。</div>`);
    } else if (rk.reason === 'calc' || rk.reason === 'numeric') {
      parts.push(`<div class="rankinfo">計算問題や数値の選択肢には、推定順位を出しません。${a.related.forms.length ? '下の公式で計算してください。' : ''}</div>`);
    }
    if (a.stem) {
      parts.push(`<section class="qcard"><h3>問題文</h3><p class="qtext">${paint(a.stem, a.stemEx.ranges)}</p>
        ${a.stemEx.terms.map(x => termRow(x.t)).join('')}</section>`);
    }
    if (a.stemSimilar.length) {
      parts.push(`<section class="qcard sim"><h3>問題文の説明に近い用語 <small>文字の重なりからの推定です</small></h3>${a.stemSimilar.map(x => termRow(x.t)).join('')}</section>`);
    }
    const shownTerms = new Set(a.stemEx.terms.map(x => x.t.idx));
    a.items.forEach(it => {
      const fresh = it.ex.terms.filter(x => !shownTerms.has(x.t.idx));
      const again = it.ex.terms.filter(x => shownTerms.has(x.t.idx));
      fresh.forEach(x => shownTerms.add(x.t.idx));
      // 棒の長さは順位と同じ向きにする（「不適切」問題では、資料と合わないものほど長い）
      const barRate = rk.inverted ? 1 - it.relative : it.relative;
      const rankBadge = it.rank ? `<div class="rankrow"><span class="rank r${it.rank}">推定${it.rank}位</span><span class="bar" aria-hidden="true"><span style="width:${Math.round(barRate * 100)}%"></span></span></div>` : '';
      parts.push(`<section class="qcard opt"><h3><span class="optlabel">${esc(it.label)}</span><span class="opttext">${paint(it.text, it.ex.ranges)}</span></h3>${rankBadge}
        ${fresh.map(x => termRow(x.t)).join('')}
        ${again.length ? `<div class="again">上と同じ用語：${again.map(x => termRow(x.t, { brief: true })).join('')}</div>` : ''}
        ${it.similar.length ? `<div class="simlabel">解説が近い用語（推定）</div>${it.similar.map(x => termRow(x.t)).join('')}` : ''}
        ${!it.ex.terms.length && !it.similar.length ? '<p class="muted">資料に該当する用語が見つかりません。</p>' : ''}</section>`);
    });
    const allFound = a.stemEx.terms.length + a.items.reduce((n, it) => n + it.ex.terms.length, 0) + a.stemSimilar.length + a.items.reduce((n, it) => n + it.similar.length, 0);
    if (!allFound) parts.push('<div class="empty">用語が見つかりませんでした。資料にない語の可能性があります。</div>');

    const words = [];
    const r = a.related;
    if (a.similarQs.length) parts.push(`<section class="rel"><h3>似た問題</h3>${a.similarQs.map(x => kakoCard(x.item, words)).join('')}</section>`);
    if (r.forms.length) parts.push(`<section class="rel"><h3>関係しそうな公式</h3>${r.forms.map(x => formCard(x.item, words)).join('')}</section>`);
    if (r.confs.length) parts.push(`<section class="rel"><h3>混同ポイント</h3>${r.confs.map(x => confCard(x.item, x.terms.flatMap(t => t.names.map(n => n.l)))).join('')}</section>`);
    if (r.tables.length) parts.push(`<section class="rel"><h3>比較表</h3>${r.tables.map(x => tableCard(x.item, x.terms.flatMap(t => t.names.map(n => n.l)))).join('')}</section>`);
    if (r.news.length) parts.push(`<section class="rel"><h3>最新情報</h3>${r.news.map(x => newsCard(x.item, words)).join('')}</section>`);
    parts.push('<p class="muted disclaimer">推定順位は正解の判定ではありません。資料の解説を手がかりに、ご自身で判断してください。</p>');
    out.innerHTML = parts.join('');
  }

  /* ---------- モード切り替え ---------- */
  function setMode(mode) {
    const isQ = mode === 'question';
    $('tabKeyword').setAttribute('aria-selected', String(!isQ));
    $('tabQuestion').setAttribute('aria-selected', String(isQ));
    $('tabKeyword').classList.toggle('on', !isQ);
    $('tabQuestion').classList.toggle('on', isQ);
    $('panelKeyword').hidden = isQ;
    $('panelQuestion').hidden = !isQ;
    $('panelOthers').hidden = true;
    $('panelTimeline').hidden = true;
    $('tabTimeline').classList.remove('on');
    $('tabTimeline').setAttribute('aria-selected', 'false');
    $('tabOthers').classList.remove('on');
    $('tabOthers').setAttribute('aria-selected', 'false');
    (isQ ? $('qtext') : $('q')).focus();
    if (isQ) renderQuestion();
  }
  const SELECT_IDS = ['fField', 'fImp', 'fSyl', 'fKana', 'fKind', 'fScope', 'fSort'];
  function snapshot() {
    const values = {};
    SELECT_IDS.forEach(id => { values[id] = $(id).value; });
    return { q: $('q').value, mode: !$('panelTimeline').hidden ? 'timeline' : !$('panelOthers').hidden ? 'others' : $('panelQuestion').hidden ? 'keyword' : 'question', values, fuzzy: $('fFuzzy').checked, flaggedOnly: $('fFlagged').checked, type: state.type };
  }
  function showTerm(name) {
    state.back.push(snapshot());
    if (state.back.length > 20) state.back.shift();
    $('q').value = name;
    state.type = 'all';
    Object.keys(FILTER_IDS).forEach(id => { $(id).value = ''; });
    $('fScope').value = 'all';
    $('fSort').value = 'rel';
    $('fFlagged').checked = false;
    setMode('keyword');
    runSearch();
    window.scrollTo({ top: 0 });
  }
  function goBack() {
    const s = state.back.pop();
    if (!s) return;
    $('q').value = s.q;
    SELECT_IDS.forEach(id => { $(id).value = s.values[id]; });
    $('fFuzzy').checked = s.fuzzy;
    $('fFlagged').checked = s.flaggedOnly;
    state.type = s.type;
    runSearch();
    if (s.mode === 'others') $('tabOthers').click();
    else if (s.mode === 'timeline') $('tabTimeline').click();
    else setMode(s.mode);
    window.scrollTo({ top: 0 });
  }

  /* ---------- イベント ---------- */
  let t1, t2;
  $('q').addEventListener('input', () => { clearTimeout(t1); t1 = setTimeout(runSearch, 80); });
  ['fField', 'fImp', 'fSyl', 'fKana', 'fKind', 'fScope', 'fSort', 'fFuzzy', 'fFlagged'].forEach(id => $(id).addEventListener('change', runSearch));
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-flag]');
    if (!b) return;
    const no = Number(b.dataset.flag);
    if (flagged.has(no)) flagged.delete(no); else flagged.add(no);
    saveFlags();
    updateFlagCount();
    const on = flagged.has(no);
    document.querySelectorAll(`[data-flag="${no}"]`).forEach(x => {
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', String(on));
      x.textContent = on ? '付箋あり' : '付箋';
    });
    if ($('fFlagged').checked) runSearch();
  });
  $('more').addEventListener('click', () => { state.shown += PAGE; renderSearch(); });
  function clearFilters() {
    Object.keys(FILTER_IDS).forEach(id => { $(id).value = ''; });
    $('fScope').value = 'all'; $('fSort').value = 'rel'; $('fFuzzy').checked = true; $('fFlagged').checked = false;
    state.type = 'all';
  }
  $('reset').addEventListener('click', () => {
    $('q').value = '';
    state.back = [];
    clearFilters();
    runSearch();
    $('q').focus();
  });
  $('resetFilters').addEventListener('click', () => {
    clearFilters();
    runSearch();
  });
  $('types').addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    state.type = b.dataset.type; state.shown = PAGE; renderSearch();
  });
  $('list').addEventListener('click', e => {
    const link = e.target.closest('[data-term]');
    if (link) { showTerm(link.dataset.term); return; }
    const b = e.target.closest('button.tag[data-k]');
    if (!b) return;
    $(b.dataset.k).value = b.dataset.v;
    runSearch();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('notes').addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { goBack(); return; }
    const b = e.target.closest('[data-q]');
    if (b) { $('q').value = b.dataset.q; runSearch(); return; }
    if (e.target.id === 'toQuestion') {
      $('qtext').value = $('q').value;
      setMode('question');
    }
  });
  function showOthers() {
    ['tabKeyword', 'tabQuestion'].forEach(id => { $(id).classList.remove('on'); $(id).setAttribute('aria-selected', 'false'); });
    $('tabOthers').classList.add('on');
    $('tabOthers').setAttribute('aria-selected', 'true');
    $('panelKeyword').hidden = true;
    $('panelQuestion').hidden = true;
    $('panelOthers').hidden = false;
    $('panelTimeline').hidden = true;
    $('tabTimeline').classList.remove('on');
    $('tabTimeline').setAttribute('aria-selected', 'false');
    $('oq').focus();
  }
  document.addEventListener('gk-search', e => showTerm(e.detail));
  $('tabOthers').addEventListener('click', showOthers);
  $('tabKeyword').addEventListener('click', () => setMode('keyword'));
  $('tabQuestion').addEventListener('click', () => setMode('question'));
  $('qtext').addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(renderQuestion, 150); });
  $('qclear').addEventListener('click', () => { $('qtext').value = ''; renderQuestion(); $('qtext').focus(); });
  $('qsample').addEventListener('click', () => {
    $('qtext').value = '次のうち、過学習への対策として最も不適切な選択肢を1つ選べ。\nA）Dropout\nB）データ拡張\nC）L2正則化\nD）訓練データを減らす';
    renderQuestion();
  });
  $('qresult').addEventListener('click', e => {
    const b = e.target.closest('[data-term]');
    if (b) showTerm(b.dataset.term);
  });
  // 入力欄の外で貼り付けたら、そのまま問題文として分析する（複数行のときだけ）
  function takeQuestion(text) {
    $('qtext').value = text;
    setMode('question');
    window.scrollTo({ top: 0 });
  }
  document.addEventListener('paste', e => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (text.trim().split(/\n/).length < 2) return;
    e.preventDefault();
    takeQuestion(text);
  });
  $('qpaste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error('empty');
      takeQuestion(text);
    } catch (err) {
      $('qtext').focus();
      $('qresult').querySelectorAll('.clipnote').forEach(x => x.remove());
      $('qresult').insertAdjacentHTML('afterbegin', '<div class="rankinfo clipnote">クリップボードを読めませんでした。入力欄で Ctrl+V を押してください。</div>');
    }
  });
  document.addEventListener('keydown', e => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
      e.preventDefault();
      const box = !$('panelTimeline').hidden ? $('tq') : !$('panelOthers').hidden ? $('oq') : $('panelQuestion').hidden ? $('q') : $('qtext');
      box.focus();
      box.select();
    }
  });

  // スマートフォンでは、結果が最初の画面に入るよう絞り込み欄を閉じておく
  if (window.matchMedia && window.matchMedia('(max-width:560px)').matches) $('filtersBox').open = false;
  updateFlagCount();
  runSearch();
  renderQuestion();
  // ショートカットから開いたとき（アドレスの末尾が #quick）は問題文の画面にして、クリップボードの内容を分析する
  if (location.hash === '#quick') {
    setMode('question');
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(t => { if (t && t.trim()) takeQuestion(t); }).catch(() => { /* 許可されない場合は、入力欄で貼り付ける */ });
    }
  }
})();

// タブ(キーワード/問題文/他の人の資料/年表)を左右の矢印キーで移る
(function () {
  const tabs = ['tabKeyword', 'tabQuestion', 'tabOthers', 'tabTimeline'].map(id => document.getElementById(id));
  tabs.forEach((t, i) => t.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.click(); n.focus();
  }));
})();

// 音声入力(ブラウザの音声認識を使う)。検索欄の右に🎤ボタンを付ける
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  let active = null;
  function stop() { if (active) { try { active.rec.stop(); } catch (e) { /* 停止済み */ } } }
  function attach(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'micbtn';
    b.textContent = '🎤';
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', '音声で入力');
    b.title = '音声で入力（もう一度押すと止まります）。音声はブラウザの音声認識サービスに送られます';
    el.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => {
      if (active && active.btn === b) { stop(); return; }
      stop();
      const rec = new SR();
      rec.lang = 'ja-JP';
      rec.interimResults = true;
      rec.continuous = id === 'qtext';
      const base = el.value ? el.value.replace(/\s*$/, ' ') : '';
      const done = (msg) => {
        b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
        if (active && active.btn === b) active = null;
        if (msg) { b.title = msg; b.classList.add('err'); } else b.classList.remove('err');
      };
      rec.onresult = ev => {
        let t = '';
        for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        el.value = (id === 'qtext' ? base : '') + t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = ev => done(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'マイクの使用が許可されていません。アドレスバーの許可設定を確認してください' : ev.error === 'no-speech' ? '' : '音声入力に失敗しました（' + ev.error + '）');
      rec.onend = () => done(b.classList.contains('err') ? b.title : '');
      active = { rec, btn: b };
      b.classList.remove('err'); b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
      try { rec.start(); } catch (e) { done('音声入力を開始できませんでした'); }
    });
  }
  ['q', 'qtext', 'oq', 'tq'].forEach(attach);
})();

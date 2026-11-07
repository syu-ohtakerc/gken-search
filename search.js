// 検索の処理（画面に依存しない部分）。
(function (root) {
  'use strict';

  /* ---------- 文字の正規化 ---------- */
  const REMOVE = /[\s\-‐‑‒–—―−ー・･_'’"“”「」『』]/;
  const SMALL = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ', 'ゕ': 'か', 'ゖ': 'け' };

  // 全角半角・大小文字・カタカナひらがな・長音やハイフンの違いをなくす。
  // t: 正規化後の文字列、a/b: 正規化後の各文字が元の文字列のどこから来たか
  function fold(s) {
    const src = String(s == null ? '' : s);
    const t = [], a = [], b = [];
    let i = 0;
    for (const ch of src) {
      const end = i + ch.length;
      for (const n of ch.normalize('NFKC')) {
        if (n === '゙' || n === '゚') { // 濁点・半濁点は直前の文字と合成する
          if (t.length) {
            t[t.length - 1] = (t[t.length - 1] + n).normalize('NFC')[0];
            b[b.length - 1] = end;
          }
          continue;
        }
        if (REMOVE.test(n)) continue;
        let c = n.toLowerCase();
        for (let k = 0; k < c.length; k++) {
          let u = c[k];
          const code = u.charCodeAt(0);
          if (code >= 0x30A1 && code <= 0x30F6) u = String.fromCharCode(code - 0x60);
          if (SMALL[u]) u = SMALL[u];
          t.push(u); a.push(i); b.push(end);
        }
      }
      i = end;
    }
    return { t: t.join(''), a, b };
  }
  const loose = s => fold(s).t;

  // words（正規化済み）が text のどこに現れるかを、元の文字位置の範囲で返す
  function rangesOf(text, words) {
    const f = fold(text);
    const out = [];
    (words || []).forEach(w => {
      if (!w) return;
      let p = 0;
      while ((p = f.t.indexOf(w, p)) >= 0) {
        out.push([f.a[p], f.b[p + w.length - 1]]);
        p += w.length;
      }
    });
    return mergeRanges(out);
  }
  function mergeRanges(list) {
    if (!list.length) return [];
    const s = list.slice().sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const m = [s[0].slice()];
    for (let i = 1; i < s.length; i++) {
      const l = m[m.length - 1];
      if (s[i][0] <= l[1]) l[1] = Math.max(l[1], s[i][1]);
      else m.push(s[i].slice());
    }
    return m;
  }

  /* ---------- 用語の索引 ---------- */
  function variants(term) {
    const out = [];
    term.split('／').forEach(part => {
      const m = part.match(/^(.*?)[（(](.+?)[）)](.*)$/);
      if (m) { out.push((m[1] + m[3]).trim()); out.push(m[2].trim()); }
      else out.push(part.trim());
    });
    out.slice().forEach(v => {
      if (/^[A-Za-z0-9*α-ω-]+法$/.test(v)) out.push(v.slice(0, -1)); // k-means法 → k-means
    });
    return out.filter(Boolean);
  }

  const TERMS = GLOSSARY.map((g, idx) => {
    const seen = new Set();
    const names = [];
    const add = (raw, alias) => {
      const l = loose(raw);
      if (!l || seen.has(l)) return;
      seen.add(l);
      names.push({ raw, l, alias });
    };
    variants(g.term).forEach(v => add(v, false));
    const aliases = (typeof ALIASES !== 'undefined' && ALIASES[g.term]) || [];
    aliases.forEach(v => add(v, true));
    const rawReadings = (typeof READINGS !== 'undefined' && READINGS[g.term]) || [];
    const readings = [].concat(rawReadings).map(r => ({ raw: r, l: loose(r), alias: true, reading: true }));
    return {
      idx, g, names, aliases, readings,
      nd: loose(g.desc),
      imp: (g.imp.match(/★/g) || []).length
    };
  });

  /* ---------- 検索対象の文書 ---------- */
  const DOCS_CONF = CONFUSIONS.map(c => ({ type: 'conf', item: c, field: c.field, strong: [loose(c.topic)], weak: [loose(c.diff)] }));
  const DOCS_TABLE = TABLES.map(t => ({
    type: 'table', item: t,
    strong: [loose(t.name)].concat(t.rows.map(r => loose(r[0]))),
    weak: [loose(t.section)].concat(t.headers.map(loose)).concat(t.rows.map(r => loose(r.slice(1).join('\n'))))
  }));
  const DOCS_FORM = FORMULAS.map(f => ({ type: 'form', item: f, strong: [loose(f.name)], weak: [loose(f.formula), loose(f.note), loose(f.group)] }));
  // 最新情報の項目名と用語名が一致しないものに、検索用の語を足す（元データは変えない）
  const NEWS_KEYWORDS = {
    '第三次ブームと生成AIの時代区分': '第三次AIブーム 生成AI',
    'シラバス・試験形式': 'G検定 シラバス',
    '試験中の資料参照': 'G検定 受験'
  };
  const newsKeywords = n => NEWS_KEYWORDS[n.topic] || '';
  const DOCS_NEWS = NEWS.map(n => ({ type: 'news', item: n, strong: [loose(n.topic), loose(newsKeywords(n))], weak: [loose(n.result), loose(n.basis)] }));
  const KAKO = (typeof KAKO_MOCK !== 'undefined' ? KAKO_MOCK : []).concat(typeof KAKO_JDLA !== 'undefined' ? KAKO_JDLA : []);
  const DOCS_KAKO = KAKO.map(k => ({ type: 'kako', item: k, strong: [loose(k.q)], weak: [loose(k.opts.join('\n')), loose(k.expl), loose(k.field)] }));
  const DOCS_EXTRA = DOCS_CONF.concat(DOCS_TABLE, DOCS_FORM, DOCS_NEWS, DOCS_KAKO);

  /* ---------- あいまい一致 ---------- */
  // pattern が text のどこかの部分文字列に、何文字の違いで一致するか（Sellers法）
  function fuzzyDistance(pattern, text, limit) {
    const m = pattern.length;
    if (!m) return Infinity;
    let prev = new Array(m + 1);
    for (let i = 0; i <= m; i++) prev[i] = i;
    let best = prev[m];
    for (let j = 0; j < text.length; j++) {
      const cur = new Array(m + 1);
      cur[0] = 0;
      for (let i = 1; i <= m; i++) {
        const cost = pattern[i - 1] === text[j] ? 0 : 1;
        cur[i] = Math.min(prev[i - 1] + cost, prev[i] + 1, cur[i - 1] + 1);
      }
      if (cur[m] < best) best = cur[m];
      prev = cur;
    }
    return best <= limit ? best : Infinity;
  }
  function fuzzyLimit(len) {
    if (len < 3 || len > 24) return 0;
    if (len <= 4) return 1;
    if (len <= 8) return 2;
    return 3;
  }
  const isKanaWord = w => /^[ぁ-ゖ]+$/.test(w);
  function fuzzyCandidates(w) {
    const limit = fuzzyLimit(w.length);
    if (!limit) return [];
    const found = [];
    const kana = isKanaWord(w);
    TERMS.forEach(t => {
      let best = null;
      (kana ? t.names.concat(t.readings) : t.names).forEach(n => {
        if (n.l.length < w.length - limit) return;
        const d = fuzzyDistance(w, n.l, limit);
        if (d === Infinity) return;
        const gap = Math.abs(n.l.length - w.length);
        if (!best || d < best.d || (d === best.d && gap < best.gap)) best = { t, d, gap, name: n };
      });
      if (best) found.push(best);
    });
    found.sort((x, y) => x.d - y.d || x.gap - y.gap || y.t.imp - x.t.imp || x.t.idx - y.t.idx);
    if (!found.length) return [];
    const top = found[0].d;
    return found.filter(c => c.d === top).slice(0, 6);
  }
  const tokenCache = new Map();
  function tokenInfo(w) {
    if (tokenCache.has(w)) return tokenCache.get(w);
    const kana = isKanaWord(w) && w.length >= 2;
    const exact = TERMS.some(t => t.nd.includes(w) || t.names.some(n => n.l.includes(w)) || (kana && t.readings.some(r => r.l.includes(w)))) ||
      DOCS_EXTRA.some(d => d.strong.concat(d.weak).some(x => x.includes(w)));
    const info = exact ? { exact: true, cands: [] } : { exact: false, cands: fuzzyCandidates(w) };
    tokenCache.set(w, info);
    return info;
  }

  /* ---------- キーワード検索 ---------- */
  function parseKeywords(q) {
    const inc = [], exc = [];
    // 「再現率（Recall）」「AIC／BIC」のような用語名も、部分に分けて検索できるようにする
    String(q || '').normalize('NFKC').trim().split(/[\s\/()]+/).filter(Boolean).forEach(tok => {
      if (/^[-−ー‐–—]/.test(tok) && tok.length > 1) { const w = loose(tok.slice(1)); if (w) exc.push(w); }
      else { const w = loose(tok); if (w) inc.push({ raw: tok, w }); }
    });
    return { inc, exc };
  }

  function scoreTerm(t, w, scope) {
    if (scope !== 'desc') {
      let s = 0, via = null;
      t.names.forEach(n => {
        let v = 0;
        if (n.l === w) v = 100; else if (n.l.startsWith(w)) v = 60; else if (n.l.includes(w)) v = 40;
        if (v > s || (v === s && v && via && via.alias && !n.alias)) { s = v; via = n; }
      });
      if (s) return { s, via };
      // ひらがなの語は読みでも探す
      if (w.length >= 2 && isKanaWord(w)) {
        t.readings.forEach(n => {
          let v = 0;
          if (n.l === w) v = 90; else if (n.l.startsWith(w)) v = 55; else if (n.l.includes(w)) v = 35;
          if (v > s) { s = v; via = n; }
        });
        if (s) return { s, via };
      }
    }
    if (scope !== 'term' && t.nd.includes(w)) return { s: 10, via: null };
    return null;
  }
  function scoreExtra(d, w, scope) {
    if (scope !== 'desc' && d.strong.some(x => x.includes(w))) return 45;
    if (scope !== 'term' && d.weak.some(x => x.includes(w))) return 12;
    return 0;
  }
  function termFilterOk(t, f) {
    if (f.flags && !f.flags.has(t.g.no)) return false;
    if (f.field && t.g.field !== f.field) return false;
    if (f.kind && t.g.kind !== f.kind) return false;
    if (f.kana && t.g.kana !== f.kana) return false;
    if (f.imp) {
      if (f.imp === '2+' && t.imp < 2) return false;
      if ((f.imp === '3' || f.imp === '2' || f.imp === '0') && t.imp !== +f.imp) return false;
    }
    if (f.syl) {
      if (f.syl.endsWith('*')) { if (t.g.syl[0] !== f.syl[0]) return false; }
      else if (t.g.syl !== f.syl) return false;
    }
    return true;
  }

  function search(q, filters, opts) {
    const f = filters || {};
    const scope = (opts && opts.scope) || 'all';
    const sort = (opts && opts.sort) || 'rel';
    // 「解説のみ」のときは、用語名に対するあいまい一致を使わない
    const useFuzzy = (!opts || opts.fuzzy !== false) && scope !== 'desc';
    const { inc, exc } = parseKeywords(q);
    const whole = loose(q);
    const notes = [];
    const words = [];
    const tokens = inc.map(({ raw, w }) => {
      const info = tokenInfo(w);
      if (info.exact || !useFuzzy || !info.cands.length) {
        words.push(w);
        // 読みで見つかる語は、用語名でも資料の本文を探し、ハイライトする
        const expansions = [];
        if (w.length >= 3 && isKanaWord(w)) {
          TERMS.forEach(t => {
            if (expansions.length < 12 && t.readings.some(r => r.l === w || r.l.startsWith(w))) {
              t.names.filter(n => !n.alias).forEach(n => { expansions.push(n.l); words.push(n.l); });
            }
          });
        }
        return { raw, w, fuzzy: false, missing: !info.exact, expansions };
      }
      const map = new Map();
      info.cands.forEach(c => { map.set(c.t.idx, c); words.push(c.name.l); words.push(c.t.names[0].l); });
      notes.push({ raw, names: info.cands.map(c => c.t.g.term) });
      return { raw, w, fuzzy: true, map, names: info.cands.map(c => c.name.l) };
    });

    const results = [];
    TERMS.forEach(t => {
      if (!termFilterOk(t, f)) return;
      const hay = (scope === 'desc' ? [] : t.names.map(n => n.l)).concat(scope === 'term' ? [] : [t.nd]);
      if (exc.some(w => hay.some(x => x.includes(w)))) return;
      let score = 0;
      const vias = [];
      for (const tk of tokens) {
        if (tk.fuzzy) {
          const c = tk.map.get(t.idx);
          if (!c) return;
          score += 30 - c.d * 5;
          if (c.name.alias) vias.push(c.name.raw);
          continue;
        }
        const r = scoreTerm(t, tk.w, scope);
        if (!r) return;
        score += r.s;
        if (r.via && r.via.alias) vias.push(r.via.raw);
      }
      // 検索語全体が用語名や別名と一致するものを最優先にする
      if (whole && scope !== 'desc' && (loose(t.g.term) === whole || t.names.some(n => n.l === whole) || t.readings.some(n => n.l === whole))) score += 1000;
      results.push({ type: 'term', item: t, score: score + t.imp, fuzzy: tokens.some(k => k.fuzzy), vias });
    });

    const termOnly = !!(f.imp || f.syl || f.kana || f.kind || f.flags);
    let hiddenExtras = false;
    if (termOnly || f.field) hiddenExtras = true;
    DOCS_EXTRA.forEach(d => {
      if (termOnly) return;
      if (f.field && d.type !== 'conf') return;
      if (f.field && d.field !== f.field) return;
      const all = d.strong.concat(d.weak);
      const excHay = scope === 'term' ? d.strong : scope === 'desc' ? d.weak : all;
      if (exc.some(w => excHay.some(x => x.includes(w)))) return;
      let score = 0;
      for (const tk of tokens) {
        if (tk.fuzzy) {
          if (!tk.names.some(n => all.some(x => x.includes(n)))) return;
          score += 15;
          continue;
        }
        let s = scoreExtra(d, tk.w, scope);
        if (!s && tk.expansions) tk.expansions.forEach(x => { s = Math.max(s, scoreExtra(d, x, scope)); });
        if (!s) return;
        score += s;
      }
      results.push({ type: d.type, item: d.item, score, fuzzy: tokens.some(k => k.fuzzy), vias: [] });
    });

    const typeRank = { term: 0, conf: 1, table: 2, form: 3, news: 4, kako: 5 };
    const termNo = r => (r.type === 'term' ? r.item.g.no : 0);
    results.forEach((r, i) => { r.order = i; });
    results.sort((x, y) => {
      if (sort === 'rel' && tokens.length) return y.score - x.score || typeRank[x.type] - typeRank[y.type] || x.order - y.order;
      if (typeRank[x.type] !== typeRank[y.type]) return typeRank[x.type] - typeRank[y.type];
      if (x.type === 'term') {
        if (sort === 'rel' || sort === 'imp') {
          if (y.item.imp !== x.item.imp) return y.item.imp - x.item.imp;
        }
        return termNo(x) - termNo(y);
      }
      return x.order - y.order;
    });

    return { results, words, notes, hiddenExtras, tokens: tokens.length, exclude: exc, missing: tokens.filter(t => t.missing).map(t => t.raw) };
  }

  /* ---------- 問題文の中の用語を見つける ---------- */
  const isAlnum = c => /^[0-9a-z]$/.test(String(c || '').normalize('NFKC').toLowerCase());
  const isKatakana = c => /^[ァ-ヺ]$/.test(String(c || '').normalize('NFKC'));

  const EXACT_CASE = new Set(['GAP', 'CAM', 'CLIP', 'FAT', 'LAWS', 'LIME', 'GLUE', 'RAG', 'mAP', 'CEC', 'BPR', 'NDA', 'CTC', 'FPN', 'PPO', 'CoT', 'BoW']);
  // カタカナの短い名前の直後に続いても、複合語として認める語
  const KANA_SUFFIX = /^(セット|データ|モデル|サイズ|ネットワーク|システム|レイヤー?|サービス|ベース|コンピューティング)/;
  const NAME_INDEX = [];
  TERMS.forEach(t => t.names.forEach(n => NAME_INDEX.push({
    t, n,
    asciiStart: isAlnum(n.raw[0]),
    asciiEnd: isAlnum(n.raw[n.raw.length - 1]),
    // カタカナだけの短い名前は、別の語の一部（フィルタリングなど）に一致しやすい
    kanaShort: n.l.length <= 4 && /^[ァ-ヺー・]+$/.test(n.raw),
    // カタカナの名前は、文中のひらがな（受け身の「れる」など）には一致させない
    kataOnly: /[ァ-ヺ]/.test(n.raw) && !/[ぁ-ゖ]/.test(n.raw),
    // 英単語と同じつづりの名前は、大文字小文字まで一致したときだけ認める
    exactCase: EXACT_CASE.has(n.raw),
    // 短い英字名は語の途中に空白を認めない（a dam → Adam を防ぐ）
    noSpace: /^[A-Za-z0-9]{1,4}$/.test(n.raw)
  })));
  // 複合語の一部として現れたときは、別の意味なので一致させない
  const COMPOUND_BLOCK = {
    '分散': { after: /^(処理|学習|型|システム|コンピューティング|環境)/ },
    '感度': { after: /^分析/ },
    '報酬': { before: /役員$/ },
    'カーネル': { after: /^(関数|トリック|法)/ }
  };
  // 同じつづりでも別の概念を指す文脈では、用語として扱わない
  const CONTEXT_BLOCK = {
    'バイアス': /\+1|第2項|の低減/, // ニューロンの切片や、統計のバイアス
    'F1': /F2|フォルマント/, // 音声のフォルマント周波数
    '量子化': /標本化|アナログ|A-D/, // 信号の量子化
    '枝刈り': /ミニマックス|αβ|探索木/, // 探索木の枝刈り
    'プルーニング': /ミニマックス|αβ|探索木/
  };
  const CONTEXT_WINDOW = 20; // 文脈は一致した語の前後だけを見る
  function extractOk(e, src, s, en) {
    const before = src[s - 1], after = src[en];
    const slice = src.slice(s, en);
    if (e.asciiStart && isAlnum(before)) return false;
    if (e.asciiEnd && isAlnum(after)) {
      // VGG16 や YOLOv3 のように、英字名の直後の数字やバージョンは認める
      const lastIsLetter = /[A-Za-z]$/.test(e.n.raw);
      const rest = src.slice(en, en + 2).normalize('NFKC').toLowerCase();
      // CNNs のような複数形も認める
      const plural = /[A-Z]$/.test(e.n.raw) && rest[0] === 's' && !isAlnum(src[en + 1]);
      if (!plural && !(lastIsLetter && /^(\d|v\d)/.test(rest))) return false;
    }
    if (e.kanaShort && isKatakana(before)) return false;
    if (e.kanaShort && isKatakana(after) && !KANA_SUFFIX.test(src.slice(en))) return false;
    if (e.kataOnly && /[ぁ-ゖ]/.test(slice)) return false;
    if (e.exactCase && slice.normalize('NFKC') !== e.n.raw) return false;
    if (e.noSpace && /\s/.test(slice)) return false;
    const ctx = CONTEXT_BLOCK[e.n.raw];
    if (ctx && ctx.test(src.slice(Math.max(0, s - CONTEXT_WINDOW), en + CONTEXT_WINDOW))) return false;
    const block = COMPOUND_BLOCK[e.n.raw];
    if (block) {
      if (block.after && block.after.test(src.slice(en))) return false;
      if (block.before && block.before.test(src.slice(0, s))) return false;
    }
    return true;
  }

  // 長い語を優先して、文章の中に出てくる用語を返す
  function extractTerms(text) {
    const src = String(text || '');
    const f = fold(src);
    const all = [];
    NAME_INDEX.forEach(e => {
      const w = e.n.l;
      let p = 0;
      while ((p = f.t.indexOf(w, p)) >= 0) {
        const s = f.a[p], en = f.b[p + w.length - 1];
        if (extractOk(e, src, s, en)) all.push({ t: e.t, name: e.n, p, end: p + w.length, s, e: en });
        p += 1;
      }
    });
    all.sort((x, y) => (y.end - y.p) - (x.end - x.p) || x.p - y.p);
    const taken = [];
    const mentions = [];
    all.forEach(m => {
      const clash = taken.some(k => m.p < k.end && k.p < m.end && !(k.p === m.p && k.end === m.end));
      if (clash) return;
      taken.push(m);
      mentions.push(m);
    });
    mentions.sort((x, y) => x.p - y.p);
    const byTerm = new Map();
    mentions.forEach(m => {
      if (!byTerm.has(m.t.idx)) byTerm.set(m.t.idx, { t: m.t, name: m.name, count: 0, first: m.p, len: m.end - m.p });
      byTerm.get(m.t.idx).count++;
    });
    const terms = [...byTerm.values()].sort((x, y) => y.len - x.len || y.t.imp - x.t.imp || x.first - y.first);
    return { mentions, terms, ranges: mergeRanges(mentions.map(m => [m.s, m.e])) };
  }

  /* ---------- 説明文が近い用語 ---------- */
  const BOILER = [
    /以下の文章を読み[、,]?/g, /以下の[^。\n]{0,20}説明に適した[^。\n]{0,20}組み合わせとして[、,]?/g,
    /空欄に最もよく当てはまる選択肢を\s*[1１一]つ選べ/g, /最も(不)?適切な選択肢を\s*[1１一]つ選べ/g,
    /(不)?適切な選択肢を\s*[1１一]つ選べ/g, /最も(不)?適切な(もの|記述|説明|選択肢)(を\s*([1１一]つ)?選べ|はどれか?)?/g,
    /(もの|説明|記述)(を\s*([1１一]つ)?選べ|はどれか?)/g, /どれか/g, /次のうち/g, /として[、,]?/g, /選択肢/g
  ];
  // 言い換えの辞書。同じ意味の語を代表の語にそろえてから比べる（先頭が代表）
  const PARAPHRASES = [
    // 文脈で意味が割れる語（罰則、削除、外部、偏り、プライバシーなど）は、別の概念に一致するので入れない
    ['二乗', '2乗', '自乗'], ['ばらつき', '散らばり'], ['ずれ', '偏差', '乖離'], ['画素', 'ピクセル'],
    ['見逃し', '偽陰性'], ['誤検知', '誤検出', '偽陽性'], ['減らす', '削減', '低減', '抑える', '抑制', '少なく'],
    ['増やす', '増加', '増大', '多く'], ['類似', '似た', '似て', '近い', '近さ'], ['停止', '止める', '止め', '打ち切'],
    ['未知データ', '未知のデータ', '新しいデータ', '新規データ'], ['訓練データ', '学習データ'], ['正解ラベル', '教師ラベル', '正解データ', '教師データ', 'ラベル付き'],
    ['軽量化', 'モデル圧縮', '軽くする'], ['深い層', '層が深い', '多層', '深いネットワーク'], ['言い換え', 'パラフレーズ', 'paraphrasing', '同義語'],
    ['電力', 'エネルギー消費', '消費電力'], ['次元削減', '次元圧縮', '次元を減らす', '次元を下げ'],
    ['ランダム', '無作為', '乱数'], ['順序', '語順', '位置情報'],
    ['寄与', '影響度', '重要度'], ['判断根拠', '判断の根拠', '説明性', '解釈性', '解釈しやすく'], ['ペナルティ', '罰則項'],
    ['生成', '作り出す', '作成'], ['検索', '探す', '探し出す'], ['圧縮', '縮小'], ['最大化', '最大にする', '最も大きく'],
    ['逐次', '順に', '順番に', '1本ずつ'], ['並列', '同時に'], ['統合', '組み合わせる', '組合せる'],
    ['分布', '確率分布'], ['同意', '承諾'], ['著作権者', '権利者'], ['実現可能性', 'フィージビリティ'], ['小規模', '試験的'],
    ['長期依存', '長期の依存', '長期記憶'], ['特徴抽出', '特徴を抽出', '局所特徴'], ['出力サイズ', '出力の大きさ', '出力の次元'],
    ['関係する事柄', '関連する事柄', '関係する情報'], ['有限', '限られた'], ['もっともらしく', 'それらしく'], ['事実に反する', '誤った情報', '事実と異なる'],
    ['残差接続', 'スキップ結合', 'スキップ接続', 'ショートカット接続'], ['ビット数', 'バイト数', '数値精度'], ['端末', 'エッジデバイス', 'デバイス'], ['知識表現', '知識を明示的'], ['顧客', 'ユーザ', '利用者'],
    ['教師なし', '正解ラベルのない', '正解ラベルなし', 'ラベルのない', 'ラベルなし'], ['クラスタ', 'グループを作る', 'グループ分け']
  ];
  const PARA_LIST = [];
  PARAPHRASES.forEach(g => g.slice(1).forEach(v => PARA_LIST.push([v.normalize('NFKC').toLowerCase(), g[0]])));
  PARA_LIST.sort((a, b) => b[0].length - a[0].length);
  function simClean(s) {
    let x = String(s || '').normalize('NFKC').toLowerCase();
    BOILER.forEach(r => { x = x.replace(r, ' '); });
    PARA_LIST.forEach(([v, rep]) => { if (x.includes(v)) x = x.split(v).join(rep); });
    return x;
  }
  const isHira = c => /[ぁ-ゖ]/.test(c);
  function grams(s) {
    const x = simClean(s).replace(/[\s、。,.，．・:：;；!?！？()（）「」『』\[\]【】／/\-ー=]+/g, ' ');
    const set = new Set();
    x.split(' ').forEach(run => {
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i], b = run[i + 1];
        if (isHira(a) && isHira(b)) continue;
        if (/[a-z0-9]/.test(a) && /[a-z0-9]/.test(b)) continue; // 英字の2文字組は無関係な語にも一致しやすい
        if (/[0-9]/.test(a) || /[0-9]/.test(b)) continue; // 「2つ」のような数字の並びも同じ
        set.add(a + b);
      }
    });
    return set;
  }
  // 用語ごとの文書: 名前・別名・解説に、混同ポイントと比較表で語られている内容も加える
  const SIM_DOCS = TERMS.map(t => {
    const g = grams(t.g.desc);
    grams(t.g.term).forEach(x => g.add(x));
    t.aliases.forEach(a => grams(a).forEach(x => g.add(x)));
    return { t, g };
  });
  const addContext = (text, context) => {
    extractTerms(text).terms.forEach(x => grams(context).forEach(k => SIM_DOCS[x.t.idx].g.add(k)));
  };
  CONFUSIONS.forEach(c => addContext(c.topic, c.diff));
  TABLES.forEach(t => t.rows.forEach(r => {
    if (r[0]) addContext(r[0], r.slice(1).join(' '));
  }));
  const DF = new Map();
  SIM_DOCS.forEach(d => d.g.forEach(x => DF.set(x, (DF.get(x) || 0) + 1)));
  const idf = x => Math.log((SIM_DOCS.length + 1) / ((DF.get(x) || 0) + 0.5));
  SIM_DOCS.forEach(d => {
    let n = 0;
    d.g.forEach(x => { const v = idf(x); n += v * v; });
    d.norm = Math.sqrt(n) || 1;
  });
  const SIM_THRESHOLD = 0.16;
  function similarTerms(text, k, excludeIdx) {
    const q = grams(text);
    if (q.size < 3) return [];
    let qn = 0;
    q.forEach(x => { if (DF.has(x)) { const v = idf(x); qn += v * v; } });
    qn = Math.sqrt(qn) || 1;
    const ex = excludeIdx || new Set();
    const out = [];
    SIM_DOCS.forEach(d => {
      if (ex.has(d.t.idx)) return;
      let dot = 0, shared = 0;
      q.forEach(x => { if (d.g.has(x)) { const v = idf(x); dot += v * v; shared++; } });
      if (shared < 2) return;
      const score = dot / (qn * d.norm);
      if (score >= SIM_THRESHOLD) out.push({ t: d.t, score });
    });
    out.sort((x, y) => y.score - x.score || y.t.imp - x.t.imp);
    // 最上位より大きく劣る候補は、関連が薄いので出さない
    const top = out.length ? out[0].score : 0;
    return out.filter(x => x.score >= top * 0.6).slice(0, k || 5);
  }

  /* ---------- 選択肢の推定順位 ---------- */
  function cosine(q, g, gNorm) {
    let dot = 0, qn = 0;
    q.forEach(x => { const v = idf(x); qn += v * v; if (g.has(x)) dot += v * v; });
    if (!qn) return 0;
    return dot / (Math.sqrt(qn) * gNorm);
  }
  function normOf(g) {
    let n = 0;
    g.forEach(x => { const v = idf(x); n += v * v; });
    return Math.sqrt(n) || 1;
  }
  const docScore = (q, t) => { const d = SIM_DOCS[t.idx]; return cosine(q, d.g, d.norm); };
  const RANK_WEIGHTS = { optTerm: 1, stemTerm: 1, direct: 0.5, link: 0.15 };
  // 用語どうしの関係: 解説や混同ポイント、比較表の同じ行で一緒に語られている語
  const LINKS = TERMS.map(() => new Set());
  const MENTION_COUNT = TERMS.map(() => 0);
  function linkTerms(text, ownerIdx) {
    const found = extractTerms(text).terms.map(x => x.t.idx);
    found.forEach(i => {
      if (ownerIdx !== undefined && i !== ownerIdx) { LINKS[ownerIdx].add(i); LINKS[i].add(ownerIdx); MENTION_COUNT[i]++; }
      found.forEach(j => { if (i !== j) LINKS[i].add(j); });
    });
  }
  TERMS.forEach(t => linkTerms(t.g.desc, t.idx));
  CONFUSIONS.forEach(c => linkTerms(c.topic));
  TABLES.forEach(t => t.rows.forEach(r => linkTerms(r.join(' '))));
  // 多くの解説に出てくる一般的な語（AI など）は、手がかりとして弱いので除く
  const isGeneric = t => MENTION_COUNT[t.idx] >= 12 || t.names.some(n => n.l === 'ai');

  // 選択肢ごとに、問題文や資料とどれだけ合っているかを数値にする。正解の判定ではなく推定
  function rankOptions(stem, items, types) {
    if ((types || []).includes('calc')) return { ranked: false, reason: 'calc' };
    const statements = {};
    items.filter(it => it.cls === 'hira').forEach(it => { statements[it.label] = it.text; });
    const hasOthers = items.some(it => it.cls !== 'hira');
    const opts = items.filter(it => !hasOthers || it.cls !== 'hira');
    if (opts.length < 2) return { ranked: false, reason: 'few' };
    if (opts.every(it => !/[^\d\s.,%％×/／回個件-]/.test(it.text))) return { ranked: false, reason: 'numeric' };
    const stemQ = grams(stem);
    const stemTerms = extractTerms(stem).terms.map(x => x.t).filter(t => !isGeneric(t)).slice(0, 4);
    opts.forEach(it => {
      const pairs = [];
      if (Object.keys(statements).length) {
        // 組み合わせ問題: 「( あ ) 相関係数」の形を、説明文「あ」と用語の組として調べる
        const re = /[(（]\s*([あ-か])\s*[)）]\s*([^(（]+)/g;
        let m;
        while ((m = re.exec(it.text))) {
          const ts = extractTerms(m[2]).terms;
          if (statements[m[1]] && ts.length) pairs.push([grams(statements[m[1]]), ts[0].t]);
        }
      }
      if (pairs.length) {
        it.score = pairs.reduce((sum, [q, t]) => sum + docScore(q, t), 0) / pairs.length;
        return;
      }
      const o = grams(it.text);
      const optTerms = it.ex.terms.map(x => x.t);
      // 選択肢が用語名そのものなら強く、文章の中にたまたま出てくる語なら弱く数える
      const plain = it.text.replace(/\s/g, '').length || 1;
      const covered = it.ex.ranges.reduce((n, [a, b]) => n + (b - a), 0) / plain;
      const f1Weight = covered >= 0.5 ? 1 : 0.25;
      const f1 = optTerms.length ? f1Weight * Math.max(...optTerms.map(t => docScore(stemQ, t))) : 0;
      const f2 = stemTerms.length && o.size ? Math.max(...stemTerms.map(t => docScore(o, t))) : 0;
      // 問題文と選択肢の直接の比較は、選択肢が文章のときだけ使う（語だけだと偶然の一致が多い）
      const isSentenceOpt = plain >= 12;
      const f3 = isSentenceOpt && o.size && stemQ.size ? cosine(stemQ, o, normOf(o)) : 0;
      // 問題文の語と選択肢の語が、資料の中で関係しているか
      const named = covered >= 0.5 ? optTerms : [];
      const f4 = named.length ? stemTerms.filter(s => named.some(t => t.idx !== s.idx && LINKS[s.idx].has(t.idx))).length : 0;
      it.score = RANK_WEIGHTS.optTerm * f1 + RANK_WEIGHTS.stemTerm * f2 + RANK_WEIGHTS.direct * f3 + RANK_WEIGHTS.link * f4;
    });
    // 「不適切」を選ぶ問題では、資料と最も合わない選択肢を上位にする
    const inverted = (types || []).includes('negative');
    const sorted = opts.slice().sort((a, b) => inverted ? a.score - b.score : b.score - a.score);
    const hi = Math.max(...opts.map(o => o.score));
    if (hi <= 0) return { ranked: false, reason: 'nomatch' };
    sorted.forEach((it, i) => { it.rank = i + 1; it.relative = it.score / hi; });
    return { ranked: true, inverted, topLabel: sorted[0].label };
  }

  /* ---------- 似た問題 ---------- */
  const KAKO_DOCS = KAKO.map(k => {
    const g = grams(k.q);
    k.opts.forEach(o => grams(o).forEach(x => g.add(x)));
    return { k, g, stemG: grams(k.q), norm: normOf(g) };
  });
  const KAKO_THRESHOLD = 0.2;
  const KAKO_MIN_SHARED = 4;
  function similarKako(text, n, exclude) {
    const q = grams(text);
    if (q.size < 4) return [];
    const out = [];
    KAKO_DOCS.forEach(d => {
      if (exclude && exclude(d.k)) return;
      // 少しの文字の重なりだけでは「似た問題」としない
      let shared = 0;
      q.forEach(x => { if (d.g.has(x)) shared++; });
      if (shared < KAKO_MIN_SHARED) return;
      const s = cosine(q, d.g, d.norm);
      if (s >= KAKO_THRESHOLD) out.push({ item: d.k, score: s });
    });
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, n || 3);
  }

  /* ---------- 問題文の分解 ---------- */
  const SEQ = {
    letter: 'ABCDEF', number: '123456', kata: 'アイウエオカ', hira: 'あいうえおか', circled: '①②③④⑤⑥'
  };
  const SYM = 'A-Fa-fＡ-Ｆａ-ｆ1-6１-６ア-カあ-か';
  const RE_PAREN = new RegExp(`^\\s*[(（\\[【〔]\\s*([${SYM}])\\s*[)）\\]】〕]\\s*(.*)$`);
  const RE_PLAIN = new RegExp(`^\\s*([${SYM}])\\s*(?:(?:[)）:：、,，]|[.．](?![0-9０-９]))\\s*(.*)|\\s+(.*)|$)$`);
  function markerOf(line) {
    // 「A）」「(あ)」「( あ )」「1.」「①」のような行頭の記号。本文は元の文字のまま残す
    const circled = line.match(/^\s*([①-⑥])\s*(.*)$/);
    if (circled) return { cls: 'circled', sym: circled[1], label: circled[1], rest: circled[2] };
    const paren = line.match(RE_PAREN);
    const plain = paren ? null : line.match(RE_PLAIN);
    const m = paren ? [paren[1], paren[2]] : plain ? [plain[1], plain[2] !== undefined ? plain[2] : (plain[3] || '')] : null;
    if (!m) return null;
    const n = m[0].normalize('NFKC');
    const sym = /[a-f]/.test(n) ? n.toUpperCase() : n;
    for (const cls of ['letter', 'number', 'kata', 'hira']) {
      if (SEQ[cls].includes(sym)) return { cls, sym, label: n, rest: m[1] };
    }
    return null;
  }
  // 1行に「A）… B）… C）… D）…」と並んでいる場合に行を分ける
  const INLINE = [
    { cls: 'letter', chars: 'A-DＡ-Ｄ' },
    { cls: 'kata', chars: 'アイウエ' },
    { cls: 'number', chars: '1-4１-４' }
  ];
  const PARTICLE = /^[はとやでのをがもにへ、,]/;
  function splitInline(line) {
    // 行頭に記号がある行は、同じ系統の記号でだけ分ける（「A) (ア) x (イ) y」の中を分けない）
    const head = markerOf(line);
    if (head && (head.cls === 'hira' || head.cls === 'circled')) return [line];
    const classes = head ? INLINE.filter(x => x.cls === head.cls) : INLINE;
    for (const { cls, chars } of classes) {
      const re = new RegExp(`[(（]?([${chars}])([)）]|[:：、]|[.．](?![0-9０-９]))`, 'g');
      const seq = SEQ[cls];
      const hits = [];
      let m;
      while ((m = re.exec(line))) {
        const sym = m[1].normalize('NFKC');
        const closes = /[)）]/.test(m[2]);
        const before = line[m.index - 1];
        const atStart = !line.slice(0, m.index).trim();
        const edge = atStart || /[\s。．]/.test(before || '');
        // 「（ア）は誤差を表し」のように助詞が続くものは、文中の記号なので選択肢にしない
        if (PARTICLE.test(line.slice(m.index + m[0].length).trimStart())) continue;
        if (!hits.length) {
          if (edge && (sym === seq[0] || atStart)) hits.push({ sym, at: m.index });
        } else if (sym === seq[seq.indexOf(hits[0].sym) + hits.length] && (edge || closes)) {
          hits.push({ sym, at: m.index });
        }
      }
      if (hits.length >= 2) {
        // 行の途中から始まる場合は、前の文が終わっていて3個以上そろうときだけ分ける
        const prior = line.slice(0, hits[0].at).trim();
        if (prior && !(hits.length >= 3 && /([。．？?]|選べ|選びなさい|選んでください)$/.test(prior))) continue;
        const out = [];
        if (hits[0].at > 0) out.push(line.slice(0, hits[0].at));
        const parts = hits.map((h, i) => line.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : line.length).trim());
        // 中身が空のものや選ぶ指示を含むものがあれば、選択肢の並びではなく文中の記号とみなす
        const invalid = parts.some(p => {
          const mk = markerOf(p);
          const body = mk ? mk.rest : p;
          return !body.replace(/[、,。\s]/g, '') || /(選べ|選びなさい|選んでください|選択せよ|選択してください|選択しなさい|どれか)[。.？?]?$/.test(p);
        });
        if (invalid) continue;
        return out.concat(parts);
      }
    }
    return [line];
  }
  // 同じ系統の記号について、連番になっている最後のまとまりを選ぶ。
  // 本文の先頭にある「A と B の違い」や問題番号「1.」は、連番から外れるので本文として扱われる
  function selectRuns(marks) {
    const runs = {}, cur = {};
    marks.forEach((m, i) => {
      if (!m) return;
      const seq = SEQ[m.cls], c = cur[m.cls];
      if (c && seq[c.length] === m.sym) c.push(i);
      else if (m.sym === seq[0]) {
        const r = [i];
        cur[m.cls] = r;
        (runs[m.cls] = runs[m.cls] || []).push(r);
      }
    });
    const picked = [];
    Object.keys(runs).forEach(cls => {
      const good = runs[cls].filter(r => r.length >= 2);
      if (good.length) picked.push(good[good.length - 1]);
    });
    // 別の系統のまとまりの途中にある連番（選択肢の中の手順など）は、選択肢にしない
    const chosen = new Set();
    picked.filter(r => !picked.some(o => o !== r && o[0] < r[0] && r[r.length - 1] < o[o.length - 1]))
      .forEach(r => r.forEach(i => chosen.add(i)));
    return chosen;
  }
  const INSTRUCTION = /選べ|選び|選ん|選択(せよ|して|しなさい)|どれ|答えよ|答えなさい/;
  const ANSWER_LINE = /^[【\[［＜<■□◆●▼〔(（\s]*(解答・解説|正解|正答|答え|解答|解説)(?:[】\]］＞>〕)）:：、]|は|\s|$)/;
  // 否定の語が「もの」「選択肢」などに直接かかっているときだけ、否定の問題とみなす
  const NEG_WORD = '不適切|不適当|適切でない|適切ではない|適切とはいえない|適切とは言えない|ふさわしくない|誤っている|誤りである|誤りがある|誤った|間違っている|間違った|正しくない|正しいとはいえない|当てはまらない|あてはまらない|該当しない|含まれない|用いられない|使われない|関係のない|関係ない|関係しない|でない|ではない';
  const NEGATIVE = new RegExp(
    `(${NEG_WORD})(な|の)?\\s*(もの|選択肢|記述|説明|組み合わせ|文|語句|用語)` + // 誤っているもの
    `|(${NEG_WORD})(な|の)?(のは|は)どれ` + // 誤っているのはどれか
    `|(${NEG_WORD})(な|の)?[一-龠ァ-ヺー]{1,6}(を([1１一]つ)?選|はどれ)` + // 不適切な手法を1つ選べ
    `|(誤り|間違い)(を|は)[^。\\n]{0,8}(選|どれ)`
  );
  const NEGATIVE_STRONG = /(誤っている|間違っている|正しくない)(もの|記述|説明|組み合わせ)/;
  function isNegative(scope) {
    // 「最も適切でない」「最も適切とはいえない」は肯定の問題として扱わない
    const asksBest = /最も(よく)?(適切(?!で|と|は)|当てはまる)/.test(scope) && !/最も不適/.test(scope);
    return asksBest ? NEGATIVE_STRONG.test(scope) : NEGATIVE.test(scope);
  }

  function parseQuestion(text) {
    const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    for (const l of rawLines) {
      const s = l.trim();
      if (!s) continue;
      if (ANSWER_LINE.test(s)) break; // 正解や解説より後は分析しない
      if (/出題された過去問題$/.test(s)) continue; // 出典の行
      splitInline(l).forEach(x => { if (x.trim()) lines.push(x); });
    }
    const marks = lines.map(markerOf);
    const chosen = selectRuns(marks);
    const stem = [];
    const items = [];
    lines.forEach((l, i) => {
      const m = marks[i];
      if (m && chosen.has(i)) {
        items.push({ label: m.label, cls: m.cls, text: m.rest || '' });
      } else if (items.length && !INSTRUCTION.test(l)) {
        const last = items[items.length - 1];
        last.text = last.text ? last.text + '\n' + l.trim() : l.trim();
      } else {
        stem.push(l.trim());
      }
    });
    const asksChoice = INSTRUCTION.test(stem.join('\n'));
    if (!items.length && stem.length >= 5 && asksChoice && stem.slice(-4).every(x => x.length <= 80)) {
      // 記号がない場合、選ぶ指示があり後ろの4行が短ければ、それを選択肢とみなす
      const opts = stem.splice(stem.length - 4, 4);
      opts.forEach((t, i) => items.push({ label: String(i + 1), cls: 'auto', text: t }));
    }
    const stemText = stem.join('\n');
    const base = stemText || lines.join('\n');
    // 「誤り」などの判定は、選ぶ指示の文に限る（「誤った情報を出力する現象」などを除くため）
    const sentences = base.split(/[。\n]/);
    const instr = sentences.filter(x => INSTRUCTION.test(x));
    const scope = instr.length ? instr.join('\n') : base;
    const types = [];
    if (isNegative(scope)) types.push('negative');
    if (/組み?合わ?せ(として|を([1１一]つ)?選|はどれ|を答)/.test(scope)) types.push('combo');
    if (/空欄|(^|[^A-Za-z0-9_])[(（]\s*[)）]|[(（][\s　]+[ァ-ヶあ-んA-Za-z]?[\s　]*[)）]|[(（][アあ][)）]|【[\s　]*】|\[[\s　]*\]|＿{2,}|_{3,}/.test(base)) types.push('blank');
    const calcBase = base.replace(/[1１一]つ(選|の)/g, '');
    if (/[0-9０-９]/.test(calcBase) && (/計算し|計算せよ|計算する|計算した|求めよ|求めなさい|求める|何回|何%|何％|いくつか?(?:[。？?]|$|になる|である)|いくらか?(?:[。？?]|$)|期待値|[A-Za-z]+\s*[=＝]\s*[0-9０-９]/m.test(calcBase))) types.push('calc');
    return { stem: stemText, items, types };
  }

  /* ---------- 問題文から関連資料を探す ---------- */
  function namesIn(text, termList) {
    const hits = [];
    const f = fold(text);
    termList.forEach(t => {
      const hit = t.names.some(n => {
        if (n.l.length < 2 || n.l === 'ai') return false; // 「AI」は一般語なので関連資料の根拠にしない
        const isAscii = /^[0-9a-z]+$/.test(n.l);
        let p = 0;
        while ((p = f.t.indexOf(n.l, p)) >= 0) {
          if (!isAscii) return true;
          const before = text[f.a[p] - 1], after = text[f.b[p + n.l.length - 1]];
          if (!isAlnum(before) && !isAlnum(after)) return true;
          p++;
        }
        return false;
      });
      if (hit) hits.push(t);
    });
    return hits;
  }

  const CALC_KEYS = FORMULAS.map(f => ({ f, key: loose(f.name.split(/[\s（(]/)[0]) }));
  // 語の境界を確かめて探す（GPUとTPU の中の TP などを除く）
  function hasWord(text, key) {
    const f = fold(text);
    const isAscii = /^[0-9a-z]+$/.test(key);
    let p = 0;
    while ((p = f.t.indexOf(key, p)) >= 0) {
      if (!isAscii) return true;
      if (!isAlnum(text[f.a[p] - 1]) && !isAlnum(text[f.b[p + key.length - 1]])) return true;
      p++;
    }
    return false;
  }

  // residual: 抽出済みの用語を取り除いた文章（「分散表現」の中の「分散」で公式を出さないため）
  function relatedFor(termList, residual, types) {
    const uniq = [];
    const seen = new Set();
    termList.forEach(t => { if (!seen.has(t.idx)) { seen.add(t.idx); uniq.push(t); } });
    const confs = [];
    CONFUSIONS.forEach(c => {
      const topic = namesIn(c.topic, uniq);
      const diff = namesIn(c.diff, uniq);
      const strong = topic.length, total = new Set(topic.concat(diff)).size;
      if (strong || total >= 2) confs.push({ item: c, score: strong * 3 + total, terms: [...new Set(topic.concat(diff))] });
    });
    confs.sort((x, y) => y.score - x.score);
    const tables = [];
    TABLES.forEach(t => {
      const firsts = namesIn(t.rows.map(r => r[0]).join('\n') + '\n' + t.name, uniq);
      const others = namesIn(t.rows.map(r => r.slice(1).join('\n')).join('\n'), uniq);
      const total = new Set(firsts.concat(others)).size;
      if (firsts.length || total >= 2) tables.push({ item: t, score: firsts.length * 3 + total, terms: [...new Set(firsts.concat(others))] });
    });
    tables.sort((x, y) => y.score - x.score);
    const forms = [];
    CALC_KEYS.forEach(({ f, key }) => {
      const direct = key.length >= 2 && hasWord(residual, key);
      const viaTerm = namesIn(f.name, uniq).length > 0;
      if (direct || viaTerm) forms.push({ item: f, score: (direct ? 2 : 0) + (viaTerm ? 1 : 0) });
    });
    forms.sort((x, y) => y.score - x.score);
    const isCalc = (types || []).includes('calc');
    const news = [];
    NEWS.forEach(n => {
      const topic = namesIn(n.topic + '\n' + newsKeywords(n), uniq);
      const body = namesIn(n.result, uniq);
      if (topic.length || body.length >= 2) news.push({ item: n, score: topic.length * 3 + body.length });
    });
    news.sort((x, y) => y.score - x.score);
    return { confs: confs.slice(0, 6), tables: tables.slice(0, 4), forms: isCalc ? forms : forms.slice(0, 6), news: news.slice(0, 3) };
  }

  function analyzeQuestion(text, options) {
    const q = parseQuestion(text);
    const stemEx = extractTerms(q.stem);
    const known = new Set(stemEx.terms.map(x => x.t.idx));
    const all = stemEx.terms.map(x => x.t);
    const items = q.items.map(it => {
      const ex = extractTerms(it.text);
      ex.terms.forEach(x => { known.add(x.t.idx); all.push(x.t); });
      return Object.assign({}, it, { ex });
    });
    items.forEach(it => {
      // 説明文の選択肢には、解説が近い用語を添える（文中に短い語が含まれていても探す）
      // 用語が2語以上見つかった選択肢（組み合わせ問題など）では推定しない
      const isStatement = it.cls === 'hira';
      const isSentence = isStatement || (it.text.replace(/\s/g, '').length >= 12 && it.ex.terms.length < 2);
      const found = new Set(it.ex.terms.map(x => x.t.idx));
      it.similar = (isSentence || !it.ex.terms.length) ? similarTerms(it.text, isStatement ? 5 : 3, found) : [];
    });
    const stemSimilar = similarTerms(q.stem, 5, known);
    // 関連資料の根拠は、文中に実際に出てきた用語だけにする（推定した語は使わない）
    const blank = (s, ranges) => {
      let out = '', p = 0;
      ranges.forEach(([a, b]) => { out += s.slice(p, a) + ' '; p = b; });
      return out + s.slice(p);
    };
    const residual = [blank(q.stem, stemEx.ranges)].concat(items.map(it => blank(it.text, it.ex.ranges))).join('\n');
    const related = relatedFor(all, residual, q.types);
    const ranking = rankOptions(q.stem, items, q.types);
    const similarQs = similarKako(q.stem + '\n' + items.map(it => it.text).join('\n'), 3, options && options.excludeKako);
    return { stem: q.stem, stemEx, items, types: q.types, stemSimilar, related, ranking, similarQs };
  }

  root.GS = { fold, loose, rangesOf, TERMS, KAKO, search, extractTerms, similarTerms, similarKako, parseQuestion, analyzeQuestion, fuzzyDistance, variants };
})(typeof window !== 'undefined' ? window : this);

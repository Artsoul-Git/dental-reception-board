/* 受付予約ボード — 分析タブの描画
 *
 * 集計はすべてこのファイルの中で完結させる（他ファイルの集計関数には依存しない）。
 * 描画先の要素が無いブロックは黙って飛ばすので、index.html 側は必要な枠だけ置けばよい。
 * 文字はすべて textContent で入れる。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var el = DRB.views.el;
  var clear = DRB.views.clear;
  var A = {};
  DRB.analytics = A;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var GREY = '#6E757C';        // 担当・ご用件が決まっていない分の色
  var DONUT_R = 70;
  var DONUT_C = 2 * Math.PI * DONUT_R;

  function $(id) { return document.getElementById(id); }

  /* ================= 専用スタイル ================= */

  /* style.css とは別管理にしたいので、初回の描画時に一度だけ差し込む。
     クラス名は an- 接頭辞で既存と衝突させない。 */
  var STYLE_ID = 'an-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.an-panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);',
      'padding:12px 14px;box-shadow:var(--shadow);}',
      '.an-rows{display:grid;gap:2px;}',
      '.an-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;',
      'padding:5px 0;border-bottom:1px solid var(--line-soft);}',
      '.an-row:last-child{border-bottom:0;}',
      '.an-row--closed{color:var(--ink-mute);}',
      '.an-row__label{flex:0 0 8.5em;font-weight:700;}',
      '.an-row__n{flex:0 0 4.5em;text-align:right;}',
      '.an-row__rate{flex:0 0 4.5em;text-align:right;color:var(--ink-mute);}',
      '.an-row__bar{flex:1 1 140px;min-width:100px;}',
      '.an-stack{display:flex;height:12px;border-radius:4px;overflow:hidden;background:var(--line-soft);}',
      '.an-seg{display:block;height:100%;}',
      '.an-deltas{flex:0 0 auto;display:flex;gap:6px;flex-wrap:wrap;}',
      '.an-delta{font-size:11.5px;border-radius:999px;padding:0 8px;background:#efeae1;',
      'color:var(--ink-mute);white-space:nowrap;}',
      '.an-delta--up{background:var(--accent-tint);color:var(--accent-deep);}',
      '.an-delta--down{background:#fbf0ee;color:var(--danger);}',
      '.an-total{display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;margin-top:10px;',
      'padding-top:10px;border-top:1px solid var(--line);font-size:13.5px;}',
      '.an-total b{font-size:19px;}',
      '.an-chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--ink-mute);}',
      '.an-chips li{display:flex;align-items:center;gap:5px;}',
      '.an-chips i{width:11px;height:11px;border-radius:3px;display:inline-block;}',
      '.an-pie{display:flex;gap:18px;flex-wrap:wrap;align-items:center;}',
      '.an-pie__fig{flex:0 0 auto;width:min(190px,50vw);max-width:190px;}',
      '.an-pie__fig svg{width:100%;height:auto;display:block;}',
      '.an-pie__num{font-size:30px;font-weight:700;fill:var(--ink);}',
      '.an-pie__unit{font-size:12px;fill:var(--ink-mute);}',
      '.an-pie__bg{fill:none;stroke:var(--line-soft);}',
      '.an-legend{flex:1 1 230px;min-width:0;display:grid;gap:4px;font-size:13px;}',
      '.an-legend__i{display:grid;grid-template-columns:12px 1fr auto auto auto;gap:8px;align-items:center;}',
      '.an-legend__sw{width:12px;height:12px;border-radius:3px;display:inline-block;}',
      '.an-legend__name{overflow-wrap:anywhere;}',
      '.an-legend__n{text-align:right;color:var(--ink-mute);white-space:nowrap;}',
      '.an-grade{font-size:11px;border-radius:999px;padding:0 7px;background:#efeae1;color:var(--ink-mute);}',
      '.an-grade--A{background:var(--accent-tint);color:var(--accent-deep);font-weight:700;}',
      '.an-grade--C{background:var(--hold-tint);color:#7a5318;}',
      '.an-advice{margin-top:12px;padding-top:10px;border-top:1px solid var(--line-soft);',
      'display:grid;gap:5px;font-size:13px;}',
      '.an-advice li{padding-left:1.1em;text-indent:-1.1em;}',
      '.an-advice li::before{content:"・";color:var(--accent);}',
      '.an-note{font-size:12px;color:var(--ink-mute);margin-top:8px;}',
      '.an-bars .bars__i{grid-template-columns:8em 1fr 3.6em;}',
      '.an-scroll{overflow-x:auto;}',
      '.an-issues{display:grid;gap:16px;}',
      '.an-issues__h{font-size:15px;font-weight:700;color:var(--accent-deep);margin-bottom:6px;}',
      '.an-issues ol{margin:0;padding-left:1.4em;display:grid;gap:5px;font-size:13.5px;}',
      '@media (max-width:720px){',
      '.an-row__label{flex:0 0 6.5em;}',
      '.an-row__rate{display:none;}',
      '.an-legend__i{grid-template-columns:12px 1fr auto auto;}',
      '.an-bars .bars__i{grid-template-columns:6.5em 1fr 3.6em;}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ================= 小さな道具 ================= */

  function isKey(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

  /** 実際にご来院いただいたとみなす状態 */
  function isVisit(b) { return b.status === 'done' || b.status === 'checkout'; }

  /** 月加算。月末を越える日付は、その月の末日に丸める。 */
  function addMonths(key, months) {
    var d = M.fromKey(key);
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return M.toKey(d);
  }

  /** 昇順の配列から、key より後（strict）／key 以上（!strict）の最初の位置を返す */
  function bisect(arr, key, strict) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      var go = strict ? (arr[mid] <= key) : (arr[mid] < key);
      if (go) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function weekdayOf(key) { return WD[M.fromKey(key).getDay()]; }

  function deltaBadge(n, caption) {
    var text = n > 0 ? '+' + n : (n < 0 ? String(n) : '±0');
    var cls = 'an-delta' + (n > 0 ? ' an-delta--up' : (n < 0 ? ' an-delta--down' : ''));
    return el('span', cls, caption + ' ' + text);
  }

  function emptyIn(host, text) {
    clear(host);
    host.appendChild(el('p', 'empty', text));
  }

  function setCaption(id, text) {
    var node = $(id);
    if (node) node.textContent = text;
  }

  /* ================= 索引づくり ================= */

  /**
   * 2万件規模でも耐えるよう、走査は一度だけにして索引を使い回す。
   * byDate は日別の稼働率計算に、visits は再来院・DM後来院の判定に使う。
   */
  function buildIndex(ctx) {
    var today = M.todayKey();
    var ix = {
      today: today,
      byDate: {},
      visits: {},          // 患者ID → ご来院日（昇順・重複あり）
      hasFuture: {},       // 患者ID → この先のご予約があるか
      patients: {},
      period: [],          // 集計期間内の予約
      statCache: {},
      rangeOk: false,
      from: '',
      to: ''
    };

    if (isKey(ctx.from) && isKey(ctx.to) && ctx.from <= ctx.to) {
      ix.rangeOk = true;
      ix.from = ctx.from;
      ix.to = ctx.to;
    }

    (ctx.patients || []).forEach(function (p) { ix.patients[p.id] = p; });

    (ctx.bookings || []).forEach(function (b) {
      if (!b || !isKey(b.date)) return;
      (ix.byDate[b.date] || (ix.byDate[b.date] = [])).push(b);
      if (b.patientId) {
        if (isVisit(b)) (ix.visits[b.patientId] || (ix.visits[b.patientId] = [])).push(b.date);
        if (M.isActive(b) && b.date >= today) ix.hasFuture[b.patientId] = true;
      }
      if (ix.rangeOk && b.date >= ix.from && b.date <= ix.to) ix.period.push(b);
    });

    Object.keys(ix.visits).forEach(function (pid) { ix.visits[pid].sort(); });
    return ix;
  }

  /** その日の集計。休診日は null を返す。日別に索引した予約だけ渡すので走査量が増えない。 */
  function dayStat(ctx, ix, key) {
    if (ix.statCache[key] !== undefined) return ix.statCache[key];
    var cfg = ctx.cfg;
    var out = null;
    if (cfg && cfg.hours && cfg.units && cfg.closedDates && !M.isClosed(cfg, key)) {
      out = M.summarize(cfg, key, ix.byDate[key] || []);
    }
    ix.statCache[key] = out;
    return out;
  }

  /** その日の有効なご予約を、ご用件ごとに数える */
  function purposeCountOn(ix, key) {
    var out = {};
    (ix.byDate[key] || []).forEach(function (b) {
      if (!M.isActive(b)) return;
      out[b.purpose || ''] = (out[b.purpose || ''] || 0) + 1;
    });
    return out;
  }

  function activeCountOn(ix, key) {
    var n = 0;
    (ix.byDate[key] || []).forEach(function (b) { if (M.isActive(b)) n++; });
    return n;
  }

  /* ================= 円グラフ（ドーナツ） ================= */

  function svgEl(tag) { return document.createElementNS(SVG_NS, tag); }

  /**
   * rows = [{label, color, n}]。stroke-dasharray でリングを塗り分ける。
   * 外部ライブラリを使わずに済み、拡大縮小にも強い。
   */
  function donut(rows, total, unit) {
    var svg = svgEl('svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('role', 'img');

    var desc = rows.filter(function (r) { return r.n > 0; }).map(function (r) {
      return r.label + ' ' + r.n + unit + '（' + pct(r.n, total) + '%）';
    }).join('、');
    svg.setAttribute('aria-label', '合計 ' + total + unit + '。' + (desc || '内訳なし'));

    var bg = svgEl('circle');
    bg.setAttribute('class', 'an-pie__bg');
    bg.setAttribute('cx', '100');
    bg.setAttribute('cy', '100');
    bg.setAttribute('r', String(DONUT_R));
    bg.setAttribute('stroke-width', '34');
    svg.appendChild(bg);

    var acc = 0;
    rows.forEach(function (r) {
      if (!(r.n > 0) || !(total > 0)) return;
      var len = DONUT_C * (r.n / total);
      var arc = svgEl('circle');
      arc.setAttribute('cx', '100');
      arc.setAttribute('cy', '100');
      arc.setAttribute('r', String(DONUT_R));
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke', r.color || GREY);
      arc.setAttribute('stroke-width', '34');
      arc.setAttribute('stroke-dasharray', len + ' ' + (DONUT_C - len));
      arc.setAttribute('stroke-dashoffset', String(-acc));
      arc.setAttribute('transform', 'rotate(-90 100 100)');
      var t = svgEl('title');
      t.textContent = r.label + ' ' + r.n + unit + '（' + pct(r.n, total) + '%）';
      arc.appendChild(t);
      svg.appendChild(arc);
      acc += len;
    });

    var num = svgEl('text');
    num.setAttribute('class', 'an-pie__num');
    num.setAttribute('x', '100');
    num.setAttribute('y', '99');
    num.setAttribute('text-anchor', 'middle');
    num.textContent = String(total);
    svg.appendChild(num);

    var cap = svgEl('text');
    cap.setAttribute('class', 'an-pie__unit');
    cap.setAttribute('x', '100');
    cap.setAttribute('y', '120');
    cap.setAttribute('text-anchor', 'middle');
    cap.textContent = '合計' + unit;
    svg.appendChild(cap);

    var fig = el('div', 'an-pie__fig');
    fig.appendChild(svg);
    return fig;
  }

  /** 円グラフと凡例を横並びにする。extra は凡例1行あたりの追加表示（貢献度など）。 */
  function pieBlock(rows, total, unit, extraOf) {
    var box = el('div', 'an-pie');
    box.appendChild(donut(rows, total, unit));

    var legend = el('ul', 'an-legend');
    rows.forEach(function (r) {
      var li = el('li', 'an-legend__i');
      var sw = el('i', 'an-legend__sw');
      sw.style.background = r.color || GREY;
      li.appendChild(sw);
      li.appendChild(el('span', 'an-legend__name', r.label));
      li.appendChild(el('span', 'an-legend__n', r.n + unit));
      li.appendChild(el('span', 'an-legend__n', pct(r.n, total) + '%'));
      var extra = extraOf ? extraOf(r) : null;
      li.appendChild(extra || el('span'));
      legend.appendChild(li);
    });
    box.appendChild(legend);
    return box;
  }

  /* ================= 横棒リスト ================= */

  /** rows = [{label, color, n, text}]。text があれば数値の代わりに文字を出す。 */
  function barsList(rows, max) {
    var ul = el('ul', 'bars an-bars');
    var top = max || rows.reduce(function (a, r) { return Math.max(a, Number(r.n) || 0); }, 0);
    rows.forEach(function (r) {
      var li = el('li', 'bars__i');
      li.appendChild(el('span', 'bars__label', r.label));
      if (r.n === null || r.n === undefined) {
        li.appendChild(el('span', 'an-note', r.text || '—'));
        li.appendChild(el('span'));
      } else {
        var track = el('span', 'bars__track');
        var fill = el('i');
        fill.style.width = (top > 0 ? Math.round((r.n / top) * 100) : 0) + '%';
        fill.style.background = r.color || 'var(--accent)';
        track.appendChild(fill);
        li.appendChild(track);
        li.appendChild(el('span', 'bars__n', r.text !== undefined ? r.text : String(r.n)));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  /** 見出し配列と行配列から表を作る */
  function table(heads, rows) {
    var t = el('table', 'grid');
    var thead = el('thead');
    var hr = el('tr');
    heads.forEach(function (h) {
      var th = el('th', null, h);
      th.scope = 'col';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (v) { tr.appendChild(el('td', null, String(v))); });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);

    var wrap = el('div', 'an-scroll');
    wrap.appendChild(t);
    return wrap;
  }

  /* ================= 収益貢献度 ================= */

  /**
   * ご用件ごとの A/B/C を決める。
   * perHour のときは「概算利益 ÷ 所要時間」で高い順に三等分する。
   * 利益が未設定（0）のご用件は院長が選んだ grade をそのまま使う。
   */
  function gradeMap(cfg) {
    var out = {};
    var purposes = (cfg && cfg.purposes) || [];
    purposes.forEach(function (p) {
      out[p.key] = (p.grade === 'A' || p.grade === 'C') ? p.grade : 'B';
    });

    var mode = cfg && cfg.contribution && cfg.contribution.mode;
    if (mode !== 'perHour') return out;

    var slotMinutes = Number(cfg.slotMinutes) || 30;
    var scored = purposes.filter(function (p) {
      return Number(p.profit) > 0;
    }).map(function (p) {
      var minutes = Math.max(1, (Number(p.span) || 1) * slotMinutes);
      return { key: p.key, perHour: (Number(p.profit) / minutes) * 60 };
    }).sort(function (a, b) { return b.perHour - a.perHour; });

    if (!scored.length) return out;
    var third = scored.length / 3;
    scored.forEach(function (s, i) {
      out[s.key] = i < third ? 'A' : (i < third * 2 ? 'B' : 'C');
    });
    return out;
  }

  /* ================= KPI ================= */

  function renderStats(ctx, ix) {
    var host = $('repStats');
    if (!host) return;
    clear(host);

    var total = ix.period.length;
    var canceled = 0, noshow = 0, visited = 0;
    ix.period.forEach(function (b) {
      if (b.status === 'canceled') canceled++;
      else if (b.status === 'noshow') noshow++;
      if (isVisit(b)) visited++;
    });

    var rateSum = 0, openDays = 0;
    if (ix.rangeOk) {
      var key = ix.from;
      var guard = 0;
      while (key <= ix.to && guard++ < 800) {
        var s = dayStat(ctx, ix, key);
        if (s) { rateSum += s.rate; openDays++; }
        key = M.shiftDays(key, 1);
      }
    }

    var newPatients = 0;
    if (ix.rangeOk) {
      (ctx.patients || []).forEach(function (p) {
        if (p.firstVisit && p.firstVisit >= ix.from && p.firstVisit <= ix.to) newPatients++;
      });
    }

    [
      ['平均稼働率', openDays ? Math.round(rateSum / openDays) : 0, '%'],
      ['ご予約の総数', total, '件'],
      ['ご来院', visited, '件'],
      ['キャンセル率', pct(canceled, total), '%'],
      ['無断キャンセル率', pct(noshow, total), '%'],
      ['新しい患者さん', newPatients, '名'],
      ['診療日数', openDays, '日']
    ].forEach(function (row) {
      var li = el('li');
      li.appendChild(el('b', null, row[0]));
      var v = el('span', null, String(row[1]));
      v.appendChild(el('small', null, row[2]));
      li.appendChild(v);
      host.appendChild(li);
    });
  }

  /* ================= 日ごとの稼働率（直近30日で固定） ================= */

  function renderChart(ctx, ix) {
    var host = $('repChart');
    if (!host) return;
    clear(host);

    var days = [];
    for (var i = 29; i >= 0; i--) {
      var key = M.shiftDays(ix.today, -i);
      var s = dayStat(ctx, ix, key);
      if (s) days.push({ date: key, rate: s.rate, booked: s.booked });
    }

    if (!days.length) {
      host.appendChild(el('p', 'empty', '直近30日に診療日がありません。'));
      return;
    }

    var track = el('div', 'chart__track');
    days.forEach(function (d) {
      var col = el('div', 'chart__col');
      var bar = el('i', 'chart__bar');
      bar.style.height = Math.max(2, d.rate) + '%';
      if (d.rate >= 85) bar.classList.add('is-high');
      col.appendChild(bar);
      col.title = M.formatDateLong(d.date) + '　稼働率 ' + d.rate + '%（' + d.booked + '件）';
      col.setAttribute('aria-label', col.title);
      track.appendChild(col);
    });
    host.appendChild(track);

    var axis = el('div', 'chart__axis');
    axis.appendChild(el('span', null, M.formatDateLong(days[0].date)));
    axis.appendChild(el('span', null, M.formatDateLong(days[days.length - 1].date)));
    host.appendChild(axis);
  }

  /* ================= ご用件の色見本（週間・月間の凡例） ================= */

  function purposeLegend(cfg) {
    var ul = el('ul', 'an-chips');
    ((cfg && cfg.purposes) || []).forEach(function (p) {
      var li = el('li');
      var sw = el('i');
      sw.style.background = p.color || GREY;
      li.appendChild(sw);
      li.appendChild(el('span', null, p.label));
      ul.appendChild(li);
    });
    return ul;
  }

  /** ご用件別の件数から積み上げ横棒を作る */
  function stackBar(cfg, counts, total) {
    var bar = el('span', 'an-stack');
    if (!(total > 0)) return bar;
    var list = ((cfg && cfg.purposes) || []).map(function (p) {
      return { label: p.label, color: p.color || GREY, n: counts[p.key] || 0 };
    });
    var known = list.reduce(function (a, r) { return a + r.n; }, 0);
    if (total > known) list.push({ label: 'ご用件未設定', color: GREY, n: total - known });

    list.forEach(function (r) {
      if (!(r.n > 0)) return;
      var seg = el('i', 'an-seg');
      seg.style.width = (r.n / total) * 100 + '%';
      seg.style.background = r.color;
      seg.title = r.label + ' ' + r.n + '件';
      bar.appendChild(seg);
    });
    return bar;
  }

  /* ================= 週間分析 ================= */

  function renderWeek(ctx, ix) {
    var host = $('repWeek');
    if (!host) return;
    clear(host);

    var start = isKey(ctx.weekStartKey) ? ctx.weekStartKey : ix.today;
    var end = M.shiftDays(start, 6);
    setCaption('repWeekCaption', M.formatDateFull(start) + ' 〜 ' + M.formatDateLong(end));

    var cmp = ctx.compare || {};
    var panel = el('div', 'an-panel');
    var rows = el('div', 'an-rows');

    var total = 0, filled = 0, capacity = 0, openDays = 0;

    for (var i = 0; i < 7; i++) {
      var key = M.shiftDays(start, i);
      var s = dayStat(ctx, ix, key);
      var row = el('div', 'an-row' + (s ? '' : ' an-row--closed'));
      row.appendChild(el('span', 'an-row__label',
        (M.fromKey(key).getMonth() + 1) + '/' + M.fromKey(key).getDate() + '（' + weekdayOf(key) + '）'));

      if (!s) {
        row.appendChild(el('span', 'an-row__n', '休診'));
        rows.appendChild(row);
        continue;
      }

      total += s.booked;
      filled += s.filled;
      capacity += s.capacity;
      openDays++;

      row.appendChild(el('span', 'an-row__n', s.booked + '件'));
      row.appendChild(el('span', 'an-row__rate', s.rate + '%'));
      var barWrap = el('span', 'an-row__bar');
      barWrap.appendChild(stackBar(ctx.cfg, purposeCountOn(ix, key), s.booked));
      row.appendChild(barWrap);

      if (cmp.prevMonth || cmp.prevYear) {
        var badges = el('span', 'an-deltas');
        if (cmp.prevMonth) badges.appendChild(deltaBadge(s.booked - activeCountOn(ix, M.shiftDays(key, -28)), '4週前'));
        if (cmp.prevYear) badges.appendChild(deltaBadge(s.booked - activeCountOn(ix, M.shiftDays(key, -364)), '前年'));
        row.appendChild(badges);
      }
      rows.appendChild(row);
    }

    panel.appendChild(rows);

    if (!openDays) {
      panel.appendChild(el('p', 'an-note', 'この週は診療日がありません。'));
    } else {
      var sum = el('div', 'an-total');
      var b1 = el('span', null, 'この週の合計 ');
      b1.appendChild(el('b', null, String(total)));
      b1.appendChild(el('span', null, ' 件'));
      sum.appendChild(b1);
      sum.appendChild(el('span', null, '稼働率 ' + pct(filled, capacity) + '%'));
      sum.appendChild(el('span', null, '診療日 ' + openDays + '日'));
      panel.appendChild(sum);
      panel.appendChild(purposeLegend(ctx.cfg));
    }

    host.appendChild(panel);
  }

  /* ================= 月間分析 ================= */

  /** 年月を渡すと、その月の合計と週ごとの内訳を返す */
  function monthReport(ctx, ix, year, month) {
    var last = new Date(year, month + 1, 0).getDate();
    var offset = new Date(year, month, 1).getDay(); // 第1週の空白日数（日曜始まり）
    var weeks = [];
    var total = 0, filled = 0, capacity = 0, openDays = 0;

    for (var day = 1; day <= last; day++) {
      var key = M.toKey(new Date(year, month, day));
      var wi = Math.floor((day - 1 + offset) / 7);
      var w = weeks[wi] || (weeks[wi] = {
        index: wi, total: 0, filled: 0, capacity: 0, openDays: 0,
        purposes: {}, fromDay: day, toDay: day
      });
      w.toDay = day;

      var s = dayStat(ctx, ix, key);
      if (!s) continue;
      w.total += s.booked;
      w.filled += s.filled;
      w.capacity += s.capacity;
      w.openDays++;
      total += s.booked;
      filled += s.filled;
      capacity += s.capacity;
      openDays++;

      var counts = purposeCountOn(ix, key);
      Object.keys(counts).forEach(function (k) {
        w.purposes[k] = (w.purposes[k] || 0) + counts[k];
      });
    }

    return {
      year: year, month: month, weeks: weeks,
      total: total, filled: filled, capacity: capacity, openDays: openDays
    };
  }

  function renderMonth(ctx, ix) {
    var host = $('repMonth');
    if (!host) return;
    clear(host);

    var base = isKey(ctx.monthKey) ? ctx.monthKey : ix.today;
    var d = M.fromKey(base);
    var year = d.getFullYear();
    var month = d.getMonth();
    setCaption('repMonthCaption', year + '年' + (month + 1) + '月');

    var rep = monthReport(ctx, ix, year, month);
    var cmp = ctx.compare || {};
    var panel = el('div', 'an-panel');
    var rows = el('div', 'an-rows');

    rep.weeks.forEach(function (w) {
      var row = el('div', 'an-row' + (w.openDays ? '' : ' an-row--closed'));
      row.appendChild(el('span', 'an-row__label',
        '第' + (w.index + 1) + '週（' + (month + 1) + '/' + w.fromDay + '〜' + w.toDay + '）'));

      if (!w.openDays) {
        row.appendChild(el('span', 'an-row__n', '休診'));
        rows.appendChild(row);
        return;
      }

      row.appendChild(el('span', 'an-row__n', w.total + '件'));
      row.appendChild(el('span', 'an-row__rate', pct(w.filled, w.capacity) + '%'));
      var barWrap = el('span', 'an-row__bar');
      barWrap.appendChild(stackBar(ctx.cfg, w.purposes, w.total));
      row.appendChild(barWrap);
      rows.appendChild(row);
    });

    if (!rep.weeks.length) rows.appendChild(el('p', 'an-note', 'この月の記録がありません。'));
    panel.appendChild(rows);

    var sum = el('div', 'an-total');
    var head = el('span', null, 'この月の合計 ');
    head.appendChild(el('b', null, String(rep.total)));
    head.appendChild(el('span', null, ' 件'));
    sum.appendChild(head);
    sum.appendChild(el('span', null, '稼働率 ' + pct(rep.filled, rep.capacity) + '%'));
    sum.appendChild(el('span', null, '診療日 ' + rep.openDays + '日'));

    if (cmp.prevMonth) {
      var pm = month === 0 ? monthReport(ctx, ix, year - 1, 11) : monthReport(ctx, ix, year, month - 1);
      sum.appendChild(deltaBadge(rep.total - pm.total, '前月（' + pm.total + '件）'));
    }
    if (cmp.prevYear) {
      var py = monthReport(ctx, ix, year - 1, month);
      sum.appendChild(deltaBadge(rep.total - py.total, '前年同月（' + py.total + '件）'));
    }
    panel.appendChild(sum);
    if (rep.openDays) panel.appendChild(purposeLegend(ctx.cfg));

    host.appendChild(panel);
  }

  /* ================= ご用件の内訳とアドバイス ================= */

  function renderPurpose(ctx, ix) {
    var host = $('repPurpose');
    if (!host) return;
    clear(host);

    var counts = {};
    var total = 0;
    ix.period.forEach(function (b) {
      if (!M.isActive(b)) return;
      counts[b.purpose || ''] = (counts[b.purpose || ''] || 0) + 1;
      total++;
    });

    if (!total) {
      host.appendChild(el('p', 'empty', 'この期間のご予約がまだ記録されていません。'));
      return;
    }

    var grades = gradeMap(ctx.cfg);
    var purposes = (ctx.cfg && ctx.cfg.purposes) || [];
    var rows = purposes.map(function (p) {
      return { key: p.key, label: p.label, color: p.color || GREY, n: counts[p.key] || 0 };
    }).filter(function (r) { return r.n > 0; });

    var known = rows.reduce(function (a, r) { return a + r.n; }, 0);
    if (total > known) rows.push({ key: '', label: 'ご用件未設定', color: GREY, n: total - known });
    rows.sort(function (a, b) { return b.n - a.n; });

    var panel = el('div', 'an-panel');
    panel.appendChild(pieBlock(rows, total, '件', function (r) {
      var g = grades[r.key];
      if (!g) return null;
      return el('span', 'an-grade an-grade--' + g, g);
    }));

    /* --- 伸ばすべきご用件 --- */
    var advice = el('ul', 'an-advice');
    var lines = [];
    var aShare = 0;

    rows.forEach(function (r) {
      var g = grades[r.key];
      if (!g) return;
      var share = pct(r.n, total);
      if (g === 'A') aShare += share;
      if (g === 'A' && share < 15) {
        lines.push('「' + r.label + '」は収益への貢献が高い一方で、構成比が ' + share +
          '% にとどまっています。ご案内の機会を増やす余地があります。');
      }
      if (g === 'C' && share >= 30) {
        lines.push('「' + r.label + '」が構成比 ' + share +
          '% を占めています。時間の使い方を見直す余地があります。');
      }
    });

    if (aShare < 30) {
      lines.push('収益への貢献が高いご用件の合計が ' + aShare +
        '% です。全体として比率が低めですので、枠の配分を見直されてはいかがでしょうか。');
    }
    if (!lines.length) lines.push('いまの構成に大きな偏りはありません。');

    lines.slice(0, 4).forEach(function (t) { advice.appendChild(el('li', null, t)); });
    panel.appendChild(advice);

    host.appendChild(panel);
  }

  /* ================= 担当ごとの件数 ================= */

  function renderStaff(ctx, ix) {
    var host = $('repStaff');
    if (!host) return;
    clear(host);

    var counts = {};
    var none = 0;
    var total = 0;
    ix.period.forEach(function (b) {
      if (!M.isActive(b)) return;
      total++;
      if (b.staffId) counts[b.staffId] = (counts[b.staffId] || 0) + 1;
      else none++;
    });

    if (!total) {
      host.appendChild(el('p', 'empty', 'この期間のご予約がまだ記録されていません。'));
      return;
    }

    var rows = ((ctx.cfg && ctx.cfg.staff) || []).map(function (s) {
      return { label: s.name, color: s.color || GREY, n: counts[s.id] || 0 };
    }).filter(function (r) { return r.n > 0; });
    rows.sort(function (a, b) { return b.n - a.n; });
    if (none > 0) rows.push({ label: '担当を決めていない', color: GREY, n: none });

    var panel = el('div', 'an-panel');
    panel.appendChild(pieBlock(rows, total, '件'));
    host.appendChild(panel);
  }

  /* ================= DM後のご来院率（媒体別） ================= */

  var DM_WINDOW_DAYS = 30;
  var CHANNEL_LABEL = { mail: 'メール', line: 'LINE', postcard: 'ハガキ' };

  function renderDmVisit(ctx, ix) {
    var host = $('repDmVisit');
    if (!host) return;
    clear(host);

    var stats = { mail: { sent: 0, hit: 0 }, line: { sent: 0, hit: 0 }, postcard: { sent: 0, hit: 0 } };
    var counted = 0;

    (ctx.messages || []).forEach(function (m) {
      if (!m) return;
      if (m.kind !== 'recall' && m.kind !== 'dm') return;
      if (m.state !== 'sent' && m.state !== 'simulated') return;
      var day = String(m.at || '').slice(0, 10);
      if (!isKey(day)) return;
      if (!ix.rangeOk || day < ix.from || day > ix.to) return;
      var box = stats[m.channel];
      if (!box) return;

      box.sent++;
      counted++;

      // その患者さんに、送信日から30日以内のご来院があったか
      var visits = ix.visits[m.patientId];
      if (!visits || !visits.length) return;
      var i = bisect(visits, day, false);
      if (i < visits.length && visits[i] <= M.shiftDays(day, DM_WINDOW_DAYS)) box.hit++;
    });

    if (!counted) {
      host.appendChild(el('p', 'empty', 'この期間にお送りしたお知らせ・定期健診のご案内がまだありません。'));
      return;
    }

    var rows = ['mail', 'line', 'postcard'].map(function (ch) {
      var s = stats[ch];
      if (!s.sent) return [CHANNEL_LABEL[ch], '送信なし', '—', '—'];
      return [CHANNEL_LABEL[ch], s.sent + '通', s.hit + '名', pct(s.hit, s.sent) + '%'];
    });

    host.appendChild(table(['媒体', '送信数', 'ご来院', '割合'], rows));
    host.appendChild(el('p', 'an-note',
      'お送りした日から ' + DM_WINDOW_DAYS + '日以内にご来院（完了・お会計）があった方の割合です。'));
  }

  /* ================= 再来院率 ================= */

  var WINDOWS = [1, 2, 3, 6];

  /**
   * 期間内のご来院を起点に、次のご来院までの間隔を数える。
   * まだ判定期間が経過していない起点は分母から外す（「来なかった」と誤って数えないため）。
   */
  function revisitStats(ctx, ix, keyOf) {
    var buckets = {};

    ix.period.forEach(function (b) {
      if (!isVisit(b) || !b.patientId) return;
      var visits = ix.visits[b.patientId];
      if (!visits) return;

      var i = bisect(visits, b.date, true);
      var next = i < visits.length ? visits[i] : '';
      var group = keyOf ? keyOf(b) : '_all';
      if (group === null || group === undefined) return;

      var box = buckets[group] || (buckets[group] = { denom: {}, hit: {} });
      WINDOWS.forEach(function (mo) {
        var due = addMonths(b.date, mo);
        if (due > ix.today) return;  // まだ判定できない
        box.denom[mo] = (box.denom[mo] || 0) + 1;
        if (next && next <= due) box.hit[mo] = (box.hit[mo] || 0) + 1;
      });
    });

    return buckets;
  }

  function renderRevisit(ctx, ix) {
    var host = $('repRevisit');
    if (!host) return;
    clear(host);

    var box = revisitStats(ctx, ix)['_all'];
    if (!box) {
      host.appendChild(el('p', 'empty', 'この期間のご来院がまだ記録されていません。'));
      return;
    }

    var rows = WINDOWS.map(function (mo) {
      var d = box.denom[mo] || 0;
      var h = box.hit[mo] || 0;
      if (!d) return { label: mo + 'か月以内', n: null, text: 'まだ判定できません' };
      return { label: mo + 'か月以内', n: pct(h, d), text: pct(h, d) + '%', color: 'var(--accent)' };
    });

    host.appendChild(barsList(rows, 100));

    // 分母は窓ごとに変わるので、どれだけの来院で判定したかを添える
    var counts = WINDOWS.map(function (mo) { return mo + 'か月 ' + (box.denom[mo] || 0) + '件'; });
    host.appendChild(el('p', 'an-note',
      '判定できたご来院の件数：' + counts.join('　/　') +
      '。判定期間がまだ経過していないご来院は分母から外しています。'));
  }

  function renderRevisitBy(ctx, ix, hostId, keyOf, labelOf, emptyText) {
    var host = $(hostId);
    if (!host) return;
    clear(host);

    var buckets = revisitStats(ctx, ix, keyOf);
    var keys = Object.keys(buckets);
    if (!keys.length) {
      host.appendChild(el('p', 'empty', emptyText));
      return;
    }

    var rows = keys.map(function (k) {
      var box = buckets[k];
      var d = box.denom[3] || 0;
      var h = box.hit[3] || 0;
      return {
        label: labelOf(k),
        denom: d,
        rate: d ? pct(h, d) : null,
        hit: h
      };
    }).sort(function (a, b) { return b.denom - a.denom; });

    host.appendChild(table(['対象', '起点のご来院', '3か月以内の再来院', '割合', '備考'],
      rows.map(function (r) {
        return [
          r.label,
          r.denom + '件',
          r.rate === null ? '—' : r.hit + '件',
          r.rate === null ? 'まだ判定できません' : r.rate + '%',
          (r.rate !== null && r.denom < 5) ? '件数が少なく参考値です' : ''
        ];
      })));
  }

  /* ================= タグの内訳 ================= */

  function renderTags(ctx, ix) {
    var host = $('repTags');
    if (!host) return;
    clear(host);

    var patients = ctx.patients || [];
    if (!patients.length) {
      host.appendChild(el('p', 'empty', '患者さんの記録がまだありません。'));
      return;
    }

    var counts = {};
    var noTag = 0;
    patients.forEach(function (p) {
      var tags = p.tags || [];
      if (!tags.length) { noTag++; return; }
      tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });

    var rows = Object.keys(counts).map(function (t) {
      return { label: t, n: counts[t], text: counts[t] + '名', color: 'var(--accent)' };
    }).sort(function (a, b) { return b.n - a.n; });

    if (noTag > 0) rows.push({ label: 'タグなし', n: noTag, text: noTag + '名', color: GREY });

    host.appendChild(barsList(rows));
  }

  /* ================= 当院の課題 ================= */

  /** 定期健診のご案内をお送りする目安を過ぎている方の人数 */
  function recallDueCount(ctx, ix) {
    var cfg = ctx.cfg || {};
    var fallback = Number(cfg.reminder && cfg.reminder.recallMonths) || 6;
    var n = 0;
    (ctx.patients || []).forEach(function (p) {
      var months = Number(p.recallMonths);
      if (months === -1) return;             // ご案内を希望されていない方
      if (!(months > 0)) months = fallback;
      var visits = ix.visits[p.id];
      var last = p.lastVisit || (visits && visits.length ? visits[visits.length - 1] : '');
      if (!isKey(last)) return;
      if (ix.hasFuture[p.id]) return;
      if (addMonths(last, months) <= ix.today) n++;
    });
    return n;
  }

  function renderIssues(ctx, ix) {
    var host = $('repIssues');
    if (!host) return;
    clear(host);

    var from7 = M.shiftDays(ix.today, -6);
    var total7 = 0, noshow7 = 0, cancel7 = 0;
    for (var i = 0; i < 7; i++) {
      var key = M.shiftDays(from7, i);
      (ix.byDate[key] || []).forEach(function (b) {
        total7++;
        if (b.status === 'noshow') noshow7++;
        else if (b.status === 'canceled') cancel7++;
      });
    }

    /* 直近7日でいちばん稼働率の低かった日 */
    var lowDay = null;
    for (var j = 0; j < 7; j++) {
      var k = M.shiftDays(from7, j);
      var s = dayStat(ctx, ix, k);
      if (!s) continue;
      if (!lowDay || s.rate < lowDay.rate) lowDay = { key: k, rate: s.rate, vacant: s.vacant };
    }

    /* 定期健診のご案内を最後にお送りした日 */
    var lastRecall = '';
    (ctx.messages || []).forEach(function (m) {
      if (!m || m.kind !== 'recall') return;
      if (m.state !== 'sent' && m.state !== 'simulated') return;
      var day = String(m.at || '').slice(0, 10);
      if (isKey(day) && day > lastRecall) lastRecall = day;
    });
    var recallGap = lastRecall
      ? Math.round((M.fromKey(ix.today) - M.fromKey(lastRecall)) / 86400000) : -1;

    var patients = ctx.patients || [];
    var noMail = patients.filter(function (p) { return !p.email; }).length;

    var issues = [];
    var actions = [];

    if (noshow7 > 0) {
      issues.push('直近7日で無断キャンセルが ' + noshow7 + '件（ご予約 ' + total7 + '件中 ' +
        pct(noshow7, total7) + '%）ありました。');
      actions.push('無断キャンセルのあった ' + noshow7 +
        '名へ、次のご予約の前日までに確認のお電話を1件ずつ入れる。');
    }

    if (cancel7 >= 2 && pct(cancel7, total7) >= 15) {
      issues.push('直近7日のキャンセルが ' + cancel7 + '件（' + pct(cancel7, total7) +
        '%）と多めです。');
      actions.push('空いた枠のご案内を、キャンセル待ちの方へ月 ' + (cancel7 * 4) + '件お送りする。');
    }

    if (lowDay && lowDay.rate < 60) {
      issues.push(weekdayOf(lowDay.key) + '曜日（' + M.formatDateLong(lowDay.key) + '）の稼働率が ' +
        lowDay.rate + '%、空き ' + lowDay.vacant + '枠でした。');
      actions.push(weekdayOf(lowDay.key) + '曜日の空き枠へ、月 ' +
        Math.max(1, Math.min(lowDay.vacant * 4, 40)) + '件のご予約を入れることを目標にする。');
    }

    var dueCount = recallDueCount(ctx, ix);
    if (recallGap === -1) {
      issues.push('定期健診のご案内をまだ一度もお送りしていません（ご案内の目安を過ぎた方 ' +
        dueCount + '名）。');
      actions.push('定期健診のご案内を月 ' + Math.max(1, Math.min(dueCount, 60)) + '件お送りする。');
    } else if (recallGap >= 30) {
      issues.push('定期健診のご案内を ' + recallGap + '日間お送りしていません（ご案内の目安を過ぎた方 ' +
        dueCount + '名）。');
      actions.push('定期健診のご案内を月 ' + Math.max(1, Math.min(dueCount, 60)) + '件お送りする。');
    }

    if (patients.length && pct(noMail, patients.length) >= 20) {
      issues.push('メールアドレスが未登録の方が ' + noMail + '名（全 ' + patients.length + '名中 ' +
        pct(noMail, patients.length) + '%）いらっしゃいます。');
      actions.push('受付でメールアドレスを月 ' + Math.max(1, Math.min(noMail, 20)) + '件おうかがいする。');
    }

    var box = el('div', 'an-issues');

    var s1 = el('section');
    s1.appendChild(el('h3', 'an-issues__h', '今週の課題'));
    if (!issues.length) {
      s1.appendChild(el('p', 'lead', '大きな課題は見当たりません。いまの運用を続けてください。'));
    } else {
      var ol1 = el('ol');
      issues.slice(0, 3).forEach(function (t) { ol1.appendChild(el('li', null, t)); });
      s1.appendChild(ol1);
    }
    box.appendChild(s1);

    var s2 = el('section');
    s2.appendChild(el('h3', 'an-issues__h', '来月の行動目標'));
    var ol2 = el('ol');
    if (!actions.length) {
      var keep = lowDay ? lowDay.rate : 0;
      var rateSum = 0, openDays = 0;
      for (var w = 0; w < 7; w++) {
        var st = dayStat(ctx, ix, M.shiftDays(from7, w));
        if (st) { rateSum += st.rate; openDays++; }
      }
      keep = openDays ? Math.round(rateSum / openDays) : keep;
      ol2.appendChild(el('li', null, '直近7日の平均稼働率 ' + keep + '% を、来月も下回らないように保つ。'));
      ol2.appendChild(el('li', null,
        '定期健診のご案内を月 ' + Math.max(1, Math.min(dueCount, 60)) + '件お送りする。'));
    } else {
      actions.slice(0, 3).forEach(function (t) { ol2.appendChild(el('li', null, t)); });
    }
    s2.appendChild(ol2);
    box.appendChild(s2);

    host.appendChild(box);
  }

  /* ================= 入口 ================= */

  A.render = function (ctx) {
    if (!ctx || !ctx.cfg) return;
    ensureStyle();

    var safe = {
      cfg: ctx.cfg,
      bookings: ctx.bookings || [],
      patients: ctx.patients || [],
      messages: ctx.messages || [],
      contacts: ctx.contacts || [],
      from: ctx.from,
      to: ctx.to,
      weekStartKey: ctx.weekStartKey,
      monthKey: ctx.monthKey,
      compare: ctx.compare || {}
    };

    var ix = buildIndex(safe);

    renderStats(safe, ix);
    renderChart(safe, ix);
    renderWeek(safe, ix);
    renderMonth(safe, ix);
    renderPurpose(safe, ix);
    renderStaff(safe, ix);
    renderDmVisit(safe, ix);
    renderRevisit(safe, ix);

    renderRevisitBy(safe, ix, 'repRevisitStaff',
      function (b) { return b.staffId || '_none'; },
      function (k) {
        if (k === '_none') return '担当を決めていない';
        var st = DRB.staffOf(safe.cfg, k);
        return st ? st.name : '担当 ' + k;
      },
      'この期間のご来院がまだ記録されていません。');

    renderRevisitBy(safe, ix, 'repRevisitPurpose',
      function (b) { return b.purpose || '_none'; },
      function (k) {
        if (k === '_none') return 'ご用件未設定';
        return M.purposeOf(safe.cfg, k).label;
      },
      'この期間のご来院がまだ記録されていません。');

    renderTags(safe, ix);
    renderIssues(safe, ix);
  };
})(window.DRB);

/* 受付予約ボード — 画面の描画
 *
 * 文字はすべて textContent で入れる（利用者が入れた氏名やメモを
 * そのまま HTML として解釈させない）。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var V = {};
  DRB.views = V;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  V.el = el;

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  V.clear = clear;

  /* ================= 日別ボード ================= */

  /**
   * @param ctx { cfg, bookings, dateKey, counterMode, highlightIds, onSlot }
   */
  V.renderDay = function (ctx) {
    var cfg = ctx.cfg;
    var table = document.getElementById('board');
    var empty = document.getElementById('boardEmpty');
    var scroll = document.querySelector('.board-scroll');

    clear(table);

    if (M.isClosed(cfg, ctx.dateKey)) {
      scroll.hidden = true;
      empty.hidden = false;
      empty.textContent = M.formatDateFull(ctx.dateKey) + ' は休診日です。';
      return;
    }
    scroll.hidden = false;
    empty.hidden = true;

    table.classList.toggle('is-counter', ctx.counterMode);

    var cols = M.columnsOf(cfg).filter(function (c) {
      return !(c.hold && ctx.counterMode);
    });
    var grid = M.buildGrid(cfg, ctx.dateKey, ctx.bookings);

    /* --- 見出し --- */
    var thead = el('thead');
    var hrow = el('tr');
    hrow.appendChild(el('th', 't-time', '時間'));
    cols.forEach(function (c) {
      var th = el('th', c.hold ? 'is-hold' : null, c.label);
      th.scope = 'col';
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    /* --- 本体 --- */
    var tbody = el('tbody');
    var skip = {}; // 連続枠で覆われたセル

    grid.slots.forEach(function (slot, i) {
      var tr = el('tr');
      if (i > 0 && slot.band !== grid.slots[i - 1].band) tr.className = 'is-bandtop';

      var th = el('th', 't-time', slot.time);
      th.scope = 'row';
      tr.appendChild(th);

      cols.forEach(function (c) {
        if (skip[i + ':' + c.id]) return;

        var cell = M.cellAt(grid, i, c.id);
        var td = el('td', c.hold ? 'is-hold' : null);

        if (cell && cell.head) {
          if (cell.span > 1) {
            td.rowSpan = cell.span;
            for (var k = 1; k < cell.span; k++) skip[(i + k) + ':' + c.id] = true;
          }
          td.appendChild(bookingButton(ctx, cell.booking, slot, c));
        } else if (!cell) {
          td.appendChild(freeButton(ctx, i, slot, c));
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
  };

  function bookingButton(ctx, booking, slot, col) {
    var cfg = ctx.cfg;
    var purpose = M.purposeOf(cfg, booking.purpose);
    var status = window.DRB.statusOf(booking.status);
    var wrap = el('div', 'cellwrap');

    var b = el('button', 'slot slot--taken');
    b.type = 'button';
    b.style.borderLeftColor = purpose.color;

    if (ctx.counterMode) {
      b.appendChild(el('span', 'slot__name', 'ご予約あり'));
      b.setAttribute('aria-label', slot.time + ' ' + col.label + ' ご予約あり');
    } else {
      var name = el('span', 'slot__name', booking.name);
      if (booking.cardNo) name.appendChild(el('small', 'slot__card', 'No.' + booking.cardNo));
      b.appendChild(name);

      var meta = el('span', 'slot__meta', purpose.label);
      var staff = window.DRB.staffOf(cfg, booking.staffId);
      if (staff) meta.appendChild(el('small', 'slot__staff', ' / ' + staff.name));
      b.appendChild(meta);

      if (booking.memo) b.appendChild(el('span', 'slot__meta', '✎ ' + booking.memo));
      b.setAttribute('aria-label',
        slot.time + ' ' + col.label + ' ' + booking.name + '様 ' + purpose.label +
        '　' + status.label + '　内容を見る');
    }

    if (ctx.highlightIds && ctx.highlightIds.indexOf(booking.id) !== -1) b.classList.add('is-hit');
    b.addEventListener('click', function () { ctx.onSlot('detail', { booking: booking }); });
    wrap.appendChild(b);

    /* 進み具合のボタン。押すたびに 予約→来院→診療中→お会計→完了 と進む。 */
    if (!ctx.counterMode) {
      var pip = el('button', 'pip', status.short);
      pip.type = 'button';
      pip.style.background = status.color;
      pip.title = status.label + (status.next
        ? '（押すと「' + window.DRB.statusOf(status.next).label + '」へ）' : '');
      pip.setAttribute('aria-label', booking.name + '様　いまは' + status.label +
        (status.next ? '。押すと' + window.DRB.statusOf(status.next).label + 'にします' : ''));
      if (!status.next) pip.disabled = true;
      pip.addEventListener('click', function (ev) {
        ev.stopPropagation();
        ctx.onSlot('advance', { booking: booking, next: status.next });
      });
      wrap.appendChild(pip);
      b.classList.add('is-' + status.key);
    }

    return wrap;
  }

  function freeButton(ctx, slotIndex, slot, col) {
    var b = el('button', 'slot slot--free');
    b.type = 'button';
    b.setAttribute('aria-label', slot.time + ' ' + col.label + ' 空き。押すとご予約を入れられます');
    b.addEventListener('click', function () {
      ctx.onSlot('create', { slotIndex: slotIndex, time: slot.time, unit: col.id });
    });
    return b;
  }

  /* ================= 集計・凡例 ================= */

  V.renderStats = function (cfg, dateKey, bookings) {
    var host = document.getElementById('dayStats');
    clear(host);
    if (M.isClosed(cfg, dateKey)) return;

    var s = M.summarize(cfg, dateKey, bookings);
    [
      ['ご予約', s.booked, '件'],
      ['ご来院', s.arrived, '件'],
      ['空き', s.vacant, '枠'],
      ['稼働率', s.rate, '%'],
      ['確保枠の使用', s.holdUsed, '件'],
      ['取り消し', s.canceled + s.noshow, '件']
    ].forEach(function (row) {
      var li = el('li');
      li.appendChild(el('b', null, row[0]));
      var v = el('span', null, String(row[1]));
      v.appendChild(el('small', null, row[2]));
      li.appendChild(v);
      host.appendChild(li);
    });
  };

  V.renderLegend = function (cfg) {
    var host = document.getElementById('legend');
    clear(host);
    cfg.purposes.forEach(function (p) {
      var li = el('li');
      var i = el('i');
      i.style.background = p.color;
      li.appendChild(i);
      li.appendChild(document.createTextNode(p.label));
      host.appendChild(li);
    });
  };

  /* ================= 週間の埋まり ================= */

  /** @param ctx { cfg, bookings, weekStartKey, onPickDate } */
  V.renderWeek = function (ctx) {
    var cfg = ctx.cfg;
    var table = document.getElementById('weekTable');
    clear(table);

    var days = [];
    for (var d = 0; d < 7; d++) days.push(M.shiftDays(ctx.weekStartKey, d));

    var thead = el('thead');
    var hrow = el('tr');
    hrow.appendChild(el('th', 't-band', '時間帯'));
    days.forEach(function (key) {
      var th = el('th');
      th.scope = 'col';
      th.appendChild(document.createTextNode(M.fromKey(key).getDate() + '日'));
      th.appendChild(el('span', 'heat__head-day', M.weekdayLabel(key)));
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    // 午前／午後／終日 の3行にまとめる
    var bands = [
      { label: '午前（〜13:00）', from: 0, to: 13 * 60 },
      { label: '午後（13:00〜）', from: 13 * 60, to: 24 * 60 },
      { label: '終日', from: 0, to: 24 * 60 }
    ];

    var tbody = el('tbody');
    bands.forEach(function (band) {
      var tr = el('tr');
      var th = el('th', 't-band', band.label);
      th.scope = 'row';
      tr.appendChild(th);

      days.forEach(function (key) {
        var td = el('td');
        if (M.isClosed(cfg, key)) {
          td.className = 'is-closed';
          td.textContent = '休診';
          tr.appendChild(td);
          return;
        }
        var r = bandRate(cfg, key, ctx.bookings, band);
        var btn = el('button', null, r.total ? r.rate + '%' : '—');
        btn.type = 'button';
        btn.style.background = heatColor(r.rate);
        btn.style.color = r.rate >= 60 ? '#fff' : 'var(--ink)';
        btn.setAttribute('aria-label',
          M.formatDateLong(key) + ' ' + band.label + ' 稼働率 ' + r.rate + 'パーセント。押すと日別ボードへ移ります');
        btn.addEventListener('click', function () { ctx.onPickDate(key); });
        td.appendChild(btn);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    document.getElementById('weekCaption').textContent =
      M.formatDateLong(days[0]) + ' 〜 ' + M.formatDateLong(days[6]);
  };

  function bandRate(cfg, key, bookings, band) {
    var grid = M.buildGrid(cfg, key, bookings);
    var total = 0, used = 0;
    grid.slots.forEach(function (s, i) {
      if (s.minutes < band.from || s.minutes >= band.to) return;
      cfg.units.forEach(function (u) {
        total++;
        if (M.cellAt(grid, i, u.id)) used++;
      });
    });
    return { total: total, used: used, rate: total ? Math.round((used / total) * 100) : 0 };
  }

  function heatColor(rate) {
    if (!rate) return '#ffffff';
    // 空き＝白 → 満杯＝アクセント色 の連続で塗る
    var t = Math.min(1, rate / 100);
    var r = Math.round(255 + (31 - 255) * t);
    var g = Math.round(255 + (111 - 255) * t);
    var b = Math.round(255 + (107 - 255) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ================= 月間の空き ================= */

  /** @param ctx { cfg, bookings, monthKey, selectedKey, onPickDay } */
  V.renderMonth = function (ctx) {
    var cfg = ctx.cfg;
    var host = document.getElementById('calendar');
    clear(host);

    var base = M.fromKey(ctx.monthKey);
    var year = base.getFullYear();
    var month = base.getMonth();
    var first = new Date(year, month, 1);
    var lastDate = new Date(year, month + 1, 0).getDate();

    document.getElementById('monthCaption').textContent = year + '年' + (month + 1) + '月';

    ['日', '月', '火', '水', '木', '金', '土'].forEach(function (w, i) {
      var cls = 'cal__wd' + (i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : '');
      host.appendChild(el('div', cls, w));
    });

    for (var pad = 0; pad < first.getDay(); pad++) {
      host.appendChild(el('div', 'cal__day is-blank'));
    }

    var today = M.todayKey();

    for (var d = 1; d <= lastDate; d++) {
      var key = M.toKey(new Date(year, month, d));
      var btn = el('button', 'cal__day');
      btn.type = 'button';
      btn.appendChild(el('span', 'cal__n', String(d)));

      if (M.isClosed(cfg, key)) {
        btn.className += ' is-closed';
        btn.disabled = true;
        btn.appendChild(el('span', 'cal__free', '休診'));
      } else {
        var v = M.vacancyOf(cfg, key, ctx.bookings);
        btn.appendChild(el('span', 'cal__free', '空き ' + v.vacant + '枠'));
        var bar = el('div', 'cal__bar');
        var fill = el('i');
        fill.style.width = v.rate + '%';
        bar.appendChild(fill);
        btn.appendChild(bar);
        btn.setAttribute('aria-label', M.formatDateLong(key) + ' 空き ' + v.vacant + '枠');
        (function (k) {
          btn.addEventListener('click', function () { ctx.onPickDay(k); });
        })(key);
      }

      if (key === today) btn.className += ' is-today';
      if (key === ctx.selectedKey) btn.className += ' is-sel';
      host.appendChild(btn);
    }
  };

  /** @param ctx { cfg, bookings, dateKey, onPickSlot } */
  V.renderMonthDetail = function (ctx) {
    var host = document.getElementById('monthDetail');
    clear(host);
    if (!ctx.dateKey) return;

    host.appendChild(el('p', 'daylist__h', M.formatDateFull(ctx.dateKey) + ' の空いているお時間'));

    var open = M.openSlotsOf(ctx.cfg, ctx.dateKey, ctx.bookings);
    if (!open.length) {
      host.appendChild(el('p', 'lead', 'この日は空きがございません。'));
      return;
    }

    var wrap = el('div', 'daylist__times');
    open.forEach(function (s) {
      var btn = el('button', null, s.time);
      btn.type = 'button';
      btn.setAttribute('aria-label', s.time + ' 空き ' + s.units.length + '台。押すとご予約を入れられます');
      btn.addEventListener('click', function () {
        ctx.onPickSlot(ctx.dateKey, s.time, s.units[0].id);
      });
      wrap.appendChild(btn);
    });
    host.appendChild(wrap);
  };
})(window.DRB);

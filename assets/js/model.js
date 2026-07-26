/* 受付予約ボード — 枠の生成と集計 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = {};
  DRB.model = M;

  M.HOLD_UNIT = 0; // 確保枠の列ID

  /* ---------- 日付・時刻ユーティリティ ---------- */

  M.toKey = function (d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  };

  M.fromKey = function (key) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };

  M.shiftDays = function (key, n) {
    var d = M.fromKey(key);
    d.setDate(d.getDate() + n);
    return M.toKey(d);
  };

  M.todayKey = function () { return M.toKey(new Date()); };

  M.toMinutes = function (hhmm) {
    var p = hhmm.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  };

  M.toHHMM = function (mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
  };

  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  M.formatDateLong = function (key) {
    var d = M.fromKey(key);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）';
  };

  M.formatDateFull = function (key) {
    var d = M.fromKey(key);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() +
      '日（' + WD[d.getDay()] + '）';
  };

  M.weekdayLabel = function (key) { return WD[M.fromKey(key).getDay()]; };

  /* ---------- 診療枠 ---------- */

  M.isClosed = function (cfg, key) {
    if (cfg.closedDates.indexOf(key) !== -1) return true;
    return !cfg.hours[M.fromKey(key).getDay()];
  };

  /**
   * その日の診療枠を先頭時刻の配列で返す。
   * 昼休みは枠を作らないので、そのまま並べると午前と午後が連続する。
   */
  M.slotsOf = function (cfg, key) {
    if (M.isClosed(cfg, key)) return [];
    var bands = cfg.hours[M.fromKey(key).getDay()] || [];
    var step = cfg.slotMinutes;
    var out = [];
    bands.forEach(function (band, bandIndex) {
      var start = M.toMinutes(band[0]);
      var end = M.toMinutes(band[1]);
      for (var t = start; t + step <= end; t += step) {
        out.push({ time: M.toHHMM(t), minutes: t, band: bandIndex });
      }
    });
    return out;
  };

  M.columnsOf = function (cfg) {
    var cols = cfg.units.map(function (u) {
      return { id: u.id, label: u.label, hold: false };
    });
    if (cfg.holdColumn.enabled) {
      cols.push({ id: M.HOLD_UNIT, label: cfg.holdColumn.label, hold: true });
    }
    return cols;
  };

  M.purposeOf = function (cfg, keyOrNull) {
    for (var i = 0; i < cfg.purposes.length; i++) {
      if (cfg.purposes[i].key === keyOrNull) return cfg.purposes[i];
    }
    return { key: '', label: 'ご用件未設定', color: '#6E757C', span: 1 };
  };

  /* ---------- 占有マップ ---------- */

  /**
   * 「slotIndex:unitId」→ 予約 の対応表を作る。
   * span が 2 以上の予約は、後続の枠も同じ予約で埋める（先頭かどうかは head で判別）。
   */
  /** 取り消し済み・無断キャンセルは枠を空けるので、盤面には出さない */
  M.isActive = function (b) {
    return b.status !== 'canceled' && b.status !== 'noshow';
  };

  M.buildGrid = function (cfg, key, bookings) {
    var slots = M.slotsOf(cfg, key);
    var index = {};
    slots.forEach(function (s, i) { index[s.time] = i; });

    var grid = {};
    bookings.forEach(function (b) {
      if (b.date !== key || !M.isActive(b)) return;
      var head = index[b.time];
      if (head === undefined) return;
      var span = Math.max(1, Number(b.span) || 1);
      for (var i = 0; i < span && head + i < slots.length; i++) {
        // 昼休みをまたぐ予約は先頭の帯までで打ち切る
        if (slots[head + i].band !== slots[head].band) break;
        grid[(head + i) + ':' + b.unit] = { booking: b, head: i === 0, span: span };
      }
    });
    return { slots: slots, index: index, cells: grid };
  };

  M.cellAt = function (grid, slotIndex, unitId) {
    return grid.cells[slotIndex + ':' + unitId] || null;
  };

  /** 指定枠に span 分の空きがあるか（自分自身の予約は除外して判定できる） */
  M.canPlace = function (grid, slotIndex, unitId, span, ignoreId) {
    var slots = grid.slots;
    if (slotIndex + span > slots.length) return false;
    for (var i = 0; i < span; i++) {
      if (slots[slotIndex + i].band !== slots[slotIndex].band) return false;
      var cell = M.cellAt(grid, slotIndex + i, unitId);
      if (cell && cell.booking.id !== ignoreId) return false;
    }
    return true;
  };

  /** その枠に置ける最大の連続枠数 */
  M.maxSpanAt = function (grid, slotIndex, unitId, ignoreId) {
    var n = 0;
    while (M.canPlace(grid, slotIndex, unitId, n + 1, ignoreId) && n < 8) n++;
    return n;
  };

  /* ---------- 集計 ---------- */

  M.summarize = function (cfg, key, bookings) {
    var grid = M.buildGrid(cfg, key, bookings);
    var slotCount = grid.slots.length;
    var treatUnits = cfg.units.length;
    var capacity = slotCount * treatUnits;

    var filled = 0;
    var holdUsed = 0;
    var booked = 0;
    var byStatus = {};

    bookings.forEach(function (b) {
      if (b.date !== key) return;
      byStatus[b.status || 'booked'] = (byStatus[b.status || 'booked'] || 0) + 1;
      if (!M.isActive(b)) return;
      booked++;
      if (b.unit === M.HOLD_UNIT) holdUsed++;
    });

    for (var i = 0; i < slotCount; i++) {
      for (var u = 0; u < treatUnits; u++) {
        if (M.cellAt(grid, i, cfg.units[u].id)) filled++;
      }
    }

    return {
      booked: booked,
      capacity: capacity,
      filled: filled,
      vacant: capacity - filled,
      rate: capacity ? Math.round((filled / capacity) * 100) : 0,
      holdUsed: holdUsed,
      byStatus: byStatus,
      arrived: (byStatus.arrived || 0) + (byStatus.inChair || 0) +
               (byStatus.checkout || 0) + (byStatus.done || 0),
      canceled: byStatus.canceled || 0,
      noshow: byStatus.noshow || 0
    };
  };

  /** 月間カレンダー用：日ごとの空き枠数 */
  M.vacancyOf = function (cfg, key, bookings) {
    if (M.isClosed(cfg, key)) return null;
    var s = M.summarize(cfg, key, bookings);
    return { vacant: s.vacant, capacity: s.capacity, rate: s.rate };
  };

  /** 月間カレンダー・週間ビュー用：空いている枠の一覧 */
  M.openSlotsOf = function (cfg, key, bookings) {
    var grid = M.buildGrid(cfg, key, bookings);
    var out = [];
    grid.slots.forEach(function (s, i) {
      var free = cfg.units.filter(function (u) {
        return !M.cellAt(grid, i, u.id);
      });
      if (free.length) out.push({ time: s.time, units: free });
    });
    return out;
  };

  /* ---------- CSV ---------- */

  var CSV_HEADER = ['予約ID', '日付', '開始', '枠数', '列', 'お名前', '診察券番号',
    '連絡先', 'メール', 'ご用件', '状態', '担当', 'メモ', 'キャンセル理由', '患者ID'];

  function esc(v) {
    var s = (v === undefined || v === null) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  M.toCSV = function (cfg, bookings) {
    var lines = [CSV_HEADER.map(esc).join(',')];
    bookings.slice().sort(function (a, b) {
      return (a.date + a.time).localeCompare(b.date + b.time);
    }).forEach(function (b) {
      var col = b.unit === M.HOLD_UNIT ? cfg.holdColumn.label : unitLabel(cfg, b.unit);
      var staff = window.DRB.staffOf(cfg, b.staffId);
      lines.push([
        b.id, b.date, b.time, b.span || 1, col, b.name, b.cardNo,
        b.phone, b.email, M.purposeOf(cfg, b.purpose).label,
        window.DRB.statusOf(b.status).label, staff ? staff.name : '',
        b.memo, b.cancelReason, b.patientId
      ].map(esc).join(','));
    });
    return lines.join('\r\n');
  };

  function unitLabel(cfg, unitId) {
    for (var i = 0; i < cfg.units.length; i++) {
      if (cfg.units[i].id === unitId) return cfg.units[i].label;
    }
    return '列' + unitId;
  }
  M.unitLabel = unitLabel;

  M.columnLabel = function (cfg, unitId) {
    return unitId === M.HOLD_UNIT ? cfg.holdColumn.label : unitLabel(cfg, unitId);
  };

  /** RFC4180 準拠の素朴なパーサ（区切り・引用・改行のみ対応） */
  M.parseCSV = function (text) {
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') {
        quoted = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return v !== ''; }); });
  };

  M.fromCSV = function (cfg, text) {
    var rows = M.parseCSV(text);
    if (!rows.length) return [];
    var body = rows[0][0] === CSV_HEADER[0] ? rows.slice(1) : rows;
    var purposeByLabel = {};
    cfg.purposes.forEach(function (p) { purposeByLabel[p.label] = p.key; });
    var statusByLabel = {};
    window.DRB.STATUSES.forEach(function (s) { statusByLabel[s.label] = s.key; });
    var staffByName = {};
    cfg.staff.forEach(function (s) { staffByName[s.name] = s.id; });

    return body.map(function (r) {
      var colName = r[4] || '';
      var unit = M.HOLD_UNIT;
      if (colName !== cfg.holdColumn.label) {
        var found = cfg.units.filter(function (u) { return u.label === colName; })[0];
        unit = found ? found.id : (cfg.units[0] ? cfg.units[0].id : 1);
      }
      return {
        id: r[0] || M.newId(),
        date: r[1],
        time: r[2],
        span: Math.max(1, Number(r[3]) || 1),
        unit: unit,
        name: r[5] || '',
        cardNo: r[6] || '',
        phone: r[7] || '',
        email: r[8] || '',
        purpose: purposeByLabel[r[9]] || 'consult',
        status: statusByLabel[r[10]] || 'booked',
        staffId: staffByName[r[11]] || '',
        memo: r[12] || '',
        cancelReason: r[13] || '',
        patientId: r[14] || ''
      };
    }).filter(function (b) { return /^\d{4}-\d{2}-\d{2}$/.test(b.date) && /^\d{2}:\d{2}$/.test(b.time); });
  };

  M.newId = function () {
    return 'bk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  };
})(window.DRB);

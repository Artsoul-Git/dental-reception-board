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
  /** 生きているご予約。取り消し・無断キャンセルは含まない */
  M.isActive = function (b) {
    return b.status !== 'canceled' && b.status !== 'noshow';
  };

  /**
   * 取り消し済みだが枠を空けないもの。
   * 直前のキャンセルや無断キャンセルは他の方へ振り替えられないため、
   * 空き枠に戻さず「キャンセル」として枠に残す。
   */
  M.isHeld = function (b) {
    return !M.isActive(b) && !!b.slotHeld;
  };

  /** 盤面に出す（＝枠を占有する）かどうか */
  M.occupies = function (b) {
    return M.isActive(b) || M.isHeld(b);
  };

  M.buildGrid = function (cfg, key, bookings) {
    var slots = M.slotsOf(cfg, key);
    var index = {};
    slots.forEach(function (s, i) { index[s.time] = i; });

    var grid = {};
    bookings.forEach(function (b) {
      if (b.date !== key || !M.occupies(b)) return;
      var head = index[b.time];
      if (head === undefined) return;
      var span = Math.max(1, Number(b.span) || 1);
      var held = M.isHeld(b);
      for (var i = 0; i < span && head + i < slots.length; i++) {
        // 昼休みをまたぐ予約は先頭の帯までで打ち切る
        if (slots[head + i].band !== slots[head].band) break;
        grid[(head + i) + ':' + b.unit] = { booking: b, head: i === 0, span: span, held: held };
      }
    });
    return { slots: slots, index: index, cells: grid };
  };

  M.shiftMonth = function (key, n) {
    var d = M.fromKey(key);
    return M.toKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
  };

  M.formatMonth = function (key) {
    var d = M.fromKey(key);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  };

  /** 前後の確保時間を枠数に直す */
  M.bufferSlots = function (cfg) {
    var b = cfg.buffer || { before: 0, after: 0 };
    var unit = cfg.slotMinutes || 15;
    return {
      before: Math.ceil((Number(b.before) || 0) / unit),
      after: Math.ceil((Number(b.after) || 0) / unit)
    };
  };

  M.cellAt = function (grid, slotIndex, unitId) {
    return grid.cells[slotIndex + ':' + unitId] || null;
  };

  /**
   * 指定枠に span 分の空きがあるか（自分自身の予約は除外して判定できる）。
   * cfg を渡すと、前後の確保時間ぶんも空いていることを求める。
   * 確保時間は同じ帯の中だけで見る（昼休みや診療終了は自然に区切りになるため）。
   */
  M.canPlace = function (grid, slotIndex, unitId, span, ignoreId, cfg) {
    var slots = grid.slots;
    if (slotIndex < 0 || slotIndex + span > slots.length) return false;

    for (var i = 0; i < span; i++) {
      if (slots[slotIndex + i].band !== slots[slotIndex].band) return false;
      var cell = M.cellAt(grid, slotIndex + i, unitId);
      if (cell && cell.booking.id !== ignoreId) return false;
    }

    if (!cfg) return true;
    var buf = M.bufferSlots(cfg);

    for (var b = 1; b <= buf.before; b++) {
      var pi = slotIndex - b;
      if (pi < 0 || slots[pi].band !== slots[slotIndex].band) break;
      var pc = M.cellAt(grid, pi, unitId);
      if (pc && pc.booking.id !== ignoreId) return false;
    }
    for (var a = 0; a < buf.after; a++) {
      var ni = slotIndex + span + a;
      if (ni >= slots.length || slots[ni].band !== slots[slotIndex].band) break;
      var nc = M.cellAt(grid, ni, unitId);
      if (nc && nc.booking.id !== ignoreId) return false;
    }
    return true;
  };

  /** その枠に置ける最大の連続枠数 */
  M.maxSpanAt = function (grid, slotIndex, unitId, ignoreId, cfg) {
    var n = 0;
    while (M.canPlace(grid, slotIndex, unitId, n + 1, ignoreId, cfg) && n < 8) n++;
    return n;
  };

  /**
   * 「この枠にこのスタッフがすでに入っているか」の対応表。
   * 先生は同じ時間にひとつのチェアにしか入れないので、
   * チェアの空きとは別に、担当ごとの埋まり具合を見る必要がある。
   */
  M.staffBusyMap = function (cfg, key, bookings) {
    var slots = M.slotsOf(cfg, key);
    var index = {};
    slots.forEach(function (s, i) { index[s.time] = i; });

    var busy = {};
    bookings.forEach(function (b) {
      if (b.date !== key || !M.isActive(b) || !b.staffId) return;
      var head = index[b.time];
      if (head === undefined) return;
      var span = Math.max(1, Number(b.span) || 1);
      for (var i = 0; i < span && head + i < slots.length; i++) {
        if (slots[head + i].band !== slots[head].band) break;
        busy[(head + i) + ':' + b.staffId] = b.id;
      }
    });
    return { busy: busy, slots: slots, index: index };
  };

  /** そのスタッフが span 分あいているか。前後の確保時間も同じように見る。 */
  M.staffFree = function (map, slotIndex, staffId, span, ignoreId, cfg) {
    if (!staffId) return true;
    var slots = map.slots;
    if (slotIndex < 0 || slotIndex + span > slots.length) return false;

    function taken(i) {
      var hit = map.busy[i + ':' + staffId];
      return hit && hit !== ignoreId;
    }

    for (var i = 0; i < span; i++) {
      if (slots[slotIndex + i].band !== slots[slotIndex].band) return false;
      if (taken(slotIndex + i)) return false;
    }

    if (!cfg) return true;
    var buf = M.bufferSlots(cfg);
    for (var b = 1; b <= buf.before; b++) {
      var pi = slotIndex - b;
      if (pi < 0 || slots[pi].band !== slots[slotIndex].band) break;
      if (taken(pi)) return false;
    }
    for (var a = 0; a < buf.after; a++) {
      var ni = slotIndex + span + a;
      if (ni >= slots.length || slots[ni].band !== slots[slotIndex].band) break;
      if (taken(ni)) return false;
    }
    return true;
  };

  /**
   * その日のうち、指定のご用件・担当で入れられる開始時刻を返す。
   * 「用件と担当を選ぶと、その組み合わせで取れる時間だけ出す」ための関数。
   * @returns [{time, unit, unitLabel}]
   */
  M.openingsFor = function (cfg, key, bookings, purposeKey, staffId, ignoreId) {
    if (M.isClosed(cfg, key)) return [];
    var grid = M.buildGrid(cfg, key, bookings);
    var span = purposeKey ? Math.max(1, M.purposeOf(cfg, purposeKey).span || 1) : 1;
    var smap = staffId ? M.staffBusyMap(cfg, key, bookings) : null;
    var out = [];

    grid.slots.forEach(function (slot, i) {
      if (smap && !M.staffFree(smap, i, staffId, span, ignoreId, cfg)) return;
      cfg.units.forEach(function (u) {
        if (M.canPlace(grid, i, u.id, span, ignoreId, cfg)) {
          out.push({ time: slot.time, unit: u.id, unitLabel: u.label });
        }
      });
    });
    return out;
  };

  /** 開始時刻ごとにまとめる（同じ時刻に複数チェアが空いていても1件として見せる） */
  M.openingTimes = function (cfg, key, bookings, purposeKey, staffId, ignoreId) {
    var seen = {};
    var out = [];
    M.openingsFor(cfg, key, bookings, purposeKey, staffId, ignoreId).forEach(function (o) {
      if (seen[o.time]) return;
      seen[o.time] = true;
      out.push(o);
    });
    return out;
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

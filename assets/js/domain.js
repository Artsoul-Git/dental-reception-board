/* 受付予約ボード — 患者・応対・通知・分析のドメインロジック
 *
 * 「誰に、いつ、何を送るべきか」の判断はすべてここに置く。
 * 画面側は判断せず、ここが返した一覧を並べるだけにする。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var X = {};
  DRB.domain = X;

  /* ================= 患者 ================= */

  X.newPatientId = function () {
    return 'pt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  };

  X.blankPatient = function () {
    return {
      id: X.newPatientId(), cardNo: '', name: '', kana: '', phone: '', email: '',
      birth: '', sex: '', address: '', firstVisit: '', lastVisit: '',
      recallMonths: 0, tags: [], allergy: '', medical: '',
      mailOK: true, dmOK: true, note: '', createdAt: new Date().toISOString()
    };
  };

  X.findPatient = function (patients, id) {
    for (var i = 0; i < patients.length; i++) if (patients[i].id === id) return patients[i];
    return null;
  };

  X.findByCard = function (patients, cardNo) {
    if (!cardNo) return null;
    for (var i = 0; i < patients.length; i++) {
      if (String(patients[i].cardNo) === String(cardNo)) return patients[i];
    }
    return null;
  };

  /** 患者の来院履歴。新しい順。 */
  X.historyOf = function (bookings, patientId) {
    return bookings.filter(function (b) { return b.patientId === patientId; })
      .sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  };

  /** 実際に来院した最後の日。予約しただけ・キャンセルは数えない。 */
  X.lastVisitOf = function (bookings, patientId) {
    var visits = bookings.filter(function (b) {
      return b.patientId === patientId && (b.status === 'done' || b.status === 'checkout');
    }).map(function (b) { return b.date; }).sort();
    return visits.length ? visits[visits.length - 1] : '';
  };

  /** 今日より先の予約があるか。リコール案内から除くために使う。 */
  X.nextBookingOf = function (bookings, patientId) {
    var today = M.todayKey();
    var future = bookings.filter(function (b) {
      return b.patientId === patientId && M.isActive(b) && b.date >= today;
    }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    return future[0] || null;
  };

  /** 患者一覧の検索。お名前・かな・診察券番号・お電話・メール・タグを横断する。 */
  X.searchPatients = function (patients, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(function (p) {
      var hay = [p.name, p.kana, p.cardNo, p.phone, p.email, (p.tags || []).join(' ')]
        .join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  };

  /* ================= 応対記録 ================= */

  X.contactsOf = function (contacts, patientId) {
    return contacts.filter(function (c) { return c.patientId === patientId; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  };

  X.newContact = function (patientId, fields) {
    var c = {
      id: 'ct-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      patientId: patientId,
      at: new Date().toISOString(),
      channel: 'phone', direction: 'in', staffId: '',
      subject: '', body: '', bookingId: ''
    };
    Object.keys(fields || {}).forEach(function (k) { c[k] = fields[k]; });
    return c;
  };

  /* ================= 文面の差し込み ================= */

  X.renderTemplate = function (cfg, tpl, ctx) {
    var map = {
      '{{お名前}}': ctx.name || '',
      '{{様}}': (ctx.name || '') + ' 様',
      '{{日付}}': ctx.date ? M.formatDateFull(ctx.date) : '',
      '{{時刻}}': ctx.time || '',
      '{{ご用件}}': ctx.purpose ? M.purposeOf(cfg, ctx.purpose).label : '',
      '{{診察券番号}}': ctx.cardNo || '',
      '{{医院名}}': cfg.clinicName || '',
      '{{電話}}': cfg.tel || '',
      '{{最終来院}}': ctx.lastVisit ? M.formatDateFull(ctx.lastVisit) : '記録なし'
    };
    function fill(text) {
      var out = String(text || '');
      Object.keys(map).forEach(function (tag) {
        out = out.split(tag).join(map[tag]);
      });
      return out;
    }
    return { subject: fill(tpl.subject), body: fill(tpl.body) };
  };

  /** 予約1件から差し込み用の材料を作る */
  X.ctxOf = function (booking, patient) {
    return {
      name: booking.name || (patient ? patient.name : ''),
      date: booking.date,
      time: booking.time,
      purpose: booking.purpose,
      cardNo: booking.cardNo || (patient ? patient.cardNo : ''),
      lastVisit: patient ? patient.lastVisit : ''
    };
  };

  /* ================= 送るべきものの抽出 ================= */

  /** その予約・その種類で、すでに送信済みか */
  X.alreadySent = function (messages, bookingId, kind) {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.bookingId === bookingId && m.kind === kind &&
          (m.state === 'sent' || m.state === 'simulated')) return true;
    }
    return false;
  };

  /**
   * 前日リマインドの対象。
   * 明日ぶんの有効な予約のうち、メールアドレスがあり、受信を承諾していて、まだ送っていないもの。
   */
  X.reminderTargets = function (cfg, bookings, patients, messages, baseKey) {
    var target = M.shiftDays(baseKey || M.todayKey(), 1);
    return bookings.filter(function (b) {
      if (b.date !== target || !M.isActive(b)) return false;
      var p = X.findPatient(patients, b.patientId);
      var mail = b.email || (p ? p.email : '');
      if (!mail) return false;
      if (p && p.mailOK === false) return false;
      return !X.alreadySent(messages, b.id, 'reminder');
    }).map(function (b) {
      return buildOutgoing(cfg, b, X.findPatient(patients, b.patientId), 'reminder');
    });
  };

  /** 本日ご来院済みの方へのお礼。完了になっていて、まだ送っていないもの。 */
  X.thanksTargets = function (cfg, bookings, patients, messages, baseKey) {
    var day = baseKey || M.todayKey();
    return bookings.filter(function (b) {
      if (b.date !== day || b.status !== 'done') return false;
      var p = X.findPatient(patients, b.patientId);
      var mail = b.email || (p ? p.email : '');
      if (!mail) return false;
      if (p && p.mailOK === false) return false;
      return !X.alreadySent(messages, b.id, 'thanks');
    }).map(function (b) {
      return buildOutgoing(cfg, b, X.findPatient(patients, b.patientId), 'thanks');
    });
  };

  /**
   * リコール（定期健診のご案内）の対象。
   * 最終来院から一定期間が過ぎ、この先の予約が入っていない方。
   * 期間は患者ごとの設定を優先し、無ければ最後に受けた処置の標準期間、それも無ければ医院の既定。
   */
  X.recallTargets = function (cfg, bookings, patients, messages, opts) {
    var today = M.todayKey();
    var options = opts || {};
    var out = [];

    patients.forEach(function (p) {
      if (!p.email || p.mailOK === false) return;
      if (X.nextBookingOf(bookings, p.id)) return;

      var last = p.lastVisit || X.lastVisitOf(bookings, p.id);
      if (!last) return;

      var months = Number(p.recallMonths) || purposeRecall(cfg, bookings, p.id) || cfg.reminder.recallMonths;
      var due = addMonths(last, months);
      if (due > today) return;
      if (options.until && due > options.until) return;

      // 直近90日で同じ案内を送っていれば見送る
      if (recentlySent(messages, p.id, 'recall', 90)) return;

      out.push(buildRecall(cfg, p, last, due, months));
    });

    return out.sort(function (a, b) { return a.due.localeCompare(b.due); });
  };

  function purposeRecall(cfg, bookings, patientId) {
    var visits = bookings.filter(function (b) {
      return b.patientId === patientId && (b.status === 'done' || b.status === 'checkout');
    }).sort(function (a, b) { return (b.date).localeCompare(a.date); });
    if (!visits.length) return 0;
    var p = M.purposeOf(cfg, visits[0].purpose);
    return p.recallMonths || 0;
  }

  function addMonths(dateKey, months) {
    var d = M.fromKey(dateKey);
    d.setMonth(d.getMonth() + months);
    return M.toKey(d);
  }
  X.addMonths = addMonths;

  function recentlySent(messages, patientId, kind, days) {
    var limit = new Date();
    limit.setDate(limit.getDate() - days);
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.patientId !== patientId || m.kind !== kind) continue;
      if (m.state !== 'sent' && m.state !== 'simulated') continue;
      if (new Date(m.at) >= limit) return true;
    }
    return false;
  }

  function buildOutgoing(cfg, booking, patient, kind) {
    var tpl = cfg.templates[kind];
    var rendered = X.renderTemplate(cfg, tpl, X.ctxOf(booking, patient));
    return {
      kind: kind,
      to: booking.email || (patient ? patient.email : ''),
      name: booking.name,
      patientId: booking.patientId,
      bookingId: booking.id,
      subject: rendered.subject,
      body: rendered.body,
      when: M.formatDateLong(booking.date) + ' ' + booking.time
    };
  }
  X.buildOutgoing = buildOutgoing;

  function buildRecall(cfg, patient, last, due, months) {
    var rendered = X.renderTemplate(cfg, cfg.templates.recall, {
      name: patient.name, cardNo: patient.cardNo, lastVisit: last
    });
    return {
      kind: 'recall',
      to: patient.email,
      name: patient.name,
      patientId: patient.id,
      bookingId: '',
      subject: rendered.subject,
      body: rendered.body,
      due: due,
      months: months,
      when: '前回 ' + M.formatDateLong(last) + '（' + months + 'か月経過）'
    };
  }

  /* ================= 一斉配信（DM） ================= */

  /** 条件に合う配信先を絞り込む */
  X.segment = function (cfg, patients, bookings, filter) {
    var f = filter || {};
    var today = M.todayKey();

    return patients.filter(function (p) {
      if (!p.email) return false;
      if (p.dmOK === false) return false;
      if (f.tag && (p.tags || []).indexOf(f.tag) === -1) return false;

      var last = p.lastVisit || X.lastVisitOf(bookings, p.id);
      if (f.visitedWithin) {
        if (!last) return false;
        if (last < M.shiftDays(today, -Number(f.visitedWithin))) return false;
      }
      if (f.notVisitedSince) {
        if (last && last >= M.shiftDays(today, -Number(f.notVisitedSince))) return false;
      }
      if (f.hasFutureBooking === 'yes' && !X.nextBookingOf(bookings, p.id)) return false;
      if (f.hasFutureBooking === 'no' && X.nextBookingOf(bookings, p.id)) return false;
      return true;
    });
  };

  X.buildDM = function (cfg, patient, tpl) {
    var rendered = X.renderTemplate(cfg, tpl, {
      name: patient.name, cardNo: patient.cardNo, lastVisit: patient.lastVisit
    });
    return {
      kind: 'dm', to: patient.email, name: patient.name,
      patientId: patient.id, bookingId: '',
      subject: rendered.subject, body: rendered.body, when: ''
    };
  };

  /* ================= キャンセル待ち ================= */

  X.newWaitlist = function (fields) {
    var w = {
      id: 'wl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      patientId: '', name: '', phone: '',
      wantFrom: M.todayKey(), wantTo: M.shiftDays(M.todayKey(), 30),
      prefer: 'any', purpose: 'maintenance', note: '',
      state: 'waiting', createdAt: new Date().toISOString()
    };
    Object.keys(fields || {}).forEach(function (k) { w[k] = fields[k]; });
    return w;
  };

  /** 空いた枠に繰り上げられる候補。希望期間・時間帯が合う人を古い順に返す。 */
  X.waitlistFor = function (waitlist, dateKey, time) {
    var hour = Number(String(time).split(':')[0]);
    var half = hour < 13 ? 'am' : 'pm';
    return waitlist.filter(function (w) {
      if (w.state !== 'waiting') return false;
      if (w.wantFrom && dateKey < w.wantFrom) return false;
      if (w.wantTo && dateKey > w.wantTo) return false;
      if (w.prefer !== 'any' && w.prefer !== half) return false;
      return true;
    }).sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
  };

  /* ================= 分析 ================= */

  /**
   * 期間の指標をまとめて出す。
   * キャンセル率の母数は「その日に予定されていた総数」＝有効＋キャンセル＋無断。
   */
  X.analyze = function (cfg, bookings, patients, fromKey, toKey) {
    var inRange = bookings.filter(function (b) {
      return b.date >= fromKey && b.date <= toKey;
    });

    var total = inRange.length;
    var canceled = 0, noshow = 0, done = 0;
    var byPurpose = {};
    var byStaff = {};
    var newPatients = {};

    inRange.forEach(function (b) {
      if (b.status === 'canceled') canceled++;
      else if (b.status === 'noshow') noshow++;
      else if (b.status === 'done') done++;

      if (M.isActive(b)) {
        byPurpose[b.purpose] = (byPurpose[b.purpose] || 0) + 1;
        if (b.staffId) byStaff[b.staffId] = (byStaff[b.staffId] || 0) + 1;
      }
    });

    patients.forEach(function (p) {
      if (p.firstVisit && p.firstVisit >= fromKey && p.firstVisit <= toKey) {
        newPatients[p.id] = true;
      }
    });

    // 日ごとの稼働率
    var daily = [];
    var key = fromKey;
    var guard = 0;
    while (key <= toKey && guard++ < 400) {
      if (!M.isClosed(cfg, key)) {
        var s = M.summarize(cfg, key, bookings);
        daily.push({ date: key, rate: s.rate, booked: s.booked, capacity: s.capacity });
      }
      key = M.shiftDays(key, 1);
    }

    var avgRate = daily.length
      ? Math.round(daily.reduce(function (a, d) { return a + d.rate; }, 0) / daily.length) : 0;

    return {
      from: fromKey, to: toKey,
      total: total,
      done: done,
      canceled: canceled,
      noshow: noshow,
      cancelRate: total ? Math.round((canceled / total) * 100) : 0,
      noshowRate: total ? Math.round((noshow / total) * 100) : 0,
      newPatients: Object.keys(newPatients).length,
      avgRate: avgRate,
      daily: daily,
      byPurpose: byPurpose,
      byStaff: byStaff,
      openDays: daily.length
    };
  };

  X.newMessageId = function () {
    return 'ms-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  };
})(window.DRB);

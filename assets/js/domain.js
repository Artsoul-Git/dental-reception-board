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

  /* ---- ご案内の送信回数（媒体別） ---- */

  /** 患者さんごとに、これまでお送りしたご案内の回数を媒体別に数える */
  X.dmCountIndex = function (messages) {
    var idx = {};
    messages.forEach(function (m) {
      if (m.kind !== 'recall' && m.kind !== 'dm') return;
      if (m.state !== 'sent' && m.state !== 'simulated') return;
      if (!m.patientId) return;
      var c = idx[m.patientId] || (idx[m.patientId] = { mail: 0, postcard: 0, total: 0 });
      var ch = m.channel || 'mail';
      if (c[ch] === undefined) c[ch] = 0;
      c[ch]++;
      c.total++;
    });
    return idx;
  };

  X.emptyDmCount = function () { return { mail: 0, postcard: 0, total: 0 }; };

  /** 「ハガキ：2回、メール：1回」のような表示用の文字列にする */
  X.dmCountLabel = function (count) {
    var c = count || X.emptyDmCount();
    var parts = [];
    window.DRB.DM_CHANNELS.forEach(function (ch) {
      parts.push(ch.label + '：' + (c[ch.key] || 0) + '回');
    });
    return parts.join('　');
  };

  /** 最終来院からの経過月数（小数を切り捨てた整数） */
  X.monthsSince = function (dateKey, baseKey) {
    if (!dateKey) return null;
    var a = M.fromKey(dateKey);
    var b = M.fromKey(baseKey || M.todayKey());
    var n = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) n--;
    return Math.max(0, n);
  };

  /** この患者さんの定期健診の間隔（月）。-1 はご案内しない */
  X.recallMonthsOf = function (cfg, bookings, patient) {
    var own = Number(patient.recallMonths);
    if (own === -1) return -1;
    if (own > 0) return own;
    return purposeRecall(cfg, bookings, patient.id) || cfg.reminder.recallMonths;
  };

  /* 定期健診のご案内は、最終来院から2か月以上空いた方を土台にする */
  X.RECALL_MIN_MONTHS = 2;

  /**
   * リコール（定期健診のご案内）の対象。
   * 最終来院から2か月以上空き、この先のご予約が入っていない方を並べる。
   * opts.minMonths を渡すと「Nか月以上空いている方」に絞り込む。
   * 期間は患者ごとの設定を優先し、無ければ最後に受けた処置の標準期間、それも無ければ医院の既定。
   */
  X.recallTargets = function (cfg, bookings, patients, messages, opts) {
    var today = M.todayKey();
    var options = opts || {};
    var floor = Math.max(X.RECALL_MIN_MONTHS, Number(options.minMonths) || 0);
    var counts = X.dmCountIndex(messages);
    var futureIdx = futureIndex(bookings, today);
    var out = [];

    patients.forEach(function (p) {
      if (futureIdx[p.id]) return;

      var last = p.lastVisit || X.lastVisitOf(bookings, p.id);
      if (!last) return;

      var elapsed = X.monthsSince(last, today);
      if (elapsed < floor) return;

      var months = X.recallMonthsOf(cfg, bookings, p);
      if (months === -1) return;

      var due = addMonths(last, months);
      if (options.until && due > options.until) return;

      // 直近90日で同じ案内をお出ししていれば見送る
      if (recentlySent(messages, p.id, 'recall', 90)) return;

      out.push(buildRecall(cfg, p, last, due, months, elapsed, counts[p.id]));
    });

    // 空いている期間が長い方から先に出す
    return out.sort(function (a, b) { return b.elapsed - a.elapsed || a.due.localeCompare(b.due); });
  };

  /** 患者IDごとに「この先のご予約があるか」を1度だけ作る（毎回の全走査を避ける） */
  function futureIndex(bookings, today) {
    var idx = {};
    bookings.forEach(function (b) {
      if (!b.patientId || !M.isActive(b) || b.date < today) return;
      idx[b.patientId] = true;
    });
    return idx;
  }
  X.futureIndex = futureIndex;

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

  function buildRecall(cfg, patient, last, due, months, elapsed, counts) {
    var rendered = X.renderTemplate(cfg, cfg.templates.recall, {
      name: patient.name, cardNo: patient.cardNo, lastVisit: last
    });
    return {
      kind: 'recall',
      channel: cfg.reminder.recallChannel || 'postcard',
      to: patient.email,
      name: patient.name,
      patientId: patient.id,
      bookingId: '',
      subject: rendered.subject,
      body: rendered.body,
      due: due,
      months: months,
      elapsed: elapsed,
      counts: counts || X.emptyDmCount(),
      when: '前回 ' + M.formatDateLong(last) + '（' + elapsed + 'か月経過）'
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
      prefer: 'any', purpose: 'maintenance', staffId: '', note: '',
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

  /**
   * お知らせタブのバッジ用に、送るべき件数だけを数える。
   * 文面を組み立てないので、患者さんが数千名いても軽い。
   */
  X.countNotify = function (cfg, bookings, patients, messages) {
    var today = M.todayKey();
    var tomorrow = M.shiftDays(today, 1);
    var byId = {};
    patients.forEach(function (p) { byId[p.id] = p; });

    var sent = {};
    var recallAt = {};
    messages.forEach(function (m) {
      if (m.state !== 'sent' && m.state !== 'simulated') return;
      if (m.bookingId) sent[m.bookingId + '|' + m.kind] = true;
      if (m.kind === 'recall' && m.patientId) {
        if (!recallAt[m.patientId] || m.at > recallAt[m.patientId]) recallAt[m.patientId] = m.at;
      }
    });

    var future = X.futureIndex(bookings, today);
    var n = 0;

    bookings.forEach(function (b) {
      if (!M.isActive(b)) return;
      var p = byId[b.patientId];
      var mail = b.email || (p ? p.email : '');
      if (!mail || (p && p.mailOK === false)) return;
      if (b.date === tomorrow && !sent[b.id + '|reminder']) n++;
      else if (b.date === today && b.status === 'done' && !sent[b.id + '|thanks']) n++;
    });

    var limit = new Date();
    limit.setDate(limit.getDate() - 90);

    patients.forEach(function (p) {
      if (future[p.id]) return;
      var last = p.lastVisit;
      if (!last) return;
      if (X.monthsSince(last, today) < X.RECALL_MIN_MONTHS) return;
      if (Number(p.recallMonths) === -1) return;
      if (recallAt[p.id] && new Date(recallAt[p.id]) >= limit) return;
      n++;
    });

    return n;
  };

  X.newMessageId = function () {
    return 'ms-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  };

  /* ================= キャンセルの扱い ================= */

  /** 枠を他の方へ振り替えられるだけの余裕があるか（既定は2時間前まで） */
  X.HANDOVER_HOURS = 2;

  X.hoursUntil = function (booking, now) {
    var at = M.fromKey(booking.date);
    var mins = M.toMinutes(booking.time);
    at.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    return (at.getTime() - (now || new Date()).getTime()) / 3600000;
  };

  /**
   * 取り消したあと、その枠を空きに戻してよいか。
   * 直前すぎて他の方へ振り替えられない場合は、枠に「キャンセル」として残す。
   */
  X.shouldHoldSlot = function (booking, now) {
    return X.hoursUntil(booking, now) < X.HANDOVER_HOURS;
  };

  /**
   * 取り消したご予約の代わりにご案内できる日時を探す。
   * その予約の afterHours 時間より後から、日付順に n 件。
   */
  X.rebookSuggestions = function (cfg, bookings, booking, n, afterHours) {
    var limit = Number(n) || 3;
    var gap = afterHours === undefined ? 3 : afterHours;
    var startMin = M.toMinutes(booking.time) + gap * 60;
    var out = [];
    var key = booking.date;
    var guard = 0;

    while (out.length < limit && guard++ < 60) {
      if (!M.isClosed(cfg, key)) {
        var opens = M.openingTimes(cfg, key, bookings, booking.purpose);
        for (var i = 0; i < opens.length && out.length < limit; i++) {
          // 初日は「その予約の◯時間後」より前を飛ばす
          if (key === booking.date && M.toMinutes(opens[i].time) < startMin) continue;
          out.push({ date: key, time: opens[i].time, unit: opens[i].unit });
        }
      }
      key = M.shiftDays(key, 1);
    }
    return out;
  };

  /** 再予約のご案内文。空き枠は確約でないことを必ず添える。 */
  X.rebookMailBody = function (cfg, booking, patient, suggestions) {
    var lines = [];
    lines.push((booking.name || (patient && patient.name) || '') + ' 様');
    lines.push('');
    lines.push(cfg.clinicName + 'です。');
    lines.push('お電話を差し上げましたが、おつなぎできませんでしたのでご連絡いたします。');
    lines.push('');
    lines.push('下記のご予約を取り消しといたしました。');
    lines.push('');
    lines.push('　日時　' + M.formatDateFull(booking.date) + ' ' + booking.time);
    lines.push('　内容　' + M.purposeOf(cfg, booking.purpose).label);
    lines.push('');

    if (suggestions && suggestions.length) {
      lines.push('あらためてのご予約について、下記のお日にちが空いております。');
      lines.push('');
      suggestions.forEach(function (s) {
        lines.push('　・' + M.formatDateFull(s.date) + ' ' + s.time + '〜');
      });
      lines.push('');
      lines.push('ご希望のお日にちを、お電話またはこのメールへのご返信でお知らせください。');
      lines.push('');
      lines.push('※ 上記はこのご案内をお出しした時点の空き状況です。');
      lines.push('　 お申し出のタイミングによっては、すでに埋まっている場合がございます。');
      lines.push('　 その際は近いお日にちをあらためてご案内いたしますので、ご容赦ください。');
    } else {
      lines.push('あらためてのご予約をご希望の際は、お電話にてご連絡ください。');
    }

    lines.push('');
    lines.push('──────────');
    lines.push(cfg.clinicName);
    lines.push('お電話　' + cfg.tel);
    lines.push('──────────');
    return lines.join('\n');
  };

  /* ================= タグ ================= */

  /** 台帳にあるタグを、使われている数の多い順に返す */
  X.allTags = function (patients) {
    var count = {};
    patients.forEach(function (p) {
      (p.tags || []).forEach(function (t) {
        var key = String(t).trim();
        if (key) count[key] = (count[key] || 0) + 1;
      });
    });
    return Object.keys(count).sort(function (a, b) {
      return count[b] - count[a] || a.localeCompare(b, 'ja');
    }).map(function (t) { return { name: t, n: count[t] }; });
  };

  /* ================= 直近の未処理のご予約 ================= */

  /**
   * その患者さんの「まだ終わっていないご予約」のうち、いちばん近いもの。
   * 台帳から直接なおせるようにするために使う。
   */
  X.nextOpenBooking = function (bookings, patientId) {
    var today = M.todayKey();
    var list = bookings.filter(function (b) {
      if (b.patientId !== patientId || !M.isActive(b)) return false;
      if (b.status === 'done') return false;
      return b.date >= today;
    }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    return list[0] || null;
  };
})(window.DRB);

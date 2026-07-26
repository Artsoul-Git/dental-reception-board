/* 受付予約ボード — デモ用サンプルデータ
 *
 * ここで作られる氏名・診察券番号・メールアドレスはすべて架空。
 * 実運用では seed を呼ばず、空の状態から使い始める。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var X = DRB.domain;

  var SURNAMES = ['青木', '大野', '笹本', '峯田', '古賀', '瀬戸', '天野', '真柴',
    '結城', '柳瀬', '一之瀬', '菅野', '桧山', '八木', '南雲', '芦田',
    '衣笠', '早瀬', '烏丸', '香月'];
  var GIVEN = ['悠真', '奈緒', '陽向', '倫太郎', '芽依', '康介', '真央',
    '知樹', '瑠衣', '宗一', '瀬奈', '拓海', '結衣', '和輝', '志乃', '隼人'];
  var KANA_S = ['あおき', 'おおの', 'ささもと', 'みねた', 'こが', 'せと', 'あまの', 'ましば',
    'ゆうき', 'やなせ', 'いちのせ', 'かんの', 'ひやま', 'やぎ', 'なぐも', 'あしだ',
    'きぬがさ', 'はやせ', 'からすま', 'かづき'];
  var KANA_G = ['ゆうま', 'なお', 'ひなた', 'りんたろう', 'めい', 'こうすけ', 'まお',
    'ともき', 'るい', 'そういち', 'せな', 'たくみ', 'ゆい', 'かずき', 'しの', 'はやと'];

  var TAGS = ['矯正中', 'インプラント', '定期メンテ', '要フォロー', '小児', '妊娠中'];
  var CANCEL_REASONS = ['ご都合により', '体調不良のため', 'お仕事の都合', 'ご家族の都合'];

  /** 同じ日付なら毎回同じデモになるよう、文字列から乱数の種を作る */
  function seededRandom(seedText) {
    var h = 2166136261;
    for (var i = 0; i < seedText.length; i++) {
      h ^= seedText.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 100000) / 100000;
    };
  }

  function pick(rnd, list) { return list[Math.floor(rnd() * list.length)]; }

  /* ---------- 患者台帳 ---------- */

  function buildPatients(cfg, count) {
    var rnd = seededRandom('patients');
    var patients = [];
    for (var i = 0; i < count; i++) {
      var si = Math.floor(rnd() * SURNAMES.length);
      var gi = Math.floor(rnd() * GIVEN.length);
      var cardNo = String(1001 + i);
      var tags = [];
      if (rnd() > 0.72) tags.push(pick(rnd, TAGS));
      if (rnd() > 0.9) tags.push(pick(rnd, TAGS));

      // 連絡先はデモ用。ドメインは受信できない example.jp を使う
      var hasMail = rnd() > 0.18;

      patients.push({
        id: 'pt-demo-' + cardNo,
        cardNo: cardNo,
        name: SURNAMES[si] + ' ' + GIVEN[gi],
        kana: KANA_S[si] + ' ' + KANA_G[gi],
        phone: '090-' + String(1000 + Math.floor(rnd() * 8999)) + '-' + String(1000 + Math.floor(rnd() * 8999)),
        email: hasMail ? 'sample' + cardNo + '@example.jp' : '',
        birth: (1955 + Math.floor(rnd() * 60)) + '-' +
               ('0' + (1 + Math.floor(rnd() * 12))).slice(-2) + '-' +
               ('0' + (1 + Math.floor(rnd() * 28))).slice(-2),
        sex: rnd() > 0.5 ? 'f' : 'm',
        address: '',
        firstVisit: '',
        lastVisit: '',
        recallMonths: rnd() > 0.8 ? 3 : 0,
        tags: tags,
        allergy: rnd() > 0.9 ? '金属アレルギーの申告あり' : '',
        medical: rnd() > 0.88 ? '降圧剤を服用中' : '',
        mailOK: hasMail && rnd() > 0.06,
        dmOK: hasMail && rnd() > 0.2,
        note: '',
        createdAt: new Date().toISOString()
      });
    }
    return patients;
  }

  /* ---------- 予約 ---------- */

  /**
   * 起点日から days 日分のサンプル予約を作る。
   * 過去日は完了・キャンセル・無断キャンセルが混ざり、未来日はすべて予約済みにする。
   * こうしておくと分析タブの数字が最初から意味を持つ。
   */
  DRB.buildSeed = function (cfg, startKey, days) {
    var today = M.todayKey();
    var patients = buildPatients(cfg, 60);

    /* 後ろの何人かは予約に登場させない。
       こうしておくと「しばらくお見えでない方」ができ、定期健診のご案内が意味を持つ。 */
    var ACTIVE = 44;
    var activePatients = patients.slice(0, ACTIVE);
    var bookings = [];
    var contacts = [];
    var messages = [];
    var lastVisitBy = {};
    var firstVisitBy = {};

    for (var d = 0; d < days; d++) {
      var key = M.shiftDays(startKey, d);
      if (M.isClosed(cfg, key)) continue;

      var rnd = seededRandom(key);
      var slots = M.slotsOf(cfg, key);
      var past = key < today;
      var density = 0.32 + rnd() * 0.42;
      var taken = {};

      cfg.units.forEach(function (unit) {
        var i = 0;
        while (i < slots.length) {
          if (rnd() > density) { i++; continue; }

          var purpose = pick(rnd, cfg.purposes);
          var span = purpose.span;
          while (span > 1 && (i + span > slots.length || slots[i + span - 1].band !== slots[i].band)) span--;
          if (span < 1) { i++; continue; }

          var conflict = false;
          for (var k = 0; k < span; k++) if (taken[(i + k) + ':' + unit.id]) conflict = true;
          if (conflict) { i++; continue; }

          var p = activePatients[Math.floor(rnd() * activePatients.length)];
          var status = decideStatus(rnd, key, today, slots[i].time);

          var booking = {
            id: 'seed-' + key + '-' + unit.id + '-' + i,
            date: key,
            time: slots[i].time,
            span: span,
            unit: unit.id,
            patientId: p.id,
            name: p.name,
            cardNo: p.cardNo,
            phone: p.phone,
            email: p.email,
            purpose: purpose.key,
            memo: '',
            status: status,
            staffId: pick(rnd, cfg.staff).id,
            source: rnd() > 0.6 ? 'phone' : 'reception',
            arrivedAt: '', doneAt: '',
            cancelReason: status === 'canceled' ? pick(rnd, CANCEL_REASONS) : '',
            canceledAt: status === 'canceled' ? key : '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          bookings.push(booking);

          if (status === 'done' || status === 'checkout') {
            if (!firstVisitBy[p.id] || key < firstVisitBy[p.id]) firstVisitBy[p.id] = key;
            if (!lastVisitBy[p.id] || key > lastVisitBy[p.id]) lastVisitBy[p.id] = key;
          }

          // 過去のキャンセルには、受付が受けた電話の記録を残しておく
          if (status === 'canceled' && rnd() > 0.45) {
            contacts.push(X.newContact(p.id, {
              id: 'ct-' + booking.id,
              at: key + 'T09:00:00.000Z',
              channel: 'phone', direction: 'in',
              staffId: '', bookingId: booking.id,
              subject: 'ご予約の取り消し',
              body: booking.cancelReason + 'とのことでご連絡をいただき、' +
                    M.formatDateLong(key) + ' ' + booking.time + ' のご予約を取り消しました。'
            }));
          }

          for (var j = 0; j < span; j++) taken[(i + j) + ':' + unit.id] = true;
          i += span + (rnd() > 0.6 ? 1 : 0);
        }
      });

      // 確保枠は当日ぶんだけ 1 件使った状態にして、用途が伝わるようにする
      if (key === today && cfg.holdColumn.enabled && slots.length > 6) {
        var hp = patients[7];
        bookings.push({
          id: 'seed-hold-' + key,
          date: key, time: slots[5].time, span: 2, unit: M.HOLD_UNIT,
          patientId: hp.id, name: hp.name, cardNo: hp.cardNo, phone: hp.phone, email: hp.email,
          purpose: 'urgent', memo: 'お電話で当日枠のご相談。左下の奥歯が痛むとのこと。',
          status: 'booked', staffId: cfg.staff[0].id, source: 'phone',
          arrivedAt: '', doneAt: '', cancelReason: '', canceledAt: '',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        contacts.push(X.newContact(hp.id, {
          id: 'ct-hold-' + key,
          at: key + 'T00:30:00.000Z',
          channel: 'phone', direction: 'in', bookingId: 'seed-hold-' + key,
          subject: '当日のご相談',
          body: '左下の奥歯が昨夜から痛むとのお電話。確保枠にお取りしました。'
        }));
      }
    }

    /* 来院の実績を患者台帳へ書き戻す */
    patients.forEach(function (p) {
      p.lastVisit = lastVisitBy[p.id] || '';
      p.firstVisit = firstVisitBy[p.id] || '';
    });

    /* リコール案内が出るよう、しばらく来ていない方を何人か作る */
    var stale = seededRandom('stale');
    patients.forEach(function (p) {
      if (p.lastVisit) return;
      var months = 7 + Math.floor(stale() * 11);
      p.lastVisit = X.addMonths(today, -months);
      p.firstVisit = X.addMonths(p.lastVisit, -(12 + Math.floor(stale() * 24)));
    });

    /* 送信ログのサンプル（過去に確定メールを送った記録） */
    var mrnd = seededRandom('messages');
    bookings.filter(function (b) {
      return b.date < today && b.email && mrnd() > 0.75;
    }).slice(0, 40).forEach(function (b) {
      var out = X.buildOutgoing(cfg, b, X.findPatient(patients, b.patientId), 'confirm');
      messages.push({
        id: 'ms-' + b.id,
        patientId: b.patientId, bookingId: b.id, kind: 'confirm',
        to: out.to, subject: out.subject, body: out.body,
        at: b.date + 'T01:00:00.000Z', state: 'simulated', error: ''
      });
    });

    /* キャンセル待ちのサンプル */
    var waitlist = [0, 1, 2].map(function (n) {
      var p = patients[20 + n * 3];
      return X.newWaitlist({
        id: 'wl-demo-' + n,
        patientId: p.id, name: p.name, phone: p.phone,
        wantFrom: today,
        wantTo: M.shiftDays(today, 14 + n * 7),
        prefer: n === 0 ? 'am' : n === 1 ? 'pm' : 'any',
        purpose: n === 2 ? 'perio' : 'maintenance',
        note: n === 0 ? '午前中をご希望。前日でも可とのこと。' : '',
        createdAt: new Date(Date.now() - n * 86400000).toISOString()
      });
    });

    return {
      bookings: bookings, patients: patients,
      contacts: contacts, messages: messages, waitlist: waitlist
    };
  };

  /**
   * その予約が今どうなっているか。
   * 過去＝ほぼ完了、たまにキャンセル・無断キャンセル。
   * 本日＝いまの時刻を境に、済んだものと待ちのものが混ざる。
   */
  function decideStatus(rnd, key, today, time) {
    if (key > today) return 'booked';

    if (key < today) {
      var r = rnd();
      if (r < 0.06) return 'canceled';
      if (r < 0.085) return 'noshow';
      return 'done';
    }

    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var slotMin = M.toMinutes(time);
    if (slotMin + 30 < nowMin) return rnd() < 0.05 ? 'noshow' : 'done';
    if (slotMin <= nowMin) return rnd() < 0.5 ? 'inChair' : 'checkout';
    if (slotMin - 30 < nowMin) return 'arrived';
    return 'booked';
  }
})(window.DRB);

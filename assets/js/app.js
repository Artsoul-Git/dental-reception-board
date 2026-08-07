/* 受付予約ボード — 本体 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var X = DRB.domain;
  var V = DRB.views;
  var C = DRB.crm;
  var D = DRB.dialogs;
  var $ = function (id) { return document.getElementById(id); };

  /* この日付のデモを組み立て済み、という印。日が変われば作り直す。 */
  var SEEDED_KEY = 'drb.seededOn.v3';
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  var state = {
    cfg: null,
    store: null,
    bookings: [], patients: [], contacts: [], messages: [], waitlist: [],
    dateKey: M.todayKey(),
    weekStartKey: null,
    monthKey: null,
    selectedMonthDay: null,
    counterMode: false,
    highlightIds: [],
    ptQuery: '',
    ptSelected: null,
    outbox: { rem: [], thx: [], recall: [], dm: [] },
    report: null
  };

  /* ================= 起動 ================= */

  function boot() {
    state.cfg = DRB.loadConfig();
    state.store = DRB.createStore(state.cfg);
    state.weekStartKey = startOfWeek(state.dateKey);
    state.monthKey = state.dateKey;

    wireTabs();
    wireDay();
    wireWeek();
    wireMonth();
    wirePatients();
    wireNotify();
    wireReport();
    wireSetup();

    $('clinicName').textContent = state.cfg.clinicName;
    $('dayInput').value = state.dateKey;
    $('hintHold').textContent = state.cfg.holdColumn.label;
    updateConnBadge();

    reload().then(function () {
      // デモサイトなので自由に触っていただき、日が変わったら基準の状態へ戻す
      if (localStorage.getItem(SEEDED_KEY) !== M.todayKey()) {
        return seedDemo().then(function () { state.wasReset = true; });
      }
      if (!state.bookings.length) return seedDemo();
    }).then(renderAll).then(function () {
      if (state.wasReset) {
        toast('本日ぶんのデモを、はじめの状態に戻しました。ご自由にお試しください。');
      }
    }).catch(reportError);
  }

  function reload() {
    return Promise.all(['bookings', 'patients', 'contacts', 'messages', 'waitlist']
      .map(function (box) { return state.store.list(box); }))
      .then(function (res) {
        state.bookings = res[0] || [];
        state.patients = res[1] || [];
        state.contacts = res[2] || [];
        state.messages = res[3] || [];
        state.waitlist = res[4] || [];
      });
  }

  /**
   * 見えている画面だけを描き直す。
   * 2年ぶんのご予約を持つと全画面の描き直しは重くなり、
   * 1件登録するたびに数秒待たされてしまうため。
   */
  function renderAll() {
    var tab = state.activeTab || 'day';
    if (tab === 'day') { renderDay(); renderWaitlist(); }
    else if (tab === 'week') renderWeek();
    else if (tab === 'month') renderMonth();
    else if (tab === 'patient') renderPatients();
    else if (tab === 'notify') renderNotify();
    else if (tab === 'report' && state.report) renderReport();
    updateNotifyBadge();
  }

  /** バッジの数だけは全画面で出すので、文面を組み立てない軽い数え方で求める */
  var badgeTimer = null;
  function updateNotifyBadge() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(function () {
      var n = X.countNotify(state.cfg, state.bookings, state.patients, state.messages);
      var badge = $('notifyBadge');
      badge.textContent = String(n);
      badge.hidden = n === 0;

      var dn = state.messages.filter(function (m) { return m.state === 'draft'; }).length;
      $('draftBadge').textContent = String(dn);
      $('draftBadge').hidden = dn === 0;
    }, 150);
  }

  function reportError(err) {
    console.error(err);
    toast('うまくいきませんでした：' + (err && err.message ? err.message : err));
  }

  /* ================= タブ ================= */

  var TABS = ['day', 'week', 'month', 'patient', 'notify', 'report', 'setup'];

  function wireTabs() {
    TABS.forEach(function (name) {
      $('tab-' + name).addEventListener('click', function () { showTab(name); });
    });
  }

  function showTab(name) {
    TABS.forEach(function (n) {
      var on = n === name;
      $('tab-' + n).classList.toggle('is-on', on);
      $('tab-' + n).setAttribute('aria-selected', String(on));
      $('panel-' + n).hidden = !on;
    });
    state.activeTab = name;

    if (name === 'setup') fillSetupForm();
    else if (name === 'notify') renderNotify();
    else if (name === 'week') renderWeek();
    else if (name === 'month') renderMonth();
    else if (name === 'patient') renderPatients();
    else if (name === 'day') { renderDay(); renderWaitlist(); }
    else if (name === 'report') {
      // 再来院率などは判定に期間が要るので、はじめは1年ぶんを出す
      if (!state.report) setReportRange(M.shiftDays(M.todayKey(), -364), M.todayKey());
      else renderReport();
    }
  }

  /* ================= 日別ボード ================= */

  function wireDay() {
    $('dayPrev').addEventListener('click', function () { goDate(M.shiftDays(state.dateKey, -1)); });
    $('dayNext').addEventListener('click', function () { goDate(M.shiftDays(state.dateKey, 1)); });
    $('dayToday').addEventListener('click', function () { goDate(M.todayKey()); });
    $('dayInput').addEventListener('change', function () { if (this.value) goDate(this.value); });

    $('btnCounter').addEventListener('click', function () {
      state.counterMode = !state.counterMode;
      this.setAttribute('aria-pressed', String(state.counterMode));
      $('counterNote').hidden = !state.counterMode;
      renderDay();
    });

    $('searchBox').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      state.highlightIds = q ? state.bookings.filter(function (b) {
        return b.date === state.dateKey &&
          ((b.name || '').toLowerCase().indexOf(q) !== -1 || (b.cardNo || '').indexOf(q) !== -1);
      }).map(function (b) { return b.id; }) : [];
      renderDay();
    });

    $('btnPrintDay').addEventListener('click', function () {
      D.printDaySheet(state.cfg, state.dateKey, state.bookings);
    });
    $('btnExport').addEventListener('click', exportCSV);
    $('btnWaitAdd').addEventListener('click', function () { addWaitlist(); });
  }

  function goDate(key) {
    state.dateKey = key;
    $('dayInput').value = key;
    state.weekStartKey = startOfWeek(key);
    renderDay();
    renderWeek();
  }

  function renderDay() {
    $('dayCaption').textContent = M.formatDateFull(state.dateKey);
    V.renderStats(state.cfg, state.dateKey, state.bookings);
    V.renderLegend(state.cfg);
    V.renderDay({
      cfg: state.cfg, bookings: state.bookings, dateKey: state.dateKey,
      counterMode: state.counterMode, highlightIds: state.highlightIds,
      onSlot: onSlot
    });
  }

  function onSlot(kind, payload) {
    if (state.counterMode) {
      toast('窓口モードの間は変更できません。右上の「窓口モード」を解除してください。');
      return;
    }
    if (kind === 'create') openCreate(state.dateKey, payload.time, payload.unit);
    else if (kind === 'advance') advanceStatus(payload.booking, payload.next);
    else openDetail(payload.booking);
  }

  /* ---- 進み具合 ---- */

  function advanceStatus(booking, next) {
    if (!next) return;
    var b = DRB.clone(booking);
    var now = new Date().toISOString();
    b.status = next;
    b.updatedAt = now;
    if (next === 'arrived' && !b.arrivedAt) b.arrivedAt = now;
    if (next === 'done' && !b.doneAt) b.doneAt = now;

    var chain = save(b);
    // 完了になった時点で、患者台帳の最終来院日を更新する
    if (next === 'done' || next === 'checkout') chain = chain.then(function () { return touchVisit(b); });
    chain.then(function () {
      toast(b.name + '様を「' + DRB.statusOf(next).label + '」にしました。');
    }).catch(reportError);
  }

  function touchVisit(booking) {
    var p = X.findPatient(state.patients, booking.patientId);
    if (!p) return Promise.resolve();
    var changed = false;
    if (!p.firstVisit || booking.date < p.firstVisit) { p.firstVisit = booking.date; changed = true; }
    if (!p.lastVisit || booking.date > p.lastVisit) { p.lastVisit = booking.date; changed = true; }
    if (!changed) return Promise.resolve();
    return state.store.save('patients', p).then(reload).then(renderAll);
  }

  /* ---- 登録・修正 ---- */

  function openCreate(dateKey, time, unit, prefill) {
    var grid = M.buildGrid(state.cfg, dateKey, state.bookings);
    var slotIndex = grid.index[time];
    if (slotIndex === undefined) { toast('その時間は診療時間外です。'); return; }

    D.openBooking({
      cfg: state.cfg, grid: grid, patients: state.patients,
      slotIndex: slotIndex, time: time, unit: unit, dateKey: dateKey,
      prefill: prefill
    }).then(function (res) {
      if (!res) return;
      return ensurePatient(res.booking).then(function (booking) {
        return save(booking).then(function () {
          toast(booking.name + '様のご予約を登録しました。');
          if (res.sendConfirm && booking.email) return sendOne(booking, 'confirm');
        });
      });
    }).catch(reportError);
  }

  /**
   * 台帳にいらっしゃらない方は、予約と同時にお作りする。
   * 受付が二度入力しなくて済むようにするための処理。
   */
  function ensurePatient(booking) {
    if (booking.patientId && X.findPatient(state.patients, booking.patientId)) {
      var known = X.findPatient(state.patients, booking.patientId);
      var dirty = false;
      ['phone', 'email'].forEach(function (k) {
        if (booking[k] && !known[k]) { known[k] = booking[k]; dirty = true; }
      });
      if (booking.cardNo && !known.cardNo) { known.cardNo = booking.cardNo; dirty = true; }
      if (!dirty) return Promise.resolve(booking);
      return state.store.save('patients', known).then(function () { return booking; });
    }

    var byCard = X.findByCard(state.patients, booking.cardNo);
    if (byCard) {
      booking.patientId = byCard.id;
      return Promise.resolve(booking);
    }

    var p = X.blankPatient();
    p.cardNo = booking.cardNo;
    p.name = booking.name;
    p.phone = booking.phone;
    p.email = booking.email;
    booking.patientId = p.id;
    return state.store.save('patients', p).then(function () { return booking; });
  }

  function openDetail(booking) {
    D.openDetail(state.cfg, booking, X.findPatient(state.patients, booking.patientId))
      .then(function (action) {
      if (action === 'print') { D.printTicket(state.cfg, booking); return; }
      if (action === 'edit') return openEdit(booking);
      if (action === 'cancel') return cancelBooking(booking, false);
      if (action === 'noshow') return cancelBooking(booking, true);
      if (action === 'patient') {
        showTab('patient');
        state.ptSelected = booking.patientId;
        renderPatients();
        return;
      }
      if (action && action.advance) return advanceStatus(booking, action.advance);
    }).catch(reportError);
  }

  function openEdit(booking) {
    var grid = M.buildGrid(state.cfg, booking.date, state.bookings);
    var slotIndex = grid.index[booking.time];
    return D.openBooking({
      cfg: state.cfg, grid: grid, patients: state.patients,
      slotIndex: slotIndex, time: booking.time, unit: booking.unit,
      dateKey: booking.date, booking: booking
    }).then(function (res) {
      if (!res) return;
      return save(res.booking).then(function () { toast('ご予約の内容を直しました。'); });
    });
  }

  /* ---- キャンセル ---- */

  /**
   * 取り消しの受け付け。
   * 途中でやめた場合はご予約を一切さわらない（元の状態のまま残す）。
   * 「キャンセル処理を実行」を押して初めて保存する。
   */
  function cancelBooking(booking, noshow) {
    var patient = X.findPatient(state.patients, booking.patientId);

    return D.openCancel(state.cfg, booking, patient, noshow).then(function (res) {
      if (!res) {
        toast('処理をやめました。ご予約はそのままです。');
        return;
      }

      var b = DRB.clone(booking);
      b.status = res.noshow ? 'noshow' : 'canceled';
      b.cancelReason = res.reason;
      b.canceledAt = new Date().toISOString();
      b.updatedAt = b.canceledAt;
      // 直前の取り消しは他の方へ回せないので、枠を空きに戻さず残す
      b.slotHeld = !!res.holdSlot;

      var chain = save(b);

      if (res.addContact && b.patientId) {
        chain = chain.then(function () { return logCancelContact(b, res); });
      }

      if (res.follow === 'mail') {
        chain = chain.then(function () { return sendRebookMail(b, patient); });
      } else if (res.follow === 'rebook') {
        chain = chain.then(function () { return openRebookFlow(b, patient); });
      }

      return chain.then(function () {
        toast(res.noshow
          ? '無断キャンセルとして処理しました。'
          : (b.slotHeld ? 'ご予約を取り消しました。枠は「キャンセル」として残しています。'
                        : 'ご予約を取り消しました。枠は空きに戻しました。'));
        if (!b.slotHeld) return offerWaitlist(b);
      });
    });
  }

  /** お電話をおかけした事実を応対記録に残す。手段と向きも合わせて記録する。 */
  function logCancelContact(b, res) {
    var called = res.follow === 'mail' || res.follow === 'rebook';
    var subject = res.noshow ? '無断キャンセルの応対' : 'ご予約の取り消し';
    var body = M.formatDateFull(b.date) + ' ' + b.time + ' のご予約について。' + res.reason;

    if (res.follow === 'mail') {
      body += '\nお電話を差し上げましたがおつなぎできず、取り消しのご連絡と再予約の候補をメールでお送りしました。';
    } else if (res.follow === 'rebook') {
      body += '\nお電話でご連絡がつき、振替のご予約を承りました。';
    }

    return state.store.save('contacts', X.newContact(b.patientId, {
      channel: called ? 'phone' : (res.noshow ? 'other' : 'phone'),
      direction: called ? 'out' : 'in',
      bookingId: b.id,
      subject: subject,
      body: body
    })).then(reload).then(renderAll);
  }

  /** 取り消しのご連絡メール。再予約の候補を3件添える。 */
  function sendRebookMail(b, patient) {
    var to = b.email || (patient ? patient.email : '');
    if (!to) {
      toast('メールアドレスのご登録がないため、メールは作れませんでした。お電話でのご連絡をお願いします。');
      return;
    }
    var suggestions = X.rebookSuggestions(state.cfg, state.bookings, b, 3, 3);
    var subject = '【' + state.cfg.clinicName + '】' +
      M.formatDateFull(b.date) + ' のご予約について';

    return D.openMail({
      title: b.name + ' 様への取り消しのご連絡',
      to: to, name: b.name,
      subject: subject,
      body: X.rebookMailBody(state.cfg, b, patient, suggestions),
      canSend: state.store.canSendMail
    }).then(function (edited) {
      if (!edited) return;
      return deliver([{
        kind: 'cancel', channel: 'mail', to: to, name: b.name,
        patientId: b.patientId, bookingId: b.id,
        subject: edited.subject, body: edited.body
      }]);
    });
  }

  /** 振替のご予約。月間の空きから選んでいただき、決まったらこの画面に結果を出す。 */
  function openRebookFlow(b, patient) {
    return D.openRebook({
      cfg: state.cfg,
      bookings: state.bookings,
      booking: b,
      patient: patient,
      onPick: function (dateKey, time, unit, purpose, staffId) {
        var grid = M.buildGrid(state.cfg, dateKey, state.bookings);
        var idx = grid.index[time];
        if (idx === undefined) return;

        var span = Math.max(1, M.purposeOf(state.cfg, purpose).span || 1);
        if (!M.canPlace(grid, idx, unit, span, null, state.cfg)) {
          toast('その時間はちょうど埋まってしまいました。他のお時間をお選びください。');
          return;
        }

        var now = new Date().toISOString();
        var fresh = {
          id: M.newId(), date: dateKey, time: time, unit: unit, span: span,
          patientId: b.patientId, name: b.name, cardNo: b.cardNo,
          phone: b.phone, email: b.email,
          purpose: purpose, memo: '（' + M.formatDateLong(b.date) + ' からの振替）',
          status: 'booked', staffId: staffId, source: 'phone',
          arrivedAt: '', doneAt: '', cancelReason: '', canceledAt: '',
          slotHeld: false, createdAt: now, updatedAt: now
        };

        save(fresh).then(function () {
          if (D.rebookShowResult) {
            D.rebookShowResult('振替のご予約をお取りしました　▶　' +
              M.formatDateFull(dateKey) + ' ' + time + '　' + M.columnLabel(state.cfg, unit));
          }
          if (D.rebookRedraw) D.rebookRedraw();
          toast('振替のご予約を登録しました。');
        }).catch(reportError);
      }
    });
  }

  /** 空いた枠に、キャンセル待ちの方を繰り上げられないか受付に尋ねる */
  function offerWaitlist(booking) {
    var candidates = X.waitlistFor(state.waitlist, booking.date, booking.time);
    if (!candidates.length) return;
    var top = candidates[0];
    return D.confirm('キャンセル待ちの繰り上げ',
      M.formatDateLong(booking.date) + ' ' + booking.time + ' が空きました。' +
      'キャンセル待ちの ' + top.name + ' 様（' + C.preferLabel(top.prefer) + '）に、この枠でご予約をお入れしますか。',
      'この枠に入れる'
    ).then(function (ok) {
      if (!ok) return;
      openCreate(booking.date, booking.time, booking.unit, {
        name: top.name, phone: top.phone, purpose: top.purpose, patientId: top.patientId
      });
      var w = DRB.clone(top);
      w.state = 'done';
      return state.store.save('waitlist', w).then(reload).then(renderAll);
    });
  }

  function save(booking) {
    return state.store.save('bookings', booking)
      .then(function () { return touch('bookings', booking); })
      .then(renderAll);
  }

  /**
   * 保存したものを手元の一覧にも反映する。
   * ブラウザ内保存では全件を読み直す必要がないため、差分だけ当てて速さを保つ。
   * スプレッドシート連携のときは、他の端末の変更も拾うため読み直す。
   */
  function touch(box, item) {
    if (state.store.canSendMail) return reload();
    var list = state[box];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === item.id) { list[i] = item; return Promise.resolve(); }
    }
    list.push(item);
    return Promise.resolve();
  }

  /* ================= 週間・月間 ================= */

  function wireWeek() {
    $('weekPrev').addEventListener('click', function () {
      state.weekStartKey = M.shiftDays(state.weekStartKey, -7); renderWeek();
    });
    $('weekNext').addEventListener('click', function () {
      state.weekStartKey = M.shiftDays(state.weekStartKey, 7); renderWeek();
    });
    $('weekToday').addEventListener('click', function () {
      state.weekStartKey = startOfWeek(M.todayKey()); renderWeek();
    });
  }

  function renderWeek() {
    V.renderWeek({
      cfg: state.cfg, bookings: state.bookings, weekStartKey: state.weekStartKey,
      onPickDate: function (key) { goDate(key); showTab('day'); }
    });
  }

  function startOfWeek(key) { return M.shiftDays(key, -M.fromKey(key).getDay()); }

  function wireMonth() {
    $('monthPrev').addEventListener('click', function () { shiftMonth(-1); });
    $('monthNext').addEventListener('click', function () { shiftMonth(1); });
    $('monthToday').addEventListener('click', function () {
      state.monthKey = M.todayKey(); renderMonth();
    });
    $('monthPurpose').addEventListener('change', renderMonth);
    $('monthStaff').addEventListener('change', renderMonth);
  }

  function shiftMonth(n) {
    var d = M.fromKey(state.monthKey);
    state.monthKey = M.toKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
    renderMonth();
  }

  function renderMonth() {
    var cfg = state.cfg;

    /* ご用件・担当のセレクタは、台帳から「予約を入れる」で来たときに意味を持つ */
    if (!$('monthPurpose').options.length) {
      D.fillSelect($('monthPurpose'), cfg.purposes, 'key', 'label', 'ご用件で絞らない');
      D.fillSelect($('monthStaff'), cfg.staff, 'id', 'name', '担当を決めない');
    }
    $('monthPurposeBar').hidden = false;

    var purposeKey = $('monthPurpose').value || '';
    var staffId = $('monthStaff').value || '';
    $('monthPurposeNote').textContent = state.prefillPatient
      ? state.prefillPatient.name + ' 様のご予約を入れます。ご用件と担当を選ぶと、その組み合わせで取れる日と時刻だけが残ります。'
      : 'ご用件と担当を選ぶと、その組み合わせで取れる開始時刻だけを表示します。担当を選ぶと、その先生がすでに入っている時間は外れます。';

    V.renderMonth({
      cfg: cfg, bookings: state.bookings, monthKey: state.monthKey,
      selectedKey: state.selectedMonthDay, purposeKey: purposeKey, staffId: staffId,
      minKey: M.todayKey(),
      onPickDay: function (key) { state.selectedMonthDay = key; renderMonth(); }
    });
    V.renderMonthDetail({
      cfg: cfg, bookings: state.bookings, dateKey: state.selectedMonthDay,
      purposeKey: purposeKey, staffId: staffId,
      onPickSlot: function (key, time, unit) {
        var pre = null;
        if (state.prefillPatient) {
          var p = state.prefillPatient;
          pre = {
            patientId: p.id, name: p.name, cardNo: p.cardNo,
            phone: p.phone, email: p.email, purpose: purposeKey || undefined,
            staffId: staffId
          };
        } else if (purposeKey || staffId) {
          pre = { purpose: purposeKey || undefined, staffId: staffId };
        }
        goDate(key); showTab('day'); openCreate(key, time, unit, pre);
        state.prefillPatient = null;
      }
    });
  }

  /* ================= 患者台帳 ================= */

  function wirePatients() {
    $('ptSearch').addEventListener('input', function () {
      state.ptQuery = this.value;
      renderPatients();
    });
    $('btnPtNew').addEventListener('click', function () {
      D.openPatient(state.cfg, null, state.patients).then(function (p) {
        if (!p) return;
        return state.store.save('patients', p).then(reload).then(function () {
          state.ptSelected = p.id;
          renderAll();
          toast(p.name + '様を登録しました。');
        });
      }).catch(reportError);
    });
  }

  function renderPatients() {
    C.renderPatientList({
      cfg: state.cfg, patients: state.patients, bookings: state.bookings,
      query: state.ptQuery, selectedId: state.ptSelected,
      onPick: function (id) { state.ptSelected = id; renderPatients(); }
    });

    C.renderPatientDetail({
      cfg: state.cfg,
      patient: X.findPatient(state.patients, state.ptSelected),
      bookings: state.bookings, contacts: state.contacts, messages: state.messages,
      onEdit: function (p) {
        D.openPatient(state.cfg, p, state.patients).then(function (out) {
          if (!out) return;
          return state.store.save('patients', out).then(reload).then(function () {
            renderAll(); toast('患者さんの情報を直しました。');
          });
        }).catch(reportError);
      },
      onWipeMedical: function (p) {
        D.confirm('診療に関する記載を消す',
          p.name + '様の台帳から、アレルギー・既往・服薬の記載を消します。' +
          'この欄は廃止したため、元に戻せません。よろしいですか。', '消す')
          .then(function (ok) {
            if (!ok) return;
            var out = DRB.clone(p);
            out.allergy = '';
            out.medical = '';
            return state.store.save('patients', out).then(reload).then(function () {
              renderAll();
              toast('記載を消しました。');
            });
          }).catch(reportError);
      },
      onEditNext: function (p, openNext) {
        if (!openNext) { toast('これから先の未処理のご予約がありません。'); return; }
        openDetail(openNext);
      },
      onContact: function (p) {
        D.openContact(state.cfg, p).then(function (c) {
          if (!c) return;
          return state.store.save('contacts', c).then(reload).then(function () {
            renderAll(); toast('応対を記録しました。');
          });
        }).catch(reportError);
      },
      onBook: function (p) {
        state.prefillPatient = p;
        state.selectedMonthDay = null;
        state.monthKey = M.todayKey();
        showTab('month');
        renderMonth();
        toast(p.name + '様のご用件をお選びいただくと、必要な枠を取れる日だけが残ります。');
      },
      onMail: function (p) {
        var tpl = state.cfg.templates.dm;
        var rendered = X.renderTemplate(state.cfg, tpl, {
          name: p.name, cardNo: p.cardNo, lastVisit: p.lastVisit
        });
        D.openMail({
          title: p.name + ' 様へのメール',
          to: p.email, name: p.name,
          subject: rendered.subject, body: rendered.body,
          canSend: state.store.canSendMail
        }).then(function (edited) {
          if (!edited) return;
          return deliver([{
            kind: 'dm', to: p.email, name: p.name, patientId: p.id, bookingId: '',
            subject: edited.subject, body: edited.body
          }]);
        }).catch(reportError);
      }
    });
  }

  /* ================= お知らせ・案内 ================= */

  var SUBS = ['queue', 'draft', 'recall', 'dm', 'tpl', 'log'];

  function wireNotify() {
    SUBS.forEach(function (n) {
      $('sub-' + n).addEventListener('click', function () {
        SUBS.forEach(function (m) {
          var on = m === n;
          $('sub-' + m).classList.toggle('is-on', on);
          $('sub-' + m).setAttribute('aria-selected', String(on));
          $('panel-' + m).hidden = !on;
        });
        if (n === 'tpl') C.renderTemplates(state.cfg);
        if (n === 'log') C.renderLog(state.cfg, state.messages, $('logSearch').value, state.patients);
      });
    });

    $('btnSendReminders').addEventListener('click', function () {
      deliver(C.checkedItems('remList', state.outbox.rem));
    });
    $('btnDraftReminders').addEventListener('click', function () {
      stash(C.checkedItems('remList', state.outbox.rem));
    });
    $('btnCheckAllRem').addEventListener('click', function () { C.toggleAll('remList'); });

    $('btnSendDrafts').addEventListener('click', function () {
      var picked = C.checkedItems('draftList', state.outbox.draft);
      if (!picked.length) { toast('お送りする下書きが選ばれていません。'); return; }
      // 下書きは送信し直すので、元の控えは取り除いてから送る
      dropDraftIds(picked.map(function (m) { return m.id; }))
        .then(function () { return deliver(picked); })
        .catch(reportError);
    });
    $('btnCheckAllDraft').addEventListener('click', function () { C.toggleAll('draftList'); });
    $('btnDropDrafts').addEventListener('click', function () {
      var picked = C.checkedItems('draftList', state.outbox.draft);
      if (!picked.length) { toast('捨てる下書きが選ばれていません。'); return; }
      D.confirm('下書きを捨てる', picked.length + ' 件の下書きを捨てます。よろしいですか。', '捨てる')
        .then(function (ok) {
          if (!ok) return;
          return dropDraftIds(picked.map(function (m) { return m.id; }));
        }).then(function () { toast('下書きを捨てました。'); }).catch(reportError);
    });

    $('recallElapsed').addEventListener('change', renderNotify);
    $('recallChannel').addEventListener('change', renderNotify);

    $('btnSendThanks').addEventListener('click', function () {
      deliver(C.checkedItems('thxList', state.outbox.thx));
    });
    $('btnCheckAllThx').addEventListener('click', function () { C.toggleAll('thxList'); });

    $('btnSendRecall').addEventListener('click', function () {
      deliver(C.checkedItems('recallList', state.outbox.recall));
    });
    $('btnDraftRecall').addEventListener('click', function () {
      stash(C.checkedItems('recallList', state.outbox.recall));
    });
    $('btnCheckAllRc').addEventListener('click', function () { C.toggleAll('recallList'); });
    $('btnRecallCSV').addEventListener('click', exportRecallCSV);

    $('btnDmCount').addEventListener('click', countDM);
    $('btnDmPreview').addEventListener('click', previewDM);
    $('btnDmSend').addEventListener('click', sendDM);

    $('btnTplSave').addEventListener('click', function () {
      state.cfg.templates = C.collectTemplates(state.cfg);
      DRB.saveConfig(state.cfg);
      renderNotify();
      toast('文面を保存しました。');
    });
    $('btnTplReset').addEventListener('click', function () {
      D.confirm('文面を戻す', 'すべての文面を既定の内容に戻します。よろしいですか。', '戻す')
        .then(function (ok) {
          if (!ok) return;
          state.cfg.templates = DRB.clone(DRB.defaultConfig.templates);
          DRB.saveConfig(state.cfg);
          C.renderTemplates(state.cfg);
          toast('文面を既定に戻しました。');
        });
    });

    $('logSearch').addEventListener('input', function () {
      // 台帳を渡さないとお名前で探せなくなるので、必ず一緒に渡す
      C.renderLog(state.cfg, state.messages, this.value, state.patients);
    });
    $('btnLogCSV').addEventListener('click', exportLogCSV);
  }

  function renderNotify() {
    var cfg = state.cfg;

    /* 経過期間の選択肢は1〜12か月。定期健診のご案内は2か月以上空いた方が土台。 */
    var elapsedSel = $('recallElapsed');
    if (elapsedSel.options.length <= 1) {
      for (var mo = 1; mo <= 12; mo++) {
        var o = V.el('option', null, mo + 'か月以上');
        o.value = String(mo);
        elapsedSel.appendChild(o);
      }
    }
    if (!$('recallChannel').options.length) {
      D.fillSelect($('recallChannel'), DRB.DM_CHANNELS, 'key', 'label');
      $('recallChannel').value = cfg.reminder.recallChannel || 'postcard';
    }

    state.outbox.rem = X.reminderTargets(cfg, state.bookings, state.patients, state.messages);
    state.outbox.thx = X.thanksTargets(cfg, state.bookings, state.patients, state.messages);
    state.outbox.recall = X.recallTargets(cfg, state.bookings, state.patients, state.messages, {
      minMonths: Number(elapsedSel.value) || 0
    });

    /*
     * お届けの手段ごとに、お出しできる方が変わる。同意は手段ごとに別々に持つ。
     * メール … アドレスがあり、ご連絡メールの受信を承諾されている方
     * ハガキ … ご住所があり、ハガキでのご案内を承諾されている方
     * どちらも、ここで絞らないと希望されていない方へお出ししてしまう。
     */
    var ch = $('recallChannel').value || 'postcard';
    state.outbox.recall = state.outbox.recall.filter(function (r) {
      var p = X.findPatient(state.patients, r.patientId);
      if (!p) return false;
      r.channel = ch;

      if (ch === 'mail') {
        if (!p.email || p.mailOK === false) return false;
        r.to = p.email;
      } else {
        if (p.postOK === false) return false;
        if (!p.address) return false;
        r.to = 'ハガキ（' + p.address + '）';
      }
      return true;
    });

    state.outbox.draft = state.messages.filter(function (m) { return m.state === 'draft'; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); })
      .map(function (m) {
        var p = X.findPatient(state.patients, m.patientId);
        return {
          id: m.id, kind: m.kind, channel: m.channel || 'mail', to: m.to,
          name: p ? p.name : '（台帳に登録のない方）',
          patientId: m.patientId, bookingId: m.bookingId,
          subject: m.subject, body: m.body,
          when: C.kindLabel(cfg, m.kind) + '　' + C.stampLabel(m.at) + ' に下書き'
        };
      });

    C.renderOutbox({
      hostId: 'remList', items: state.outbox.rem, onPreview: previewOne,
      emptyText: '明日ご予約の方で、これからお送りする方はいらっしゃいません。'
    });
    C.renderOutbox({
      hostId: 'thxList', items: state.outbox.thx, onPreview: previewOne,
      emptyText: '本日「完了」になった方で、これからお送りする方はいらっしゃいません。'
    });
    C.renderOutbox({
      hostId: 'recallList', items: state.outbox.recall, onPreview: previewOne,
      emptyText: 'この条件に当てはまる方はいらっしゃいません。'
    });
    C.renderOutbox({
      hostId: 'draftList', items: state.outbox.draft, onPreview: previewOne,
      emptyText: '下書きはありません。'
    });

    $('recallCount').textContent = state.outbox.recall.length
      ? state.outbox.recall.length + ' 名が対象です（' +
        (Number(elapsedSel.value) || X.RECALL_MIN_MONTHS) + 'か月以上お見えでない方）。'
      : '対象の方はいらっしゃいません。';

    /* ハガキはこの画面から送るものではないので、送信と下書きは使えないようにする。
       代わりに、宛名の印刷に使うCSVの書き出しへ誘導する。 */
    var sendable = DRB.channelOf(ch).sendable;
    var none = !state.outbox.recall.length;
    $('btnSendRecall').disabled = !sendable || none;
    $('btnDraftRecall').disabled = !sendable || none;
    $('btnRecallCSV').disabled = none;
    $('btnRecallCSV').className = 'btn' + (sendable ? '' : ' btn--primary');

    var note = $('recallChNote');
    note.hidden = sendable;
    if (!sendable) {
      note.textContent = 'ハガキでお出しする設定です。この画面からは送信できませんので、'
        + '「対象をCSVで書き出す」で宛名の一覧をお取りください。'
        + 'メールでお送りになる場合は、上の「お届けの手段」をメールに変えてください。';
    }

    var dn = state.outbox.draft.length;
    $('draftBadge').textContent = String(dn);
    $('draftBadge').hidden = dn === 0;

    var n = state.outbox.rem.length + state.outbox.thx.length + state.outbox.recall.length;
    var badge = $('notifyBadge');
    badge.textContent = String(n);
    badge.hidden = n === 0;

    $('mailModeNote').hidden = !!state.store.canSendMail;

    /* 一斉配信の初期値 */
    if (!$('dmSubject').value) $('dmSubject').value = cfg.templates.dm.subject;
    if (!$('dmBody').value) $('dmBody').value = cfg.templates.dm.body;
    $('dmTags').textContent = '使える差し込み記号：' +
      DRB.MERGE_TAGS.map(function (t) { return t.tag; }).join(' ');

    var tags = {};
    state.patients.forEach(function (p) { (p.tags || []).forEach(function (t) { tags[t] = true; }); });
    var sel = $('dmTag');
    var keep = sel.value;
    D.fillSelect(sel, Object.keys(tags).map(function (t) { return { k: t, l: t }; }), 'k', 'l', '絞らない');
    sel.value = keep;

    if (state.store.canSendMail) {
      state.store.mailQuota().then(function (q) {
        $('quotaNote').textContent = q && q.remaining !== null
          ? '本日あと ' + q.remaining + ' 通お送りいただけます。' : '';
      }).catch(function () { $('quotaNote').textContent = ''; });
    } else {
      $('quotaNote').textContent = 'デモのため実際には送信しません。';
    }

    C.renderLog(state.cfg, state.messages, $('logSearch').value, state.patients);
  }

  /** 選んだぶんを下書きとして溜めておく。送信はしない。 */
  function stash(items) {
    if (!items || !items.length) { toast('下書きに入れる相手が選ばれていません。'); return Promise.resolve(); }

    return items.reduce(function (chain, m) {
      return chain.then(function () {
        return state.store.save('messages', {
          id: X.newMessageId(),
          patientId: m.patientId || '', bookingId: m.bookingId || '',
          kind: m.kind, channel: m.channel || 'mail',
          to: m.to, subject: m.subject, body: m.body,
          at: new Date().toISOString(), state: 'draft', error: ''
        });
      });
    }, Promise.resolve()).then(reload).then(renderAll).then(function () {
      toast(items.length + ' 件を下書きに入れました。「下書き」タブからお送りいただけます。');
    }).catch(reportError);
  }

  /** 下書きの控えを取り除く（ブラウザ内保存のみ。連携時は状態を捨てた印にする） */
  function dropDraftIds(ids) {
    var keep = state.messages.filter(function (m) { return ids.indexOf(m.id) === -1; });
    if (state.store.canSendMail) {
      // まとめ置き換えができないので、1件ずつ「捨てた」印を付ける
      return ids.reduce(function (chain, id) {
        var m = state.messages.filter(function (x) { return x.id === id; })[0];
        if (!m) return chain;
        var dropped = DRB.clone(m);
        dropped.state = 'failed';
        dropped.error = '下書きを捨てました';
        return chain.then(function () { return state.store.save('messages', dropped); });
      }, Promise.resolve()).then(reload).then(renderAll);
    }
    return state.store.replace('messages', keep).then(reload).then(renderAll);
  }

  function previewOne(item) {
    D.openMail({
      title: item.name + ' 様への' + C.kindLabel(state.cfg, item.kind),
      to: item.to, name: item.name,
      subject: item.subject, body: item.body,
      canSend: state.store.canSendMail
    }).then(function (edited) {
      if (!edited) return;
      var one = DRB.clone(item);
      one.subject = edited.subject;
      one.body = edited.body;
      return deliver([one]);
    }).catch(reportError);
  }

  /**
   * まとめて送る。デモでは送らずに記録だけ残す。
   * どちらの場合も送信ログの見え方は同じにしておく。
   */
  function deliver(items) {
    if (!items || !items.length) { toast('お送りする相手が選ばれていません。'); return Promise.resolve(); }

    var stamped = items.map(function (m) {
      return {
        id: X.newMessageId(),
        patientId: m.patientId || '', bookingId: m.bookingId || '',
        kind: m.kind, channel: m.channel || 'mail',
        to: m.to, subject: m.subject, body: m.body,
        at: new Date().toISOString(), state: 'queued', error: ''
      };
    });

    /* ハガキはこの画面からは送れない。お出しした記録として残す。 */
    var mailable = stamped.filter(function (m) { return DRB.channelOf(m.channel).sendable; });
    var offline = stamped.filter(function (m) { return !DRB.channelOf(m.channel).sendable; });

    if (!mailable.length) {
      return offline.reduce(function (chain, m) {
        m.state = 'simulated';
        return chain.then(function () { return state.store.save('messages', m); });
      }, Promise.resolve()).then(reload).then(renderAll).then(function () {
        toast(offline.length + ' 件を「お出しした」として記録しました。' +
          '（' + DRB.channelOf(offline[0].channel).label + 'はこの画面からは送信しません）');
      });
    }

    return state.store.sendBulk(mailable).then(function (res) {
      var byId = {};
      (res.results || []).forEach(function (r) { byId[r.id] = r; });
      offline.forEach(function (m) { m.state = 'simulated'; });

      return stamped.reduce(function (chain, m) {
        var r = byId[m.id];
        if (m.state !== 'simulated') {
          m.state = r ? r.state : (state.store.canSendMail ? 'sent' : 'simulated');
          m.error = (r && r.error) || '';
        }
        return chain.then(function () { return state.store.save('messages', m); });
      }, Promise.resolve()).then(function () {
        var ok = stamped.filter(function (m) { return m.state === 'sent' || m.state === 'simulated'; }).length;
        var ng = stamped.length - ok;
        toast(state.store.canSendMail
          ? ok + ' 通お送りしました。' + (ng ? '（' + ng + ' 通は送れませんでした）' : '')
          : ok + ' 通ぶんを記録しました（デモのため未送信）。');
      });
    }).then(reload).then(renderAll);
  }

  /** 予約1件から、確定・取り消しなどのお知らせを1通だけ作って確認画面へ出す */
  function sendOne(booking, kind) {
    var p = X.findPatient(state.patients, booking.patientId);
    var item = X.buildOutgoing(state.cfg, booking, p, kind);
    if (!item.to) return Promise.resolve();
    if (p && p.mailOK === false) {
      toast(booking.name + '様はメールの受信を希望されていないため、お送りしません。');
      return Promise.resolve();
    }
    return D.openMail({
      title: booking.name + ' 様への' + C.kindLabel(state.cfg, kind),
      to: item.to, name: item.name,
      subject: item.subject, body: item.body,
      canSend: state.store.canSendMail
    }).then(function (edited) {
      if (!edited) return;
      item.subject = edited.subject;
      item.body = edited.body;
      return deliver([item]);
    });
  }

  /* ---- 一斉配信 ---- */

  function dmFilter() {
    return {
      tag: $('dmTag').value,
      visitedWithin: $('dmVisited').value,
      notVisitedSince: $('dmStale').value,
      hasFutureBooking: $('dmFuture').value
    };
  }

  function dmItems() {
    var tpl = { subject: $('dmSubject').value, body: $('dmBody').value };
    return X.segment(state.cfg, state.patients, state.bookings, dmFilter())
      .map(function (p) { return X.buildDM(state.cfg, p, tpl); });
  }

  function countDM() {
    state.outbox.dm = dmItems();
    $('dmCount').textContent = state.outbox.dm.length + ' 名が対象です。';
    C.renderOutbox({
      hostId: 'dmList', items: state.outbox.dm, onPreview: previewOne,
      emptyText: '条件に合う方がいらっしゃいません。'
    });
  }

  function previewDM() {
    var items = dmItems();
    if (!items.length) { toast('条件に合う方がいらっしゃいません。'); return; }
    previewOne(items[0]);
  }

  function sendDM() {
    var items = dmItems();
    if (!items.length) { toast('条件に合う方がいらっしゃいません。'); return; }
    D.confirm('一斉配信',
      items.length + ' 名にお送りします。お知らせの受信を希望されていない方は含まれていません。よろしいですか。',
      '送る'
    ).then(function (ok) { if (ok) return deliver(items); }).catch(reportError);
  }

  /* ================= 分析 ================= */

  function wireReport() {
    $('repFrom').addEventListener('change', renderReport);
    $('repTo').addEventListener('change', renderReport);
    $('repThisMonth').addEventListener('click', function () {
      var d = new Date();
      setReportRange(M.toKey(new Date(d.getFullYear(), d.getMonth(), 1)),
                     M.toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
    });
    $('repLast30').addEventListener('click', function () {
      setReportRange(M.shiftDays(M.todayKey(), -29), M.todayKey());
    });
    $('repLast90').addEventListener('click', function () {
      setReportRange(M.shiftDays(M.todayKey(), -89), M.todayKey());
    });
    $('repLast365').addEventListener('click', function () {
      setReportRange(M.shiftDays(M.todayKey(), -364), M.todayKey());
    });

    $('repWeekPrev').addEventListener('click', function () {
      state.repWeekKey = M.shiftDays(state.repWeekKey || startOfWeek(M.todayKey()), -7);
      renderReport();
    });
    $('repWeekNext').addEventListener('click', function () {
      state.repWeekKey = M.shiftDays(state.repWeekKey || startOfWeek(M.todayKey()), 7);
      renderReport();
    });
    $('repWeekThis').addEventListener('click', function () {
      state.repWeekKey = startOfWeek(M.todayKey());
      renderReport();
    });

    $('repMonthPrev').addEventListener('click', function () {
      state.repMonthKey = M.shiftMonth(state.repMonthKey || M.todayKey(), -1);
      renderReport();
    });
    $('repMonthNext').addEventListener('click', function () {
      state.repMonthKey = M.shiftMonth(state.repMonthKey || M.todayKey(), 1);
      renderReport();
    });
    $('repMonthThis').addEventListener('click', function () {
      state.repMonthKey = M.todayKey();
      renderReport();
    });

    $('cmpPrevMonth').addEventListener('change', renderReport);
    $('cmpPrevYear').addEventListener('change', renderReport);
  }

  function setReportRange(from, to) {
    $('repFrom').value = from;
    $('repTo').value = to;
    renderReport();
  }

  function renderReport() {
    var from = $('repFrom').value || M.shiftDays(M.todayKey(), -29);
    var to = $('repTo').value || M.todayKey();
    if (from > to) { toast('期間の始めと終わりが逆になっています。'); return; }

    if (!state.repWeekKey) state.repWeekKey = startOfWeek(M.todayKey());
    if (!state.repMonthKey) state.repMonthKey = M.todayKey();

    state.report = { from: from, to: to };
    DRB.analytics.render({
      cfg: state.cfg,
      bookings: state.bookings,
      patients: state.patients,
      messages: state.messages,
      contacts: state.contacts,
      from: from, to: to,
      weekStartKey: state.repWeekKey,
      monthKey: state.repMonthKey,
      compare: {
        prevMonth: $('cmpPrevMonth').checked,
        prevYear: $('cmpPrevYear').checked
      }
    });
  }

  /* ================= キャンセル待ち ================= */

  function renderWaitlist() {
    C.renderWaitlist({
      cfg: state.cfg, waitlist: state.waitlist,
      onRemove: function (w) {
        D.confirm('キャンセル待ちから外す', w.name + ' 様をキャンセル待ちから外します。', '外す')
          .then(function (ok) {
            if (!ok) return;
            return state.store.remove('waitlist', w.id).then(reload).then(renderAll);
          }).catch(reportError);
      }
    });
  }

  function addWaitlist(prefill) {
    D.openWaitlist(state.cfg, prefill).then(function (w) {
      if (!w) return;
      return state.store.save('waitlist', w).then(reload).then(function () {
        renderAll();
        toast(w.name + '様をキャンセル待ちに登録しました。');
      });
    }).catch(reportError);
  }

  /* ================= 設定・連携 ================= */

  function wireSetup() {
    $('setupForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      applySetup();
    });

    $('setReset').addEventListener('click', function () {
      D.confirm('設定を戻す', '医院の設定を既定値に戻します。ご予約・患者台帳のデータはそのまま残ります。', '戻す')
        .then(function (ok) {
          if (!ok) return;
          state.cfg = DRB.clone(DRB.defaultConfig);
          DRB.saveConfig(state.cfg);
          afterConfigChange();
          toast('設定を既定値に戻しました。');
        });
    });

    $('btnPurposeAdd').addEventListener('click', function () {
      collectPurposes();
      state.cfg.purposes.push({
        key: 'p' + Date.now().toString(36),
        label: '新しいご用件', color: '#6E757C',
        span: 2, recallMonths: 6, grade: 'B', profit: 0
      });
      fillPurposeEditor();
    });

    /* 概算利益の入れ方を変えると貢献度の付き方が変わるので、その場で描き直す */
    ['contribGrade', 'contribPerHour'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        collectPurposes();
        fillPurposeEditor();
      });
    });
    $('purposeEditor').addEventListener('change', function (ev) {
      if (ev.target.dataset.part === 'profit') {
        collectPurposes();
        fillPurposeEditor();
      }
    });

    $('btnStaffAdd').addEventListener('click', function () {
      state.cfg.staff.push({
        id: 'st' + Date.now().toString(36),
        name: '新しいスタッフ', role: 'hygienist', color: '#6E757C'
      });
      fillStaffEditor();
    });

    $('linkForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      state.cfg.storage = {
        mode: $('setUseSheet').checked ? 'sheet' : 'local',
        endpoint: $('setEndpoint').value.trim(),
        token: $('setToken').value.trim(),
        calendarId: $('setCalendar').value.trim()
      };
      DRB.saveConfig(state.cfg);
      state.store = DRB.createStore(state.cfg);
      updateConnBadge();
      reload().then(renderAll).then(function () { toast('接続先を保存しました。'); }).catch(reportError);
    });

    $('btnTestLink').addEventListener('click', function () {
      probe().call('ping').then(function (d) {
        linkStat('ok', 'つながりました。連携先のバージョン ' + d.version +
          '／シート ' + (d.sheets || []).join('・') +
          (d.quota !== undefined ? '／本日あと ' + d.quota + ' 通' : ''));
      }).catch(function (e) { linkStat('ng', 'つながりませんでした：' + e.message); });
    });

    $('btnPushTpl').addEventListener('click', function () {
      probe().call('saveTemplates', state.cfg.templates).then(function () {
        return probe().call('saveClinicMeta', {
          clinicName: state.cfg.clinicName, tel: state.cfg.tel,
          slotMinutes: state.cfg.slotMinutes, calendarId: state.cfg.storage.calendarId
        });
      }).then(function () {
        linkStat('ok', '文面と医院の情報を連携先へ送りました。毎朝の自動リマインドでもこの文面が使われます。');
      }).catch(function (e) { linkStat('ng', '送れませんでした：' + e.message); });
    });

    $('btnTrigger').addEventListener('click', function () {
      probe().call('installTrigger').then(function () {
        linkStat('ok', '毎朝の自動リマインドを有効にしました。翌日ご予約の方へ自動でお送りします。');
      }).catch(function (e) { linkStat('ng', '設定できませんでした：' + e.message); });
    });

    $('btnSyncCal').addEventListener('click', function () {
      var d = M.fromKey(state.monthKey || M.todayKey());
      var from = M.toKey(new Date(d.getFullYear(), d.getMonth(), 1));
      var to = M.toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      var ids = state.bookings.filter(function (b) {
        return b.date >= from && b.date <= to;
      }).map(function (b) { return b.id; });

      if (!ids.length) { linkStat('ng', 'この月のご予約がありません。'); return; }
      linkStat('', ids.length + ' 件をカレンダーへ書き出しています…');
      probe().call('syncCalendar', {
        bookingIds: ids,
        calendarId: state.cfg.storage.calendarId,
        clinicName: state.cfg.clinicName,
        slotMinutes: state.cfg.slotMinutes
      }).then(function (r) {
        linkStat('ok', 'カレンダーへ書き出しました。新規 ' + r.created +
          '件／更新 ' + r.updated + '件／削除 ' + r.deleted + '件');
      }).catch(function (e) { linkStat('ng', '書き出せませんでした：' + e.message); });
    });

    $('btnExport2').addEventListener('click', exportCSV);
    $('btnExportPt').addEventListener('click', exportPatientCSV);
    $('fileImport').addEventListener('change', importCSV);
    wireMigrate();
    $('btnReseed').addEventListener('click', function () {
      D.confirm('デモを初期状態に戻す',
        'いま入っているご予約・患者台帳・応対記録・送信ログをすべて消し、サンプルの状態に作り直します。よろしいですか。',
        '戻す')
        .then(function (ok) {
          if (!ok) return;
          return seedDemo().then(renderAll).then(function () {
            toast('デモを初期状態に戻しました。');
          });
        }).catch(reportError);
    });
  }

  /** 接続先が未保存でも、いま入力されている値で試せるようにする */
  function probe() {
    return DRB.createStore({
      storage: {
        mode: 'sheet',
        endpoint: $('setEndpoint').value.trim(),
        token: $('setToken').value.trim()
      }
    });
  }

  function linkStat(kind, text) {
    var el = $('linkStatus');
    el.className = 'linkstat field--wide' + (kind ? ' is-' + kind : '');
    el.textContent = text;
  }

  function fillSetupForm() {
    var cfg = state.cfg;
    $('setClinic').value = cfg.clinicName;
    $('setTel').value = cfg.tel;
    $('setSlot').value = String(cfg.slotMinutes);
    $('setUnits').value = String(cfg.units.length);
    $('setRecall').value = String(cfg.reminder.recallMonths);

    D.fillSelect($('setRecallCh'), DRB.DM_CHANNELS, 'key', 'label');
    $('setRecallCh').value = cfg.reminder.recallChannel || 'postcard';

    [['setBufBefore', cfg.buffer.before], ['setBufAfter', cfg.buffer.after]].forEach(function (r) {
      var sel = $(r[0]);
      V.clear(sel);
      DRB.BUFFER_OPTIONS.forEach(function (m) {
        var o = V.el('option', null, m === 0 ? '空けない' : m + '分');
        o.value = String(m);
        sel.appendChild(o);
      });
      // 任意の分数を入れてあれば、その値も選べるようにしておく
      if (DRB.BUFFER_OPTIONS.indexOf(Number(r[1])) === -1) {
        var extra = V.el('option', null, r[1] + '分');
        extra.value = String(r[1]);
        sel.appendChild(extra);
      }
      sel.value = String(r[1] || 0);
    });

    $('setHold').checked = cfg.holdColumn.enabled;
    $('setAutoConfirm').checked = cfg.reminder.autoConfirm;
    $('setEndpoint').value = cfg.storage.endpoint || '';
    $('setToken').value = cfg.storage.token || '';
    $('setCalendar').value = cfg.storage.calendarId || '';
    $('setUseSheet').checked = cfg.storage.mode === 'sheet';

    var host = $('hoursEditor');
    V.clear(host);
    for (var d = 0; d < 7; d++) {
      var label = V.el('label');
      label.appendChild(V.el('span', null, WD[d] + '曜'));
      var input = document.createElement('input');
      input.type = 'text';
      input.dataset.day = String(d);
      input.placeholder = '休診';
      input.value = (cfg.hours[d] || []).map(function (b) { return b[0] + '-' + b[1]; }).join(', ');
      label.appendChild(input);
      host.appendChild(label);
    }

    fillStaffEditor();
    fillPurposeEditor();
  }

  function fillStaffEditor() {
    var host = $('staffEditor');
    V.clear(host);
    state.cfg.staff.forEach(function (s, i) {
      var row = V.el('div', 'staffrow');

      var name = document.createElement('input');
      name.type = 'text'; name.value = s.name; name.dataset.staff = String(i); name.dataset.part = 'name';
      name.setAttribute('aria-label', 'スタッフのお名前');
      row.appendChild(name);

      var role = document.createElement('select');
      role.dataset.staff = String(i); role.dataset.part = 'role';
      role.setAttribute('aria-label', '役割');
      [['doctor', '歯科医師'], ['hygienist', '歯科衛生士'], ['reception', '受付']].forEach(function (r) {
        var o = V.el('option', null, r[1]); o.value = r[0]; role.appendChild(o);
      });
      role.value = s.role;
      row.appendChild(role);

      var color = document.createElement('input');
      color.type = 'color'; color.value = s.color;
      color.dataset.staff = String(i); color.dataset.part = 'color';
      color.setAttribute('aria-label', '色');
      row.appendChild(color);

      var del = V.el('button', 'btn btn--danger', '外す');
      del.type = 'button';
      del.addEventListener('click', function () {
        state.cfg.staff.splice(i, 1);
        fillStaffEditor();
      });
      row.appendChild(del);

      host.appendChild(row);
    });
  }

  /* ---- ご用件の設定 ---- */

  function fillPurposeEditor() {
    var host = $('purposeEditor');
    V.clear(host);
    var cfg = state.cfg;
    var grades = DRB.gradeMap(cfg);
    var auto = cfg.contribution.mode === 'perHour';

    var head = V.el('div', 'purposehead');
    ['ご用件', '色', 'お取りする枠', '定期健診', '貢献度', '概算利益（円）', ''].forEach(function (h) {
      head.appendChild(V.el('span', null, h));
    });
    host.appendChild(head);

    cfg.purposes.forEach(function (p, i) {
      var row = V.el('div', 'purposerow');

      var name = document.createElement('input');
      name.type = 'text'; name.value = p.label;
      name.dataset.purpose = String(i); name.dataset.part = 'label';
      name.setAttribute('aria-label', 'ご用件の名前');
      row.appendChild(name);

      var color = document.createElement('input');
      color.type = 'color'; color.value = p.color;
      color.dataset.purpose = String(i); color.dataset.part = 'color';
      color.setAttribute('aria-label', '色');
      row.appendChild(color);

      var span = document.createElement('select');
      span.dataset.purpose = String(i); span.dataset.part = 'span';
      span.setAttribute('aria-label', 'お取りする枠');
      for (var n = 1; n <= 8; n++) {
        var o = V.el('option', null, n + '枠（' + (n * cfg.slotMinutes) + '分）');
        o.value = String(n);
        span.appendChild(o);
      }
      span.value = String(p.span || 1);
      row.appendChild(span);

      var recall = document.createElement('select');
      recall.dataset.purpose = String(i); recall.dataset.part = 'recallMonths';
      recall.setAttribute('aria-label', '定期健診の標準期間');
      [1, 2, 3, 4, 6, 12].forEach(function (m) {
        var o = V.el('option', null, m + 'か月');
        o.value = String(m);
        recall.appendChild(o);
      });
      recall.value = String(p.recallMonths || 6);
      row.appendChild(recall);

      var grade = document.createElement('select');
      grade.dataset.purpose = String(i); grade.dataset.part = 'grade';
      grade.setAttribute('aria-label', '収益への貢献度');
      DRB.GRADES.forEach(function (g) {
        var o = V.el('option', null, g.key);
        o.value = g.key;
        grade.appendChild(o);
      });
      grade.value = p.grade || 'B';
      grade.disabled = auto && Number(p.profit) > 0;
      grade.title = grade.disabled ? '概算利益から自動で決めています。' : '';
      row.appendChild(grade);

      var profit = document.createElement('input');
      profit.type = 'number'; profit.min = '0'; profit.step = '100';
      profit.value = Number(p.profit) ? String(p.profit) : '';
      profit.placeholder = '任意';
      profit.dataset.purpose = String(i); profit.dataset.part = 'profit';
      profit.setAttribute('aria-label', '1件あたりの概算利益');
      row.appendChild(profit);

      var tail = V.el('div');
      if (auto && Number(p.profit) > 0) {
        tail.appendChild(V.el('span', 'perhour',
          '時間あたり ' + DRB.perHourOf(cfg, p).toLocaleString('ja-JP') + '円 → ' + grades[p.key]));
      }
      var del = V.el('button', 'btn btn--danger', '削除');
      del.type = 'button';
      del.addEventListener('click', function () { removePurpose(i); });
      tail.appendChild(del);
      row.appendChild(tail);

      host.appendChild(row);
    });

    $('slotMinNote').textContent = String(cfg.slotMinutes);
    $('contribGrade').checked = !auto;
    $('contribPerHour').checked = auto;
  }

  /** 使われているご用件は消せない。過去の記録の表示が崩れるため。 */
  function removePurpose(i) {
    var cfg = state.cfg;
    if (cfg.purposes.length <= 1) { toast('ご用件は少なくとも1つ必要です。'); return; }
    var target = cfg.purposes[i];
    var used = state.bookings.filter(function (b) { return b.purpose === target.key; }).length;

    var ask = used
      ? 'この「' + target.label + '」はご予約 ' + used + ' 件で使われています。削除すると、その記録のご用件が「ご用件未設定」と表示されるようになります。よろしいですか。'
      : '「' + target.label + '」を削除します。よろしいですか。';

    D.confirm('ご用件の削除', ask, '削除する').then(function (ok) {
      if (!ok) return;
      cfg.purposes.splice(i, 1);
      DRB.saveConfig(cfg);
      fillPurposeEditor();
      renderAll();
      toast('ご用件を削除しました。');
    });
  }

  function collectPurposes() {
    var cfg = state.cfg;
    Array.prototype.forEach.call(
      $('purposeEditor').querySelectorAll('[data-purpose]'),
      function (input) {
        var p = cfg.purposes[Number(input.dataset.purpose)];
        if (!p) return;
        var part = input.dataset.part;
        if (part === 'span' || part === 'recallMonths' || part === 'profit') {
          p[part] = Number(input.value) || (part === 'profit' ? 0 : 1);
        } else {
          p[part] = input.value;
        }
      }
    );
    cfg.contribution.mode = $('contribPerHour').checked ? 'perHour' : 'grade';
  }

  function applySetup() {
    var cfg = state.cfg;
    cfg.clinicName = $('setClinic').value.trim() || DRB.defaultConfig.clinicName;
    cfg.tel = $('setTel').value.trim();
    cfg.slotMinutes = Number($('setSlot').value);
    cfg.holdColumn.enabled = $('setHold').checked;
    cfg.reminder.recallMonths = Number($('setRecall').value);
    cfg.reminder.recallChannel = $('setRecallCh').value;
    cfg.reminder.autoConfirm = $('setAutoConfirm').checked;
    cfg.buffer.before = Number($('setBufBefore').value) || 0;
    cfg.buffer.after = Number($('setBufAfter').value) || 0;
    collectPurposes();

    var want = Number($('setUnits').value);
    var units = [];
    for (var i = 1; i <= want; i++) {
      var prev = cfg.units.filter(function (u) { return u.id === i; })[0];
      units.push({ id: i, label: prev ? prev.label : 'チェア' + i });
    }
    cfg.units = units;

    Array.prototype.forEach.call($('staffEditor').querySelectorAll('[data-staff]'), function (input) {
      var s = cfg.staff[Number(input.dataset.staff)];
      if (s) s[input.dataset.part] = input.value;
    });

    var hours = {};
    var bad = null;
    Array.prototype.forEach.call($('hoursEditor').querySelectorAll('input'), function (input) {
      var day = Number(input.dataset.day);
      var text = input.value.trim();
      if (!text) { hours[day] = null; return; }
      var bands = [];
      text.split(',').forEach(function (part) {
        var m = part.trim().match(/^(\d{1,2}:\d{2})\s*[-–〜~]\s*(\d{1,2}:\d{2})$/);
        if (!m) { bad = WD[day] + '曜の「' + part.trim() + '」'; return; }
        bands.push([pad(m[1]), pad(m[2])]);
      });
      hours[day] = bands.length ? bands : null;
    });

    if (bad) { toast('診療時間を読み取れませんでした：' + bad); return; }
    cfg.hours = hours;

    DRB.saveConfig(cfg);
    afterConfigChange();
    toast('設定を保存しました。');
  }

  function pad(hhmm) {
    var p = hhmm.split(':');
    return ('0' + p[0]).slice(-2) + ':' + p[1];
  }

  function afterConfigChange() {
    $('clinicName').textContent = state.cfg.clinicName;
    $('hintHold').textContent = state.cfg.holdColumn.label;
    state.store = DRB.createStore(state.cfg);
    updateConnBadge();
    fillSetupForm();
    renderAll();
  }

  function updateConnBadge() {
    var sheet = state.cfg.storage.mode === 'sheet' && state.cfg.storage.endpoint;
    var badge = $('connBadge');
    badge.textContent = sheet ? 'スプレッドシート連携' : 'ブラウザ内保存';
    badge.classList.toggle('is-sheet', !!sheet);
  }

  /* ================= データ移行（CSVの取り込み） =================
   * 受付の方がご自分で取り込めることが契約上のお約束のため、
   * 取り込みの中身は migrate.js に置き、ここでは入口の配線だけを行う。
   */

  function migrateCtx() {
    return {
      cfg: state.cfg,
      patients: state.patients,
      bookings: state.bookings,
      store: state.store,
      refresh: function () { return reload().then(renderAll); }
    };
  }

  function refreshUndoButton() {
    $('btnMigUndo').hidden = !DRB.migrate.canUndo();
  }

  function wireMigrate() {
    var Mig = DRB.migrate;
    Mig.wire();

    $('fileMigPatient').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (f) Mig.open('patient', f, migrateCtx(), refreshUndoButton);
    });
    $('fileMigBooking').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (f) Mig.open('booking', f, migrateCtx(), refreshUndoButton);
    });

    $('btnTplPatient').addEventListener('click', function () { Mig.saveTemplate('patient', false); });
    $('btnTplPatientEx').addEventListener('click', function () { Mig.saveTemplate('patient', true); });
    $('btnTplBooking').addEventListener('click', function () { Mig.saveTemplate('booking', false); });
    $('btnTplBookingEx').addEventListener('click', function () { Mig.saveTemplate('booking', true); });

    $('btnMigUndo').addEventListener('click', function () {
      D.confirm('直前の取り込みを元に戻す',
        '直前に取り込んだぶんを取り消し、取り込む前の状態に戻します。よろしいですか。', '元に戻す')
        .then(function (ok) {
          if (!ok) return;
          return Mig.undo(migrateCtx())
            .then(function (label) { return reload().then(renderAll).then(function () {
              refreshUndoButton();
              toast(label + 'を取り込む前に戻しました。');
            }); });
        }).catch(reportError);
    });

    refreshUndoButton();
  }

  /* ================= CSV ================= */

  function download(name, text) {
    // Excel がそのまま開けるよう BOM を付ける
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvLine(cells) {
    return cells.map(function (v) {
      return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    }).join(',');
  }

  function exportCSV() {
    download('予約一覧_' + state.dateKey + '.csv', M.toCSV(state.cfg, state.bookings));
    toast('ご予約をCSVで書き出しました。');
  }

  function exportPatientCSV() {
    var head = ['患者ID', '診察券番号', 'お名前', 'ふりがな', 'お電話', 'メール', '生年月日',
      '初診', '最終来院', '定期健診の間隔', 'タグ',
      'ご連絡メール', 'お知らせメール', 'ハガキ', 'メモ'];
    var lines = [csvLine(head)];
    state.patients.forEach(function (p) {
      lines.push(csvLine([p.id, p.cardNo, p.name, p.kana, p.phone, p.email, p.birth,
        p.firstVisit, p.lastVisit, p.recallMonths || '', (p.tags || []).join(' '),
        p.mailOK === false ? '希望されない' : '受け取る',
        p.dmOK === false ? '希望されない' : '受け取る',
        p.postOK === false ? '希望されない' : '受け取る',
        p.note]));
    });
    download('患者台帳_' + M.todayKey() + '.csv', lines.join('\r\n'));
    toast('患者台帳をCSVで書き出しました。');
  }

  /** ハガキの宛名づくりにそのまま使えるよう、診察券番号・ご住所まで入れる */
  function exportRecallCSV() {
    var head = ['診察券番号', 'お名前', 'ふりがな', 'ご住所', 'お電話', 'メール',
      '前回のご来院', '経過（か月）', 'ご案内の時期', '案内間隔（か月）',
      'ハガキ送付回数', 'メール送付回数'];
    var lines = [csvLine(head)];
    state.outbox.recall.forEach(function (r) {
      var p = X.findPatient(state.patients, r.patientId) || {};
      var c = r.counts || X.emptyDmCount();
      lines.push(csvLine([p.cardNo, r.name, p.kana, p.address, p.phone, p.email,
        p.lastVisit, r.elapsed, r.due, r.months, c.postcard || 0, c.mail || 0]));
    });
    download('定期健診のご案内_' + M.todayKey() + '.csv', lines.join('\r\n'));
    toast(state.outbox.recall.length + ' 名ぶんをCSVで書き出しました。');
  }

  function exportLogCSV() {
    var head = ['日時', '種類', '手段', 'お名前', '宛先', '件名', '状態', 'エラー'];
    var lines = [csvLine(head)];
    state.messages.slice().sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at));
    }).forEach(function (m) {
      var p = X.findPatient(state.patients, m.patientId);
      lines.push(csvLine([m.at, C.kindLabel(state.cfg, m.kind),
        DRB.channelOf(m.channel).label, p ? p.name : '', m.to, m.subject,
        C.stateLabel(m.state), m.error]));
    });
    download('送信ログ_' + M.todayKey() + '.csv', lines.join('\r\n'));
    toast('送信ログをCSVで書き出しました。');
  }

  function importCSV(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result).replace(/^﻿/, '');
      var rows;
      try { rows = M.fromCSV(state.cfg, text); } catch (e) { reportError(e); return; }
      if (!rows.length) { toast('読み取れる行がありませんでした。'); return; }

      D.confirm('CSVの取り込み',
        rows.length + ' 件を取り込みます。いま入っているご予約はすべて置き換わります。よろしいですか。', '取り込む')
        .then(function (ok) {
          if (!ok) return;
          return state.store.replace('bookings', rows).then(reload).then(function () {
            renderAll();
            toast(rows.length + ' 件を取り込みました。');
          });
        }).catch(reportError);
    };
    reader.readAsText(file, 'UTF-8');
  }

  /* ================= デモデータ ================= */

  /* 管理者が決めた期間（DEMO_RANGE）ぶんを作り直す。ここがデモの基準値になる。 */
  function seedDemo() {
    var range = DRB.DEMO_RANGE;
    var days = Math.round(
      (M.fromKey(range.to) - M.fromKey(range.from)) / 86400000
    ) + 1;
    var data = DRB.buildSeed(state.cfg, range.from, days);
    return state.store.replace('bookings', data.bookings)
      .then(function () { return state.store.replace('patients', data.patients); })
      .then(function () { return replaceLocal('contacts', data.contacts); })
      .then(function () { return replaceLocal('messages', data.messages); })
      .then(function () { return replaceLocal('waitlist', data.waitlist); })
      .then(function () { localStorage.setItem(SEEDED_KEY, M.todayKey()); })
      .then(reload);
  }

  /** まとめ置き換えに対応していない箱は、1件ずつ入れる */
  function replaceLocal(box, items) {
    if (DRB.BOXES[box].replace || !state.store.canSendMail) {
      return state.store.replace(box, items).catch(function () {
        return items.reduce(function (chain, it) {
          return chain.then(function () { return state.store.save(box, it); });
        }, Promise.resolve());
      });
    }
    return items.reduce(function (chain, it) {
      return chain.then(function () { return state.store.save(box, it); });
    }, Promise.resolve());
  }

  /* ================= トースト ================= */

  var toastTimer = null;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.DRB);

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

  var SEEDED_KEY = 'drb.seeded.v2';
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
      if (!localStorage.getItem(SEEDED_KEY) && !state.bookings.length) return seedDemo();
    }).then(renderAll).catch(reportError);
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

  function renderAll() {
    renderDay();
    renderWeek();
    renderMonth();
    renderPatients();
    renderNotify();
    renderWaitlist();
    if (state.report) renderReport();
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
    if (name === 'setup') fillSetupForm();
    if (name === 'notify') renderNotify();
    if (name === 'report' && !state.report) setReportRange(M.shiftDays(M.todayKey(), -29), M.todayKey());
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
    D.openDetail(state.cfg, booking).then(function (action) {
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

  function cancelBooking(booking, noshow) {
    return D.openCancel(state.cfg, booking, noshow).then(function (res) {
      if (!res) return;

      var b = DRB.clone(booking);
      b.status = res.noshow ? 'noshow' : 'canceled';
      b.cancelReason = res.reason;
      b.canceledAt = new Date().toISOString();
      b.updatedAt = b.canceledAt;

      var chain = save(b);

      if (res.addContact && b.patientId) {
        chain = chain.then(function () {
          return state.store.save('contacts', X.newContact(b.patientId, {
            channel: res.noshow ? 'other' : 'phone',
            direction: res.noshow ? 'out' : 'in',
            bookingId: b.id,
            subject: res.noshow ? '無断キャンセル' : 'ご予約の取り消し',
            body: M.formatDateFull(b.date) + ' ' + b.time + ' のご予約について。' + res.reason
          }));
        }).then(reload).then(renderAll);
      }

      if (res.sendMail && b.email) {
        chain = chain.then(function () { return sendOne(b, 'cancel'); });
      }

      return chain.then(function () {
        toast(res.noshow ? '無断キャンセルとして記録しました。' : 'ご予約を取り消しました。');
        return offerWaitlist(b);
      });
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
    return state.store.save('bookings', booking).then(reload).then(renderAll);
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
  }

  function shiftMonth(n) {
    var d = M.fromKey(state.monthKey);
    state.monthKey = M.toKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
    renderMonth();
  }

  function renderMonth() {
    V.renderMonth({
      cfg: state.cfg, bookings: state.bookings, monthKey: state.monthKey,
      selectedKey: state.selectedMonthDay,
      onPickDay: function (key) { state.selectedMonthDay = key; renderMonth(); }
    });
    V.renderMonthDetail({
      cfg: state.cfg, bookings: state.bookings, dateKey: state.selectedMonthDay,
      onPickSlot: function (key, time, unit) {
        goDate(key); showTab('day'); openCreate(key, time, unit);
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
      D.openPatient(state.cfg, null).then(function (p) {
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
        D.openPatient(state.cfg, p).then(function (out) {
          if (!out) return;
          return state.store.save('patients', out).then(reload).then(function () {
            renderAll(); toast('患者さんの情報を直しました。');
          });
        }).catch(reportError);
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
        showTab('month');
        state.selectedMonthDay = null;
        toast(p.name + '様のご予約を入れる日を、カレンダーからお選びください。');
        state.prefillPatient = p;
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

  var SUBS = ['queue', 'recall', 'dm', 'tpl', 'log'];

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
        if (n === 'log') C.renderLog(state.cfg, state.messages, $('logSearch').value);
      });
    });

    $('btnSendReminders').addEventListener('click', function () {
      deliver(C.checkedItems('remList', state.outbox.rem));
    });
    $('btnCheckAllRem').addEventListener('click', function () { C.toggleAll('remList'); });

    $('btnSendThanks').addEventListener('click', function () {
      deliver(C.checkedItems('thxList', state.outbox.thx));
    });
    $('btnCheckAllThx').addEventListener('click', function () { C.toggleAll('thxList'); });

    $('btnSendRecall').addEventListener('click', function () {
      deliver(C.checkedItems('recallList', state.outbox.recall));
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
      C.renderLog(state.cfg, state.messages, this.value);
    });
    $('btnLogCSV').addEventListener('click', exportLogCSV);
  }

  function renderNotify() {
    var cfg = state.cfg;

    state.outbox.rem = X.reminderTargets(cfg, state.bookings, state.patients, state.messages);
    state.outbox.thx = X.thanksTargets(cfg, state.bookings, state.patients, state.messages);
    state.outbox.recall = X.recallTargets(cfg, state.bookings, state.patients, state.messages);

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
      emptyText: 'いまご案内の時期を迎えている方はいらっしゃいません。'
    });

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

    C.renderLog(state.cfg, state.messages, $('logSearch').value);
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
        kind: m.kind, to: m.to, subject: m.subject, body: m.body,
        at: new Date().toISOString(), state: 'queued', error: ''
      };
    });

    return state.store.sendBulk(stamped).then(function (res) {
      var byId = {};
      (res.results || []).forEach(function (r) { byId[r.id] = r; });

      return stamped.reduce(function (chain, m) {
        var r = byId[m.id];
        m.state = r ? r.state : (state.store.canSendMail ? 'sent' : 'simulated');
        m.error = (r && r.error) || '';
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
    state.report = X.analyze(state.cfg, state.bookings, state.patients, from, to);
    C.renderReport(state.cfg, state.report);
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

  function applySetup() {
    var cfg = state.cfg;
    cfg.clinicName = $('setClinic').value.trim() || DRB.defaultConfig.clinicName;
    cfg.tel = $('setTel').value.trim();
    cfg.slotMinutes = Number($('setSlot').value);
    cfg.holdColumn.enabled = $('setHold').checked;
    cfg.reminder.recallMonths = Number($('setRecall').value);
    cfg.reminder.autoConfirm = $('setAutoConfirm').checked;

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
      '初診', '最終来院', '定期健診の間隔', 'タグ', 'アレルギー', '既往・服薬',
      'ご予約の連絡', 'お知らせ', 'メモ'];
    var lines = [csvLine(head)];
    state.patients.forEach(function (p) {
      lines.push(csvLine([p.id, p.cardNo, p.name, p.kana, p.phone, p.email, p.birth,
        p.firstVisit, p.lastVisit, p.recallMonths || '', (p.tags || []).join(' '),
        p.allergy, p.medical,
        p.mailOK === false ? '希望されない' : '受け取る',
        p.dmOK === false ? '希望されない' : '受け取る',
        p.note]));
    });
    download('患者台帳_' + M.todayKey() + '.csv', lines.join('\r\n'));
    toast('患者台帳をCSVで書き出しました。');
  }

  function exportRecallCSV() {
    var head = ['お名前', 'メール', '前回のご来院', 'ご案内の時期', '間隔（か月）'];
    var lines = [csvLine(head)];
    state.outbox.recall.forEach(function (r) {
      var p = X.findPatient(state.patients, r.patientId);
      lines.push(csvLine([r.name, r.to, p ? p.lastVisit : '', r.due, r.months]));
    });
    download('定期健診のご案内_' + M.todayKey() + '.csv', lines.join('\r\n'));
    toast('ご案内の対象をCSVで書き出しました。');
  }

  function exportLogCSV() {
    var head = ['日時', '種類', '宛先', '件名', '状態', 'エラー'];
    var lines = [csvLine(head)];
    state.messages.slice().sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at));
    }).forEach(function (m) {
      lines.push(csvLine([m.at, C.kindLabel(state.cfg, m.kind), m.to, m.subject,
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

  /* 過去3か月ぶんで分析タブが埋まり、先1か月ぶんで月間の空きが埋まるようにする。
     開いた日を起点に組み立てるので、いつ開いてもデモが古くならない。 */
  function seedDemo() {
    var data = DRB.buildSeed(state.cfg, M.shiftDays(M.todayKey(), -92), 123);
    return state.store.replace('bookings', data.bookings)
      .then(function () { return state.store.replace('patients', data.patients); })
      .then(function () { return replaceLocal('contacts', data.contacts); })
      .then(function () { return replaceLocal('messages', data.messages); })
      .then(function () { return replaceLocal('waitlist', data.waitlist); })
      .then(function () { localStorage.setItem(SEEDED_KEY, '1'); })
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

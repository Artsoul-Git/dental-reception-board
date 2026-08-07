/* 受付予約ボード — ダイアログと印刷 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var X = DRB.domain;
  var el = DRB.views.el;
  var clear = DRB.views.clear;
  var D = {};
  DRB.dialogs = D;

  var $ = function (id) { return document.getElementById(id); };

  /** ダイアログを開き、解決したら後片付けまでやる共通の枠 */
  function run(dlg, wire) {
    return new Promise(function (resolve) {
      var offs = [];
      function on(node, type, fn) {
        node.addEventListener(type, fn);
        offs.push(function () { node.removeEventListener(type, fn); });
      }
      function done(value) {
        offs.forEach(function (off) { off(); });
        dlg.close();
        resolve(value);
      }
      on(dlg, 'cancel', function (ev) { ev.preventDefault(); done(null); });
      wire(on, done);
      dlg.showModal();
    });
  }

  function fillSelect(sel, rows, valueKey, labelKey, blank) {
    clear(sel);
    if (blank) {
      var o0 = el('option', null, blank);
      o0.value = '';
      sel.appendChild(o0);
    }
    rows.forEach(function (r) {
      var o = el('option', null, r[labelKey]);
      o.value = r[valueKey];
      sel.appendChild(o);
    });
  }
  D.fillSelect = fillSelect;

  /* ================= 確認 ================= */

  D.confirm = function (title, text, okLabel) {
    $('cfTitle').textContent = title;
    $('cfText').textContent = text;
    $('cfYes').textContent = okLabel || '実行する';
    return run($('dlgConfirm'), function (on, done) {
      on($('cfYes'), 'click', function () { done(true); });
      on($('cfNo'), 'click', function () { done(false); });
    }).then(function (v) { return v === true; });
  };

  /* ================= 予約の登録・修正 ================= */

  /**
   * @param opts { cfg, grid, patients, slotIndex, time, unit, dateKey, booking, prefill }
   * @returns Promise<{booking, sendConfirm}|null>
   */
  D.openBooking = function (opts) {
    var cfg = opts.cfg;
    var dlg = $('dlgBooking');
    var editing = !!opts.booking;
    var b = opts.booking;

    $('bookingTitle').textContent = editing ? 'ご予約の内容を直す' : 'ご予約の登録';
    $('bkSubmit').textContent = editing ? 'この内容に直す' : 'この内容で登録する';
    $('bookingSlot').textContent =
      M.formatDateFull(opts.dateKey) + '　' + opts.time + '　' + M.columnLabel(cfg, opts.unit);
    $('bookingErr').hidden = true;

    fillSelect($('bkPurpose'), cfg.purposes, 'key', 'label');
    fillSelect($('bkStaff'), cfg.staff, 'id', 'name', '担当を決めない');
    fillSelect($('bkSource'), window.DRB.SOURCES, 'key', 'label');

    var maxSpan = M.maxSpanAt(opts.grid, opts.slotIndex, opts.unit, editing ? b.id : null, cfg);
    var spanSel = $('bkSpan');
    clear(spanSel);
    for (var n = 1; n <= Math.max(1, maxSpan); n++) {
      var o = el('option', null, n + '枠（' + (n * cfg.slotMinutes) + '分）');
      o.value = String(n);
      spanSel.appendChild(o);
    }

    /* 患者候補（お名前と診察券番号の両方から引けるようにする） */
    var names = $('patientNames');
    var cards = $('cardList');
    clear(names); clear(cards);
    (opts.patients || []).forEach(function (p) {
      var on = document.createElement('option');
      on.value = p.name;
      on.label = p.cardNo ? 'No.' + p.cardNo : '';
      names.appendChild(on);
      if (p.cardNo) {
        var oc = document.createElement('option');
        oc.value = p.cardNo;
        oc.label = p.name;
        cards.appendChild(oc);
      }
    });

    var pre = opts.prefill || {};
    $('bkName').value = b ? b.name : (pre.name || '');
    $('bkCard').value = b ? b.cardNo : (pre.cardNo || '');
    $('bkPhone').value = b ? b.phone : (pre.phone || '');
    $('bkEmail').value = b ? (b.email || '') : (pre.email || '');
    $('bkPurpose').value = b ? b.purpose : (pre.purpose || cfg.purposes[0].key);
    $('bkStaff').value = b ? (b.staffId || '') : '';
    $('bkSource').value = b ? (b.source || 'reception') : 'reception';
    spanSel.value = String(b ? Math.min(b.span || 1, maxSpan || 1) : 1);
    $('bkMemo').value = b ? b.memo : '';
    $('cardHint').textContent = '';

    var linkedId = b ? b.patientId : (pre.patientId || '');
    $('bkSendConfirm').checked = !editing && cfg.reminder.autoConfirm;
    $('confirmMailWrap').hidden = editing;

    function lookupCard() {
      var no = $('bkCard').value.trim();
      if (!no) { $('cardHint').textContent = ''; return; }
      var hit = X.findByCard(opts.patients, no);
      if (hit) {
        linkedId = hit.id;
        $('cardHint').textContent = 'この番号は「' + hit.name + '」様で登録があります。';
        if (!$('bkName').value.trim()) $('bkName').value = hit.name;
        if (!$('bkPhone').value.trim() && hit.phone) $('bkPhone').value = hit.phone;
        if (!$('bkEmail').value.trim() && hit.email) $('bkEmail').value = hit.email;
      } else {
        $('cardHint').textContent = 'この番号での登録はまだありません。新しくお作りします。';
      }
    }

    function lookupName() {
      var nm = $('bkName').value.trim();
      if (!nm || linkedId) return;
      var hit = (opts.patients || []).filter(function (p) { return p.name === nm; })[0];
      if (!hit) return;
      linkedId = hit.id;
      if (!$('bkCard').value.trim()) $('bkCard').value = hit.cardNo;
      if (!$('bkPhone').value.trim()) $('bkPhone').value = hit.phone;
      if (!$('bkEmail').value.trim()) $('bkEmail').value = hit.email;
    }

    function applyDefaultSpan() {
      if (editing) return;
      var p = M.purposeOf(cfg, $('bkPurpose').value);
      spanSel.value = String(Math.max(1, Math.min(p.span, maxSpan || 1)));
    }

    return run(dlg, function (on, done) {
      on($('bookingForm'), 'submit', function (ev) {
        ev.preventDefault();
        var name = $('bkName').value.trim();
        if (!name) {
          $('bookingErr').textContent = 'お名前をご入力ください。';
          $('bookingErr').hidden = false;
          return;
        }
        var span = Number(spanSel.value) || 1;
        if (!M.canPlace(opts.grid, opts.slotIndex, opts.unit, span, editing ? b.id : null, cfg)) {
          $('bookingErr').textContent = 'その長さでは次のご予約と重なります。枠数を短くしてください。';
          $('bookingErr').hidden = false;
          return;
        }
        var now = new Date().toISOString();
        done({
          booking: {
            id: editing ? b.id : M.newId(),
            date: opts.dateKey, time: opts.time, unit: opts.unit, span: span,
            patientId: linkedId,
            name: name,
            cardNo: $('bkCard').value.trim(),
            phone: $('bkPhone').value.trim(),
            email: $('bkEmail').value.trim(),
            purpose: $('bkPurpose').value,
            memo: $('bkMemo').value.trim(),
            status: editing ? (b.status || 'booked') : 'booked',
            staffId: $('bkStaff').value,
            source: $('bkSource').value,
            arrivedAt: editing ? b.arrivedAt : '',
            doneAt: editing ? b.doneAt : '',
            cancelReason: editing ? b.cancelReason : '',
            canceledAt: editing ? b.canceledAt : '',
            createdAt: editing ? (b.createdAt || now) : now,
            updatedAt: now
          },
          sendConfirm: !editing && $('bkSendConfirm').checked
        });
      });
      on($('bkCancel'), 'click', function () { done(null); });
      on($('bkCard'), 'change', lookupCard);
      on($('bkName'), 'change', lookupName);
      on($('bkPurpose'), 'change', applyDefaultSpan);
      if (!editing) applyDefaultSpan();
      setTimeout(function () { $('bkCard').focus(); }, 0);
    });
  };

  /* ================= 予約の内容 ================= */

  /** @returns Promise<'close'|'cancel'|'noshow'|'edit'|'print'|'patient'|{advance:key}> */
  D.openDetail = function (cfg, booking, patient) {
    var body = $('detailBody');
    clear(body);

    $('detailWho').textContent = booking.name + ' 様';
    D.fillContactLine('detailContact', booking, patient);

    /* 進み具合をボタンで直接選べるようにする */
    var bar = $('detailStatus');
    clear(bar);
    var advance = null;
    window.DRB.STATUSES.forEach(function (s) {
      if (s.key === 'canceled' || s.key === 'noshow') return;
      var btn = el('button', 'stepbtn' + (s.key === (booking.status || 'booked') ? ' is-on' : ''), s.label);
      btn.type = 'button';
      btn.style.borderColor = s.color;
      if (s.key === (booking.status || 'booked')) btn.style.background = s.color;
      btn.addEventListener('click', function () { advance = s.key; $('dtClose').click(); });
      bar.appendChild(btn);
    });

    var end = M.toHHMM(M.toMinutes(booking.time) + (booking.span || 1) * cfg.slotMinutes);
    var staff = window.DRB.staffOf(cfg, booking.staffId);
    var st = window.DRB.statusOf(booking.status);
    var rows = [
      ['日時', M.formatDateFull(booking.date) + '　' + booking.time + '〜' + end],
      ['場所', M.columnLabel(cfg, booking.unit)],
      ['お名前', booking.name + ' 様'],
      ['診察券番号', booking.cardNo || (patient && patient.cardNo) || '（未登録）'],
      ['ご用件', M.purposeOf(cfg, booking.purpose).label],
      ['担当', staff ? staff.name : '（決めていません）'],
      ['受け付けた経路', window.DRB.sourceLabel(booking.source)],
      ['いまの状態', st.label + (M.isHeld(booking) ? '（枠は空きに戻していません）' : '')],
      ['受付メモ', booking.memo || '（なし）']
    ];
    if (booking.cancelReason) rows.push(['取り消しの理由', booking.cancelReason]);
    rows.forEach(function (r) {
      body.appendChild(el('dt', null, r[0]));
      body.appendChild(el('dd', null, r[1]));
    });

    $('dtCancel').disabled = !M.isActive(booking);
    $('dtNoshow').disabled = !M.isActive(booking);

    return run($('dlgDetail'), function (on, done) {
      on($('dtClose'), 'click', function () { done(advance ? { advance: advance } : 'close'); });
      on($('dtCancel'), 'click', function () { done('cancel'); });
      on($('dtNoshow'), 'click', function () { done('noshow'); });
      on($('dtEdit'), 'click', function () { done('edit'); });
      on($('dtPrint'), 'click', function () { done('print'); });
      on($('dtPatient'), 'click', function () { done('patient'); });
    }).then(function (v) { return v || 'close'; });
  };

  /* ================= 連絡先の表示 ================= */

  /**
   * お電話・メールの登録状況を並べる。
   * 無断キャンセルの応対では「どこへ連絡できるか」がその場で要るため、必ず出す。
   */
  D.fillContactLine = function (hostId, booking, patient) {
    var host = $(hostId);
    clear(host);
    var p = patient || {};
    [
      ['お電話', booking.phone || p.phone],
      ['メール', booking.email || p.email]
    ].forEach(function (r) {
      host.appendChild(el('dt', null, r[0]));
      var dd = el('dd', r[1] ? null : 'is-none', r[1] || '未登録');
      host.appendChild(dd);
    });
  };

  /* ================= キャンセル ================= */

  /**
   * 取り消しの受け付け。ここでは「何をするか」を決めるだけで、保存はしない。
   * やめた場合は null を返し、呼び出し側はご予約を元のままにする。
   * @returns Promise<{reason, follow, addContact, noshow, holdSlot}|null>
   */
  D.openCancel = function (cfg, booking, patient, noshow) {
    $('cancelTitle').textContent = noshow ? '無断キャンセルの処理' : 'ご予約の取り消し';
    $('cancelWho').textContent =
      booking.name + ' 様　' + M.formatDateFull(booking.date) + ' ' + booking.time +
      '　' + M.purposeOf(cfg, booking.purpose).label;

    D.fillContactLine('cxContactInfo', booking, patient);

    $('cxReason').value = noshow ? 'ご連絡なくお見えになりませんでした' : 'ご都合により';
    $('cxNote').value = '';
    $('cxContact').checked = true;
    $('cxFollowNone').checked = true;

    var hold = noshow || X.shouldHoldSlot(booking);
    $('cxSlotNote').textContent = hold
      ? 'この枠は他の方へ振り替えられる時間ではないため、空きには戻さず「キャンセル」として盤面に残します。'
      : 'お時間に余裕があるため、処理が終わるとこの枠は空きに戻ります。';

    return run($('dlgCancel'), function (on, done) {
      on($('cancelForm'), 'submit', function (ev) {
        ev.preventDefault();
        var reason = $('cxReason').value;
        var note = $('cxNote').value.trim();
        var follow = 'none';
        ['cxFollowMail', 'cxFollowRebook', 'cxFollowNone'].forEach(function (id) {
          if ($(id).checked) follow = $(id).value;
        });
        done({
          reason: [reason, note].filter(Boolean).join('／') || '理由の記載なし',
          follow: follow,
          addContact: $('cxContact').checked,
          noshow: !!noshow,
          holdSlot: hold
        });
      });
      on($('cxNo'), 'click', function () { done(null); });
    });
  };

  /* ================= 振替のご予約 ================= */

  /**
   * 月間の空きから振替先を選んでいただく。
   * ご用件と担当医は元のご予約のものを最初から入れておく。
   * @param opts { cfg, bookings, booking, patient, onPick(dateKey,time,unit,purpose,staffId) }
   * @returns Promise<'closed'>
   */
  D.openRebook = function (opts) {
    var cfg = opts.cfg;
    var V = window.DRB.views;
    // 過ぎたご予約の振替でも、候補は今日から先だけを出す
    var floorKey = M.todayKey();
    var monthKey = opts.booking.date > floorKey ? opts.booking.date : floorKey;
    var selected = null;

    $('rbWho').textContent =
      opts.booking.name + ' 様　（元のご予約：' +
      M.formatDateFull(opts.booking.date) + ' ' + opts.booking.time + '）';
    $('rbDone').hidden = true;

    fillSelect($('rbPurpose'), cfg.purposes, 'key', 'label');
    fillSelect($('rbStaff'), cfg.staff, 'id', 'name', '担当を決めない');
    $('rbPurpose').value = opts.booking.purpose;
    $('rbStaff').value = opts.booking.staffId || '';

    function draw() {
      $('rbCaption').textContent = M.formatMonth(monthKey);
      V.renderMonthInto({
        host: $('rbCal'),
        cfg: cfg, bookings: opts.bookings, monthKey: monthKey,
        selectedKey: selected, minKey: floorKey,
        purposeKey: $('rbPurpose').value, staffId: $('rbStaff').value,
        onPickDay: function (key) { selected = key; draw(); }
      });
      V.renderMonthDetailInto({
        host: $('rbDetail'),
        cfg: cfg, bookings: opts.bookings, dateKey: selected,
        purposeKey: $('rbPurpose').value, staffId: $('rbStaff').value,
        onPickSlot: function (key, time, unit) {
          opts.onPick(key, time, unit, $('rbPurpose').value, $('rbStaff').value);
        }
      });
    }

    D.rebookRedraw = draw;
    D.rebookShowResult = function (text) {
      $('rbDone').textContent = text;
      $('rbDone').hidden = false;
    };

    draw();

    return run($('dlgRebook'), function (on, done) {
      on($('rbClose'), 'click', function () { done('closed'); });
      on($('rbPrev'), 'click', function () { monthKey = M.shiftMonth(monthKey, -1); selected = null; draw(); });
      on($('rbNext'), 'click', function () { monthKey = M.shiftMonth(monthKey, 1); selected = null; draw(); });
      // ご用件・担当医を変えたら、空き状況をその場で引き直す
      on($('rbPurpose'), 'change', draw);
      on($('rbStaff'), 'change', draw);
    }).then(function (v) {
      D.rebookRedraw = null;
      D.rebookShowResult = null;
      return v;
    });
  };

  /* ================= 患者の登録・修正 ================= */

  D.openPatient = function (cfg, patient, allPatients) {
    var editing = !!patient;
    var p = patient || X.blankPatient();

    $('ptTitle').textContent = editing ? '患者さんの情報を直す' : '患者さんの登録';
    $('ptErr').hidden = true;
    $('ptCard').value = p.cardNo || '';
    $('ptName').value = p.name || '';
    $('ptKana').value = p.kana || '';
    $('ptBirth').value = p.birth || '';
    $('ptPhone').value = p.phone || '';
    $('ptEmail').value = p.email || '';
    $('ptAddress').value = p.address || '';
    $('ptNote').value = p.note || '';
    $('ptMailOK').checked = p.mailOK !== false;
    $('ptDmOK').checked = p.dmOK !== false;
    $('ptPostOK').checked = p.postOK !== false;

    fillSelect($('ptRecall'), window.DRB.RECALL_OPTIONS, 'value', 'label');
    $('ptRecall').value = String(Number(p.recallMonths) || 0);

    /* タグは押して選べるようにする。手で打ち込むこともできる。 */
    var known = X.allTags(allPatients || []).map(function (t) { return t.name; });
    (p.tags || []).forEach(function (t) { if (known.indexOf(t) === -1) known.push(t); });

    function currentTags() {
      return $('ptTags').value.split(/[,、]/)
        .map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function drawTags() {
      var host = $('ptTagPick');
      clear(host);
      var on = currentTags();
      known.forEach(function (name) {
        var btn = el('button', on.indexOf(name) !== -1 ? 'is-on' : null, name);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(on.indexOf(name) !== -1));
        btn.addEventListener('click', function () {
          var list = currentTags();
          var at = list.indexOf(name);
          if (at === -1) list.push(name); else list.splice(at, 1);
          $('ptTags').value = list.join(', ');
          drawTags();
        });
        host.appendChild(btn);
      });
      if (!known.length) host.appendChild(el('span', 'lead', 'まだタグがありません。下から追加できます。'));
    }

    $('ptTags').value = (p.tags || []).join(', ');
    $('ptTagNew').value = '';
    drawTags();

    return run($('dlgPatient'), function (on, done) {
      on($('patientForm'), 'submit', function (ev) {
        ev.preventDefault();
        var name = $('ptName').value.trim();
        if (!name) {
          $('ptErr').textContent = 'お名前をご入力ください。';
          $('ptErr').hidden = false;
          return;
        }
        var out = window.DRB.clone(p);
        out.cardNo = $('ptCard').value.trim();
        out.name = name;
        out.kana = $('ptKana').value.trim();
        out.birth = $('ptBirth').value;
        out.phone = $('ptPhone').value.trim();
        out.email = $('ptEmail').value.trim();
        out.address = $('ptAddress').value.trim();
        out.recallMonths = Number($('ptRecall').value);
        out.tags = currentTags();
        // アレルギー・既往・服薬は持たない（医療安全：カルテと乖離した古い情報が事故を招くため）
        out.allergy = '';
        out.medical = '';
        out.note = $('ptNote').value.trim();
        out.mailOK = $('ptMailOK').checked;
        out.dmOK = $('ptDmOK').checked;
        out.postOK = $('ptPostOK').checked;
        done(out);
      });
      on($('ptCancelBtn'), 'click', function () { done(null); });
      on($('ptTags'), 'input', drawTags);
      on($('btnTagAdd'), 'click', function () {
        var name = $('ptTagNew').value.trim();
        if (!name) return;
        if (known.indexOf(name) === -1) known.push(name);
        var list = currentTags();
        if (list.indexOf(name) === -1) list.push(name);
        $('ptTags').value = list.join(', ');
        $('ptTagNew').value = '';
        drawTags();
      });
      setTimeout(function () { $('ptName').focus(); }, 0);
    });
  };

  /* ================= 応対記録 ================= */

  D.openContact = function (cfg, patient) {
    $('ctWho').textContent = patient.name + ' 様';
    fillSelect($('ctChannel'), window.DRB.CHANNELS, 'key', 'label');
    fillSelect($('ctStaff'), cfg.staff, 'id', 'name', '担当を決めない');
    $('ctSubject').value = '';
    $('ctBody').value = '';
    $('ctDirection').value = 'in';

    return run($('dlgContact'), function (on, done) {
      on($('contactForm'), 'submit', function (ev) {
        ev.preventDefault();
        done(X.newContact(patient.id, {
          channel: $('ctChannel').value,
          direction: $('ctDirection').value,
          staffId: $('ctStaff').value,
          subject: $('ctSubject').value.trim(),
          body: $('ctBody').value.trim()
        }));
      });
      on($('ctCancelBtn'), 'click', function () { done(null); });
      setTimeout(function () { $('ctSubject').focus(); }, 0);
    });
  };

  /* ================= キャンセル待ち ================= */

  D.openWaitlist = function (cfg, prefill) {
    var pre = prefill || {};
    fillSelect($('wlPurpose'), cfg.purposes, 'key', 'label');
    fillSelect($('wlStaff'), cfg.staff, 'id', 'name', 'どなたでも');
    $('wlName').value = pre.name || '';
    $('wlPhone').value = pre.phone || '';
    $('wlPurpose').value = pre.purpose || cfg.purposes[0].key;
    $('wlStaff').value = pre.staffId || '';
    $('wlFrom').value = pre.wantFrom || M.todayKey();
    $('wlTo').value = pre.wantTo || M.shiftDays(M.todayKey(), 30);
    $('wlPrefer').value = pre.prefer || 'any';
    $('wlNote').value = '';

    return run($('dlgWait'), function (on, done) {
      on($('waitForm'), 'submit', function (ev) {
        ev.preventDefault();
        var name = $('wlName').value.trim();
        if (!name) return;
        done(X.newWaitlist({
          patientId: pre.patientId || '',
          name: name,
          phone: $('wlPhone').value.trim(),
          wantFrom: $('wlFrom').value,
          wantTo: $('wlTo').value,
          prefer: $('wlPrefer').value,
          purpose: $('wlPurpose').value,
          staffId: $('wlStaff').value,
          note: $('wlNote').value.trim()
        }));
      });
      on($('wlCancelBtn'), 'click', function () { done(null); });
      setTimeout(function () { $('wlName').focus(); }, 0);
    });
  };

  /* ================= メールの確認 ================= */

  /**
   * 送る前に必ず本文を見せる。デモでは送信できないことをここで伝える。
   * @returns Promise<{subject, body}|null>
   */
  D.openMail = function (opts) {
    $('mlTitle').textContent = opts.title || 'お送りする内容の確認';
    $('mlTo').textContent = opts.to
      ? (opts.name ? opts.name + ' 様　<' + opts.to + '>' : opts.to)
      : '宛先が登録されていません';
    $('mlSubject').value = opts.subject || '';
    $('mlBody').value = opts.body || '';
    $('mlYes').textContent = opts.canSend ? '送る' : 'デモとして記録する';
    $('mlNote').textContent = opts.canSend
      ? 'Gmail から医院のアドレスで送信されます。'
      : 'いまはデモの状態のため、実際には送信されません。文面は送信ログに残ります。実際にお送りになる場合は「Gmailで開く」をお使いください。';
    $('mlGmail').disabled = !opts.to;

    return run($('dlgMail'), function (on, done) {
      on($('mlYes'), 'click', function () {
        done({ subject: $('mlSubject').value, body: $('mlBody').value });
      });
      on($('mlNo'), 'click', function () { done(null); });
      on($('mlCopy'), 'click', function () {
        var text = $('mlSubject').value + '\n\n' + $('mlBody').value;
        copyText(text);
      });
      on($('mlGmail'), 'click', function () {
        // Gmail の作成画面を新しいタブで開く（本文はURLに載るため長文は折り返される）
        var url = 'https://mail.google.com/mail/?view=cm&fs=1' +
          '&to=' + encodeURIComponent(opts.to || '') +
          '&su=' + encodeURIComponent($('mlSubject').value) +
          '&body=' + encodeURIComponent($('mlBody').value);
        window.open(url, '_blank', 'noopener');
      });
    });
  };

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 対応していない環境は諦める */ }
    document.body.removeChild(ta);
  }
  D.copyText = copyText;

  /* ================= 印刷 ================= */

  D.printTicket = function (cfg, booking) {
    var area = $('printArea');
    clear(area);

    var end = M.toHHMM(M.toMinutes(booking.time) + (booking.span || 1) * cfg.slotMinutes);
    var box = el('div', 'ticket');
    box.appendChild(el('p', 'ticket__h', '次回のご予約'));
    box.appendChild(el('p', 'ticket__when',
      M.formatDateFull(booking.date) + '\n' + booking.time + '〜' + end));

    var dl = el('dl', 'ticket__rows');
    [
      ['お名前', booking.name + ' 様'],
      ['診察券番号', booking.cardNo || '—'],
      ['ご用件', M.purposeOf(cfg, booking.purpose).label]
    ].forEach(function (r) {
      dl.appendChild(el('dt', null, r[0]));
      dl.appendChild(el('dd', null, r[1]));
    });
    box.appendChild(dl);

    var foot = el('div', 'ticket__foot');
    foot.appendChild(el('p', null, cfg.clinicName));
    foot.appendChild(el('p', null, 'お問い合わせ　' + cfg.tel));
    foot.appendChild(el('p', null, 'ご都合が変わりましたら、お手数ですがお電話にてご連絡ください。'));
    box.appendChild(foot);

    area.appendChild(box);
    window.print();
  };

  D.printDaySheet = function (cfg, dateKey, bookings) {
    var area = $('printArea');
    clear(area);

    var rows = bookings.filter(function (b) { return b.date === dateKey && M.isActive(b); })
      .sort(function (a, b) {
        return a.time === b.time ? a.unit - b.unit : a.time.localeCompare(b.time);
      });

    area.appendChild(el('p', 'sheet__h', M.formatDateFull(dateKey) + '　ご予約一覧'));
    area.appendChild(el('p', 'sheet__sub', cfg.clinicName + '　全 ' + rows.length + ' 件'));

    var table = el('table', 'sheet__table');
    var thead = el('thead');
    var hr = el('tr');
    ['時間', '場所', 'お名前', '診察券', 'ご用件', '担当', '状態', 'メモ'].forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (b) {
      var end = M.toHHMM(M.toMinutes(b.time) + (b.span || 1) * cfg.slotMinutes);
      var staff = window.DRB.staffOf(cfg, b.staffId);
      var tr = el('tr');
      [
        b.time + '–' + end,
        M.columnLabel(cfg, b.unit),
        b.name,
        b.cardNo || '',
        M.purposeOf(cfg, b.purpose).label,
        staff ? staff.name : '',
        window.DRB.statusOf(b.status).label,
        b.memo || ''
      ].forEach(function (v) { tr.appendChild(el('td', null, v)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    area.appendChild(table);

    window.print();
  };
})(window.DRB);

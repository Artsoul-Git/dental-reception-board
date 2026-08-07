/* 受付予約ボード — 患者台帳・お知らせ・分析の描画
 *
 * views.js と同じく、文字はすべて textContent で入れる。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var X = DRB.domain;
  var el = DRB.views.el;
  var clear = DRB.views.clear;
  var C = {};
  DRB.crm = C;

  function $(id) { return document.getElementById(id); }

  /* ================= 患者台帳 ================= */

  /** @param ctx { cfg, patients, bookings, query, selectedId, onPick } */
  C.renderPatientList = function (ctx) {
    var host = $('ptList');
    clear(host);

    var hits = X.searchPatients(ctx.patients, ctx.query)
      .slice()
      .sort(function (a, b) { return String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'); });

    $('ptCount').textContent = ctx.query
      ? hits.length + ' 名が見つかりました（全 ' + ctx.patients.length + ' 名）'
      : '全 ' + ctx.patients.length + ' 名';

    hits.slice(0, 300).forEach(function (p) {
      var li = el('li');
      var b = el('button', 'ptrow' + (p.id === ctx.selectedId ? ' is-sel' : ''));
      b.type = 'button';

      var head = el('span', 'ptrow__head');
      head.appendChild(el('span', 'ptrow__name', p.name));
      if (p.cardNo) head.appendChild(el('span', 'ptrow__card', 'No.' + p.cardNo));
      b.appendChild(head);

      var sub = [];
      if (p.kana) sub.push(p.kana);
      if (p.lastVisit) sub.push('最終 ' + M.formatDateLong(p.lastVisit));
      b.appendChild(el('span', 'ptrow__sub', sub.join('　')));

      if (p.tags && p.tags.length) {
        var tw = el('span', 'ptrow__tags');
        p.tags.forEach(function (t) { tw.appendChild(el('i', 'chip', t)); });
        b.appendChild(tw);
      }
      if (!p.email) b.appendChild(el('span', 'ptrow__warn', 'メール未登録'));
      else if (p.mailOK === false) b.appendChild(el('span', 'ptrow__warn', 'メール受信を希望されていません'));

      b.addEventListener('click', function () { ctx.onPick(p.id); });
      li.appendChild(b);
      host.appendChild(li);
    });

    if (!hits.length) host.appendChild(el('li', 'empty', '該当する方がいらっしゃいません。'));
  };

  /** @param ctx { cfg, patient, bookings, contacts, messages, on* } */
  C.renderPatientDetail = function (ctx) {
    var host = $('ptDetail');
    clear(host);

    var p = ctx.patient;
    if (!p) {
      host.appendChild(el('p', 'empty', '左の一覧から患者さんをお選びください。'));
      return;
    }

    /* --- 見出し --- */
    var head = el('div', 'pthead');
    var title = el('div');
    title.appendChild(el('h2', 'pthead__name', p.name + ' 様'));
    var sub = [];
    if (p.cardNo) sub.push('診察券 No.' + p.cardNo);
    if (p.kana) sub.push(p.kana);
    if (p.birth) sub.push(ageOf(p.birth));
    title.appendChild(el('p', 'pthead__sub', sub.join('　')));
    head.appendChild(title);

    var openNext = X.nextOpenBooking(ctx.bookings, p.id);
    var acts = el('div', 'pthead__acts');
    [
      ['予約を入れる', 'onBook', 'btn--primary'],
      ['直近予約編集', 'onEditNext', ''],
      ['応対を記録', 'onContact', ''],
      ['メールを送る', 'onMail', ''],
      ['内容を直す', 'onEdit', '']
    ].forEach(function (a) {
      var btn = el('button', 'btn ' + a[2], a[0]);
      btn.type = 'button';
      if (a[0] === 'メールを送る' && (!p.email || p.mailOK === false)) btn.disabled = true;
      if (a[0] === '直近予約編集') {
        if (!openNext) {
          btn.disabled = true;
          btn.title = 'これから先の未処理のご予約がありません。';
        } else {
          btn.title = M.formatDateFull(openNext.date) + ' ' + openNext.time + ' のご予約を直します。';
        }
      }
      btn.addEventListener('click', function () { ctx[a[1]](p, openNext); });
      acts.appendChild(btn);
    });
    head.appendChild(acts);
    host.appendChild(head);

    /* --- 注意事項は目立つところに --- */
    /* アレルギー・既往の欄は廃止した（医療安全：カルテ側で更新されても
       ここに古い情報が残り、受付や衛生士が古い情報で動くと事故になるため）。
       過去に入力された値が残っている場合だけ、消していただくよう促す。 */
    if (p.allergy || p.medical) {
      var alert = el('div', 'ptalert');
      alert.appendChild(el('p', null,
        '⚠ 以前この方に入力された、診療に関する記載が残っています。'));
      if (p.allergy) alert.appendChild(el('p', 'ptalert__old', p.allergy));
      if (p.medical) alert.appendChild(el('p', 'ptalert__old', p.medical));
      alert.appendChild(el('p', null,
        'この欄は廃止しました。カルテ側で更新されても、ここには古い情報が残り続けるためです。' +
        '下のボタンで消してください。'));

      var wipe = el('button', 'btn btn--danger', 'この記載を消す');
      wipe.type = 'button';
      wipe.addEventListener('click', function () { ctx.onWipeMedical(p); });
      alert.appendChild(wipe);
      host.appendChild(alert);
    }

    /* --- 基本情報 --- */
    var next = X.nextBookingOf(ctx.bookings, p.id);
    var dl = el('dl', 'detail detail--2col');
    [
      ['お電話', p.phone || '（未登録）'],
      ['メール', p.email || '（未登録）'],
      ['初診', p.firstVisit ? M.formatDateFull(p.firstVisit) : '—'],
      ['最終来院', p.lastVisit ? M.formatDateFull(p.lastVisit) : '—'],
      ['次回のご予約', next ? M.formatDateFull(next.date) + ' ' + next.time : 'まだ入っていません'],
      ['定期健診の間隔', Number(p.recallMonths) ? p.recallMonths + 'か月' : '医院の既定'],
      ['ご住所', p.address || '—'],
      ['お知らせの受信', consentLabel(p)],
      ['タグ', (p.tags && p.tags.length) ? p.tags.join('、') : '—'],
      ['メモ', p.note || '—']
    ].forEach(function (r) {
      dl.appendChild(el('dt', null, r[0]));
      dl.appendChild(el('dd', null, r[1]));
    });
    host.appendChild(dl);

    /* --- 来院履歴 --- */
    host.appendChild(el('h3', 'h3', '来院・ご予約の履歴'));
    var history = X.historyOf(ctx.bookings, p.id);
    if (!history.length) {
      host.appendChild(el('p', 'lead', '記録がありません。'));
    } else {
      var ul = el('ul', 'timeline');
      history.slice(0, 40).forEach(function (b) {
        var st = window.DRB.statusOf(b.status);
        var li = el('li', 'timeline__i');
        var dot = el('i', 'timeline__dot');
        dot.style.background = st.color;
        li.appendChild(dot);

        var body = el('div');
        body.appendChild(el('p', 'timeline__when',
          M.formatDateFull(b.date) + ' ' + b.time + '　' + M.purposeOf(ctx.cfg, b.purpose).label));
        var meta = [st.label];
        var staff = window.DRB.staffOf(ctx.cfg, b.staffId);
        if (staff) meta.push('担当 ' + staff.name);
        if (b.cancelReason) meta.push(b.cancelReason);
        body.appendChild(el('p', 'timeline__meta', meta.join('　/　')));
        if (b.memo) body.appendChild(el('p', 'timeline__memo', b.memo));
        li.appendChild(body);
        ul.appendChild(li);
      });
      host.appendChild(ul);
    }

    /* --- 応対記録 --- */
    host.appendChild(el('h3', 'h3', '応対の記録'));
    var contacts = X.contactsOf(ctx.contacts, p.id);
    if (!contacts.length) {
      host.appendChild(el('p', 'lead', '記録がありません。'));
    } else {
      var cl = el('ul', 'timeline');
      contacts.slice(0, 40).forEach(function (c) {
        var li = el('li', 'timeline__i');
        li.appendChild(el('i', 'timeline__dot'));
        var body = el('div');
        body.appendChild(el('p', 'timeline__when',
          stampLabel(c.at) + '　' + channelLabel(c.channel) +
          '（' + (c.direction === 'in' ? '患者さんから' : '医院から') + '）'));
        body.appendChild(el('p', 'timeline__meta', c.subject));
        if (c.body) body.appendChild(el('p', 'timeline__memo', c.body));
        li.appendChild(body);
        cl.appendChild(li);
      });
      host.appendChild(cl);
    }

    /* --- 送ったメール --- */
    var mine = ctx.messages.filter(function (m) { return m.patientId === p.id; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    if (mine.length) {
      host.appendChild(el('h3', 'h3', 'お送りしたメール'));
      var ml = el('ul', 'timeline');
      mine.slice(0, 20).forEach(function (m) {
        var li = el('li', 'timeline__i');
        li.appendChild(el('i', 'timeline__dot'));
        var body = el('div');
        body.appendChild(el('p', 'timeline__when', stampLabel(m.at) + '　' + stateLabel(m.state)));
        body.appendChild(el('p', 'timeline__meta', m.subject));
        li.appendChild(body);
        ml.appendChild(li);
      });
      host.appendChild(ml);
    }
  };

  /* 同意は手段ごとに別々に持つ。メールを断られてもハガキは届く場合があるため。 */
  function consentLabel(p) {
    return [
      'ご連絡メール：' + (p.mailOK === false ? '希望されない' : '受け取る'),
      'お知らせメール：' + (p.dmOK === false ? '希望されない' : '受け取る'),
      'ハガキ：' + (p.postOK === false ? '希望されない' : '受け取る')
    ].join('　/　');
  }

  function ageOf(birth) {
    var d = M.fromKey(birth);
    var now = new Date();
    var age = now.getFullYear() - d.getFullYear();
    var m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age + '歳';
  }

  function channelLabel(key) {
    for (var i = 0; i < window.DRB.CHANNELS.length; i++) {
      if (window.DRB.CHANNELS[i].key === key) return window.DRB.CHANNELS[i].label;
    }
    return 'その他';
  }
  C.channelLabel = channelLabel;

  function stampLabel(at) {
    if (!at) return '—';
    var d = new Date(at);
    if (isNaN(d.getTime())) return String(at);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  C.stampLabel = stampLabel;

  function stateLabel(state) {
    if (state === 'sent') return '送信済み';
    if (state === 'simulated') return 'デモ（未送信）';
    if (state === 'failed') return '送信できませんでした';
    return '送信待ち';
  }
  C.stateLabel = stateLabel;

  /* ================= 送信候補の一覧 ================= */

  /**
   * チェックボックス付きの送信候補リスト。
   * @param ctx { hostId, items, emptyText, onPreview }
   */
  C.renderOutbox = function (ctx) {
    var host = $(ctx.hostId);
    clear(host);

    if (!ctx.items.length) {
      host.appendChild(el('p', 'empty', ctx.emptyText));
      return;
    }

    var ul = el('ul', 'outbox');
    ctx.items.forEach(function (item, i) {
      var li = el('li', 'outbox__i');

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.index = String(i);
      cb.className = 'outbox__cb';
      cb.setAttribute('aria-label', item.name + '様へ送る');
      li.appendChild(cb);

      var body = el('div', 'outbox__body');
      var head = el('p', 'outbox__head');
      head.appendChild(el('b', null, item.name + ' 様'));
      head.appendChild(el('span', 'outbox__to', item.to || '（宛先の登録がありません）'));
      body.appendChild(head);

      /* 経過期間の右に、これまでお出しした回数を媒体別で添える */
      var meta = el('p', 'outbox__meta', item.when);
      if (item.counts) {
        meta.appendChild(el('span', 'outbox__counts', X.dmCountLabel(item.counts)));
      }
      if (item.months) {
        meta.appendChild(el('span', 'outbox__cycle', '案内間隔 ' + item.months + 'か月'));
      }
      body.appendChild(meta);
      body.appendChild(el('p', 'outbox__sub', item.subject));
      li.appendChild(body);

      var btn = el('button', 'btn', '内容を見る');
      btn.type = 'button';
      btn.addEventListener('click', function () { ctx.onPreview(item); });
      li.appendChild(btn);

      ul.appendChild(li);
    });
    host.appendChild(ul);
  };

  C.checkedItems = function (hostId, items) {
    var boxes = $(hostId).querySelectorAll('.outbox__cb');
    var out = [];
    Array.prototype.forEach.call(boxes, function (cb) {
      if (cb.checked) out.push(items[Number(cb.dataset.index)]);
    });
    return out;
  };

  C.toggleAll = function (hostId) {
    var boxes = $(hostId).querySelectorAll('.outbox__cb');
    var anyOff = false;
    Array.prototype.forEach.call(boxes, function (cb) { if (!cb.checked) anyOff = true; });
    Array.prototype.forEach.call(boxes, function (cb) { cb.checked = anyOff; });
  };

  /* ================= 送信ログ ================= */

  C.renderLog = function (cfg, messages, query, patients) {
    var host = $('logList');
    clear(host);

    /* 宛先はお名前と並べて出す。アドレスだけでは誰宛か分からないため。 */
    var nameById = {};
    (patients || []).forEach(function (p) { nameById[p.id] = p.name; });

    var q = String(query || '').trim().toLowerCase();
    var rows = messages.slice().sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at));
    }).filter(function (m) {
      if (!q) return true;
      var who = nameById[m.patientId] || '';
      return (m.subject + ' ' + m.to + ' ' + who).toLowerCase().indexOf(q) !== -1;
    });

    if (!rows.length) {
      host.appendChild(el('p', 'empty', '記録がありません。'));
      return;
    }

    var table = el('table', 'grid');
    var thead = el('thead');
    var hr = el('tr');
    ['日時', '種類', '手段', '宛先', '件名', '状態'].forEach(function (h) {
      var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    rows.slice(0, 300).forEach(function (m) {
      var tr = el('tr');
      tr.appendChild(el('td', null, stampLabel(m.at)));
      tr.appendChild(el('td', null, kindLabel(cfg, m.kind)));
      tr.appendChild(el('td', null, window.DRB.channelOf(m.channel).label));

      var to = el('td');
      var who = nameById[m.patientId] || '';
      to.appendChild(el('span', 'logto__name', who ? who + ' 様' : '（台帳に登録のない方）'));
      to.appendChild(el('span', 'logto__addr', m.to || '—'));
      tr.appendChild(to);

      tr.appendChild(el('td', null, m.subject));
      var td = el('td');
      var pill = el('span', 'pill pill--' + m.state, stateLabel(m.state));
      td.appendChild(pill);
      if (m.error) td.appendChild(el('span', 'pill__err', m.error));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  };

  function kindLabel(cfg, kind) {
    return (cfg.templates[kind] && cfg.templates[kind].label) || kind;
  }
  C.kindLabel = kindLabel;

  /* ================= 文面の編集 ================= */

  C.renderTemplates = function (cfg) {
    var host = $('tplEditor');
    clear(host);

    Object.keys(cfg.templates).forEach(function (key) {
      var t = cfg.templates[key];
      var box = el('div', 'tplbox');
      box.appendChild(el('h3', 'h3', t.label));

      var s = el('label', 'field');
      s.appendChild(el('span', 'field__label', '件名'));
      var si = document.createElement('input');
      si.type = 'text'; si.value = t.subject; si.dataset.tpl = key; si.dataset.part = 'subject';
      s.appendChild(si);
      box.appendChild(s);

      var b = el('label', 'field');
      b.appendChild(el('span', 'field__label', '本文'));
      var bi = document.createElement('textarea');
      bi.rows = 9; bi.value = t.body; bi.dataset.tpl = key; bi.dataset.part = 'body';
      b.appendChild(bi);
      box.appendChild(b);

      host.appendChild(box);
    });

    var tags = $('tplTags');
    clear(tags);
    window.DRB.MERGE_TAGS.forEach(function (t) {
      var chip = el('span', 'tagchip');
      chip.appendChild(el('code', null, t.tag));
      if (t.desc) chip.appendChild(el('small', null, t.desc));
      tags.appendChild(chip);
    });
  };

  C.collectTemplates = function (cfg) {
    var out = window.DRB.clone(cfg.templates);
    Array.prototype.forEach.call(
      $('tplEditor').querySelectorAll('[data-tpl]'),
      function (input) {
        out[input.dataset.tpl][input.dataset.part] = input.value;
      }
    );
    return out;
  };

  /* ================= キャンセル待ち ================= */

  /** @param ctx { cfg, waitlist, onRemove, onBook } */
  C.renderWaitlist = function (ctx) {
    var host = $('waitList');
    clear(host);

    var rows = ctx.waitlist.filter(function (w) { return w.state === 'waiting'; });
    $('waitCount').textContent = String(rows.length);

    if (!rows.length) {
      host.appendChild(el('p', 'empty', 'お待ちの方はいらっしゃいません。'));
      return;
    }

    var ul = el('ul', 'outbox');
    rows.forEach(function (w) {
      var li = el('li', 'outbox__i');
      var body = el('div', 'outbox__body');
      var head = el('p', 'outbox__head');
      head.appendChild(el('b', null, w.name + ' 様'));
      if (w.phone) head.appendChild(el('span', 'outbox__to', w.phone));
      body.appendChild(head);
      var staff = window.DRB.staffOf(ctx.cfg, w.staffId);
      body.appendChild(el('p', 'outbox__meta',
        M.formatDateLong(w.wantFrom) + ' 〜 ' + M.formatDateLong(w.wantTo) + '　' +
        preferLabel(w.prefer) + '　' + M.purposeOf(ctx.cfg, w.purpose).label +
        '　担当 ' + (staff ? staff.name : 'どなたでも')));
      if (w.note) body.appendChild(el('p', 'outbox__sub', w.note));
      li.appendChild(body);

      var del = el('button', 'btn btn--danger', '外す');
      del.type = 'button';
      del.addEventListener('click', function () { ctx.onRemove(w); });
      li.appendChild(del);

      ul.appendChild(li);
    });
    host.appendChild(ul);
  };

  function preferLabel(p) {
    return p === 'am' ? '午前ご希望' : p === 'pm' ? '午後ご希望' : '時間帯の指定なし';
  }
  C.preferLabel = preferLabel;

  /* ================= 分析 ================= */

  C.renderReport = function (cfg, report) {
    var host = $('repStats');
    clear(host);

    [
      ['平均稼働率', report.avgRate, '%'],
      ['ご予約の総数', report.total, '件'],
      ['ご来院', report.done, '件'],
      ['キャンセル率', report.cancelRate, '%'],
      ['無断キャンセル率', report.noshowRate, '%'],
      ['新しい患者さん', report.newPatients, '名'],
      ['診療日数', report.openDays, '日']
    ].forEach(function (row) {
      var li = el('li');
      li.appendChild(el('b', null, row[0]));
      var v = el('span', null, String(row[1]));
      v.appendChild(el('small', null, row[2]));
      li.appendChild(v);
      host.appendChild(li);
    });

    /* 日ごとの稼働率。棒はCSSの高さで描く。 */
    var chart = $('repChart');
    clear(chart);
    if (!report.daily.length) {
      chart.appendChild(el('p', 'empty', 'この期間に診療日がありません。'));
    } else {
      var track = el('div', 'chart__track');
      report.daily.forEach(function (d) {
        var col = el('div', 'chart__col');
        var bar = el('i', 'chart__bar');
        bar.style.height = Math.max(2, d.rate) + '%';
        if (d.rate >= 85) bar.classList.add('is-high');
        col.appendChild(bar);
        col.title = M.formatDateLong(d.date) + '　稼働率 ' + d.rate + '%（' + d.booked + '件）';
        col.setAttribute('aria-label', col.title);
        track.appendChild(col);
      });
      chart.appendChild(track);

      var axis = el('div', 'chart__axis');
      axis.appendChild(el('span', null, M.formatDateLong(report.daily[0].date)));
      axis.appendChild(el('span', null, M.formatDateLong(report.daily[report.daily.length - 1].date)));
      chart.appendChild(axis);
    }

    renderBreakdown($('repPurpose'), cfg.purposes.map(function (p) {
      return { label: p.label, color: p.color, n: report.byPurpose[p.key] || 0 };
    }));

    renderBreakdown($('repStaff'), cfg.staff.map(function (s) {
      return { label: s.name, color: s.color, n: report.byStaff[s.id] || 0 };
    }));
  };

  function renderBreakdown(host, rows) {
    clear(host);
    var max = rows.reduce(function (a, r) { return Math.max(a, r.n); }, 0);
    if (!max) { host.appendChild(el('p', 'empty', '件数がありません。')); return; }

    var ul = el('ul', 'bars');
    rows.sort(function (a, b) { return b.n - a.n; }).forEach(function (r) {
      var li = el('li', 'bars__i');
      li.appendChild(el('span', 'bars__label', r.label));
      var track = el('span', 'bars__track');
      var fill = el('i');
      fill.style.width = Math.round((r.n / max) * 100) + '%';
      fill.style.background = r.color;
      track.appendChild(fill);
      li.appendChild(track);
      li.appendChild(el('span', 'bars__n', String(r.n)));
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }
})(window.DRB);

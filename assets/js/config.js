/* 受付予約ボード — 医院設定 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  DRB.CONFIG_KEY = 'drb.config.v3';

  /* デモデータの期間。管理者が決める基準値で、毎日1回ここへ戻す。 */
  DRB.DEMO_RANGE = { from: '2025-01-01', to: '2027-01-31' };

  /* ご予約を受け付けた経路 */
  DRB.SOURCES = [
    { key: 'reception', label: '窓口' },
    { key: 'phone', label: 'お電話' },
    { key: 'web', label: 'ウェブ' },
    { key: 'mail', label: 'メール' }
  ];

  /* ご案内をお届けする手段。ハガキは印刷してお出しするので、記録だけを残す。 */
  DRB.DM_CHANNELS = [
    { key: 'postcard', label: 'ハガキ', short: 'ハガキ', sendable: false },
    { key: 'mail', label: 'メール', short: 'メール', sendable: true }
  ];

  /* 患者さんごとの定期健診の間隔 */
  DRB.RECALL_OPTIONS = [
    { value: -1, label: 'ご案内しない' },
    { value: 0, label: '医院の既定にあわせる' },
    { value: 1, label: '1か月' },
    { value: 2, label: '2か月' },
    { value: 3, label: '3か月' },
    { value: 4, label: '4か月' },
    { value: 6, label: '6か月' },
    { value: 12, label: '12か月' }
  ];

  /* 収益への貢献度。院長が選ぶだけで済むよう、既定は3段階。 */
  DRB.GRADES = [
    { key: 'A', label: 'A（高い）', color: '#2E7D6B' },
    { key: 'B', label: 'B（ふつう）', color: '#3B6FA8' },
    { key: 'C', label: 'C（低い）', color: '#9a948c' }
  ];

  DRB.BUFFER_OPTIONS = [0, 15, 30];

  /* 予約の進み具合。受付が押していく順に並べている。 */
  DRB.STATUSES = [
    { key: 'booked',   label: 'ご予約',   short: '予',  color: '#8d949c', next: 'arrived' },
    { key: 'arrived',  label: '来院',     short: '来',  color: '#3B6FA8', next: 'inChair' },
    { key: 'inChair',  label: '診療中',   short: '診',  color: '#1F6F6B', next: 'checkout' },
    { key: 'checkout', label: 'お会計',   short: '会',  color: '#7B5EA7', next: 'done' },
    { key: 'done',     label: '完了',     short: '済',  color: '#4b7a5a', next: null },
    { key: 'canceled', label: 'キャンセル', short: '取', color: '#a6a099', next: null },
    { key: 'noshow',   label: '無断キャンセル', short: '無', color: '#C0522F', next: null }
  ];

  /* 応対記録の手段 */
  DRB.CHANNELS = [
    { key: 'phone', label: 'お電話' },
    { key: 'visit', label: 'ご来院時' },
    { key: 'mail',  label: 'メール' },
    { key: 'other', label: 'その他' }
  ];

  /* 差し込み記号。文面編集画面にも同じ一覧を出す。 */
  DRB.MERGE_TAGS = [
    { tag: '{{お名前}}', desc: '患者さんのお名前' },
    { tag: '{{様}}', desc: 'お名前＋「様」' },
    { tag: '{{日付}}', desc: '2026年8月3日（月）' },
    { tag: '{{時刻}}', desc: '10:15' },
    { tag: '{{ご用件}}', desc: '定期メンテナンス など' },
    { tag: '{{診察券番号}}', desc: '' },
    { tag: '{{医院名}}', desc: '' },
    { tag: '{{電話}}', desc: '' },
    { tag: '{{最終来院}}', desc: 'リコール案内で使う' }
  ];

  var TPL = {
    confirm: {
      label: 'ご予約の確定',
      subject: '【{{医院名}}】ご予約を承りました（{{日付}} {{時刻}}）',
      body: '{{様}}\n\nいつもありがとうございます。{{医院名}}です。\n下記のとおりご予約を承りました。\n\n　日時　{{日付}} {{時刻}}\n　内容　{{ご用件}}\n\nご都合が変わりましたら、お手数ですが下記までご連絡ください。\n当日は診察券をお持ちください。\n\n──────────\n{{医院名}}\nお電話　{{電話}}\n──────────'
    },
    reminder: {
      label: '前日リマインド',
      subject: '【{{医院名}}】明日 {{時刻}} のご予約のお知らせ',
      body: '{{様}}\n\n{{医院名}}です。\n明日のご予約をお知らせいたします。\n\n　日時　{{日付}} {{時刻}}\n　内容　{{ご用件}}\n\nお気をつけてお越しください。\nご都合が悪くなられた場合は、お早めにご連絡いただけますと助かります。\n\n──────────\n{{医院名}}\nお電話　{{電話}}\n──────────'
    },
    cancel: {
      label: 'キャンセルの確認',
      subject: '【{{医院名}}】ご予約取り消しの確認（{{日付}} {{時刻}}）',
      body: '{{様}}\n\n{{医院名}}です。\n下記のご予約を取り消しいたしました。\n\n　日時　{{日付}} {{時刻}}\n　内容　{{ご用件}}\n\n次回のご予約をご希望の際は、お気軽にご連絡ください。\n\n──────────\n{{医院名}}\nお電話　{{電話}}\n──────────'
    },
    thanks: {
      label: 'ご来院のお礼',
      subject: '【{{医院名}}】本日はありがとうございました',
      body: '{{様}}\n\n本日はご来院いただきありがとうございました。{{医院名}}です。\n\n施術後、気になることがございましたら遠慮なくご連絡ください。\n次回のご予約は {{日付}} {{時刻}} を承っております。\n\n──────────\n{{医院名}}\nお電話　{{電話}}\n──────────'
    },
    recall: {
      label: '定期健診のご案内',
      subject: '【{{医院名}}】そろそろ定期健診の時期です',
      body: '{{様}}\n\n{{医院名}}です。\n前回のご来院から時間が経ちましたので、定期健診のご案内をお送りしました。\n\n　前回のご来院　{{最終来院}}\n\nお口の状態は、痛みが出る前の段階で見つけられるほど負担が軽くて済みます。\nご都合のよいお日にちが決まりましたら、お電話またはご返信にてお知らせください。\n\n──────────\n{{医院名}}\nお電話　{{電話}}\n──────────'
    },
    dm: {
      label: 'お知らせ（一斉配信）',
      subject: '【{{医院名}}】お知らせ',
      body: '{{様}}\n\n{{医院名}}です。\n\n（ここに本文を書いてください）\n\n──────────\n{{医院名}}\nお電話　{{電話}}\n──────────'
    }
  };

  DRB.defaultConfig = {
    clinicName: 'さくら通り歯科クリニック（デモ）',
    tel: '000-000-0000',
    mailFrom: '',
    slotMinutes: 15,
    units: [
      { id: 1, label: 'チェア1' },
      { id: 2, label: 'チェア2' },
      { id: 3, label: 'チェア3' }
    ],
    holdColumn: { enabled: true, label: '確保枠' },
    staff: [
      { id: 'dr1', name: '院長', role: 'doctor', color: '#1F6F6B' },
      { id: 'dr2', name: '副院長', role: 'doctor', color: '#3B6FA8' },
      { id: 'dh1', name: '衛生士A', role: 'hygienist', color: '#7B5EA7' },
      { id: 'dh2', name: '衛生士B', role: 'hygienist', color: '#C0522F' }
    ],
    // 0=日 1=月 … 6=土 ／ null は休診
    hours: {
      0: null,
      1: [['09:30', '13:00'], ['14:30', '19:00']],
      2: [['09:30', '13:00'], ['14:30', '19:00']],
      3: [['09:30', '13:00'], ['14:30', '19:00']],
      4: null,
      5: [['09:30', '13:00'], ['14:30', '19:00']],
      6: [['09:30', '13:00'], ['14:00', '17:00']]
    },
    closedDates: [
      '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23',
      '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04',
      '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
      '2026-09-21', '2026-09-23', '2026-10-12', '2026-11-03',
      '2026-11-23'
    ],
    /* grade＝院長が選ぶ収益への貢献度。profit＝1件あたりの概算利益（0は未設定）。 */
    purposes: [
      { key: 'maintenance', label: '定期メンテナンス', color: '#2E7D6B', span: 3, recallMonths: 6, grade: 'A', profit: 0 },
      { key: 'caries', label: 'う蝕処置', color: '#3B6FA8', span: 2, recallMonths: 6, grade: 'B', profit: 0 },
      { key: 'urgent', label: '痛み・当日対応', color: '#C0522F', span: 2, recallMonths: 3, grade: 'C', profit: 0 },
      { key: 'prosthetic', label: '補綴（詰め物・被せ物）', color: '#7B5EA7', span: 2, recallMonths: 6, grade: 'A', profit: 0 },
      { key: 'perio', label: '歯周治療', color: '#1F7A8C', span: 3, recallMonths: 3, grade: 'A', profit: 0 },
      { key: 'consult', label: '相談・カウンセリング', color: '#6E757C', span: 1, recallMonths: 12, grade: 'C', profit: 0 }
    ],

    /* 貢献度の付け方。grade＝ABCをそのまま使う／perHour＝概算利益から時間あたりで自動採点 */
    contribution: { mode: 'grade' },

    /* ご予約の前後に空けておく時間（分）。片付けや説明の時間を見込むための設定。 */
    buffer: { before: 0, after: 0 },
    templates: TPL,
    reminder: {
      autoConfirm: true,     // 登録したら確定メールを送る
      prevDay: true,         // 前日リマインドの対象にする
      recallMonths: 6,       // 最終来院からこの月数で案内の候補にする
      recallChannel: 'postcard'  // 定期健診のご案内はハガキでお出しする
    },
    storage: {
      mode: 'local', // 'local' | 'sheet'
      endpoint: '',
      token: '',
      calendarId: ''
    }
  };

  DRB.loadConfig = function () {
    var cfg = DRB.clone(DRB.defaultConfig);
    try {
      var raw = localStorage.getItem(DRB.CONFIG_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(saved).forEach(function (k) { cfg[k] = saved[k]; });
        // 版が上がって増えた枝が欠けていても落ちないようにする
        ['templates', 'reminder', 'storage', 'holdColumn', 'contribution', 'buffer'].forEach(function (k) {
          cfg[k] = merge(DRB.defaultConfig[k], cfg[k]);
        });
        if (!cfg.staff || !cfg.staff.length) cfg.staff = DRB.clone(DRB.defaultConfig.staff);
        if (!cfg.purposes || !cfg.purposes.length) cfg.purposes = DRB.clone(DRB.defaultConfig.purposes);
        // 版が上がって増えた項目は既定値で埋める
        cfg.purposes.forEach(function (p) {
          if (!p.grade) p.grade = 'B';
          if (typeof p.profit !== 'number') p.profit = 0;
          if (typeof p.recallMonths !== 'number') p.recallMonths = 6;
        });
      }
    } catch (e) {
      console.warn('設定の読み込みに失敗したため既定値を使います', e);
    }
    return cfg;
  };

  function merge(base, over) {
    var out = DRB.clone(base);
    if (over && typeof over === 'object') {
      Object.keys(over).forEach(function (k) {
        out[k] = (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]))
          ? merge(out[k], over[k]) : over[k];
      });
    }
    return out;
  }

  DRB.saveConfig = function (cfg) {
    localStorage.setItem(DRB.CONFIG_KEY, JSON.stringify(cfg));
  };

  DRB.clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  DRB.statusOf = function (key) {
    for (var i = 0; i < DRB.STATUSES.length; i++) {
      if (DRB.STATUSES[i].key === key) return DRB.STATUSES[i];
    }
    return DRB.STATUSES[0];
  };

  DRB.staffOf = function (cfg, id) {
    for (var i = 0; i < cfg.staff.length; i++) if (cfg.staff[i].id === id) return cfg.staff[i];
    return null;
  };

  DRB.sourceLabel = function (key) {
    for (var i = 0; i < DRB.SOURCES.length; i++) {
      if (DRB.SOURCES[i].key === key) return DRB.SOURCES[i].label;
    }
    return '窓口';
  };

  DRB.channelOf = function (key) {
    for (var i = 0; i < DRB.DM_CHANNELS.length; i++) {
      if (DRB.DM_CHANNELS[i].key === key) return DRB.DM_CHANNELS[i];
    }
    return DRB.DM_CHANNELS[1];
  };

  /**
   * ご用件ごとの収益貢献度を返す。
   * 概算利益を入れた用件が1つでもあり、モードが perHour なら、
   * 時間あたり利益の高い順に上位1/3をA・中1/3をB・下1/3をCとして付け直す。
   * 利益を入れていない用件は院長が選んだ ABC をそのまま使う。
   */
  DRB.gradeMap = function (cfg) {
    var map = {};
    cfg.purposes.forEach(function (p) { map[p.key] = p.grade || 'B'; });
    if (!cfg.contribution || cfg.contribution.mode !== 'perHour') return map;

    var scored = cfg.purposes.filter(function (p) { return Number(p.profit) > 0; })
      .map(function (p) {
        var minutes = Math.max(1, (p.span || 1) * cfg.slotMinutes);
        return { key: p.key, perHour: Number(p.profit) / minutes * 60 };
      })
      .sort(function (a, b) { return b.perHour - a.perHour; });

    if (!scored.length) return map;
    var third = Math.ceil(scored.length / 3);
    scored.forEach(function (s, i) {
      map[s.key] = i < third ? 'A' : (i < third * 2 ? 'B' : 'C');
    });
    return map;
  };

  DRB.perHourOf = function (cfg, purpose) {
    if (!Number(purpose.profit)) return 0;
    var minutes = Math.max(1, (purpose.span || 1) * cfg.slotMinutes);
    return Math.round(Number(purpose.profit) / minutes * 60);
  };
})(window.DRB);

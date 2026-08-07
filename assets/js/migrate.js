/* 受付予約ボード — CSVによるデータ移行（患者台帳・ご予約）
 *
 * 別紙6「CSVテンプレート仕様」を実装したもの。
 * 受付の方がご自分で取り込めることが契約上のお約束（第6条）なので、
 * ここは「取り込む前に見せる」「名指しで直せる」「元に戻せる」を最優先にしている。
 *
 * 進め方は3段階。
 *   1. 列の対応づけ … どのCSVの列が、どの項目になるかを画面で確認する
 *   2. 確認と差分   … 直すべき行を「◯行目の◯◯」で名指しする／新規と更新の件数を出す
 *   3. 取り込み     … 取り込む前にバックアップCSVを書き出し、直後は元に戻せる
 *
 * 文字はすべて textContent で入れる（CSVの中身をHTMLとして解釈させない）。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  var M = DRB.model;
  var X = DRB.domain;
  var el = DRB.views.el;
  var clear = DRB.views.clear;

  var G = {};
  DRB.migrate = G;

  var $ = function (id) { return document.getElementById(id); };

  /* ================= 列の定義 =================
   * label は別紙6の見出しと一致させる（配布したテンプレートの見出しを正とする）。
   * aliases には、医院が自作した表でよく使われる言い方と、
   * 本システムの書き出しCSVの見出しを入れておく（書き出したものをそのまま戻せるように）。
   */

  G.PATIENT_COLUMNS = [
    { key: 'cardNo', label: '診察券番号', required: true, type: 'text',
      aliases: ['診察券No', 'カルテ番号', 'カルテNo', '患者番号', '患者コード', '患者ID'],
      desc: '患者さんを見分ける番号です。同じ番号を2人に使わないでください。いまお使いの番号をそのままお入れいただけます。' },
    { key: 'name', label: '氏名', required: true, type: 'text',
      aliases: ['お名前', '名前', '患者名', '氏名'],
      desc: '姓と名の間は、空けても空けなくても構いません。' },
    { key: 'kana', label: 'ふりがな', type: 'text',
      aliases: ['フリガナ', 'カナ', 'ヨミガナ', 'よみがな', 'ふりがな'],
      desc: 'ひらがな・カタカナのどちらでも構いません。' },
    { key: 'birth', label: '生年月日', type: 'date',
      aliases: ['誕生日', '生年月日'],
      desc: '2026-04-01 の形でお願いします。1980/5/3 や 1980年5月3日 でも取り込めます。' },
    { key: 'phone', label: '電話番号', type: 'phone',
      aliases: ['お電話', '電話', 'TEL', 'Tel', '連絡先', '携帯', '電話番号'],
      desc: 'ハイフンは有っても無くても構いません。' },
    { key: 'email', label: 'メールアドレス', type: 'email',
      aliases: ['メール', 'Email', 'E-mail', 'mail', 'メールアドレス'],
      desc: '空欄で構いません。空欄の患者さんには、メールのご案内が届きません。' },
    { key: 'address', label: '郵便番号・住所', type: 'text',
      aliases: ['住所', 'ご住所', '郵便番号', '〒', '郵便番号・住所'],
      desc: 'ハガキの宛名づくりに使います。1つの欄にまとめてお入れください。' },
    { key: 'firstVisit', label: '初診日', type: 'date',
      aliases: ['初診', '初回来院日', '初診日'],
      desc: '分からない場合は空欄で構いません。' },
    { key: 'lastVisit', label: '最終来院日', type: 'date',
      aliases: ['最終来院', '前回来院日', '最終来院日'],
      desc: '定期健診のご案内を出す相手を決めるのに使います。できるだけお入れください。' },
    /* 同意は「手段」ごとに3つ持ちます。メールを断られた方でもハガキは受け取る、
       という実態があるため、メールの可否だけで全部を止めない設計です。 */
    { key: 'mailOK', label: 'ご連絡メールの可否', type: 'consent',
      aliases: ['ご予約の連絡', 'メール案内', 'メール可否', 'メール案内の可否', 'ご連絡メールの可否'],
      desc: '「可」「否」「未確認」でお入れください。ご予約の確認・前日のご連絡・定期健診のご案内を、メールでお送りしてよいかどうかです。空欄は「可」として取り込みます。' },
    { key: 'dmOK', label: 'お知らせメールの可否', type: 'consent',
      aliases: ['お知らせ', 'DM', 'お知らせメール', 'お知らせメールの可否'],
      desc: '「可」「否」「未確認」でお入れください。医院からのお知らせ（宣伝・ご案内）を、メールでお送りしてよいかどうかです。空欄は「可」として取り込みます。' },
    { key: 'postOK', label: 'ハガキ案内の可否', type: 'consent',
      aliases: ['ハガキ', 'ハガキ案内', 'ハガキ可否', 'ハガキ案内の可否', '郵送'],
      desc: '「可」「否」「未確認」でお入れください。ハガキでのご案内をお届けしてよいかどうかです。**メールの可否とは別の意思**として扱います。空欄は「可」として取り込みます。' },
    { key: 'note', label: '備考', type: 'note',
      aliases: ['メモ', '特記', 'コメント', '備考'],
      desc: '※アレルギー・既往歴・服薬内容など、診療に関することは入れないでください（利用契約書 第14条第3項）。' }
  ];

  G.BOOKING_COLUMNS = [
    { key: 'date', label: '予約日', required: true, type: 'date',
      aliases: ['日付', 'ご予約日', '来院日', '予約日'],
      desc: '2026-08-10 の形でお願いします。' },
    { key: 'time', label: '開始時刻', required: true, type: 'time',
      aliases: ['開始', '時刻', '時間', '開始時間', '開始時刻'],
      desc: '09:30 の形（24時間）でお願いします。診療時間の枠の開始時刻と一致している必要があります。' },
    { key: 'minutes', label: '所要時間（分）', required: true, type: 'minutes',
      aliases: ['所要時間', '所要分', '施術時間', '分', '所要時間（分）'],
      desc: '30 のように分の数字だけをお入れください。1枠の長さの倍数に切り上げて取り込みます。' },
    { key: 'cardNo', label: '診察券番号', required: true, type: 'text',
      aliases: ['診察券No', 'カルテ番号', '患者番号', '診察券番号'],
      desc: '患者情報CSVの診察券番号と一致している必要があります。先に患者情報CSVを取り込んでください。' },
    { key: 'staff', label: '担当者', type: 'text',
      aliases: ['担当', '担当医', 'ドクター', '担当者'],
      desc: '「設定・連携」で登録した担当者のお名前と一致している必要があります。空欄で構いません。' },
    { key: 'purpose', label: '処置区分', type: 'text',
      aliases: ['ご用件', '用件', '処置', '内容', '処置区分'],
      desc: '「設定・連携」で登録したご用件の名前と一致している必要があります。空欄で構いません。' },
    { key: 'memo', label: '備考', type: 'note',
      aliases: ['メモ', '受付メモ', 'コメント', '備考'],
      desc: '※診療に関することは入れないでください。当日の段取り（お車でお越しなど）にとどめてください。' }
  ];

  /* 備考に入っていたら取り込まない語。医療安全のため、診療情報はカルテ側で一元管理していただく。 */
  var MED_WORDS = ['アレルギー', 'あれるぎー', '既往', '服薬', '投薬', '内服', '薬剤', '処方',
    '抗凝固', 'ワーファリン', 'ワルファリン', 'ビスホスホネート', 'ステロイド',
    '糖尿', '高血圧', '心疾患', '心臓', 'ペースメーカー', '妊娠', '授乳',
    '肝炎', '感染症', 'HIV', '喘息', 'リウマチ', '骨粗鬆', '休薬', '麻酔'];

  /* ================= 小さな道具 ================= */

  /** 全角の英数字・記号を半角にそろえる（Excelの入力ゆれを吸収する） */
  function toHalf(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ');
  }

  function trim(v) { return String(v === undefined || v === null ? '' : v).trim(); }
  function pad2(n) { return ('0' + n).slice(-2); }

  function esc(v) {
    return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  }

  function csvLine(cells) { return cells.map(esc).join(','); }

  /** Excel がそのまま開けるよう BOM を付けて保存する */
  function download(name, text) {
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
  G.download = download;

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  /* ================= 文字コードの判別 =================
   * Excel の「CSV（コンマ区切り）」で保存すると Shift_JIS になる。
   * UTF-8 として読めなければ Shift_JIS として読み直す。
   * ここを自動でやらないと、受付の方の画面ではお名前が化けたまま取り込まれる。
   */

  G.decode = function (buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8（BOM付き）' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'Shift_JIS（Excelの標準）' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(bytes), encoding: '不明' };
      }
    }
  };

  /* ================= CSVの読み取り =================
   * 行番号を持ち回るのが肝。エラーを「3行目の…」と名指しできないと、
   * 受付の方はどこを直せばよいか分からない。行番号は Excel の行番号に合わせる。
   */

  G.parse = function (text) {
    var body = text.replace(/^﻿/, '');
    var delim = pickDelimiter(body);
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var line = 1;
    var startLine = 1;

    function endField() { row.push(field); field = ''; }
    function endRow() {
      endField();
      rows.push({ line: startLine, cells: row });
      row = [];
      startLine = line + 1;
    }

    for (var i = 0; i < body.length; i++) {
      var c = body[i];
      if (quoted) {
        if (c === '"') {
          if (body[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else {
          if (c === '\n') line++;
          field += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === delim) {
        endField();
      } else if (c === '\n') {
        endRow();
        line++;
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field !== '' || row.length) endRow();

    var live = rows.filter(function (r) {
      return r.cells.some(function (v) { return trim(v) !== ''; });
    });
    if (!live.length) return { headers: [], rows: [], delimiter: delim };

    return {
      headers: live[0].cells.map(trim),
      headerLine: live[0].line,
      rows: live.slice(1),
      delimiter: delim
    };
  };

  /** Excel の「Unicode テキスト」で保存するとタブ区切りになるので、そこも拾う */
  function pickDelimiter(text) {
    var head = text.split('\n')[0] || '';
    var tabs = (head.match(/\t/g) || []).length;
    var commas = (head.match(/,/g) || []).length;
    var semis = (head.match(/;/g) || []).length;
    if (tabs > commas && tabs > semis) return '\t';
    if (semis > commas && semis > tabs) return ';';
    return ',';
  }

  /* ================= 列の自動あてはめ ================= */

  function norm(s) {
    return toHalf(s).toLowerCase().replace(/[\s　_\-・（）()]/g, '');
  }

  /**
   * CSVの見出しを、システムの項目にあてはめる。
   * 見出しの順番も名前も医院ごとにばらばらなので、
   * 一致しなかったぶんは画面で人が選び直せるようにする（戻り値は見出しの位置）。
   *
   * 順番が肝。3周に分ける。
   *   1周目：正式な見出し（別紙6の名前）とぴったり同じもの
   *   2周目：別の言い方（カルテ番号 など）とぴったり同じもの
   *   3周目：部分的に似ているもの（患者氏名 など）
   * 1周目を先にしないと、本システムが書き出したCSV（「患者ID」と「診察券番号」が
   * どちらも入っている）で、診察券番号に患者IDが入ってしまう。
   */
  G.autoMap = function (headers, columns) {
    var used = {};
    var map = {};
    var normHeads = headers.map(norm);
    columns.forEach(function (col) { map[col.key] = -1; });

    function claim(col, i) { map[col.key] = i; used[i] = true; }

    // 1周目：正式な見出しと完全一致
    columns.forEach(function (col) {
      var label = norm(col.label);
      for (var i = 0; i < headers.length; i++) {
        if (used[i] || map[col.key] >= 0) continue;
        if (normHeads[i] === label) { claim(col, i); return; }
      }
    });

    // 2周目：別の言い方と完全一致
    columns.forEach(function (col) {
      if (map[col.key] >= 0) return;
      var names = (col.aliases || []).map(norm);
      for (var i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        if (names.indexOf(normHeads[i]) !== -1) { claim(col, i); return; }
      }
    });

    // 3周目：部分一致（「患者氏名」「TEL番号」など）
    columns.forEach(function (col) {
      if (map[col.key] >= 0) return;
      var names = [col.label].concat(col.aliases || []).map(norm)
        .filter(function (n) { return n.length >= 2; });   // 短すぎる語は誤爆するので使わない
      for (var i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        var h = normHeads[i];
        if (!h) continue;
        for (var k = 0; k < names.length; k++) {
          if (h.indexOf(names[k]) !== -1 || names[k].indexOf(h) !== -1) { claim(col, i); return; }
        }
      }
    });

    return map;
  };

  /* ================= 値の点検 ================= */

  function checkDate(raw) {
    var s = toHalf(raw).trim();
    if (!s) return { value: '' };
    s = s.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')
      .replace(/[\/.]/g, '-').replace(/\s+/g, '').trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return { error: '日付として読み取れません。2026-04-01 の形でご入力ください' };
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
      return { error: 'そのお日にちは存在しません' };
    }
    return { value: y + '-' + pad2(mo) + '-' + pad2(d) };
  }

  function checkTime(raw) {
    var s = toHalf(raw).trim().replace(/時/g, ':').replace(/分/g, '').replace(/：/g, ':').replace(/\s+/g, '');
    if (!s) return { value: '' };
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (!m) return { error: '時刻として読み取れません。09:30 の形でご入力ください' };
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return { error: 'その時刻は存在しません' };
    return { value: pad2(h) + ':' + pad2(mi) };
  }

  function checkPhone(raw) {
    var s = toHalf(raw).trim();
    if (!s) return { value: '' };
    var digits = s.replace(/[-()\s]/g, '');
    if (!/^\+?\d{9,15}$/.test(digits)) {
      return { error: 'お電話番号として読み取れません。数字とハイフンでご入力ください' };
    }
    return { value: s };
  }

  function checkEmail(raw) {
    var s = toHalf(raw).trim();
    if (!s) return { value: '' };
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s)) {
      return { error: 'メールアドレスとして読み取れません。@ の前後をご確認ください' };
    }
    return { value: s };
  }

  var YES = ['可', '○', '◯', '〇', 'はい', '有', 'あり', '受け取る', '受取る', 'ok', 'true', '1', 'y', 'yes'];
  var NO = ['否', '×', '✕', 'x', 'いいえ', '無', 'なし', '不可', '希望されない', '希望しない', 'ng', 'false', '0', 'n', 'no'];

  function checkConsent(raw) {
    var s = toHalf(raw).trim().toLowerCase();
    if (!s || s === '未確認' || s === '不明') return { value: null };
    if (YES.indexOf(s) !== -1) return { value: true };
    if (NO.indexOf(s) !== -1) return { value: false };
    return { error: '「可」「否」「未確認」のいずれかでご入力ください' };
  }

  function checkMinutes(raw) {
    var s = toHalf(raw).trim().replace(/分/g, '');
    if (!s) return { error: '所要時間が空欄です' };
    var n = Number(s);
    if (!isFinite(n) || n <= 0) return { error: '所要時間は 30 のように分の数字でご入力ください' };
    if (n > 480) return { error: '所要時間が長すぎます（480分まで）' };
    return { value: n };
  }

  /** 備考に診療に関する語が入っていないか見る */
  function scanNote(raw) {
    var s = trim(raw);
    if (!s) return { value: '' };
    var lower = s.toLowerCase();
    for (var i = 0; i < MED_WORDS.length; i++) {
      var w = MED_WORDS[i];
      if (s.indexOf(w) !== -1 || lower.indexOf(w.toLowerCase()) !== -1) {
        return { value: '', blocked: w };
      }
    }
    return { value: s };
  }

  function checkValue(type, raw) {
    if (type === 'date') return checkDate(raw);
    if (type === 'time') return checkTime(raw);
    if (type === 'phone') return checkPhone(raw);
    if (type === 'email') return checkEmail(raw);
    if (type === 'consent') return checkConsent(raw);
    if (type === 'minutes') return checkMinutes(raw);
    if (type === 'note') return scanNote(raw);
    return { value: trim(raw) };
  }

  /* ================= 患者台帳の点検と差分 ================= */

  /** 診察券番号から患者さんを引く表。2,200名でも1回作れば速い。 */
  function cardIndex(patients) {
    var idx = {};
    patients.forEach(function (p) {
      var k = trim(p.cardNo);
      if (k && !idx[k]) idx[k] = p;
    });
    return idx;
  }

  G.LIMIT = 5000;

  G.checkPatients = function (ctx, parsed, map) {
    var out = { errors: [], warnings: [], creates: [], updates: [], same: 0 };
    var idx = cardIndex(ctx.patients);
    var seen = {};

    if (parsed.rows.length > G.LIMIT) {
      out.errors.push({ line: 0, column: '', message:
        'この1本で取り込めるのは ' + G.LIMIT + ' 行までです（' + parsed.rows.length + ' 行ありました）。ファイルを分けてください。' });
      return out;
    }

    parsed.rows.forEach(function (r) {
      var rec = {};
      var bad = false;

      G.PATIENT_COLUMNS.forEach(function (col) {
        var at = map[col.key];
        var raw = at >= 0 ? r.cells[at] : '';
        var res = checkValue(col.type, raw);
        if (res.error) {
          out.errors.push({ line: r.line, column: col.label, value: trim(raw), message: res.error });
          bad = true;
          return;
        }
        if (res.blocked) {
          out.warnings.push({ line: r.line, column: col.label, word: res.blocked, message:
            '診療に関する語（' + res.blocked + '）が入っていたため、この欄は空欄で取り込みます。カルテ側でご管理ください' });
        }
        rec[col.key] = res.value;
      });

      if (!bad && !trim(rec.cardNo)) {
        out.errors.push({ line: r.line, column: '診察券番号', value: '', message: '必ずお入れください' });
        bad = true;
      }
      if (!bad && !trim(rec.name)) {
        out.errors.push({ line: r.line, column: '氏名', value: '', message: '必ずお入れください' });
        bad = true;
      }
      if (bad) return;

      var card = trim(rec.cardNo);
      if (seen[card]) {
        out.errors.push({ line: r.line, column: '診察券番号', value: card, message:
          '同じ診察券番号が ' + seen[card] + '行目にもあります。どちらか一方にしてください' });
        return;
      }
      seen[card] = r.line;

      var hit = idx[card];
      if (!hit) {
        out.creates.push({ line: r.line, rec: rec });
        return;
      }
      var changes = [];
      G.PATIENT_COLUMNS.forEach(function (col) {
        if (map[col.key] < 0) return;                    // その列がCSVに無ければ触らない
        var next = rec[col.key];
        if (col.type === 'consent') {
          if (next === null) return;                     // 未確認は現状のままにする
          var now = hit[col.key] !== false;
          if (now === next) return;
          changes.push({ label: col.label, from: now ? '可' : '否', to: next ? '可' : '否', key: col.key, value: next });
          return;
        }
        if (next === '' ) return;                        // 空欄で上書きして消さない
        var cur = trim(hit[col.key]);
        if (cur === trim(next)) return;
        changes.push({ label: col.label, from: cur, to: next, key: col.key, value: next });
      });
      if (!changes.length) { out.same++; return; }
      out.updates.push({ line: r.line, id: hit.id, card: card, name: hit.name, changes: changes });
    });

    return out;
  };

  /* ================= ご予約の点検と差分 ================= */

  G.checkBookings = function (ctx, parsed, map) {
    var cfg = ctx.cfg;
    var out = { errors: [], warnings: [], creates: [], updates: [], same: 0, skips: [] };
    var idx = cardIndex(ctx.patients);
    var today = M.todayKey();

    if (parsed.rows.length > G.LIMIT) {
      out.errors.push({ line: 0, column: '', message:
        'この1本で取り込めるのは ' + G.LIMIT + ' 行までです（' + parsed.rows.length + ' 行ありました）。ファイルを分けてください。' });
      return out;
    }

    var purposeByLabel = {};
    cfg.purposes.forEach(function (p) { purposeByLabel[norm(p.label)] = p.key; });
    var staffByName = {};
    cfg.staff.forEach(function (s) { staffByName[norm(s.name)] = s.id; });

    /* 日ごとの埋まり具合。1行ごとに作り直すと2年ぶんでは重いので、日付ごとに1回だけ作る。 */
    var occByDate = {};
    var slotsByDate = {};
    function occOf(dateKey) {
      if (occByDate[dateKey]) return occByDate[dateKey];
      var grid = M.buildGrid(cfg, dateKey, ctx.bookings);
      var occ = {};
      Object.keys(grid.cells).forEach(function (k) { occ[k] = true; });
      slotsByDate[dateKey] = grid.slots;
      occByDate[dateKey] = occ;
      return occ;
    }

    /* すでに入っているご予約（診察券番号＋日付＋時刻）。同じものを二重に入れない。 */
    var existing = {};
    ctx.bookings.forEach(function (b) {
      if (!M.occupies(b)) return;
      existing[trim(b.cardNo) + '|' + b.date + '|' + b.time] = b;
    });
    var seen = {};

    parsed.rows.forEach(function (r) {
      var rec = {};
      var bad = false;

      G.BOOKING_COLUMNS.forEach(function (col) {
        var at = map[col.key];
        var raw = at >= 0 ? r.cells[at] : '';
        var res = checkValue(col.type, raw);
        if (res.error) {
          out.errors.push({ line: r.line, column: col.label, value: trim(raw), message: res.error });
          bad = true;
          return;
        }
        if (res.blocked) {
          out.warnings.push({ line: r.line, column: col.label, word: res.blocked, message:
            '診療に関する語（' + res.blocked + '）が入っていたため、この欄は空欄で取り込みます。カルテ側でご管理ください' });
        }
        rec[col.key] = res.value;
      });
      if (bad) return;

      function err(column, value, message) {
        out.errors.push({ line: r.line, column: column, value: value, message: message });
      }

      if (!rec.date) { err('予約日', '', '必ずお入れください'); return; }
      if (!rec.time) { err('開始時刻', '', '必ずお入れください'); return; }
      var card = trim(rec.cardNo);
      if (!card) { err('診察券番号', '', '必ずお入れください'); return; }

      var patient = idx[card];
      if (!patient) {
        err('診察券番号', card, 'この番号の患者さんが台帳にいません。先に患者情報CSVを取り込んでください');
        return;
      }

      if (M.isClosed(cfg, rec.date)) {
        err('予約日', rec.date, 'この日は休診日に設定されています。「設定・連携」の診療時間をご確認ください');
        return;
      }

      var occ = occOf(rec.date);
      var slots = slotsByDate[rec.date];
      var head = -1;
      for (var i = 0; i < slots.length; i++) if (slots[i].time === rec.time) { head = i; break; }
      if (head < 0) {
        err('開始時刻', rec.time, 'この日の診療時間に、その開始時刻の枠がありません（' +
          (slots.length ? slots[0].time + '〜' + slots[slots.length - 1].time : '休診') + 'の範囲で、' +
          cfg.slotMinutes + '分きざみ）');
        return;
      }

      var span = Math.max(1, Math.ceil(rec.minutes / cfg.slotMinutes));
      if (head + span > slots.length || slots[head + span - 1].band !== slots[head].band) {
        err('所要時間（分）', String(rec.minutes), '所要時間が、昼休みまたは診療終了をまたいでいます');
        return;
      }

      var staffId = '';
      if (trim(rec.staff)) {
        staffId = staffByName[norm(rec.staff)] || '';
        if (!staffId) {
          err('担当者', trim(rec.staff), 'この担当者は登録されていません（登録済み：' +
            cfg.staff.map(function (s) { return s.name; }).join('・') + '）');
          return;
        }
      }

      var purposeKey = '';
      if (trim(rec.purpose)) {
        purposeKey = purposeByLabel[norm(rec.purpose)] || '';
        if (!purposeKey) {
          err('処置区分', trim(rec.purpose), 'このご用件は登録されていません（登録済み：' +
            cfg.purposes.map(function (p) { return p.label; }).join('・') + '）');
          return;
        }
      }

      var dupKey = card + '|' + rec.date + '|' + rec.time;
      if (seen[dupKey]) {
        err('予約日', rec.date, '同じ患者さん・同じ日時のご予約が ' + seen[dupKey] + '行目にもあります');
        return;
      }
      seen[dupKey] = r.line;

      if (existing[dupKey]) {
        out.skips.push({ line: r.line, name: patient.name,
          when: M.formatDateLong(rec.date) + ' ' + rec.time,
          reason: 'すでに同じご予約が入っています' });
        return;
      }

      /* チェアを決める。空いているいちばん若い番号に入れる。 */
      var unit = 0;
      for (var u = 0; u < cfg.units.length && !unit; u++) {
        var free = true;
        for (var s2 = 0; s2 < span; s2++) {
          if (occ[(head + s2) + ':' + cfg.units[u].id]) { free = false; break; }
        }
        if (free) unit = cfg.units[u].id;
      }
      if (!unit) {
        err('開始時刻', rec.time, 'この時間は ' + cfg.units.length + '台のチェアがすべて埋まっています');
        return;
      }
      for (var s3 = 0; s3 < span; s3++) occ[(head + s3) + ':' + unit] = true;

      out.creates.push({
        line: r.line,
        rec: {
          id: M.newId(),
          date: rec.date, time: rec.time, span: span, unit: unit,
          patientId: patient.id, name: patient.name, cardNo: card,
          phone: patient.phone || '', email: patient.email || '',
          purpose: purposeKey, staffId: staffId, memo: rec.memo || '',
          status: rec.date < today ? 'done' : 'booked',
          source: 'reception', slotHeld: false,
          createdAt: new Date().toISOString()
        },
        view: {
          when: M.formatDateLong(rec.date) + ' ' + rec.time,
          name: patient.name,
          unit: M.columnLabel(cfg, unit),
          span: span * cfg.slotMinutes + '分',
          purpose: purposeKey ? M.purposeOf(cfg, purposeKey).label : '（未設定）'
        }
      });
    });

    return out;
  };

  /* ================= テンプレートの書き出し ================= */

  var PATIENT_SAMPLE = [
    ['1001', '山田 太郎', 'ヤマダ タロウ', '1980-05-03', '090-1234-5678', 'taro@example.jp',
      '700-0001 岡山県岡山市北区北方1-2-3', '2024-04-10', '2026-06-12', '可', '可', 'ご予約は午前をご希望'],
    ['1002', '佐藤 花子', 'サトウ ハナコ', '1992-11-21', '086-000-0000', '',
      '700-0002 岡山県岡山市北区表町2-3-4', '2025-01-15', '2026-07-02', '否', '可', 'お電話は夕方以降が確実です'],
    ['1003', '鈴木 一郎', 'スズキ イチロウ', '1965-02-08', '09098765432', 'ichiro@example.jp',
      '', '2023-09-01', '2026-05-20', '可', '否', '']
  ];

  /* お日にち・お時間は書き方の見本。実際には、空いている枠に書き換えてお使いいただく。 */
  var BOOKING_SAMPLE = [
    ['2026-08-10', '09:30', '45', '1001', '院長', '定期メンテナンス', '午前をご希望'],
    ['2026-08-10', '10:30', '30', '1002', '', 'う蝕処置', ''],
    ['2026-08-12', '15:00', '30', '1003', '衛生士A', '相談・カウンセリング', 'お車でお越しです']
  ];

  G.templateCSV = function (kind, withSample) {
    var cols = kind === 'booking' ? G.BOOKING_COLUMNS : G.PATIENT_COLUMNS;
    var lines = [csvLine(cols.map(function (c) { return c.label; }))];
    if (withSample) {
      (kind === 'booking' ? BOOKING_SAMPLE : PATIENT_SAMPLE).forEach(function (row) {
        lines.push(csvLine(row));
      });
    }
    return lines.join('\r\n');
  };

  G.saveTemplate = function (kind, withSample) {
    var name = (kind === 'booking' ? 'ご予約' : '患者情報') +
      (withSample ? 'CSV_記入例' : 'CSV_テンプレート') + '.csv';
    download(name, G.templateCSV(kind, withSample));
  };

  /** 取り込む前に、いまの中身をそのまま書き出しておく（戻し先を必ず1本作る） */
  G.backup = function (ctx, kind) {
    if (kind === 'booking') {
      download('取り込み前バックアップ_ご予約_' + stamp() + '.csv', M.toCSV(ctx.cfg, ctx.bookings));
      return;
    }
    var lines = [csvLine(G.PATIENT_COLUMNS.map(function (c) { return c.label; }))];
    ctx.patients.forEach(function (p) {
      lines.push(csvLine([p.cardNo, p.name, p.kana, p.birth, p.phone, p.email, p.address,
        p.firstVisit, p.lastVisit,
        p.mailOK === false ? '否' : '可',
        p.dmOK === false ? '否' : '可',
        p.postOK === false ? '否' : '可',
        p.note]));
    });
    download('取り込み前バックアップ_患者台帳_' + stamp() + '.csv', lines.join('\r\n'));
  };

  /* ================= 取り込みの実行 ================= */

  /**
   * 1件ずつ保存すると、そのたびに全件を書き直すため2,200名では待たされる。
   * 出来上がりの配列を作って1回で入れ替える。
   */
  G.applyPatients = function (ctx, result, pickedUpdates) {
    var prev = ctx.patients.slice();
    var byId = {};
    result.updates.forEach(function (u, i) {
      if (!pickedUpdates[i]) return;
      byId[u.id] = u;
    });

    var next = ctx.patients.map(function (p) {
      var u = byId[p.id];
      if (!u) return p;
      var copy = {};
      Object.keys(p).forEach(function (k) { copy[k] = p[k]; });
      u.changes.forEach(function (ch) {
        copy[ch.key] = ch.value;
      });
      return copy;
    });

    result.creates.forEach(function (c) {
      var p = X.blankPatient();
      G.PATIENT_COLUMNS.forEach(function (col) {
        var v = c.rec[col.key];
        if (col.type === 'consent') { p[col.key] = (v === null ? true : v); return; }
        if (v !== undefined && v !== '') p[col.key] = v;
      });
      next.push(p);
    });

    return ctx.store.replace('patients', next).then(function () {
      G.lastUndo = {
        box: 'patients', prev: prev, at: new Date(),
        label: '患者台帳（新規 ' + result.creates.length + '名・更新 ' +
          Object.keys(byId).length + '名）'
      };
      return { created: result.creates.length, updated: Object.keys(byId).length };
    });
  };

  G.applyBookings = function (ctx, result) {
    var prev = ctx.bookings.slice();
    var next = ctx.bookings.concat(result.creates.map(function (c) { return c.rec; }));
    return ctx.store.replace('bookings', next).then(function () {
      G.lastUndo = {
        box: 'bookings', prev: prev, at: new Date(),
        label: 'ご予約（' + result.creates.length + '件）'
      };
      return { created: result.creates.length, updated: 0 };
    });
  };

  G.undo = function (ctx) {
    if (!G.lastUndo) return Promise.reject(new Error('元に戻せる取り込みがありません。'));
    var u = G.lastUndo;
    return ctx.store.replace(u.box, u.prev).then(function () {
      G.lastUndo = null;
      return u.label;
    });
  };

  G.canUndo = function () { return !!G.lastUndo; };

  /* ================= 画面 ================= */

  var S = null;   // いま進めている取り込みの状態

  function setStep(n) {
    $('mgStep').textContent = '手順 ' + n + ' / 3';
  }

  function showErr(text) {
    var p = $('mgErr');
    if (!text) { p.hidden = true; p.textContent = ''; return; }
    p.hidden = false;
    p.textContent = text;
  }

  function section(host, title) {
    host.appendChild(el('h3', 'mg-h', title));
    var box = el('div', 'mg-sec');
    host.appendChild(box);
    return box;
  }

  function table(host, heads) {
    var t = el('table', 'grid mg-table');
    var thead = el('thead');
    var hr = el('tr');
    heads.forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el('tbody');
    t.appendChild(tb);
    host.appendChild(t);
    return tb;
  }

  /* ---- 手順1：列の対応づけ ---- */

  function renderMapping() {
    setStep(1);
    showErr('');
    var host = $('mgBody');
    clear(host);

    $('mgTitle').textContent = (S.kind === 'booking' ? 'ご予約' : '患者情報') + 'のCSVを取り込む';
    $('mgNext').textContent = '確認して次へ';
    $('mgBack').hidden = true;

    var info = el('p', 'mg-info');
    info.textContent = 'ファイル：' + S.fileName + '／文字コード：' + S.encoding +
      '／' + S.parsed.rows.length + ' 行（見出しの行を除く）';
    host.appendChild(info);

    var lead = el('p', 'mg-lead');
    lead.textContent = 'CSVのどの列が、どの項目になるかをご確認ください。' +
      '列の並びが違っていても、ここで選び直せば取り込めます。' +
      '取り込まない列は「（取り込まない）」を選んでください。';
    host.appendChild(lead);

    if (S.encoding.indexOf('Shift_JIS') !== -1) {
      var note = el('p', 'mg-warn');
      note.textContent = 'このファイルは Excel の標準的な文字コード（Shift_JIS）でした。読み替えて表示しています。' +
        '下の「最初の3行」でお名前が正しく読めていれば、そのままお進みください。';
      host.appendChild(note);
    }

    var tb = table(host, ['システムの項目', 'CSVの見出し', '最初の3行']);
    S.columns.forEach(function (col) {
      var tr = el('tr');
      var th = el('td');
      th.appendChild(el('span', null, col.label));
      if (col.required) th.appendChild(el('span', 'req', '必須'));
      tr.appendChild(th);

      var td = el('td');
      var sel = el('select', 'mg-sel');
      var o0 = el('option', null, '（取り込まない）');
      o0.value = '-1';
      sel.appendChild(o0);
      S.parsed.headers.forEach(function (h, i) {
        var o = el('option', null, (i + 1) + '列目：' + (h || '（見出しなし）'));
        o.value = String(i);
        sel.appendChild(o);
      });
      sel.value = String(S.map[col.key]);
      sel.addEventListener('change', function () {
        S.map[col.key] = Number(sel.value);
        renderSample(preview, col);
      });
      td.appendChild(sel);
      tr.appendChild(td);

      var preview = el('td', 'mg-prev');
      renderSample(preview, col);
      tr.appendChild(preview);

      tb.appendChild(tr);
    });

    var warn = el('p', 'mg-warn');
    warn.textContent = '※ 備考欄に、アレルギー・既往歴・服薬内容など診療に関することは入れないでください。' +
      '入っていた場合、その欄は空欄にして取り込みます。';
    host.appendChild(warn);
  }

  function renderSample(td, col) {
    clear(td);
    var at = S.map[col.key];
    if (at < 0) { td.appendChild(el('span', 'mg-dim', '—')); return; }
    S.parsed.rows.slice(0, 3).forEach(function (r) {
      var v = trim(r.cells[at]);
      td.appendChild(el('div', null, v || '（空欄）'));
    });
  }

  /* ---- 手順2：確認と差分 ---- */

  function renderReview() {
    setStep(2);
    showErr('');
    var host = $('mgBody');
    clear(host);
    $('mgBack').hidden = false;

    var res = S.result;
    var total = res.creates.length + res.updates.length;

    var sum = el('p', 'mg-sum');
    sum.textContent = '新規 ' + res.creates.length + ' 件／更新の候補 ' + res.updates.length + ' 件' +
      '／変更なし ' + (res.same || 0) + ' 件' +
      (res.skips && res.skips.length ? '／すでに入っているもの ' + res.skips.length + ' 件' : '') +
      '／直していただきたい行 ' + res.errors.length + ' 件';
    host.appendChild(sum);

    if (res.errors.length) {
      var eb = section(host, '直していただきたい行（' + res.errors.length + '件）');
      var lead = el('p', 'mg-lead');
      lead.textContent = 'この行は取り込みません。ほかの行はそのまま取り込めます。' +
        'CSVを直してから、もう一度取り込んでください。';
      eb.appendChild(lead);
      var tb = table(eb, ['行', '項目', '入っていた内容', 'どうすればよいか']);
      res.errors.slice(0, 200).forEach(function (e) {
        var tr = el('tr');
        tr.appendChild(el('td', 'mg-line', e.line ? e.line + '行目' : '—'));
        tr.appendChild(el('td', null, e.column || '—'));
        tr.appendChild(el('td', 'mg-val', e.value === '' ? '（空欄）' : (e.value || '—')));
        tr.appendChild(el('td', null, e.message));
        tb.appendChild(tr);
      });
      if (res.errors.length > 200) {
        eb.appendChild(el('p', 'mg-dim', 'ほか ' + (res.errors.length - 200) + ' 件。上から順にお直しください。'));
      }
      var btn = el('button', 'btn', '直していただきたい行をCSVで書き出す');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var lines = [csvLine(['行', '項目', '入っていた内容', 'どうすればよいか'])];
        res.errors.forEach(function (e) {
          lines.push(csvLine([e.line ? e.line + '行目' : '', e.column, e.value, e.message]));
        });
        download('取り込めなかった行_' + stamp() + '.csv', lines.join('\r\n'));
      });
      eb.appendChild(btn);
    }

    if (res.warnings.length) {
      var wb = section(host, '備考を空欄にして取り込む行（' + res.warnings.length + '件）');
      var wtb = table(wb, ['行', '項目', '理由']);
      res.warnings.slice(0, 100).forEach(function (w) {
        var tr = el('tr');
        tr.appendChild(el('td', 'mg-line', w.line + '行目'));
        tr.appendChild(el('td', null, w.column));
        tr.appendChild(el('td', null, w.message));
        wtb.appendChild(tr);
      });
    }

    if (res.updates.length) {
      var ub = section(host, 'すでに台帳にいる方（' + res.updates.length + '名）');
      var ulead = el('p', 'mg-lead');
      ulead.textContent = '同じ診察券番号の方がすでにいらっしゃいます。' +
        '勝手に書き換えることはしません。CSVの内容に直すものだけ、チェックを入れてください。';
      ub.appendChild(ulead);

      var acts = el('div', 'mg-acts');
      var all = el('button', 'btn', 'すべて選ぶ');
      all.type = 'button';
      var none = el('button', 'btn', 'すべて外す');
      none.type = 'button';
      var count = el('span', 'mg-count', '');
      acts.appendChild(all);
      acts.appendChild(none);
      acts.appendChild(count);
      ub.appendChild(acts);

      var utb = table(ub, ['取り込む', '行', '診察券番号', 'お名前', '変わるところ']);
      var boxes = [];
      res.updates.slice(0, 200).forEach(function (u, i) {
        var tr = el('tr');
        var td0 = el('td');
        var cb = el('input');
        cb.type = 'checkbox';
        cb.checked = S.picked[i];
        cb.addEventListener('change', function () { S.picked[i] = cb.checked; refreshCount(); });
        boxes.push(cb);
        td0.appendChild(cb);
        tr.appendChild(td0);
        tr.appendChild(el('td', 'mg-line', u.line + '行目'));
        tr.appendChild(el('td', null, u.card));
        tr.appendChild(el('td', null, u.name));
        var td4 = el('td');
        u.changes.forEach(function (ch) {
          td4.appendChild(el('div', null, ch.label + '：' +
            (ch.from === '' ? '（空欄）' : ch.from) + ' → ' + (ch.to === '' ? '（空欄）' : ch.to)));
        });
        tr.appendChild(td4);
        utb.appendChild(tr);
      });
      if (res.updates.length > 200) {
        ub.appendChild(el('p', 'mg-dim',
          'ほか ' + (res.updates.length - 200) + ' 名は画面に出していません。「すべて選ぶ」は全員に効きます。'));
      }

      function refreshCount() {
        var n = 0;
        S.picked.forEach(function (v) { if (v) n++; });
        count.textContent = res.updates.length + '名のうち ' + n + '名を選んでいます';
      }
      all.addEventListener('click', function () {
        for (var i = 0; i < S.picked.length; i++) S.picked[i] = true;
        boxes.forEach(function (b) { b.checked = true; });
        refreshCount();
      });
      none.addEventListener('click', function () {
        for (var i = 0; i < S.picked.length; i++) S.picked[i] = false;
        boxes.forEach(function (b) { b.checked = false; });
        refreshCount();
      });
      refreshCount();
    }

    if (res.creates.length) {
      var cb2 = section(host, '新しく登録する' + (S.kind === 'booking' ? 'ご予約' : '方') +
        '（' + res.creates.length + '件）');
      if (S.kind === 'booking') {
        var btb = table(cb2, ['行', '日時', 'お名前', 'チェア', '長さ', 'ご用件']);
        res.creates.slice(0, 100).forEach(function (c) {
          var tr = el('tr');
          tr.appendChild(el('td', 'mg-line', c.line + '行目'));
          tr.appendChild(el('td', null, c.view.when));
          tr.appendChild(el('td', null, c.view.name));
          tr.appendChild(el('td', null, c.view.unit));
          tr.appendChild(el('td', null, c.view.span));
          tr.appendChild(el('td', null, c.view.purpose));
          btb.appendChild(tr);
        });
      } else {
        var ptb = table(cb2, ['行', '診察券番号', 'お名前', 'お電話', 'メール']);
        res.creates.slice(0, 100).forEach(function (c) {
          var tr = el('tr');
          tr.appendChild(el('td', 'mg-line', c.line + '行目'));
          tr.appendChild(el('td', null, c.rec.cardNo));
          tr.appendChild(el('td', null, c.rec.name));
          tr.appendChild(el('td', null, c.rec.phone || '—'));
          tr.appendChild(el('td', null, c.rec.email || '—'));
          ptb.appendChild(tr);
        });
      }
      if (res.creates.length > 100) {
        cb2.appendChild(el('p', 'mg-dim', 'ほか ' + (res.creates.length - 100) + ' 件も取り込みます。'));
      }
    }

    if (res.skips && res.skips.length) {
      var sb = section(host, 'すでに入っているため取り込まないもの（' + res.skips.length + '件）');
      var stb = table(sb, ['行', '日時', 'お名前', '理由']);
      res.skips.slice(0, 100).forEach(function (s) {
        var tr = el('tr');
        tr.appendChild(el('td', 'mg-line', s.line + '行目'));
        tr.appendChild(el('td', null, s.when));
        tr.appendChild(el('td', null, s.name));
        tr.appendChild(el('td', null, s.reason));
        stb.appendChild(tr);
      });
    }

    var back = el('p', 'mg-lead');
    back.textContent = '「取り込む」を押すと、まず、いまの内容をバックアップのCSVとして保存します（自動で書き出されます）。' +
      'そのうえで取り込みます。取り込んだ直後であれば、この画面から元に戻せます。';
    host.appendChild(back);

    $('mgNext').textContent = total ? '取り込む' : '取り込むものがありません';
    $('mgNext').disabled = !total;
  }

  /* ---- 手順3：結果 ---- */

  function renderDone(done) {
    setStep(3);
    showErr('');
    var host = $('mgBody');
    clear(host);
    $('mgBack').hidden = true;
    $('mgNext').hidden = true;
    $('mgCancel').textContent = '閉じる';

    var p = el('p', 'mg-sum');
    p.textContent = '取り込みました。新規 ' + done.created + ' 件／更新 ' + done.updated + ' 件。';
    host.appendChild(p);

    var q = el('p', 'mg-lead');
    q.textContent = '内容が思っていたものと違う場合は、下のボタンで取り込む前に戻せます。' +
      'この画面を閉じたあとも「設定・連携」から戻せますが、ブラウザを閉じると戻せなくなります。' +
      'その場合は、先ほど保存されたバックアップCSVを取り込んでください。';
    host.appendChild(q);

    var btn = el('button', 'btn btn--danger', '取り込む前に戻す');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      G.undo(S.ctx).then(function () {
        return S.ctx.refresh();
      }).then(function () {
        clear(host);
        host.appendChild(el('p', 'mg-sum', '取り込む前の状態に戻しました。'));
        if (S.onChange) S.onChange();
      }).catch(function (e) {
        btn.disabled = false;
        showErr(e.message);
      });
    });
    host.appendChild(btn);
  }

  /* ---- 入口 ---- */

  /**
   * @param kind 'patient' | 'booking'
   * @param file 受付の方が選んだCSVファイル
   * @param ctx  { cfg, patients, bookings, store, refresh }
   * @param onChange 取り込み後に呼ぶ（設定画面のボタン表示を直すため）
   */
  G.open = function (kind, file, ctx, onChange) {
    var dlg = $('dlgMigrate');
    var reader = new FileReader();

    reader.onload = function () {
      var dec = G.decode(reader.result);
      var parsed = G.parse(dec.text);

      if (!parsed.headers.length || !parsed.rows.length) {
        window.alert('このファイルからは、取り込める行が見つかりませんでした。\n' +
          '1行目に見出し（診察券番号、氏名 など）、2行目から中身が入っているCSVをお選びください。');
        return;
      }

      S = {
        kind: kind,
        ctx: ctx,
        onChange: onChange,
        fileName: file.name,
        encoding: dec.encoding,
        parsed: parsed,
        columns: kind === 'booking' ? G.BOOKING_COLUMNS : G.PATIENT_COLUMNS,
        picked: [],
        result: null
      };
      S.map = G.autoMap(parsed.headers, S.columns);

      $('mgNext').hidden = false;
      $('mgNext').disabled = false;
      $('mgCancel').textContent = 'やめる';
      renderMapping();
      dlg.showModal();
    };

    reader.onerror = function () {
      window.alert('ファイルを読み取れませんでした。もう一度お試しください。');
    };
    reader.readAsArrayBuffer(file);
  };

  /** 設定画面から1度だけ呼ぶ（ダイアログのボタンを配線する） */
  G.wire = function () {
    var dlg = $('dlgMigrate');

    $('mgCancel').addEventListener('click', function () {
      dlg.close();
      if (S && S.onChange) S.onChange();
      S = null;
    });
    dlg.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      dlg.close();
      if (S && S.onChange) S.onChange();
      S = null;
    });

    $('mgBack').addEventListener('click', function () {
      if (S) renderMapping();
    });

    $('mgNext').addEventListener('click', function () {
      if (!S) return;

      if (!S.result) {
        // 手順1 → 手順2
        var missing = S.columns.filter(function (c) {
          return c.required && S.map[c.key] < 0;
        });
        if (missing.length) {
          showErr('必須の項目に、CSVの列が選ばれていません：' +
            missing.map(function (c) { return c.label; }).join('・'));
          return;
        }
        S.result = S.kind === 'booking'
          ? G.checkBookings(S.ctx, S.parsed, S.map)
          : G.checkPatients(S.ctx, S.parsed, S.map);
        S.picked = S.result.updates.map(function () { return false; });
        renderReview();
        return;
      }

      // 手順2 → 実行
      $('mgNext').disabled = true;
      showErr('');
      try {
        G.backup(S.ctx, S.kind);
      } catch (e) {
        $('mgNext').disabled = false;
        showErr('バックアップを保存できませんでした：' + e.message + '（取り込みは行っていません）');
        return;
      }

      var run = S.kind === 'booking'
        ? G.applyBookings(S.ctx, S.result)
        : G.applyPatients(S.ctx, S.result, S.picked);

      run.then(function (done) {
        return S.ctx.refresh().then(function () {
          renderDone(done);
          if (S.onChange) S.onChange();
        });
      }).catch(function (e) {
        $('mgNext').disabled = false;
        showErr('取り込めませんでした：' + e.message);
      });
    });
  };
})(window.DRB);

/* 受付予約ボード — データ層
 *
 * 画面側は必ずこの store 経由でデータに触る。
 * localStorage と スプレッドシート(GAS) の差はここで吸収するので、
 * 実運用へ移すときに画面側のコードを書き換えなくてよい。
 */
window.DRB = window.DRB || {};

(function (DRB) {
  'use strict';

  /* 保存する箱の一覧。増やすときはここに1行足せば両アダプタに行き渡る。 */
  var BOXES = {
    bookings: { key: 'drb.bookings.v2', idField: 'id', list: 'listBookings', save: 'saveBooking', remove: 'removeBooking', replace: 'replaceBookings' },
    patients: { key: 'drb.patients.v2', idField: 'id', list: 'listPatients', save: 'savePatient', remove: 'removePatient', replace: 'replacePatients' },
    contacts: { key: 'drb.contacts.v2', idField: 'id', list: 'listContacts', save: 'saveContact', remove: null, replace: null },
    messages: { key: 'drb.messages.v2', idField: 'id', list: 'listMessages', save: 'saveMessage', remove: null, replace: null },
    waitlist: { key: 'drb.waitlist.v2', idField: 'id', list: 'listWaitlist', save: 'saveWaitlist', remove: 'removeWaitlist', replace: null }
  };

  DRB.BOXES = BOXES;

  /* ================= ブラウザ内保存 ================= */

  function LocalAdapter() {}

  LocalAdapter.prototype.name = 'ブラウザ内保存';
  LocalAdapter.prototype.canSendMail = false;

  LocalAdapter.prototype.list = function (box) {
    return Promise.resolve(read(BOXES[box].key));
  };

  LocalAdapter.prototype.save = function (box, item) {
    var def = BOXES[box];
    var all = read(def.key);
    var i = indexOf(all, def.idField, item[def.idField]);
    if (i >= 0) all[i] = item; else all.push(item);
    write(def.key, all);
    return Promise.resolve(item);
  };

  LocalAdapter.prototype.remove = function (box, id) {
    var def = BOXES[box];
    write(def.key, read(def.key).filter(function (o) { return o[def.idField] !== id; }));
    return Promise.resolve();
  };

  LocalAdapter.prototype.replace = function (box, items) {
    write(BOXES[box].key, items || []);
    return Promise.resolve((items || []).length);
  };

  /**
   * デモではメールを実際には送らない。
   * 文面は組み立てて送信ログに残すので、画面上の動きは本番と同じになる。
   */
  LocalAdapter.prototype.sendMail = function (item) {
    return Promise.resolve({ id: item.id, state: 'simulated' });
  };

  LocalAdapter.prototype.sendBulk = function (items) {
    return Promise.resolve({
      sent: 0, failed: 0, simulated: items.length,
      results: items.map(function (m) { return { id: m.id, to: m.to, state: 'simulated' }; })
    });
  };

  LocalAdapter.prototype.mailQuota = function () {
    return Promise.resolve({ remaining: null });
  };

  LocalAdapter.prototype.call = function (action) {
    return Promise.reject(new Error('「' + action + '」はスプレッドシート連携を設定してからお使いいただけます。'));
  };

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('保存データの読み込みに失敗しました', e);
      return [];
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function indexOf(list, field, id) {
    for (var i = 0; i < list.length; i++) if (list[i][field] === id) return i;
    return -1;
  }

  /* ================= スプレッドシート（GAS ウェブアプリ） ================= */

  function SheetAdapter(settings) {
    this.endpoint = settings.endpoint;
    this.token = settings.token;
  }

  SheetAdapter.prototype.name = 'スプレッドシート連携';
  SheetAdapter.prototype.canSendMail = true;

  SheetAdapter.prototype.call = function (action, payload) {
    // text/plain にすると GAS 側でプリフライトを避けられる
    return fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: this.token, payload: payload || null })
    }).then(function (res) {
      if (!res.ok) throw new Error('連携先が ' + res.status + ' を返しました');
      return res.json();
    }).then(function (json) {
      if (!json.ok) throw new Error(json.error || '連携先でエラーが起きました');
      return json.data;
    });
  };

  SheetAdapter.prototype.list = function (box) { return this.call(BOXES[box].list); };
  SheetAdapter.prototype.save = function (box, item) { return this.call(BOXES[box].save, item); };

  SheetAdapter.prototype.remove = function (box, id) {
    var def = BOXES[box];
    if (!def.remove) return Promise.resolve();
    return this.call(def.remove, { id: id });
  };

  SheetAdapter.prototype.replace = function (box, items) {
    var def = BOXES[box];
    if (!def.replace) return Promise.reject(new Error(box + ' はまとめて置き換えできません。'));
    return this.call(def.replace, items || []);
  };

  SheetAdapter.prototype.sendMail = function (item) { return this.call('sendMail', item); };

  /** 実行時間の上限に当たらないよう、まとめ送りは小分けにして順に投げる */
  SheetAdapter.prototype.sendBulk = function (items) {
    var self = this;
    var CHUNK = 40;
    var chunks = [];
    for (var i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));

    var total = { sent: 0, failed: 0, simulated: 0, results: [] };
    return chunks.reduce(function (chain, chunk) {
      return chain.then(function () {
        return self.call('sendBulk', { items: chunk }).then(function (r) {
          total.sent += r.sent || 0;
          total.failed += r.failed || 0;
          total.results = total.results.concat(r.results || []);
        });
      });
    }, Promise.resolve()).then(function () { return total; });
  };

  SheetAdapter.prototype.mailQuota = function () { return this.call('mailQuota'); };

  /* ================= 生成 ================= */

  DRB.createStore = function (cfg) {
    var s = (cfg && cfg.storage) || {};
    return (s.mode === 'sheet' && s.endpoint) ? new SheetAdapter(s) : new LocalAdapter();
  };
})(window.DRB);

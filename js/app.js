(function(){
  const MG = window.MG;
  const db = MG.db;

  const views = ['library','download','detail','viewer','settings'];
  const show = name => {
    views.forEach(v => {
      document.getElementById('view-' + v).hidden = (v !== name);
    });
    if (name !== 'viewer' && MG.closeViewer && document.getElementById('view-viewer').hidden) MG.closeViewer();
    document.getElementById('drawer').hidden = true;
    window.scrollTo(0, 0);
  };

  const titles = {
    library:'漫画ライブラリ', download:'ダウンロード',
    detail:'作品詳細', viewer:'', settings:'設定'
  };

  const router = async () => {
    const hash = location.hash.replace(/^#\/?/, '');
    const [route, ...rest] = hash.split('/');
    const arg = rest.join('/');

    if (!route || route === 'library') {
      document.getElementById('appbar-title').textContent = titles.library;
      show('library');
      MG.renderLibrary();
    } else if (route === 'download') {
      document.getElementById('appbar-title').textContent = titles.download;
      show('download');
      MG.renderQueue();
      MG.renderLog();
    } else if (route === 'work') {
      document.getElementById('appbar-title').textContent = titles.detail;
      show('detail');
      MG.renderDetail(decodeURIComponent(arg));
    } else if (route === 'read') {
      document.getElementById('appbar-title').textContent = '';
      show('viewer');
      await MG.openViewer(decodeURIComponent(arg));
    } else if (route === 'settings') {
      document.getElementById('appbar-title').textContent = titles.settings;
      show('settings');
      document.dispatchEvent(new CustomEvent('mg:settings'));
    } else if (route === 's') {
      show('download');
      await handleShare(arg);
    } else {
      location.hash = '#/library';
    }
  };

  /* --- 共有リンク --- */
  const makePayload = async (url, pass) => {
    const obj = { u: url, t: Date.now() };
    if (!pass) return 'u.' + MG.b64u.enc(new TextEncoder().encode(JSON.stringify(obj)));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations: 150000, hash:'SHA-256' },
      base, { name:'AES-GCM', length: 256 }, false, ['encrypt']
    );
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(obj)));
    return 'p.' + MG.b64u.enc(salt) + '.' + MG.b64u.enc(iv) + '.' + MG.b64u.enc(new Uint8Array(ct));
  };

  const readPayload = async (payload, pass) => {
    const [kind, ...parts] = payload.split('.');
    if (kind === 'u') {
      return JSON.parse(new TextDecoder().decode(MG.b64u.dec(parts[0])));
    }
    const salt = MG.b64u.dec(parts[0]);
    const iv = MG.b64u.dec(parts[1]);
    const ct = MG.b64u.dec(parts[2]);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations: 150000, hash:'SHA-256' },
      base, { name:'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  };

  const handleShare = async payload => {
    const input = document.getElementById('dl-url');
    try {
      if (payload.startsWith('p.')) {
        const pass = prompt('共有リンクのパスワード');
        if (!pass) return;
        const obj = await readPayload(payload, pass);
        input.value = obj.u;
      } else {
        const obj = await readPayload(payload, '');
        input.value = obj.u;
      }
      MG.toast('共有作品を読み込みました。「ダウンロード開始」で取り込みます');
      MG.checkDedupe();
    } catch {
      MG.toast('リンクを復号できませんでした');
    }
  };

  MG.openShare = async url => {
    const box = document.getElementById('dl-share-box');
    box.hidden = false;
    document.getElementById('dl-url').value = url;
    MG.checkDedupe();
    document.getElementById('share-make').onclick = async () => {
      const pass = document.getElementById('share-pass').value.trim();
      const payload = await makePayload(url, pass);
      const link = `${location.origin}${location.pathname}#/s/${payload}`;
      const out = document.getElementById('share-out');
      out.hidden = false;
      out.value = link;
      const copy = document.getElementById('share-copy');
      copy.hidden = false;
      copy.onclick = () => {
        navigator.clipboard.writeText(link).then(() => MG.toast('コピーしました'));
      };
    };
  };

  /* --- キュー描画 --- */
  MG.renderQueue = () => {
    const box = document.getElementById('queue');
    const items = MG.queueSnapshot();
    document.getElementById('queue-empty').hidden = items.length > 0;
    box.innerHTML = '';
    for (const t of items) {
      const el = document.createElement('div');
      el.className = 'queue-item';
      const pct = t.total ? (t.done / t.total) * 100 : 0;
      el.innerHTML = `
        <strong>${MG.escapeHtml(t.workId)}</strong>
        <div class="muted">${t.state} — ${MG.escapeHtml(t.message || '')}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>`;
      if (t.state === 'done') {
        const a = document.createElement('a');
        a.href = '#/work/' + encodeURIComponent(t.workId);
        a.textContent = '詳細を開く';
        a.style.fontSize = '12px';
        el.appendChild(a);
      }
      box.appendChild(el);
    }
  };

  MG.renderLog = async () => {
    const rows = await db.logs.orderBy('ts').reverse().limit(200).toArray();
    document.getElementById('log-view').textContent = rows
      .map(r => `${new Date(r.ts).toLocaleString('ja-JP')}\t${r.level}\t${r.message}`)
      .join('\n');
  };

  MG.checkDedupe = async () => {
    const el = document.getElementById('dl-dedupe');
    el.hidden = true;
    try {
      const p = MG.parseUrl(document.getElementById('dl-url').value);
      const w = await db.works.get(p.contentId);
      if (w) {
        el.hidden = false;
        el.innerHTML = `取得済みです: <a href="#/work/${encodeURIComponent(w.id)}">${MG.escapeHtml(w.title)}</a>`;
      }
    } catch {}
  };

  /* --- 起動 --- */
  const init = async () => {
    await MG.applyTheme();
    MG.initLibraryEvents();
    MG.initViewerEvents();
    MG.initSettings();

    document.getElementById('btn-menu').onclick = () => {
      const d = document.getElementById('drawer');
      d.hidden = !d.hidden;
    };
    document.getElementById('btn-theme').onclick = async () => {
      const cur = await MG.settings.get('theme');
      const next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
      await MG.settings.set('theme', next);
      MG.applyTheme();
    };

    document.getElementById('dl-form').addEventListener('submit', async e => {
      e.preventDefault();
      const url = document.getElementById('dl-url').value.trim();
      const folderId = Number(document.getElementById('dl-folder').value) || null;
      try {
        MG.enqueue(url, folderId);
        MG.toast('キューに追加しました');
        document.getElementById('dl-url').value = '';
        document.getElementById('dl-dedupe').hidden = true;
      } catch (err) { MG.toast(err.message); }
    });
    document.getElementById('dl-url').addEventListener('input', () => {
      clearTimeout(MG._dedupeT);
      MG._dedupeT = setTimeout(MG.checkDedupe, 500);
    });
    document.getElementById('dl-pause').onclick = () => { MG.pauseQueue(); MG.toast('停止しました'); };
    document.getElementById('log-export').onclick = async () => {
      const rows = await db.logs.toArray();
      const text = rows.map(r => `${new Date(r.ts).toISOString()}\t${r.level}\t${r.workId || '-'}\t${r.message}`).join('\n');
      MG.downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'download.log');
    };
    document.getElementById('log-clear').onclick = async () => {
      await db.logs.clear();
      MG.renderLog();
    };

    document.addEventListener('mg:queue', MG.renderQueue);
    document.addEventListener('mg:log', () => {
      if (!document.getElementById('view-download').hidden) MG.renderLog();
    });

    if (navigator.storage?.persist) {
      navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); });
    }

    window.addEventListener('hashchange', router);
    await router();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
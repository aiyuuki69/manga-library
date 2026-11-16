(function(){
  const MG = window.MG;
  const db = MG.db;

  MG.applyTheme = async () => {
    const s = await MG.settings.all();
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.style.setProperty('--accent', s.accent);
    document.documentElement.lang = s.lang;
    document.getElementById('set-theme').value = s.theme;
    document.getElementById('set-accent').value = s.accent;
    document.getElementById('set-lang').value = s.lang;
    document.getElementById('set-concurrency').value = s.concurrency;
    document.getElementById('set-proxy').value = s.proxyMode;
    document.getElementById('set-custom-proxy').value = s.customProxy;
  };

  const refreshStorage = async () => {
    const el = document.getElementById('st-text');
    if (!navigator.storage?.estimate) { el.textContent = 'この環境では計測できません'; return; }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const pct = quota ? (usage / quota) * 100 : 0;
    document.getElementById('st-fill').style.width = pct.toFixed(2) + '%';
    el.textContent = `${MG.formatBytes(usage)} / ${MG.formatBytes(quota)} (${pct.toFixed(1)}%)`;
  };

  const refreshPersist = async () => {
    const el = document.getElementById('st-persist-state');
    if (!navigator.storage?.persisted) { el.textContent = 'Persistent Storage API 非対応'; return; }
    const ok = await navigator.storage.persisted();
    el.textContent = ok ? '永続化済み' : '未永続(自動削除の対象になり得ます)';
  };

  MG.initSettings = () => {
    document.getElementById('set-theme').onchange = async e => {
      await MG.settings.set('theme', e.target.value); MG.applyTheme();
    };
    document.getElementById('set-accent').oninput = async e => {
      await MG.settings.set('accent', e.target.value); MG.applyTheme();
    };
    document.getElementById('set-lang').onchange = async e => {
      await MG.settings.set('lang', e.target.value);
      location.reload();
    };
    document.getElementById('set-concurrency').onchange = async e => {
      await MG.settings.set('concurrency', Math.min(6, Math.max(1, Number(e.target.value) || 3)));
    };
    document.getElementById('set-proxy').onchange = e => MG.settings.set('proxyMode', e.target.value);
    document.getElementById('set-custom-proxy').onchange = e => MG.settings.set('customProxy', e.target.value.trim());

    document.getElementById('st-persist').onclick = async () => {
      if (!navigator.storage?.persist) return MG.toast('非対応');
      const ok = await navigator.storage.persist();
      MG.toast(ok ? '永続化しました' : '永続化が許可されませんでした');
      refreshPersist();
    };

    document.getElementById('bk-export').onclick = MG.exportBackup;
    document.getElementById('bk-import').onchange = MG.importBackup;

    document.getElementById('mt-verify').onclick = MG.verifyLibrary;
    document.getElementById('mt-cache').onclick = async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      MG.toast('キャッシュを削除しました');
    };

    document.addEventListener('mg:settings', () => { refreshStorage(); refreshPersist(); });
  };

  /* --- バックアップ --- */
  MG.exportBackup = async () => {
    const works = await db.works.toArray();
    if (!works.length) return MG.toast('作品がありません');
    const zip = new JSZip();
    const index = [];
    let n = 0;
    for (const w of works) {
      if (!w.cbz) continue;
      zip.file(`漫画ライブラリ/${w.contentId}/${w.contentId}.cbz`, w.cbz, { binary: true });
      index.push({
        contentId: w.contentId, contentType: w.contentType, sourceUrl: w.sourceUrl,
        title: w.title, author: w.author, circle: w.circle, parody: w.parody,
        tags: w.tags, category: w.category, posted: w.posted, likes: w.likes,
        description: w.description, coverUrl: w.coverUrl, pageCount: w.pageCount,
        bytes: w.bytes, favorite: w.favorite, lastReadPage: w.lastReadPage,
        readAt: w.readAt, addedAt: w.addedAt
      });
      if (w.cover) zip.file(`漫画ライブラリ/${w.contentId}/cover.jpg`, w.cover, { binary: true });
      n++;
      document.getElementById('bk-state').textContent = `${n}/${works.length}`;
    }
    zip.file('漫画ライブラリ/library.json', JSON.stringify({ version: 1, works: index }, null, 2));
    const logs = await db.logs.toArray();
    zip.file('漫画ライブラリ/download.log',
      logs.map(l => `${new Date(l.ts).toISOString()}\t${l.level}\t${l.workId || '-'}\t${l.message}`).join('\n'));

    const blob = await zip.generateAsync({ type:'blob', compression:'STORE' });
    MG.downloadBlob(blob, `manga-library-backup-${Date.now()}.zip`);
    document.getElementById('bk-state').textContent = '書き出し完了';
  };

  MG.importBackup = async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const zip = await JSZip.loadAsync(file);
    const idxFile = Object.keys(zip.files).find(n => /library\.json$/.test(n));
    if (!idxFile) return MG.toast('library.json が見つかりません');
    const data = JSON.parse(await zip.files[idxFile].async('string'));

    let added = 0, skipped = 0;
    for (const rec of data.works || []) {
      const existing = await db.works.get(rec.contentId);
      if (existing) { skipped++; continue; }
      const cbzPath = Object.keys(zip.files).find(n => n.endsWith(`/${rec.contentId}.cbz`));
      if (!cbzPath) { skipped++; continue; }
      const cbz = await zip.files[cbzPath].async('blob');
      const coverPath = Object.keys(zip.files).find(n => n.endsWith(`/${rec.contentId}/cover.jpg`));
      const cover = coverPath ? await zip.files[coverPath].async('blob') : null;
      await db.works.put({
        ...rec, id: rec.contentId, status:'complete', cbz,
        cover, addedAt: rec.addedAt || Date.now(), updatedAt: Date.now()
      });
      added++;
    }
    document.getElementById('bk-state').textContent = `復元: 追加${added} / 重複スキップ${skipped}`;
    MG.toast(`復元完了 追加${added} スキップ${skipped}`);
    MG.renderLibrary();
  };

  /* --- 整合性確認 --- */
  MG.verifyLibrary = async () => {
    const out = document.getElementById('mt-out');
    out.textContent = '検査中…\n';
    const works = await db.works.toArray();
    let bad = 0;
    for (const w of works) {
      if (w.status !== 'complete') { out.textContent += `未完了: ${w.contentId}\n`; bad++; continue; }
      if (!w.cbz) { out.textContent += `CBZ欠落: ${w.contentId}\n`; bad++; continue; }
      try {
        const { zip, names } = await MG.openCbz(w.cbz);
        if (!names.length) throw new Error('ページ0');
        if (names.length !== (w.pageCount || names.length)) throw new Error(`ページ数不一致 ${names.length}/${w.pageCount}`);
        for (const n of names) {
          const buf = await zip.files[n].async('arraybuffer');
          if (!MG.sniffImage(buf)) throw new Error(`破損 ${n}`);
        }
        out.textContent += `OK: ${w.contentId} (${names.length}p)\n`;
      } catch (err) {
        out.textContent += `NG: ${w.contentId} — ${err.message}\n`;
        bad++;
      }
    }
    out.textContent += `\n完了: ${works.length}件中 ${bad}件に問題\n`;
    await MG.log(bad ? 'warn' : 'info', `verify: ${works.length} checked, ${bad} bad`);
  };
})();
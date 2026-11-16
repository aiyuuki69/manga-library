(function(){
  const MG = window.MG;
  const db = MG.db;

  const queue = [];
  const active = new Map();
  let paused = false;
  let running = false;
  let seq = 0;

  const emit = (id, patch) => {
    const task = queue.find(t => t.id === id);
    if (!task) return;
    Object.assign(task, patch);
    document.dispatchEvent(new CustomEvent('mg:queue'));
  };

  MG.enqueue = (url, folderId = null) => {
    const parsed = MG.parseUrl(url);
    const task = {
      id: 't' + (++seq),
      url: parsed.canonical,
      parsed,
      folderId,
      state: 'waiting',
      done: 0,
      total: 0,
      message: '',
      workId: parsed.contentId
    };
    queue.push(task);
    document.dispatchEvent(new CustomEvent('mg:queue'));
    MG.pump();
    return task;
  };

  MG.queueSnapshot = () => queue.map(t => ({ ...t }));
  MG.pauseQueue = () => { paused = true; };
  MG.resumeQueue = () => { paused = false; MG.pump(); };
  MG.clearFinished = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (['done','error','skipped'].includes(queue[i].state)) queue.splice(i, 1);
    }
    document.dispatchEvent(new CustomEvent('mg:queue'));
  };

  MG.pump = async () => {
    if (running || paused) return;
    running = true;
    try {
      while (!paused) {
        const limit = Math.max(1, Number(await MG.settings.get('concurrency')) || 3);
        while (active.size < limit) {
          const next = queue.find(t => t.state === 'waiting');
          if (!next) break;
          next.state = 'running';
          active.set(next.id, next);
          runTask(next)
            .catch(e => emit(next.id, { state:'error', message: e.message }))
            .finally(() => {
              active.delete(next.id);
              document.dispatchEvent(new CustomEvent('mg:queue'));
              MG.pump();
            });
        }
        if (!active.size) break;
        await MG.sleep(200);
      }
    } finally {
      running = false;
    }
  };

  const runTask = async task => {
    const { parsed } = task;
    const workId = parsed.contentId;

    /* 重複判定 */
    const existing = await db.works.get(workId);
    if (existing && existing.status === 'complete') {
      emit(task.id, { state:'skipped', message:'取得済みのためスキップ' });
      await MG.log('info', `skip (already downloaded): ${workId}`, workId);
      return;
    }

    emit(task.id, { message:'メタデータ取得中' });
    const html = await MG.fetchRes(parsed.canonical, 'text');
    const info = MG.parseWork(html, parsed);
    if (!info.pages.length) throw new Error('ページ画像を検出できませんでした');

    const total = info.pages.length;
    emit(task.id, { total, message:`${total}ページ検出` });

    const work = existing ? { ...existing, ...mapMeta(info) } : {
      id: workId,
      contentId: workId,
      contentType: parsed.contentType,
      sourceUrl: parsed.canonical,
      ...mapMeta(info),
      folderId: task.folderId,
      favorite: 0,
      status: 'partial',
      addedAt: Date.now(),
      updatedAt: Date.now(),
      bytes: 0,
      lastReadPage: 1,
      readAt: 0,
      cbz: null
    };
    work.status = 'partial';
    work.updatedAt = Date.now();
    await db.works.put(work);

    /* 既存ページを再利用(再開) */
    const doneRows = await db.pages.where('workId').equals(workId).toArray();
    const doneIdx = new Set(doneRows.filter(p => p.ok).map(p => p.idx));
    emit(task.id, { done: doneIdx.size });

    for (const page of info.pages) {
      if (paused) { emit(task.id, { state:'waiting', message:'一時停止' }); return; }
      if (doneIdx.has(page.order)) continue;

      let attempt = 0;
      let blob = null;
      while (attempt < 4 && !blob) {
        try {
          blob = await MG.fetchRes(page.url, 'blob');
        } catch (e) {
          attempt++;
          if (attempt >= 4) throw new Error(`ページ${page.order}取得失敗: ${e.message}`);
          await MG.sleep(600 * attempt);
        }
      }

      const head = await blob.slice(0, 16).arrayBuffer();
      const kind = MG.sniffImage(head);
      if (!kind) throw new Error(`ページ${page.order}が画像ではありません`);

      const urlExt = MG.extFromUrl(page.url);
      const ext = ['jpg','jpeg'].includes(kind.ext) ? (urlExt === 'jpeg' ? 'jpg' : kind.ext) : kind.ext;

      await db.pages.where('[workId+idx]').equals([workId, page.order]).delete();
      await db.pages.add({
        workId, idx: page.order, url: page.url, ext,
        mime: kind.mime, blob, bytes: blob.size, ok: 1
      });
      doneIdx.add(page.order);
      emit(task.id, { done: doneIdx.size, message:`${doneIdx.size}/${total}` });
    }

    emit(task.id, { message:'整合性チェック' });
    const all = await db.pages.where('workId').equals(workId).toArray();
    const byIdx = new Map(all.filter(p => p.ok).map(p => [p.idx, p]));
    const missing = [];
    for (let i = 1; i <= total; i++) if (!byIdx.has(i)) missing.push(i);
    if (missing.length) throw new Error(`取得漏れ: ${missing.join(',')}`);

    emit(task.id, { message:'CBZ生成中' });
    const ordered = [];
    for (let i = 1; i <= total; i++) {
      const p = byIdx.get(i);
      ordered.push({ idx: i, ext: p.ext, blob: p.blob });
    }

    const cbz = await MG.buildCbz(work, ordered, (d, t) => {
      emit(task.id, { message:`CBZ ${d}/${t}` });
    });

    /* 表紙は1ページ目 */
    let coverBlob = null;
    if (ordered.length) {
      coverBlob = new Blob([ordered[0].blob], { type: ordered[0].blob.type || 'image/jpeg' });
    }

    work.status = 'complete';
    work.pageCount = total;
    work.bytes = cbz.size;
    work.cbz = cbz;
    work.cover = coverBlob;
    work.coverUrl = info.coverUrl || work.coverUrl || '';
    work.updatedAt = Date.now();
    await db.works.put(work);

    /* ページblobはCBZへ移したので解放 */
    await db.pages.where('workId').equals(workId).delete();

    emit(task.id, { state:'done', message:`完了 ${MG.formatBytes(cbz.size)}` });
    await MG.log('info', `ok ${workId} (${total}p, ${MG.formatBytes(cbz.size)})`, workId);
    document.dispatchEvent(new CustomEvent('mg:library'));
  };

  const mapMeta = info => ({
    title: info.title,
    author: info.author,
    circle: info.circle,
    parody: info.parody,
    tags: info.tags,
    category: info.category,
    posted: info.posted,
    likes: info.likes,
    description: info.description,
    coverUrl: info.coverUrl
  });

  MG.log = MG.log || (async () => {});
})();
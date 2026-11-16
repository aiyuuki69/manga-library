(function(){
  const MG = window.MG;
  const db = MG.db;

  const state = { folderId: null, q: '', tag: null, sort: 'added-desc' };

  MG.libraryState = state;

  MG.coverSrc = work => {
    if (work.cover) return URL.createObjectURL(work.cover);
    return work.coverUrl || '';
  };

  const workQuery = async () => {
    let rows = await db.works.toArray();
    rows = rows.filter(w => w.status === 'complete');
    if (state.folderId !== null) {
      if (state.folderId === 'fav') rows = rows.filter(w => w.favorite);
      else rows = rows.filter(w => w.folderId === state.folderId);
    }
    if (state.q) {
      const q = state.q.toLowerCase();
      rows = rows.filter(w =>
        (w.title || '').toLowerCase().includes(q) ||
        (w.author || '').toLowerCase().includes(q) ||
        (w.circle || '').toLowerCase().includes(q) ||
        (w.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (state.tag) rows = rows.filter(w => (w.tags || []).includes(state.tag));
    const cmp = {
      'added-desc': (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      'read-desc':  (a, b) => (b.readAt || 0) - (a.readAt || 0),
      'title-asc':  (a, b) => (a.title || '').localeCompare(b.title || '', 'ja'),
      'pages-desc': (a, b) => (b.pageCount || 0) - (a.pageCount || 0)
    }[state.sort];
    return rows.sort(cmp);
  };

  MG.renderLibrary = async () => {
    const grid = document.getElementById('cover-grid');
    const rows = await workQuery();

    document.getElementById('grid-count').textContent = rows.length ? `${rows.length}件` : '';
    document.getElementById('grid-empty').hidden = rows.length > 0;
    grid.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const w of rows) {
      const card = document.createElement('div');
      card.className = 'cover';
      card.draggable = true;
      card.dataset.id = w.id;
      const src = MG.coverSrc(w);
      card.innerHTML = `
        ${src ? `<img src="${src}" alt="" loading="lazy">` : ''}
        ${w.favorite ? '<span class="fav">★</span>' : ''}
        <span class="badge">${w.pageCount || 0}p</span>
        <span class="cap">${MG.escapeHtml(w.title)}</span>`;
      card.addEventListener('click', () => { location.hash = '#/work/' + encodeURIComponent(w.id); });
      card.addEventListener('dragstart', e => e.dataTransfer.setData('text/work-id', w.id));
      frag.appendChild(card);
    }
    grid.appendChild(frag);

    renderFolders();
    renderChips(rows);
  };

  const renderFolders = async () => {
    const folders = await db.folders.toArray();
    const grid = document.getElementById('folder-grid');
    const drawer = document.getElementById('drawer-folders');
    const select = document.getElementById('dl-folder');

    grid.innerHTML = '';
    drawer.innerHTML = '';
    const opts = ['<option value="">(ルート)</option>'];
    for (const f of folders) {
      const count = await db.works.where('folderId').equals(f.id).count();
      const el = document.createElement('div');
      el.className = 'folder';
      el.innerHTML = `📁 ${MG.escapeHtml(f.name)} <span class="cnt">${count}</span>`;
      el.addEventListener('click', () => { state.folderId = f.id; MG.renderLibrary(); });
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', async e => {
        e.preventDefault();
        el.classList.remove('drop');
        const id = e.dataTransfer.getData('text/work-id');
        if (id) { await db.works.update(id, { folderId: f.id }); MG.renderLibrary(); }
      });
      el.addEventListener('contextmenu', async e => {
        e.preventDefault();
        if (!confirm(`フォルダ「${f.name}」を削除しますか?(作品はルートへ移動)`)) return;
        await db.works.where('folderId').equals(f.id).modify({ folderId: null });
        await db.folders.delete(f.id);
        if (state.folderId === f.id) state.folderId = null;
        MG.renderLibrary();
      });
      grid.appendChild(el);

      const a = document.createElement('a');
      a.href = '#/library';
      a.textContent = '📁 ' + f.name;
      a.addEventListener('click', () => { state.folderId = f.id; MG.renderLibrary(); });
      drawer.appendChild(a);

      opts.push(`<option value="${f.id}">${MG.escapeHtml(f.name)}</option>`);
    }
    select.innerHTML = opts.join('');
  };

  const renderChips = rows => {
    const counts = new Map();
    for (const w of rows) for (const t of (w.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
    const box = document.getElementById('tag-chips');
    box.innerHTML = '';
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
    for (const [t, c] of top) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = `${t} (${c})`;
      b.setAttribute('aria-pressed', String(state.tag === t));
      b.addEventListener('click', () => {
        state.tag = state.tag === t ? null : t;
        MG.renderLibrary();
      });
      box.appendChild(b);
    }
  };

  MG.renderDetail = async id => {
    const view = document.getElementById('view-detail');
    const w = await db.works.get(id);
    if (!w) { view.innerHTML = '<p class="empty">作品が見つかりません</p>'; return; }
    const src = MG.coverSrc(w);

    view.innerHTML = `
      <div class="detail">
        <div>
          <div class="cover">${src ? `<img src="${src}" alt="">` : ''}</div>
          <div class="row">
            <button class="btn primary" id="d-read">読む</button>
            <button class="btn" id="d-fav">${w.favorite ? '★ 解除' : '☆ お気に入り'}</button>
          </div>
          <div class="row">
            <button class="btn" id="d-export">CBZ書き出し</button>
            <button class="btn" id="d-share">共有リンク</button>
            <button class="btn danger" id="d-del">削除</button>
          </div>
        </div>
        <div>
          <h2>${MG.escapeHtml(w.title)}</h2>
          <p class="muted">${MG.escapeHtml(w.author || '作者不明')}${w.circle ? ' / ' + MG.escapeHtml(w.circle) : ''}</p>
          <p class="muted">${w.pageCount || 0}ページ / ${MG.formatBytes(w.bytes || 0)} / ${w.status === 'complete' ? '取得済み' : '未完了'}</p>
          <p class="muted">最終閲覧: ページ${w.lastReadPage || 1}${w.readAt ? ' (' + new Date(w.readAt).toLocaleString('ja-JP') + ')' : ''}</p>
          <p class="muted">${MG.escapeHtml(w.posted || '')}</p>
          <div>${[...(w.parody || []), ...(w.tags || [])].map(t => `<span class="tag">${MG.escapeHtml(t)}</span>`).join('')}</div>
          <p class="hint"><a href="${MG.escapeHtml(w.sourceUrl)}" target="_blank" rel="noopener">元ページを開く</a></p>
        </div>
      </div>`;

    document.getElementById('d-read').onclick = () => { location.hash = '#/read/' + encodeURIComponent(w.id); };
    document.getElementById('d-fav').onclick = async () => {
      await db.works.update(w.id, { favorite: w.favorite ? 0 : 1 });
      MG.renderDetail(w.id);
    };
    document.getElementById('d-export').onclick = async () => {
      if (!w.cbz) return MG.toast('CBZがありません');
      MG.downloadBlob(w.cbz, `${w.contentId}.cbz`);
    };
    document.getElementById('d-share').onclick = () => MG.openShare(w.sourceUrl);
    document.getElementById('d-del').onclick = async () => {
      if (!confirm(`「${w.title}」を削除しますか?`)) return;
      await db.works.delete(w.id);
      await db.pages.where('workId').equals(w.id).delete();
      await MG.log('info', `deleted ${w.id}`, w.id);
      location.hash = '#/library';
    };
  };

  MG.newFolder = async () => {
    const name = prompt('フォルダ名');
    if (!name) return;
    await db.folders.add({ name: name.trim(), parentId: null, createdAt: Date.now() });
    MG.renderLibrary();
  };

  MG.initLibraryEvents = () => {
    document.getElementById('search').addEventListener('input', e => {
      state.q = e.target.value.trim();
      MG.renderLibrary();
    });
    document.getElementById('sort').addEventListener('change', e => {
      state.sort = e.target.value;
      MG.renderLibrary();
    });
    document.getElementById('btn-new-folder').addEventListener('click', MG.newFolder);
    document.addEventListener('mg:library', () => {
      if (!document.getElementById('view-library').hidden) MG.renderLibrary();
    });
  };
})();
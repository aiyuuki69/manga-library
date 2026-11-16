(function(){
  const MG = window.MG;

  const db = new Dexie('manga_library');
  db.version(1).stores({
    folders: '++id, name, parentId, createdAt',
    works:   'id, sourceUrl, contentType, status, folderId, favorite, addedAt, readAt, title',
    pages:   '++id, [workId+idx], workId, ok',
    logs:    '++id, ts, level, workId',
    meta:    'key'
  });
  MG.db = db;

  MG.settings = {
    defaults: {
      theme: 'system',
      accent: '#7c5cff',
      lang: 'ja',
      concurrency: 3,
      proxyMode: 'auto',
      customProxy: '',
      readerMode: 'paged',
      readerDir: 'rtl'
    },
    async all(){
      const rows = await db.meta.toArray();
      const out = { ...this.defaults };
      for (const r of rows) {
        if (r.key in out) out[r.key] = r.value;
      }
      return out;
    },
    async get(k){
      const r = await db.meta.get(k);
      return r ? r.value : this.defaults[k];
    },
    async set(k, v){ await db.meta.put({ key:k, value:v }); }
  };

  MG.log = async (level, message, workId = null) => {
    const entry = { ts: Date.now(), level, message: String(message), workId };
    await db.logs.add(entry);
    const count = await db.logs.count();
    if (count > 4000) {
      const old = await db.logs.orderBy('id').limit(count - 3000).primaryKeys();
      await db.logs.bulkDelete(old);
    }
    document.dispatchEvent(new CustomEvent('mg:log', { detail: entry }));
  };
})();
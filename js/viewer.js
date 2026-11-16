(function(){
  const MG = window.MG;
  const db = MG.db;

  const st = { work: null, names: [], urls: [], idx: 0, mode: 'paged', dir: 'rtl', zip: null };

  MG.openViewer = async id => {
    const w = await db.works.get(id);
    if (!w || !w.cbz) { MG.toast('CBZがありません'); location.hash = '#/work/' + id; return; }

    st.work = w;
    const { zip, names } = await MG.openCbz(w.cbz);
    st.zip = zip;
    st.names = names;
    st.urls = [];
    st.idx = Math.min(Math.max((w.lastReadPage || 1) - 1, 0), Math.max(names.length - 1, 0));

    const s = await MG.settings.all();
    st.mode = s.readerMode || 'paged';
    st.dir = s.readerDir || 'rtl';
    document.getElementById('vw-mode').value = st.mode;
    document.getElementById('vw-dir').value = st.dir;
    document.getElementById('vw-title').textContent = w.title;

    const slider = document.getElementById('vw-slider');
    slider.max = names.length;
    slider.value = st.idx + 1;

    await render();
  };

  const ensureUrl = async i => {
    if (st.urls[i]) return st.urls[i];
    st.urls[i] = await MG.pageBlobUrl(st.zip, st.names[i]);
    return st.urls[i];
  };

  const stage = () => document.getElementById('vw-stage');

  const render = async () => {
    const s = stage();
    s.className = 'vw-stage ' + st.mode;
    s.innerHTML = '';

    if (st.mode === 'scroll') {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < st.names.length; i++) {
        const img = new Image();
        img.loading = i < 3 ? 'eager' : 'lazy';
        img.src = await ensureUrl(i);
        img.dataset.i = i;
        frag.appendChild(img);
      }
      s.appendChild(frag);
      s.scrollTop = 0;
      const target = s.querySelector(`img[data-i="${st.idx}"]`);
      if (target) target.scrollIntoView();
      s.addEventListener('scroll', onScroll, { passive: true });
    } else if (st.mode === 'spread') {
      const wrap = document.createElement('div');
      wrap.className = 'vw-spread';
      const a = st.idx;
      const b = Math.min(st.idx + 1, st.names.length - 1);
      const order = st.dir === 'rtl' ? [b, a] : [a, b];
      for (const i of order) {
        const img = new Image();
        img.src = await ensureUrl(i);
        wrap.appendChild(img);
      }
      s.appendChild(wrap);
    } else {
      const img = new Image();
      img.src = await ensureUrl(st.idx);
      s.appendChild(img);
    }

    document.getElementById('vw-pos').textContent = `${st.idx + 1} / ${st.names.length}`;
    document.getElementById('vw-slider').value = st.idx + 1;
    savePos();
  };

  let saveT;
  const savePos = () => {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      if (!st.work) return;
      await db.works.update(st.work.id, { lastReadPage: st.idx + 1, readAt: Date.now() });
    }, 400);
  };

  const onScroll = () => {
    const s = stage();
    const imgs = [...s.querySelectorAll('img')];
    const top = s.scrollTop + s.clientHeight * 0.4;
    let cur = 0;
    for (const img of imgs) {
      if (img.offsetTop <= top) cur = Number(img.dataset.i);
    }
    st.idx = cur;
    document.getElementById('vw-pos').textContent = `${cur + 1} / ${st.names.length}`;
    document.getElementById('vw-slider').value = cur + 1;
    savePos();
  };

  const step = d => {
    const n = st.mode === 'spread' ? 2 : 1;
    st.idx = Math.min(Math.max(st.idx + d * n, 0), st.names.length - 1);
    if (st.mode === 'scroll') {
      const t = stage().querySelector(`img[data-i="${st.idx}"]`);
      if (t) t.scrollIntoView({ behavior: 'smooth' });
    } else {
      render();
    }
  };

  MG.closeViewer = () => {
    stage().innerHTML = '';
    st.urls.forEach(u => URL.revokeObjectURL(u));
    st.urls = [];
    st.zip = null;
    st.work = null;
  };

  MG.initViewerEvents = () => {
    document.getElementById('vw-close').onclick = () => { location.hash = '#/library'; };
    document.getElementById('vw-prev').onclick = () => step(st.dir === 'rtl' ? 1 : -1);
    document.getElementById('vw-next').onclick = () => step(st.dir === 'rtl' ? -1 : 1);

    document.getElementById('vw-slider').oninput = e => {
      st.idx = Number(e.target.value) - 1;
      if (st.mode === 'scroll') {
        const t = stage().querySelector(`img[data-i="${st.idx}"]`);
        if (t) t.scrollIntoView();
      } else render();
    };

    document.getElementById('vw-mode').onchange = async e => {
      st.mode = e.target.value;
      await MG.settings.set('readerMode', st.mode);
      render();
    };
    document.getElementById('vw-dir').onchange = async e => {
      st.dir = e.target.value;
      await MG.settings.set('readerDir', st.dir);
      render();
    };

    document.addEventListener('keydown', e => {
      if (document.getElementById('view-viewer').hidden) return;
      if (e.key === 'ArrowRight') step(st.dir === 'rtl' ? -1 : 1);
      if (e.key === 'ArrowLeft') step(st.dir === 'rtl' ? 1 : -1);
      if (e.key === 'Escape') location.hash = '#/library';
    });

    stage().addEventListener('click', e => {
      if (st.mode === 'scroll') return;
      const r = stage().getBoundingClientRect();
      if (e.clientX - r.left > r.width / 2) step(st.dir === 'rtl' ? -1 : 1);
      else step(st.dir === 'rtl' ? 1 : -1);
    });
  };
})();
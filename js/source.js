/* URL解析 + 取得 + HTMLパース */
(function(){
  const MG = window.MG;

  const HOST = 'momon-ga.com';
  const CONTENT_TYPES = new Set(['fanzine','magazine','doujin','comic']);

  const PROXIES = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`
  ];

  MG.parseUrl = raw => {
    let u;
    try { u = new URL(String(raw).trim()); } catch { throw new Error('URLの形式が不正です'); }
    if (!/(^|\.)momon-ga\.com$/.test(u.hostname)) {
      throw new Error('momon-ga.com のURLを入力してください');
    }
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('URLは /{content_type}/{content_id}/ 形式である必要があります');
    const contentType = parts[0];
    const contentId = parts[1];
    if (!CONTENT_TYPES.has(contentType)) {
      throw new Error(`未対応のcontent_type: ${contentType}`);
    }
    if (!/^[a-z0-9_-]+$/i.test(contentId)) throw new Error('content_id が不正です');
    const galleryId = (contentId.match(/(\d{4,})/) || [])[1] || null;
    return {
      contentType,
      contentId,
      galleryId,
      canonical: `https://${HOST}/${contentType}/${contentId}/`
    };
  };

  const proxyUrl = (url, mode, custom) => {
    if (custom) return custom.replace('{url}', encodeURIComponent(url));
    return PROXIES[0](url);
  };

  MG.fetchRes = async (url, kind = 'text') => {
    const s = await MG.settings.all();
    const mode = s.proxyMode || 'auto';
    const attempts = [];
    if (mode !== 'proxy') attempts.push(url);
    if (mode !== 'off') {
      if (s.customProxy) attempts.push(proxyUrl(url, mode, s.customProxy));
      else PROXIES.forEach(p => attempts.push(p(url)));
    }
    let lastErr = null;
    for (const target of attempts) {
      try {
        const res = await fetch(target, {
          referrerPolicy: 'no-referrer',
          credentials: 'omit',
          cache: 'no-store'
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return kind === 'blob' ? await res.blob() : await res.text();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('取得に失敗しました');
  };

  const pickText = (doc, sels) => {
    for (const s of sels) {
      const el = doc.querySelector(s);
      const v = el && (el.textContent || '').trim();
      if (v) return v;
    }
    return '';
  };

  const metaContent = (doc, name) => {
    const el = doc.querySelector(`meta[property="${name}"],meta[name="${name}"]`);
    return el ? (el.getAttribute('content') || '').trim() : '';
  };

  MG.parseWork = (html, parsed) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const tagsOf = groupLabel => {
      const out = [];
      doc.querySelectorAll('.post-tag-table').forEach(tb => {
        const label = (tb.querySelector('.post-tag-title')?.textContent || '').trim();
        if (label !== groupLabel) return;
        tb.querySelectorAll('a').forEach(a => {
          const t = (a.textContent || '').trim();
          if (t) out.push(t);
        });
      });
      return out;
    };

    const title =
      pickText(doc, ['h1']) ||
      metaContent(doc, 'og:title') ||
      (doc.title || '').replace(/\s*-\s*.*$/, '') ||
      parsed.contentId;

    const author = tagsOf('作者').join(', ');
    const circle = tagsOf('サークル').join(', ');
    const parody = tagsOf('パロディ');
    const tags = tagsOf('内容');
    const category = (doc.querySelector('#post-category')?.textContent || '').trim();
    const pageCountHint = parseInt((doc.querySelector('#post-number')?.textContent || '').replace(/\D/g,''), 10) || 0;
    const posted = (doc.querySelector('#post-time')?.textContent || '').trim();
    const likes = parseInt((doc.querySelector('#post-wpulike')?.textContent || '').replace(/\D/g,''), 10) || 0;
    const coverUrl = doc.querySelector('.history')?.dataset.thumb || metaContent(doc, 'og:image') || '';

    /* ページ画像: DOM順を厳守 */
    const seen = new Set();
    const pages = [];
    const pushImg = (src, order) => {
      if (!src) return;
      let abs;
      try { abs = new URL(src, parsed.canonical).href; } catch { return; }
      if (seen.has(abs)) return;
      if (!/\.(jpe?g|png|webp|gif|avif|bmp)(\?|$)/i.test(abs) && !/\/galleries\//.test(abs)) return;
      seen.add(abs);
      pages.push({ url: abs, order });
    };

    const container = doc.querySelector('#post-hentai') || doc.body;
    let order = 0;
    container.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src');
      pushImg(src, ++order);
    });

    /* フォールバック: galleryId から連番を再構成 */
    if (pages.length < 2 && parsed.galleryId) {
      const host = (pages[0] && new URL(pages[0].url).origin) || 'https://z2.momon-ga.me';
      const ext = pages[0] ? MG.extFromUrl(pages[0].url) : 'webp';
      const limit = Math.max(pageCountHint, 1);
      for (let i = 1; i <= limit; i++) {
        pushImg(`${host}/galleries/${parsed.galleryId}/${i}.${ext}`, i);
      }
    }

    /* 数値サフィックスで安定ソート(同値はDOM順) */
    pages.sort((a, b) => {
      const na = parseInt((a.url.match(/\/(\d+)\.\w+(?:\?|$)/) || [])[1] || 0, 10);
      const nb = parseInt((b.url.match(/\/(\d+)\.\w+(?:\?|$)/) || [])[1] || 0, 10);
      return na === nb ? a.order - b.order : na - nb;
    });

    const description = metaContent(doc, 'description') || metaContent(doc, 'og:description');

    return {
      title, author, circle, parody, tags, category, posted, likes,
      coverUrl, pageCountHint, description, pages
    };
  };

  MG.fetchWorkMeta = async url => {
    const parsed = MG.parseUrl(url);
    const html = await MG.fetchRes(parsed.canonical, 'text');
    const info = MG.parseWork(html, parsed);
    if (!info.pages.length) throw new Error('ページ画像を検出できませんでした(構造変更の可能性)');
    return { parsed, info };
  };
})();
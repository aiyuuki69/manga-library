/* 汎用ヘルパ */
(function(){
  const MG = window.MG = window.MG || {};

  MG.pad3 = n => String(n).padStart(3, '0');

  MG.sleep = ms => new Promise(r => setTimeout(r, ms));

  MG.escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));

  MG.formatBytes = b => {
    if (!b) return '0 B';
    const u = ['B','KB','MB','GB','TB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i ? 1 : 0) + ' ' + u[i];
  };

  MG.extFromUrl = url => {
    try {
      const p = new URL(url).pathname;
      const m = /\.([a-z0-9]{2,5})$/i.exec(p);
      const e = m ? m[1].toLowerCase() : '';
      if (['jpg','jpeg','png','webp','gif','avif','bmp'].includes(e)) {
        return e === 'jpeg' ? 'jpg' : e;
      }
    } catch {}
    return 'jpg';
  };

  /* 先頭バイトから実際の形式を判定。破損チェックも兼ねる */
  MG.sniffImage = buf => {
    const b = new Uint8Array(buf.slice(0, 16));
    const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hex.startsWith('ffd8ff')) return { ext:'jpg', mime:'image/jpeg' };
    if (hex.startsWith('89504e47')) return { ext:'png', mime:'image/png' };
    if (hex.startsWith('47494638')) return { ext:'gif', mime:'image/gif' };
    if (hex.startsWith('52494646') && hex.slice(16,24) === '57454250') return { ext:'webp', mime:'image/webp' };
    if (hex.startsWith('424d')) return { ext:'bmp', mime:'image/bmp' };
    if (hex.slice(8,16).startsWith('66747970')) return { ext:'avif', mime:'image/avif' };
    return null;
  };

  MG.downloadBlob = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };

  MG.toast = (msg, ms = 2600) => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(MG._toastT);
    MG._toastT = setTimeout(() => { el.hidden = true; }, ms);
  };

  MG.modal = html => {
    const m = document.getElementById('modal');
    document.getElementById('modal-body').innerHTML = html;
    m.hidden = false;
    return m;
  };
  MG.closeModal = () => { document.getElementById('modal').hidden = true; };

  MG.b64u = {
    enc(bytes){
      let s = '';
      const b = new Uint8Array(bytes);
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    },
    dec(str){
      const s = atob(str.replace(/-/g,'+').replace(/_/g,'/'));
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    }
  };
})();
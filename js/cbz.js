(function(){
  const MG = window.MG;

  MG.comicInfoXml = (work, pageCount) => {
    const esc = MG.escapeHtml;
    const genres = [...(work.parody || []), ...(work.tags || [])].join(',');
    return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${esc(work.title)}</Title>
  <Series>${esc(work.title)}</Series>
  <Number>1</Number>
  <Summary>${esc(work.description || '')}</Summary>
  <Writer>${esc(work.author || '')}</Writer>
  <Penciller>${esc(work.author || '')}</Penciller>
  <Publisher>${esc(work.circle || 'momon:GA')}</Publisher>
  <Genre>${esc(genres)}</Genre>
  <Web>${esc(work.sourceUrl)}</Web>
  <PageCount>${pageCount}</PageCount>
  <LanguageISO>ja</LanguageISO>
  <Manga>YesAndRightToLeft</Manga>
  <Notes>content_id=${esc(work.contentId)} / downloaded=${new Date().toISOString()}</Notes>
</ComicInfo>
`;
  };

  /* pages: [{idx, ext, blob}] 順序は idx 昇順で渡すこと */
  MG.buildCbz = async (work, pages, onProgress) => {
    const zip = new JSZip();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      zip.file(`${MG.pad3(i + 1)}.${p.ext}`, p.blob, { binary: true });
      if (onProgress) onProgress(i + 1, pages.length);
    }
    zip.file('ComicInfo.xml', MG.comicInfoXml(work, pages.length));
    return zip.generateAsync({
      type: 'blob',
      compression: 'STORE',
      platform: 'DOS',
      mimeType: 'application/vnd.comicbook+zip'
    });
  };

  MG.openCbz = async blob => {
    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files)
      .filter(n => !zip.files[n].dir && !/ComicInfo\.xml$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { zip, names };
  };

  MG.pageBlobUrl = async (zip, name) => {
    const buf = await zip.files[name].async('blob');
    const mime = MG.sniffImage(buf)?.mime || 'application/octet-stream';
    return URL.createObjectURL(new Blob([buf], { type: mime }));
  };
})();
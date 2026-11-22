/* Sıramatik — bilgisayar kontrol paneli */
(() => {
  'use strict';

  const $ = (s, kok = document) => kok.querySelector(s);
  const DEPO_FILTRE = 'sira_panel_gise';

  let durum = null;
  let kartImzasi = '';
  let ayarTaslak = null;   // ayarlar sekmesindeki düzenlenen kopya
  let ayarKirli = false;

  // ------------------------------------------------------------ yardımcılar
  const el = (etiket, ozellik = {}, ...cocuklar) => {
    const e = document.createElement(etiket);
    for (const [k, v] of Object.entries(ozellik)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of cocuklar.flat()) if (c != null) e.append(c);
    return e;
  };

  let tostZaman;
  const tost = (metin, hata = false) => {
    const t = $('#tost');
    t.textContent = metin;
    t.className = 'tost acik' + (hata ? ' hata' : '');
    clearTimeout(tostZaman);
    tostZaman = setTimeout(() => { t.className = 'tost' + (hata ? ' hata' : ''); }, 2800);
  };

  const islem = (ad, veri = {}) => new Promise((coz) => {
    Sira.islem(ad, veri, (hata, sonuc) => {
      if (hata) tost(hata, true);
      coz(hata ? null : (sonuc ?? true));
    });
  });

  const hizmet = (kod) => durum?.hizmetler.find((h) => h.kod === kod);
  const bekleyen = (h) => Math.max(0, h.son_bilet - h.son_cagri);
  const filtre = () => Number(Sira.depoOku(DEPO_FILTRE)) || 0;

  // ------------------------------------------------------------ sekmeler
  document.querySelectorAll('.sekmeler button').forEach((b) => {
    b.addEventListener('click', () => sekmeAc(b.dataset.sekme));
  });

  function sekmeAc(ad) {
    document.querySelectorAll('.sekmeler button').forEach((b) => b.classList.toggle('aktif', b.dataset.sekme === ad));
    $('#sekme-cagri').hidden = ad !== 'cagri';
    $('#sekme-ayarlar').hidden = ad !== 'ayarlar';
    if (ad === 'ayarlar' && !ayarKirli) ayarFormunuDoldur();
  }

  // ------------------------------------------------------------ çağrı sekmesi
  function filtreCiz() {
    const s = $('#gise-filtre');
    const secili = filtre();
    s.replaceChildren(el('option', { value: '', text: 'Tüm gişeler' }),
      ...durum.giseler.map((g) => el('option', { value: g.no, text: g.ad, selected: g.no === secili })));
    const tek = durum.giseler.some((g) => g.no === secili);
    $('#kisayol-ipucu').innerHTML = tek
      ? 'Kısayollar: <kbd>Boşluk</kbd> sıradaki · <kbd>T</kbd> tekrar çağır'
      : 'İpucu: Bu bilgisayar tek bir gişeye aitse yukarıdan seçin; klavye kısayolları açılır.';
  }

  $('#gise-filtre').addEventListener('change', (e) => {
    Sira.depoYaz(DEPO_FILTRE, e.target.value);
    kartImzasi = '';
    ciz();
  });

  function gorunenGiseler() {
    const f = filtre();
    const tek = durum.giseler.filter((g) => g.no === f);
    return tek.length ? tek : durum.giseler;
  }

  function gisekartlariCiz() {
    const kap = $('#gise-kartlari');
    const liste = gorunenGiseler();
    const imza = JSON.stringify([filtre(), liste.map((g) => [g.no, g.ad, g.hizmetler]), durum.hizmetler.map((h) => [h.kod, h.ad])]);
    if (imza !== kartImzasi) {
      kartImzasi = imza;
      kap.classList.toggle('tek', liste.length === 1 && filtre() > 0);
      kap.replaceChildren(...liste.map(giseKartiOlustur));
      if (!liste.length) kap.append(el('div', { class: 'kart' }, el('p', { class: 'bos-metin', text: 'Henüz gişe yok. Ayarlar sekmesinden ekleyin.' })));
    }
    // dinamik kısımlar
    for (const g of liste) {
      const kart = kap.querySelector(`[data-no="${g.no}"]`);
      if (!kart) continue;
      const n = $('.gk-numara', kart);
      n.textContent = g.aktif || '—';
      n.classList.toggle('bos', !g.aktif);
      const h = hizmet(g.aktif_hizmet);
      kart.style.borderTopColor = h ? h.renk : '';
      const son = durum.cagrilar.find((c) => c.gise === g.no);
      $('.gk-alt', kart).textContent = son ? `${h ? h.ad : ''} · ${Sira.saatMetni(son.zaman)}` : 'Henüz çağrı yok';
      const toplam = g.hizmetler.reduce((t, k) => t + (hizmet(k) ? bekleyen(hizmet(k)) : 0), 0);
      $('[data-islem="sonraki"]', kart).textContent = `Sıradaki Çağır${toplam ? ` (${toplam} bekliyor)` : ''}`;
    }
  }

  function giseKartiOlustur(g) {
    const secim = el('select', { class: 'gk-hizmet', title: 'Hangi hizmetten çağrılacak' },
      el('option', { value: '', text: 'Otomatik' }),
      ...g.hizmetler.map((k) => hizmet(k)).filter(Boolean).map((h) => el('option', { value: h.kod, text: `${h.kod} · ${h.ad}` })));
    const elleGirdi = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'No: 12', title: 'Belirli bir numarayı çağır (12 veya B-12)', 'aria-label': 'Numara ile çağır' });

    const kart = el('div', { class: 'kart gise-karti', 'data-no': g.no },
      el('div', { class: 'gk-ust' }, el('h3', { text: g.ad }), secim),
      el('div', { class: 'gk-ekran' },
        el('div', { class: 'gk-numara bos', text: '—' }),
        el('div', { class: 'gk-alt' })),
      el('button', {
        type: 'button', class: 'btn birincil buyuk', 'data-islem': 'sonraki',
        onclick: (e) => sonraki(g.no, secim.value, e.currentTarget),
      }, 'Sıradaki Çağır'),
      el('div', { class: 'gk-satir' },
        el('button', { type: 'button', class: 'btn', onclick: () => tekrar(g.no) }, 'Tekrar'),
        el('form', {
          class: 'gk-elle',
          onsubmit: (e) => { e.preventDefault(); elleCagir(g, secim.value, elleGirdi); },
        }, elleGirdi, el('button', { type: 'submit', class: 'btn' }, 'Çağır'))));
    return kart;
  }

  async function sonraki(no, hizmetKod, dugme) {
    if (dugme) dugme.disabled = true;
    const c = await islem('sonraki', { gise: no, hizmet: hizmetKod || '' });
    if (dugme) setTimeout(() => { dugme.disabled = false; }, 600); // çift tıklamayı engelle
    if (c) tost(`${c.gise_ad} → ${c.numara} çağrıldı`);
  }

  async function tekrar(no) {
    const c = await islem('tekrar', { gise: no });
    if (c) tost(`${c.numara} tekrar çağrıldı`);
  }

  async function elleCagir(g, secilenKod, girdi) {
    const m = String(girdi.value).trim().toUpperCase().match(/^([A-Z]{1,2})?\s*-?\s*(\d{1,4})$/);
    if (!m) { tost('Numara biçimi: 12 veya B-12', true); return; }
    const kod = m[1] || secilenKod || g.hizmetler[0] || '';
    const c = await islem('cagir', { gise: g.no, hizmet: kod, numara: Number(m[2]) });
    if (c) { tost(`${c.gise_ad} → ${c.numara} çağrıldı`); girdi.value = ''; }
  }

  function hizmetTablosuCiz() {
    const kap = $('#hizmet-tablosu');
    if (!durum.hizmetler.length) { kap.replaceChildren(el('p', { class: 'bos-metin', text: 'Hizmet tanımlı değil.' })); return; }
    kap.replaceChildren(...durum.hizmetler.map((h) => el('div', { class: 'hizmet-satiri' },
      el('span', { class: 'rozet', style: { background: h.renk }, text: h.kod }),
      el('div', { class: 'hs-ad' }, h.ad, el('small', { text: `Son bilet ${h.son_bilet} · Son çağrı ${h.son_cagri}` })),
      el('div', { class: 'hs-bekleyen' }, String(bekleyen(h)), el('small', { text: 'bekliyor' })),
      el('button', {
        type: 'button', class: 'btn ince', title: 'Gelen müşteriye numara ver',
        onclick: async () => { const b = await islem('bilet', { hizmet: h.kod }); if (b) tost(`${b.numara} numaralı bilet verildi (önünde ${b.onunuzde} kişi)`); },
      }, '+ Bilet'))));
  }

  function sonCagrilarCiz() {
    const kap = $('#son-cagrilar');
    if (!durum.cagrilar.length) { kap.replaceChildren(el('li', {}, el('span', { class: 'bos-metin', text: 'Henüz çağrı yapılmadı.' }))); return; }
    kap.replaceChildren(...durum.cagrilar.slice(0, 15).map((c) => el('li', {},
      el('span', { class: 'rozet', style: { background: hizmet(c.hizmet)?.renk || '#64748b', minWidth: '10px', height: '10px', padding: 0, borderRadius: '50%' } }),
      el('span', { class: 'sc-numara', text: c.numara }),
      el('span', { class: 'sc-gise', text: c.gise_ad }),
      c.tekrar ? el('span', { class: 'etiket-tekrar', text: 'tekrar' }) : null,
      el('span', { class: 'sc-saat', text: Sira.saatMetni(c.zaman, true) }))));
  }

  function ciz() {
    if (!durum) return;
    $('#isletme-adi').textContent = durum.ayarlar.isletme || 'Kontrol Paneli';
    document.title = `${durum.ayarlar.isletme || 'Sıramatik'} — Panel`;
    filtreCiz();
    gisekartlariCiz();
    hizmetTablosuCiz();
    sonCagrilarCiz();
  }

  // Klavye kısayolları (tek gişe seçiliyken)
  document.addEventListener('keydown', (e) => {
    if ($('#sekme-cagri').hidden || !durum) return;
    if (e.target.closest('input, textarea, select, button')) return;
    const g = durum.giseler.find((x) => x.no === filtre());
    if (!g) return;
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      const kart = document.querySelector(`[data-no="${g.no}"]`);
      sonraki(g.no, kart ? $('.gk-hizmet', kart).value : '', kart && $('[data-islem="sonraki"]', kart));
    } else if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'r') {
      e.preventDefault();
      tekrar(g.no);
    }
  });

  // ------------------------------------------------------------ ayarlar sekmesi
  const form = $('#ayar-formu');

  function ayarFormunuDoldur() {
    if (!durum) return;
    ayarTaslak = {
      hizmetler: durum.hizmetler.map((h) => ({ kod: h.kod, ad: h.ad, renk: h.renk })),
      giseler: durum.giseler.map((g) => ({ no: g.no, ad: g.ad, hizmetler: [...g.hizmetler] })),
    };
    const a = durum.ayarlar;
    for (const k of ['isletme', 'alt_baslik', 'kayan_yazi']) form.elements[k].value = a[k] || '';
    for (const k of ['ses', 'konusma', 'gunluk_sifirla', 'bilet_zorunlu']) form.elements[k].checked = !!a[k];
    ayarKirli = false;
    hizmetDuzenCiz();
    giseDuzenCiz();
  }

  const RENKLER = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  function hizmetDuzenCiz() {
    $('#hizmet-duzen').replaceChildren(...ayarTaslak.hizmetler.map((h, i) => el('div', { class: 'duzen-satiri' },
      el('input', {
        class: 'kod', value: h.kod, maxlength: 2, 'aria-label': 'Kod', title: 'Harf kodu (A, B, C…)',
        oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); h.kod = e.target.value; },
        onchange: giseDuzenCiz,
      }),
      el('input', { class: 'ad', value: h.ad, maxlength: 40, 'aria-label': 'Hizmet adı', oninput: (e) => { h.ad = e.target.value; } }),
      el('input', { type: 'color', value: h.renk, 'aria-label': 'Renk', oninput: (e) => { h.renk = e.target.value; } }),
      el('button', {
        type: 'button', class: 'btn sil', title: 'Hizmeti sil', 'aria-label': 'Hizmeti sil',
        onclick: () => { ayarTaslak.hizmetler.splice(i, 1); ayarKirli = true; hizmetDuzenCiz(); giseDuzenCiz(); },
      }, '✕'))));
  }

  function giseDuzenCiz() {
    const kodlar = ayarTaslak.hizmetler.map((h) => h.kod).filter(Boolean);
    $('#gise-duzen').replaceChildren(...ayarTaslak.giseler.map((g, i) => el('div', { class: 'duzen-satiri' },
      el('input', { class: 'ad', value: g.ad, maxlength: 30, 'aria-label': 'Gişe adı', oninput: (e) => { g.ad = e.target.value; } }),
      el('button', {
        type: 'button', class: 'btn sil', title: 'Gişeyi sil', 'aria-label': 'Gişeyi sil',
        onclick: () => { ayarTaslak.giseler.splice(i, 1); ayarKirli = true; giseDuzenCiz(); },
      }, '✕'),
      el('div', { class: 'secimler' }, ...kodlar.map((k) => el('label', { class: 'secim' },
        el('input', {
          type: 'checkbox', checked: g.hizmetler.includes(k),
          onchange: (e) => {
            g.hizmetler = e.target.checked ? [...new Set([...g.hizmetler, k])] : g.hizmetler.filter((x) => x !== k);
          },
        }),
        `${k} · ${ayarTaslak.hizmetler.find((h) => h.kod === k)?.ad || ''}`))))));
  }

  form.addEventListener('input', () => { ayarKirli = true; });

  $('#hizmet-ekle').addEventListener('click', () => {
    const kullanilan = new Set(ayarTaslak.hizmetler.map((h) => h.kod));
    const kod = 'ABCDEFGHJKLMNPRSTUVYZ'.split('').find((k) => !kullanilan.has(k)) || '';
    ayarTaslak.hizmetler.push({ kod, ad: 'Yeni hizmet', renk: RENKLER[ayarTaslak.hizmetler.length % RENKLER.length] });
    ayarKirli = true;
    hizmetDuzenCiz();
    giseDuzenCiz();
  });

  $('#gise-ekle').addEventListener('click', () => {
    const n = ayarTaslak.giseler.length + 1;
    ayarTaslak.giseler.push({ no: 0, ad: `Gişe ${n}`, hizmetler: ayarTaslak.hizmetler.map((h) => h.kod) });
    ayarKirli = true;
    giseDuzenCiz();
  });

  $('#ayar-geri').addEventListener('click', () => { ayarFormunuDoldur(); tost('Değişiklikler geri alındı'); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ayarlar = {};
    for (const k of ['isletme', 'alt_baslik', 'kayan_yazi']) ayarlar[k] = form.elements[k].value;
    for (const k of ['ses', 'konusma', 'gunluk_sifirla', 'bilet_zorunlu']) ayarlar[k] = form.elements[k].checked;
    const ok = await islem('ayar', { ayarlar, hizmetler: ayarTaslak.hizmetler, giseler: ayarTaslak.giseler });
    if (ok) {
      ayarKirli = false;
      tost('Ayarlar kaydedildi — TV ekranı güncellendi');
      setTimeout(ayarFormunuDoldur, 300);
    }
  });

  $('#sifirla').addEventListener('click', async () => {
    if (!confirm('Tüm numaralar, bekleyenler ve çağrı geçmişi sıfırlanacak. Emin misiniz?')) return;
    if (await islem('sifirla')) tost('Numaralar sıfırlandı');
  });

  // ------------------------------------------------------------ adres şeridi
  Sira.istek('GET', '/api/bilgi', null, (hata, b) => {
    if (hata || !b) return;
    const ip = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? b.adresler[0] : location.hostname;
    const kok = `http://${ip}:${b.port}`;
    $('#adres-ekran').textContent = `${kok}/ekran`;
    $('#adres-panel').textContent = `${kok}/panel`;
    $('#adres-bilet').textContent = `${kok}/bilet`;
    $('#adres-serit').hidden = false;
    if (b.surum) $('#surum').textContent = `v${b.surum}`;
  });

  document.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-kopya]');
    if (!k) return;
    try { await navigator.clipboard.writeText(k.textContent); tost('Adres kopyalandı'); } catch { /* yoksay */ }
  });

  // ------------------------------------------------------------ bağlantı
  let ilkDurum = true;
  Sira.baglan((d) => {
    durum = d;
    ciz();
    if (ilkDurum) { ilkDurum = false; if (location.hash === '#ayarlar') sekmeAc('ayarlar'); }
    if (!$('#sekme-ayarlar').hidden && !ayarKirli) ayarFormunuDoldur();
  }, (bagli) => {
    $('#durum-nokta').className = 'nokta ' + (bagli ? 'bagli' : 'kopuk');
    $('#durum-metin').textContent = bagli ? 'Bağlı' : 'Bağlantı yok';
  });
})();

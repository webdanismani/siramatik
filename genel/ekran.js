/*
 * Sıramatik — TV ekranı
 * Kumanda tuşları, anons kuyruğu, zil sesi ve Türkçe sesli okuma.
 * ES5 (eski Tizen / webOS tarayıcıları için).
 */
(function () {
  'use strict';

  var TV_UYGULAMASI = !!window.SIRA_TV_UYGULAMASI; // Tizen/webOS paketinden mi çalışıyoruz?
  var DEPO_SUNUCU = 'sira_sunucu';
  var DEPO_GISE = 'sira_tv_gise';
  var DEPO_SES = 'sira_tv_ses';

  var GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  var AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var GECMIS_SATIR = 5;
  var ANONS_SURESI = 5000;

  var TUS = {
    SOL: 37, YUKARI: 38, SAG: 39, ASAGI: 40, OK: 13,
    KIRMIZI: 403, YESIL: 404, SARI: 405, MAVI: 406
  };
  var GERI_TUSLARI = [10009, 461, 27, 8]; // Tizen, webOS, Esc, Backspace

  var durum = null;
  var sonGorulenId = -1;
  var ilkVeri = true;
  var kuyruk = [];
  var anonsSuruyor = false;
  var gosterilen = null;
  var seciliGiseNo = parseInt(Sira.depoOku(DEPO_GISE), 10) || 0;
  var sesAcik = Sira.depoOku(DEPO_SES) !== '0';
  var kumandaZaman = null;
  var bildirimZaman = null;
  var baglantiZaman = null;
  var sesBag = null;
  var sonKayanMetin = null;
  var islemBekliyor = false;

  function $(id) { return document.getElementById(id); }
  function goster(id, acik) {
    var el = $(id);
    if (!el) return;
    if (acik) el.className = el.className.replace(/\s*gizli/g, '');
    else if (el.className.indexOf('gizli') < 0) el.className += ' gizli';
  }
  function acikMi(id) { return $(id).className.indexOf('gizli') < 0; }

  // ------------------------------------------------------------------ ölçek & saat
  function olcekle() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var t = 'scale(' + s + ')';
    var sahne = $('sahne');
    sahne.style.webkitTransform = t;
    sahne.style.transform = t;
  }

  function saatGuncelle() {
    var d = new Date();
    Sira.yaz('saat', Sira.iki(d.getHours()) + ':' + Sira.iki(d.getMinutes()));
    Sira.yaz('tarih', d.getDate() + ' ' + AYLAR[d.getMonth()] + ' ' + d.getFullYear() + ', ' + GUNLER[d.getDay()]);
  }

  // ------------------------------------------------------------------ yardımcılar
  function hizmet(kod) {
    if (!durum) return null;
    for (var i = 0; i < durum.hizmetler.length; i++) if (durum.hizmetler[i].kod === kod) return durum.hizmetler[i];
    return null;
  }
  function renk(kod) { var h = hizmet(kod); return h ? h.renk : '#3b82f6'; }

  function seciliGise() {
    if (!durum || !durum.giseler.length) return null;
    for (var i = 0; i < durum.giseler.length; i++) if (durum.giseler[i].no === seciliGiseNo) return durum.giseler[i];
    seciliGiseNo = durum.giseler[0].no;
    return durum.giseler[0];
  }

  function bildir(metin, hata) {
    var el = $('bildirim');
    el.textContent = metin;
    el.className = 'bildirim' + (hata ? ' hata' : '');
    clearTimeout(bildirimZaman);
    bildirimZaman = setTimeout(function () { goster('bildirim', false); }, 3200);
  }

  // ------------------------------------------------------------------ çizim
  function ciz() {
    if (!durum) return;
    var a = durum.ayarlar;
    Sira.yaz('isletme', a.isletme || 'Sıramatik');
    Sira.yaz('alt-baslik', a.alt_baslik || '');
    document.title = (a.isletme || 'Sıramatik') + ' — Sıra Ekranı';
    kayanYazi(a.kayan_yazi || '');
    if (!anonsSuruyor) buyukGoster(durum.cagrilar[0] || null, false);
    gecmisCiz();
    giselerCiz();
    bekleyenCiz();
    kumandaCiz();
    sesUyarisi();
  }

  function buyukGoster(c, animasyon) {
    gosterilen = c;
    var kutu = $('cagri');
    if (!c) {
      kutu.className = 'cagri bos';
      Sira.yaz('numara', '—');
      Sira.yaz('hedef-gise', 'Hoş geldiniz');
      Sira.yaz('hizmet-ad', '');
      $('hedef').style.background = '';
      $('parilti').style.background = 'none';
      return;
    }
    var r = renk(c.hizmet);
    var h = hizmet(c.hizmet);
    Sira.yaz('numara', c.numara);
    Sira.yaz('hedef-gise', c.gise_ad);
    Sira.yaz('hizmet-ad', h ? h.ad : '');
    $('hedef').style.background = r;
    $('parilti').style.background = 'radial-gradient(circle at 50% 40%, ' + r + ' 0%, rgba(0,0,0,0) 62%)';
    kutu.className = 'cagri';
    if (animasyon) {
      void kutu.offsetWidth; // animasyonu yeniden başlat
      kutu.className = 'cagri yeni';
    }
  }

  function gecmisCiz() {
    var liste = $('gecmis-liste');
    liste.innerHTML = '';
    var adet = 0;
    for (var i = 0; i < durum.cagrilar.length && adet < GECMIS_SATIR; i++) {
      var c = durum.cagrilar[i];
      if (gosterilen && c.id === gosterilen.id) continue;
      var satir = document.createElement('div');
      satir.className = 'satir' + (adet === 0 && anonsSuruyor ? ' ilk' : '');
      var sol = document.createElement('div');
      sol.className = 's-numara';
      var nokta = document.createElement('span');
      nokta.className = 's-nokta';
      nokta.style.background = renk(c.hizmet);
      sol.appendChild(nokta);
      sol.appendChild(document.createTextNode(c.numara));
      var sag = document.createElement('div');
      sag.className = 's-gise';
      sag.textContent = c.gise_ad;
      satir.appendChild(sol);
      satir.appendChild(sag);
      liste.appendChild(satir);
      adet++;
    }
    if (!adet) {
      var bos = document.createElement('div');
      bos.className = 'bos-not';
      bos.textContent = 'Henüz çağrı yapılmadı';
      liste.appendChild(bos);
    }
  }

  function giselerCiz() {
    var kap = $('giseler');
    kap.innerHTML = '';
    kap.className = 'giseler' + (durum.giseler.length > 5 ? ' cok' : '');
    var kumandaAcik = acikMi('kumanda');
    var secili = seciliGise();
    for (var i = 0; i < durum.giseler.length && i < 9; i++) {
      var g = durum.giseler[i];
      var kart = document.createElement('div');
      kart.className = 'gise-kart' + (kumandaAcik && secili && secili.no === g.no ? ' secili' : '');
      kart.style.borderTopColor = g.aktif_hizmet ? renk(g.aktif_hizmet) : '#334155';
      var ad = document.createElement('div');
      ad.className = 'g-ad';
      ad.textContent = g.ad;
      var no = document.createElement('div');
      no.className = 'g-no' + (g.aktif ? '' : ' bos');
      no.textContent = g.aktif || '—';
      kart.appendChild(ad);
      kart.appendChild(no);
      kap.appendChild(kart);
    }
  }

  function bekleyenCiz() {
    var kap = $('bekleyen-liste');
    kap.innerHTML = '';
    var sigan = durum.hizmetler.length > 3 ? 2 : 3; // 3 satır sığar; fazlası "+N hizmet" olur
    for (var i = 0; i < durum.hizmetler.length && i < sigan; i++) {
      var h = durum.hizmetler[i];
      var satir = document.createElement('div');
      satir.className = 'bk-satir';
      var kod = document.createElement('span');
      kod.className = 'bk-kod';
      kod.style.background = h.renk;
      kod.textContent = h.kod;
      var ad = document.createElement('span');
      ad.className = 'bk-ad';
      ad.textContent = h.ad;
      var sayi = document.createElement('span');
      sayi.className = 'bk-sayi';
      sayi.textContent = Math.max(0, h.son_bilet - h.son_cagri);
      satir.appendChild(kod);
      satir.appendChild(ad);
      satir.appendChild(sayi);
      kap.appendChild(satir);
    }
    if (durum.hizmetler.length > sigan) {
      // Fazla hizmet varsa toplamı göster
      var toplam = 0;
      for (var j = sigan; j < durum.hizmetler.length; j++) toplam += Math.max(0, durum.hizmetler[j].son_bilet - durum.hizmetler[j].son_cagri);
      var s = document.createElement('div');
      s.className = 'bk-satir';
      var a = document.createElement('span');
      a.className = 'bk-ad';
      a.textContent = '+' + (durum.hizmetler.length - sigan) + ' hizmet';
      var n = document.createElement('span');
      n.className = 'bk-sayi';
      n.textContent = toplam;
      s.appendChild(a);
      s.appendChild(n);
      kap.appendChild(s);
    }
  }

  function kayanYazi(metin) {
    if (metin === sonKayanMetin) return;
    sonKayanMetin = metin;
    var ic = $('kayan-ic');
    goster('kayan', !!metin);
    ic.textContent = metin;
    if (!metin) return;
    // Hız: saniyede ~130 px
    var genislik = ic.offsetWidth || metin.length * 18;
    var saniye = Math.max(12, Math.round((1920 + genislik) / 130));
    // Yazı, ekran açılır açılmaz görünsün diye animasyon yarı yoldan başlar.
    var gecikme = '-' + Math.round(saniye * 1920 * 0.6 / (1920 + genislik)) + 's';
    ic.style.webkitAnimationDuration = saniye + 's';
    ic.style.animationDuration = saniye + 's';
    ic.style.webkitAnimationDelay = gecikme;
    ic.style.animationDelay = gecikme;
  }

  // ------------------------------------------------------------------ anons
  function yeniCagrilariBul() {
    var maxId = sonGorulenId;
    var yeniler = [];
    for (var i = durum.cagrilar.length - 1; i >= 0; i--) {
      var c = durum.cagrilar[i];
      if (c.id > sonGorulenId) yeniler.push(c);
      if (c.id > maxId) maxId = c.id;
    }
    sonGorulenId = maxId;
    if (ilkVeri) { ilkVeri = false; return; }
    // Uzun bir kopukluktan sonra hepsini tek tek okumayalım: en fazla son 3.
    if (yeniler.length > 3) yeniler = yeniler.slice(yeniler.length - 3);
    for (var j = 0; j < yeniler.length; j++) kuyruk.push(yeniler[j]);
    if (!anonsSuruyor && kuyruk.length) siradakiAnons();
  }

  function siradakiAnons() {
    if (!kuyruk.length) {
      anonsSuruyor = false;
      ciz();
      return;
    }
    anonsSuruyor = true;
    var c = kuyruk.shift();
    buyukGoster(c, true);
    gecmisCiz();
    sesCal(c);
    setTimeout(siradakiAnons, kuyruk.length ? ANONS_SURESI - 800 : ANONS_SURESI);
  }

  // ------------------------------------------------------------------ ses
  function sesBaglami() {
    if (sesBag) return sesBag;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { sesBag = new AC(); } catch (e) { return null; }
    return sesBag;
  }

  function sesKilidiAc() {
    var c = sesBaglami();
    if (c && c.state === 'suspended' && c.resume) {
      try {
        var p = c.resume();
        if (p && p.then) p.then(sesUyarisi);
      } catch (e) { /* yoksay */ }
    }
    setTimeout(sesUyarisi, 400);
  }

  function sesUyarisi() {
    var c = sesBaglami();
    var gerekli = durum && durum.ayarlar.ses && sesAcik && c && c.state === 'suspended';
    goster('ses-uyari', !!gerekli);
  }

  function nota(c, frekans, t, sure, guc) {
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = 'sine';
    o.frequency.value = frekans;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(guc, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + sure + 0.05);
  }

  function zil() {
    var c = sesBaglami();
    if (!c || c.state === 'suspended') return;
    var t = c.currentTime + 0.05;
    // "ding-dong": temel ton + bir oktav üst harmonik
    nota(c, 880, t, 1.0, 0.45);
    nota(c, 1760, t, 0.6, 0.12);
    nota(c, 659.25, t + 0.5, 1.4, 0.45);
    nota(c, 1318.5, t + 0.5, 0.8, 0.12);
  }

  function okunacakMetin(c) {
    var p = String(c.numara).split('-');
    var sayi = parseInt(p[p.length - 1], 10);
    var harf = p.length > 1 ? p[0].split('').join(' ') + ' ' : '';
    return harf + sayi + ' numara, ' + c.gise_ad;
  }

  function konus(metin) {
    var s = window.speechSynthesis;
    if (!s || !window.SpeechSynthesisUtterance) return;
    try {
      s.cancel();
      var u = new SpeechSynthesisUtterance(metin);
      u.lang = 'tr-TR';
      u.rate = 0.9;
      var sesler = s.getVoices ? s.getVoices() : [];
      for (var i = 0; i < sesler.length; i++) {
        if (/^tr/i.test(sesler[i].lang)) { u.voice = sesler[i]; break; }
      }
      s.speak(u);
    } catch (e) { /* TV'de konuşma desteği olmayabilir */ }
  }

  function sesCal(c) {
    if (!durum || !durum.ayarlar.ses || !sesAcik) return;
    zil();
    if (durum.ayarlar.konusma) {
      setTimeout(function () { konus(okunacakMetin(c)); }, 1500);
    }
  }

  // ------------------------------------------------------------------ kumanda
  function kumandaCiz() {
    var g = seciliGise();
    Sira.yaz('k-gise-ad', g ? g.ad : 'Gişe yok');
    Sira.yaz('k-aktif', g && g.aktif ? g.aktif : '—');
  }

  function kumandaAc() {
    var ilk = !acikMi('kumanda');
    goster('kumanda', true);
    clearTimeout(kumandaZaman);
    kumandaZaman = setTimeout(kumandaKapat, 8000);
    if (ilk && durum) { kumandaCiz(); giselerCiz(); }
    return ilk;
  }

  function kumandaKapat() {
    goster('kumanda', false);
    if (durum) giselerCiz();
  }

  function giseDegistir(adim) {
    if (!durum || !durum.giseler.length) return;
    var g = seciliGise();
    var i = 0;
    for (var k = 0; k < durum.giseler.length; k++) if (durum.giseler[k].no === g.no) i = k;
    i = (i + adim + durum.giseler.length) % durum.giseler.length;
    giseSec(durum.giseler[i].no);
  }

  function giseSec(no) {
    seciliGiseNo = no;
    Sira.depoYaz(DEPO_GISE, String(no));
    kumandaCiz();
    giselerCiz();
  }

  function cagriIslemi(ad) {
    var g = seciliGise();
    if (!g) { bildir('Önce bilgisayardan gişe tanımlayın.', true); return; }
    if (islemBekliyor) return;
    islemBekliyor = true;
    Sira.islem(ad, { gise: g.no }, function (hata, sonuc) {
      islemBekliyor = false;
      if (hata) bildir(hata, true);
      else if (sonuc) bildir(g.ad + '  →  ' + sonuc.numara + (ad === 'tekrar' ? ' (tekrar)' : ''));
    });
  }

  function sesDegistir() {
    sesAcik = !sesAcik;
    Sira.depoYaz(DEPO_SES, sesAcik ? '1' : '0');
    bildir(sesAcik ? 'Anons sesi açıldı' : 'Anons sesi kapatıldı', !sesAcik);
    if (!sesAcik && window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) { /* yoksay */ }
    sesUyarisi();
  }

  // ------------------------------------------------------------------ bilgi / kurulum
  function adresleriYaz() {
    var kok = TV_UYGULAMASI ? Sira.taban.replace(/^https?:\/\//, '') : window.location.host;
    Sira.yaz('adres-panel', kok ? 'http://' + kok + '/panel' : '—');
    Sira.yaz('adres-bilet', kok ? 'http://' + kok + '/bilet' : '—');
  }

  function bilgiAc(kurulum) {
    adresleriYaz();
    kumandaKapat();
    goster('bilgi', true);
    goster('bilgi-adresler', !kurulum);
    goster('sunucu-ayari', TV_UYGULAMASI);
    Sira.yaz('bilgi-baslik', kurulum ? 'Sıramatik — İlk Kurulum' : 'Sıramatik — Yardım');
    if (TV_UYGULAMASI) {
      var girdi = $('sunucu-girdi');
      girdi.value = (Sira.depoOku(DEPO_SUNUCU) || '');
      if (kurulum) setTimeout(function () { girdi.focus(); }, 300);
    }
  }

  function bilgiKapat() {
    if (TV_UYGULAMASI && !Sira.depoOku(DEPO_SUNUCU)) return; // kurulum bitmeden kapanmasın
    var girdi = $('sunucu-girdi');
    if (girdi) girdi.blur();
    goster('bilgi', false);
  }

  function sunucuKaydet() {
    var v = String($('sunucu-girdi').value || '').replace(/\s+/g, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!/^[A-Za-z0-9.\-]+(:\d{2,5})?$/.test(v)) {
      bildir('Geçersiz adres. Örnek: 192.168.1.20:8080', true);
      return;
    }
    if (v.indexOf(':') < 0) v += ':8080';
    Sira.depoYaz(DEPO_SUNUCU, v);
    window.location.reload();
  }

  function uygulamadanCik() {
    try {
      if (window.tizen && tizen.application) { tizen.application.getCurrentApplication().exit(); return; }
    } catch (e) { /* yoksay */ }
    try { window.close(); } catch (e2) { /* yoksay */ }
  }

  // ------------------------------------------------------------------ tuşlar
  function tusBas(e) {
    var k = e.keyCode;
    sesKilidiAc();

    // Bilgi / kurulum penceresi açıkken
    if (acikMi('bilgi')) {
      var girdiOdakta = document.activeElement && document.activeElement.id === 'sunucu-girdi';
      if (k === TUS.OK && girdiOdakta) { e.preventDefault(); sunucuKaydet(); return; }
      if (girdiOdakta && k !== 10009 && k !== 461 && k !== 27 && k !== TUS.ASAGI && k !== TUS.YUKARI) return; // yazmaya izin ver
      if (GERI_TUSLARI.indexOf(k) >= 0 || k === TUS.MAVI) { e.preventDefault(); bilgiKapat(); return; }
      if (TV_UYGULAMASI && (k === TUS.OK || k === TUS.YUKARI || k === TUS.ASAGI)) {
        e.preventDefault();
        $('sunucu-girdi').focus();
      }
      return;
    }

    if (k >= 49 && k <= 57 || k >= 97 && k <= 105) { // 1-9 (numpad dahil)
      var sira = (k >= 97 ? k - 96 : k - 48) - 1;
      if (durum && durum.giseler[sira]) { kumandaAc(); giseSec(durum.giseler[sira].no); }
      return;
    }

    switch (k) {
      case TUS.OK:
      case TUS.SAG:
        e.preventDefault();
        if (kumandaAc()) return;       // ilk basış yalnızca menüyü açar (yanlışlıkla çağrıyı önler)
        cagriIslemi('sonraki');
        return;
      case TUS.SOL:
        e.preventDefault();
        if (kumandaAc()) return;
        cagriIslemi('tekrar');
        return;
      case TUS.YUKARI:
      case TUS.ASAGI:
        e.preventDefault();
        if (kumandaAc()) return;
        giseDegistir(k === TUS.ASAGI ? 1 : -1);
        return;
      case TUS.YESIL:
        kumandaAc();
        cagriIslemi('sonraki');
        return;
      case TUS.KIRMIZI:
        kumandaAc();
        cagriIslemi('tekrar');
        return;
      case TUS.SARI:
        sesDegistir();
        return;
      case TUS.MAVI:
        bilgiAc(false);
        return;
    }

    if (GERI_TUSLARI.indexOf(k) >= 0) {
      if (acikMi('kumanda')) { e.preventDefault(); kumandaKapat(); return; }
      if (TV_UYGULAMASI && (k === 10009 || k === 461)) { e.preventDefault(); uygulamadanCik(); }
    }
  }

  function tizenTuslariniKaydet() {
    try {
      if (window.tizen && tizen.tvinputdevice) {
        tizen.tvinputdevice.registerKeyBatch([
          'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
          '1', '2', '3', '4', '5', '6', '7', '8', '9'
        ]);
      }
    } catch (e) { /* tarayıcıdan çalışıyorsa tizen nesnesi yoktur */ }
  }

  // ------------------------------------------------------------------ başlat
  function baglantiDurumu(bagli) {
    clearTimeout(baglantiZaman);
    if (bagli) goster('baglanti', false);
    else baglantiZaman = setTimeout(function () { goster('baglanti', true); }, 3000);
  }

  function baslat() {
    olcekle();
    window.addEventListener('resize', olcekle);
    saatGuncelle();
    setInterval(saatGuncelle, 1000);
    tizenTuslariniKaydet();
    document.addEventListener('keydown', tusBas, false);
    document.addEventListener('click', sesKilidiAc, false);
    if (window.speechSynthesis && window.speechSynthesis.getVoices) window.speechSynthesis.getVoices();

    if (TV_UYGULAMASI) {
      var kayitli = Sira.depoOku(DEPO_SUNUCU);
      if (!kayitli) { bilgiAc(true); return; }
      Sira.taban = 'http://' + kayitli;
    }

    Sira.baglan(function (d) {
      durum = d;
      yeniCagrilariBul();
      ciz();
    }, baglantiDurumu);
  }

  baslat();
})();

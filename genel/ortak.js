/*
 * Sıramatik — ortak bağlantı katmanı
 * Eski TV tarayıcılarıyla (Tizen 2.4+, webOS 3+) uyum için ES5 yazılmıştır.
 */
(function () {
  'use strict';

  var Sira = {
    // TV uygulaması gibi başka bir kökten çalışırken "http://192.168.1.20:8080" olur.
    taban: ''
  };

  Sira.adres = function (yol) {
    return Sira.taban + yol;
  };

  /** JSON isteği. bitti(hata, veri) */
  Sira.istek = function (yontem, yol, govde, bitti) {
    var x = new XMLHttpRequest();
    var tamam = false;
    function son(hata, veri) {
      if (tamam) return;
      tamam = true;
      if (bitti) bitti(hata, veri);
    }
    x.open(yontem, Sira.adres(yol), true);
    x.timeout = 8000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || x.status === 0) return;
      var veri = null;
      try { veri = JSON.parse(x.responseText); } catch (e) { /* yoksay */ }
      if (x.status >= 200 && x.status < 300) son(null, veri);
      else son((veri && veri.hata) || ('Sunucu hatası (' + x.status + ')'), veri);
    };
    x.onerror = function () { son('Sunucuya ulaşılamadı.'); };
    x.ontimeout = function () { son('Sunucu yanıt vermedi.'); };
    if (govde) {
      // text/plain "basit istek" sayılır; TV uygulamasından CORS ön kontrolü gerekmez.
      x.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      x.send(JSON.stringify(govde));
    } else {
      x.send();
    }
  };

  /** Sunucuda işlem çalıştırır. bitti(hata, sonuc) */
  Sira.islem = function (ad, veri, bitti) {
    var govde = {};
    var k;
    if (veri) for (k in veri) if (veri.hasOwnProperty(k)) govde[k] = veri[k];
    govde.islem = ad;
    Sira.istek('POST', '/api/islem', govde, function (hata, cevap) {
      if (bitti) bitti(hata, cevap ? cevap.sonuc : null);
    });
  };

  /**
   * Anlık durum akışına bağlanır. EventSource yoksa 2 sn'de bir yoklar.
   * onDurum(durum), onBaglanti(bagliMi)
   */
  Sira.baglan = function (onDurum, onBaglanti) {
    var es = null;
    var sonSinyal = 0;
    var sonSurum = -1;

    function sinyal() {
      sonSinyal = Date.now();
      onBaglanti(true);
    }

    function isle(d) {
      if (!d || typeof d.surum === 'undefined') return;
      sonSurum = d.surum;
      onDurum(d);
    }

    function ac() {
      if (es) { try { es.close(); } catch (e) { /* yoksay */ } }
      sonSinyal = Date.now();
      es = new EventSource(Sira.adres('/api/akis'));
      es.onopen = sinyal;
      es.onmessage = function (e) {
        sinyal();
        var d;
        try { d = JSON.parse(e.data); } catch (x) { return; }
        isle(d);
      };
      es.addEventListener('ping', sinyal);
      es.onerror = function () {
        onBaglanti(false);
        if (es.readyState === 2) setTimeout(ac, 3000); // kapandıysa kendimiz yeniden açarız
      };
    }

    // ?yokla=1 : anlık akışı engelleyen ağlar/proxy'ler için yoklama moduna zorla
    var yoklamaZorla = /[?&]yokla=1/.test(window.location.search);
    if (window.EventSource && !yoklamaZorla) {
      ac();
      // Sunucu 15 sn'de bir ping atar; 40 sn sessizlik = kopuk bağlantı.
      setInterval(function () {
        if (Date.now() - sonSinyal > 40000) {
          onBaglanti(false);
          ac();
        }
      }, 10000);
    } else {
      (function yokla() {
        Sira.istek('GET', '/api/durum', null, function (hata, d) {
          if (hata) onBaglanti(false);
          else {
            onBaglanti(true);
            if (d && d.surum !== sonSurum) isle(d);
          }
          setTimeout(yokla, 2000);
        });
      })();
    }
  };

  Sira.yaz = function (id, metin) {
    var el = typeof id === 'string' ? document.getElementById(id) : id;
    if (el) el.textContent = metin == null ? '' : String(metin);
  };

  Sira.iki = function (n) {
    return (n < 10 ? '0' : '') + n;
  };

  Sira.saatMetni = function (saniye, saniyeli) {
    var d = new Date(saniye * 1000);
    return Sira.iki(d.getHours()) + ':' + Sira.iki(d.getMinutes()) +
      (saniyeli ? ':' + Sira.iki(d.getSeconds()) : '');
  };

  Sira.depoOku = function (anahtar) {
    try { return window.localStorage.getItem(anahtar); } catch (e) { return null; }
  };

  Sira.depoYaz = function (anahtar, deger) {
    try { window.localStorage.setItem(anahtar, deger); } catch (e) { /* yoksay */ }
  };

  window.Sira = Sira;
})();

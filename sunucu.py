#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sıramatik sunucusu
==================
Aynı yerel ağdaki cihazlara üç sayfa sunar:

  /ekran  -> TV'de açılan sıra ekranı (kumanda ile de kontrol edilir)
  /panel  -> Bilgisayardan kontrol paneli
  /bilet  -> Numara alma (kiosk / tablet / telefon) sayfası

Durum değişiklikleri Server-Sent Events (/api/akis) ile tüm ekranlara anında iletilir.
Harici paket gerekmez: yalnızca Python 3.8+.

Kullanım:  python sunucu.py [port]      (varsayılan port 8080)

Geliştirici : Web Danışmanı — https://webdanismani.com
Destek      : https://oblifex.com
Lisans      : Ücretsiz kullanılabilir, satışı yasaktır (bkz. LICENSE).
"""
import datetime
import json
import os
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

SURUM = "1.0.0"
KOK = os.path.dirname(os.path.abspath(__file__))
GENEL = os.path.join(KOK, "genel")
VERI_DOSYASI = os.path.join(KOK, "veri.json")
PORT = 8080
AZAMI_CAGRI = 30          # geçmişte tutulan çağrı sayısı
AZAMI_GOVDE = 64 * 1024   # POST gövdesi üst sınırı
AZAMI_HIZMET = 20
AZAMI_GISE = 30

SAYFALAR = {"/ekran": "ekran.html", "/panel": "panel.html", "/bilet": "bilet.html"}
TURLER = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}

kilit = threading.Condition()
durum = {}


class IslemHatasi(Exception):
    """Kullanıcıya gösterilecek işlem hatası."""


def bugun():
    return datetime.date.today().isoformat()


def varsayilan_durum():
    return {
        "ayarlar": {
            "isletme": "Sıramatik",
            "alt_baslik": "Sıra Takip Sistemi",
            "kayan_yazi": "Hoş geldiniz! Lütfen numaranız ekranda göründüğünde ilgili gişeye geliniz.",
            "ses": True,
            "konusma": True,
            "gunluk_sifirla": True,
            "bilet_zorunlu": False,
        },
        "hizmetler": [
            {"kod": "A", "ad": "Genel İşlemler", "renk": "#3b82f6", "son_bilet": 0, "son_cagri": 0},
            {"kod": "B", "ad": "Vezne", "renk": "#10b981", "son_bilet": 0, "son_cagri": 0},
        ],
        "giseler": [
            {"no": 1, "ad": "Gişe 1", "hizmetler": ["A", "B"], "aktif": None, "aktif_hizmet": None},
            {"no": 2, "ad": "Gişe 2", "hizmetler": ["A"], "aktif": None, "aktif_hizmet": None},
            {"no": 3, "ad": "Gişe 3", "hizmetler": ["B"], "aktif": None, "aktif_hizmet": None},
        ],
        "cagrilar": [],
        "sayac": 0,
        "surum": 1,
        "tarih": bugun(),
    }


# --------------------------------------------------------------------------- kalıcılık

def yukle():
    global durum
    temel = varsayilan_durum()
    if os.path.isfile(VERI_DOSYASI):
        try:
            with open(VERI_DOSYASI, "r", encoding="utf-8") as f:
                okunan = json.load(f)
            if not isinstance(okunan, dict):
                raise ValueError("geçersiz yapı")
            for anahtar, deger in temel.items():
                okunan.setdefault(anahtar, deger)
            for anahtar, deger in temel["ayarlar"].items():
                okunan["ayarlar"].setdefault(anahtar, deger)
            temel = okunan
        except (OSError, ValueError) as e:
            yedek = VERI_DOSYASI + ".bozuk"
            print(f"! veri.json okunamadı ({e}); {yedek} olarak saklandı, temiz başlanıyor.")
            try:
                os.replace(VERI_DOSYASI, yedek)
            except OSError:
                pass
    durum = temel
    kaydet()


def kaydet():
    gecici = VERI_DOSYASI + ".tmp"
    with open(gecici, "w", encoding="utf-8") as f:
        json.dump(durum, f, ensure_ascii=False, indent=1)
    os.replace(gecici, VERI_DOSYASI)


def degisti():
    """Kilit tutulurken çağrılır: sürümü artırır, kaydeder, dinleyenleri uyandırır."""
    durum["surum"] += 1
    kaydet()
    kilit.notify_all()


# --------------------------------------------------------------------------- yardımcılar

def hizmet_bul(kod):
    for h in durum["hizmetler"]:
        if h["kod"] == kod:
            return h
    return None


def hizmet_al(kod):
    h = hizmet_bul(str(kod or "").upper())
    if not h:
        raise IslemHatasi("Hizmet bulunamadı.")
    return h


def gise_al(v):
    try:
        no = int(v.get("gise"))
    except (TypeError, ValueError):
        raise IslemHatasi("Gişe seçilmedi.")
    for g in durum["giseler"]:
        if g["no"] == no:
            return g
    raise IslemHatasi("Gişe bulunamadı.")


def numara_metni(kod, sayi):
    return f"{kod}-{sayi:03d}"


def cagri_ekle(h, g, sayi, tekrar=False):
    durum["sayac"] += 1
    c = {
        "id": durum["sayac"],
        "numara": numara_metni(h["kod"], sayi),
        "hizmet": h["kod"],
        "gise": g["no"],
        "gise_ad": g["ad"],
        "zaman": int(time.time()),
        "tekrar": tekrar,
    }
    durum["cagrilar"].insert(0, c)
    del durum["cagrilar"][AZAMI_CAGRI:]
    g["aktif"] = c["numara"]
    g["aktif_hizmet"] = h["kod"]
    return c


def sifirla_ic():
    for h in durum["hizmetler"]:
        h["son_bilet"] = 0
        h["son_cagri"] = 0
    for g in durum["giseler"]:
        g["aktif"] = None
        g["aktif_hizmet"] = None
    durum["cagrilar"] = []
    durum["tarih"] = bugun()


def gun_kontrol():
    """Gün değiştiyse ve otomatik sıfırlama açıksa numaraları sıfırlar (kilit içinde)."""
    if durum.get("tarih") != bugun():
        if durum["ayarlar"].get("gunluk_sifirla"):
            sifirla_ic()
        else:
            durum["tarih"] = bugun()
        degisti()


# --------------------------------------------------------------------------- işlemler

def islem_sonraki(v):
    g = gise_al(v)
    istenen = str(v.get("hizmet") or "").upper()
    if istenen:
        adaylar = [hizmet_al(istenen)]
    else:
        adaylar = [h for h in durum["hizmetler"] if h["kod"] in g["hizmetler"]] or list(durum["hizmetler"])
    if not adaylar:
        raise IslemHatasi("Tanımlı hizmet yok.")
    bekleyenler = [h for h in adaylar if h["son_bilet"] > h["son_cagri"]]
    if bekleyenler:
        h = max(bekleyenler, key=lambda x: x["son_bilet"] - x["son_cagri"])
    elif durum["ayarlar"].get("bilet_zorunlu"):
        raise IslemHatasi("Bekleyen numara yok.")
    else:
        h = adaylar[0]
    h["son_cagri"] += 1
    h["son_bilet"] = max(h["son_bilet"], h["son_cagri"])
    return cagri_ekle(h, g, h["son_cagri"])


def islem_tekrar(v):
    g = gise_al(v)
    for i, c in enumerate(durum["cagrilar"]):
        if c["gise"] == g["no"]:
            durum["cagrilar"].pop(i)
            h = hizmet_bul(c["hizmet"]) or {"kod": c["hizmet"]}
            sayi = int(c["numara"].rsplit("-", 1)[-1])
            return cagri_ekle(h, g, sayi, tekrar=True)
    raise IslemHatasi("Bu gişe henüz kimseyi çağırmadı.")


def islem_cagir(v):
    g = gise_al(v)
    kod = str(v.get("hizmet") or "").upper() or (g["hizmetler"][0] if g["hizmetler"] else "")
    h = hizmet_al(kod)
    try:
        sayi = int(v.get("numara"))
    except (TypeError, ValueError):
        raise IslemHatasi("Geçerli bir numara girin.")
    if not 1 <= sayi <= 9999:
        raise IslemHatasi("Numara 1 ile 9999 arasında olmalı.")
    if sayi > h["son_cagri"]:
        h["son_cagri"] = sayi
        h["son_bilet"] = max(h["son_bilet"], sayi)
    return cagri_ekle(h, g, sayi)


def islem_bilet(v):
    h = hizmet_al(v.get("hizmet"))
    if h["son_bilet"] >= 9999:
        raise IslemHatasi("Günlük numara sınırına ulaşıldı.")
    h["son_bilet"] += 1
    return {
        "numara": numara_metni(h["kod"], h["son_bilet"]),
        "hizmet": h["kod"],
        "hizmet_ad": h["ad"],
        "onunuzde": h["son_bilet"] - h["son_cagri"] - 1,
        "zaman": int(time.time()),
    }


def islem_sifirla(v):
    sifirla_ic()
    return None


def islem_ayar(v):
    """Ayarları, hizmetleri ve gişeleri doğrular; hepsi geçerliyse birlikte uygular."""
    ayarlar = dict(durum["ayarlar"])
    gelen = v.get("ayarlar") or {}
    if not isinstance(gelen, dict):
        raise IslemHatasi("Geçersiz ayarlar.")
    for anahtar, sinir in (("isletme", 60), ("alt_baslik", 80), ("kayan_yazi", 500)):
        if anahtar in gelen:
            ayarlar[anahtar] = str(gelen[anahtar] or "").strip()[:sinir]
    for anahtar in ("ses", "konusma", "gunluk_sifirla", "bilet_zorunlu"):
        if anahtar in gelen:
            ayarlar[anahtar] = bool(gelen[anahtar])

    hizmetler = durum["hizmetler"]
    if "hizmetler" in v:
        liste = v.get("hizmetler")
        if not isinstance(liste, list) or not liste:
            raise IslemHatasi("En az bir hizmet tanımlanmalı.")
        if len(liste) > AZAMI_HIZMET:
            raise IslemHatasi(f"En fazla {AZAMI_HIZMET} hizmet tanımlanabilir.")
        eski = {h["kod"]: h for h in durum["hizmetler"]}
        hizmetler, kodlar = [], set()
        for h in liste:
            kod = re.sub(r"[^A-Z]", "", str(h.get("kod", "")).upper())[:2]
            if not kod:
                raise IslemHatasi("Her hizmetin harf kodu olmalı (ör. A).")
            if kod in kodlar:
                raise IslemHatasi(f"'{kod}' kodu birden fazla hizmette kullanılmış.")
            kodlar.add(kod)
            renk = str(h.get("renk") or "")
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", renk):
                renk = "#3b82f6"
            o = eski.get(kod, {})
            hizmetler.append({
                "kod": kod,
                "ad": str(h.get("ad") or kod).strip()[:40] or kod,
                "renk": renk.lower(),
                "son_bilet": int(o.get("son_bilet", 0)),
                "son_cagri": int(o.get("son_cagri", 0)),
            })
    gecerli_kodlar = {h["kod"] for h in hizmetler}

    kaynak = v.get("giseler") if "giseler" in v else durum["giseler"]
    if not isinstance(kaynak, list):
        raise IslemHatasi("Geçersiz gişe listesi.")
    if len(kaynak) > AZAMI_GISE:
        raise IslemHatasi(f"En fazla {AZAMI_GISE} gişe tanımlanabilir.")
    eski_g = {g["no"]: g for g in durum["giseler"]}
    giseler, nolar = [], set()
    # Yeni gişeler, silinmiş bir gişenin numarasını (ve aktif çağrısını) devralmasın.
    sonraki_no = max([int(g.get("no") or 0) for g in kaynak] + list(eski_g) + [durum.get("son_gise_no", 0)]) + 1
    for g in kaynak:
        try:
            no = int(g.get("no") or 0)
        except (TypeError, ValueError):
            no = 0
        if no <= 0 or no in nolar:
            no = sonraki_no
            sonraki_no += 1
        nolar.add(no)
        secili = [k for k in (g.get("hizmetler") or []) if k in gecerli_kodlar]
        o = eski_g.get(no, {})
        giseler.append({
            "no": no,
            "ad": str(g.get("ad") or f"Gişe {no}").strip()[:30] or f"Gişe {no}",
            "hizmetler": secili,
            "aktif": o.get("aktif"),
            "aktif_hizmet": o.get("aktif_hizmet"),
        })

    durum["ayarlar"] = ayarlar
    durum["hizmetler"] = hizmetler
    durum["giseler"] = giseler
    durum["son_gise_no"] = max([g["no"] for g in giseler] + [durum.get("son_gise_no", 0)])
    return None


ISLEMLER = {
    "sonraki": islem_sonraki,
    "tekrar": islem_tekrar,
    "cagir": islem_cagir,
    "bilet": islem_bilet,
    "sifirla": islem_sifirla,
    "ayar": islem_ayar,
}


# --------------------------------------------------------------------------- ağ

def yerel_adresler():
    adresler = []
    try:
        # UDP "connect" paket göndermez; yalnızca hangi arayüzün kullanılacağını öğrenir.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        adresler.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in adresler:
                adresler.append(ip)
    except OSError:
        pass
    return [ip for ip in adresler if not ip.startswith("127.")] or ["127.0.0.1"]


class Isleyici(BaseHTTPRequestHandler):
    server_version = "Siramatik/" + SURUM

    def log_message(self, bicim, *args):
        pass  # sessiz çalış

    # ---- yanıt yardımcıları
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")

    def json_gonder(self, kod, veri):
        govde = (veri if isinstance(veri, str) else json.dumps(veri, ensure_ascii=False)).encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(govde)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(govde)

    def metin_gonder(self, kod, metin):
        govde = metin.encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(govde)))
        self.end_headers()
        self.wfile.write(govde)

    def dosya_gonder(self, ad):
        yol = os.path.normpath(os.path.join(GENEL, unquote(ad).lstrip("/\\")))
        if not yol.startswith(GENEL + os.sep) or not os.path.isfile(yol):
            return self.metin_gonder(404, "Bulunamadı")
        tur = TURLER.get(os.path.splitext(yol)[1].lower(), "application/octet-stream")
        with open(yol, "rb") as f:
            govde = f.read()
        self.send_response(200)
        self.send_header("Content-Type", tur)
        self.send_header("Content-Length", str(len(govde)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(govde)

    # ---- yöntemler
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        yol = urlparse(self.path).path
        if yol == "/":
            self.send_response(302)
            self.send_header("Location", "/panel")
            self.end_headers()
        elif yol in SAYFALAR:
            self.dosya_gonder(SAYFALAR[yol])
        elif yol == "/api/durum":
            with kilit:
                gun_kontrol()
                veri = json.dumps(durum, ensure_ascii=False)
            self.json_gonder(200, veri)
        elif yol == "/api/bilgi":
            self.json_gonder(200, {"adresler": yerel_adresler(), "port": PORT, "surum": SURUM})
        elif yol == "/api/akis":
            self.akis()
        else:
            self.dosya_gonder(yol)

    def do_POST(self):
        if urlparse(self.path).path != "/api/islem":
            return self.json_gonder(404, {"ok": False, "hata": "Bulunamadı"})
        try:
            uzunluk = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            uzunluk = 0
        if uzunluk <= 0 or uzunluk > AZAMI_GOVDE:
            return self.json_gonder(400, {"ok": False, "hata": "Geçersiz istek boyutu"})
        try:
            v = json.loads(self.rfile.read(uzunluk).decode("utf-8"))
            if not isinstance(v, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self.json_gonder(400, {"ok": False, "hata": "Geçersiz istek"})

        fonksiyon = ISLEMLER.get(v.get("islem"))
        if not fonksiyon:
            return self.json_gonder(400, {"ok": False, "hata": "Bilinmeyen işlem"})

        with kilit:
            gun_kontrol()
            try:
                sonuc = fonksiyon(v)
                degisti()
                kod, cevap = 200, {"ok": True, "sonuc": sonuc}
            except IslemHatasi as e:
                kod, cevap = 400, {"ok": False, "hata": str(e)}
            except (TypeError, ValueError, AttributeError):
                kod, cevap = 400, {"ok": False, "hata": "Geçersiz değer gönderildi."}
        self.json_gonder(kod, cevap)

    def akis(self):
        """Server-Sent Events: her değişiklikte tam durumu gönderir, arada ping atar."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._cors()
        self.end_headers()
        son = -1
        try:
            self.wfile.write(b"retry: 3000\n\n")
            while True:
                with kilit:
                    if durum["surum"] == son:
                        kilit.wait(15)
                    veri = None
                    if durum["surum"] != son:
                        son = durum["surum"]
                        veri = json.dumps(durum, ensure_ascii=False)
                if veri is not None:
                    self.wfile.write(("data: " + veri + "\n\n").encode("utf-8"))
                else:
                    self.wfile.write(b"event: ping\ndata: 1\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass


def gun_bekcisi():
    """Gece yarısı otomatik sıfırlamanın ekranlara da yansıması için."""
    while True:
        time.sleep(30)
        with kilit:
            gun_kontrol()


def main():
    global PORT
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])
    elif os.environ.get("SIRA_PORT"):
        PORT = int(os.environ["SIRA_PORT"])

    yukle()
    threading.Thread(target=gun_bekcisi, daemon=True).start()
    try:
        sunucu = ThreadingHTTPServer(("0.0.0.0", PORT), Isleyici)
    except OSError as e:
        print(f"! {PORT} portu açılamadı ({e}). Başka bir port deneyin: python sunucu.py 8090")
        sys.exit(1)

    cizgi = "=" * 62
    print(cizgi)
    print(f"  SIRAMATİK v{SURUM} — SUNUCU ÇALIŞIYOR")
    print("  Web Danışmanı (webdanismani.com) tarafından geliştirilmiştir.")
    print("  Destek & yardım: https://oblifex.com   ·   Satışı yasaktır.")
    print(cizgi)
    for ip in yerel_adresler():
        print(f"  TV ekranı     : http://{ip}:{PORT}/ekran")
        print(f"  Kontrol paneli: http://{ip}:{PORT}/panel")
        print(f"  Bilet sayfası : http://{ip}:{PORT}/bilet")
        print("-" * 62)
    print("  TV ve bilgisayar aynı Wi-Fi / ağda olmalı.")
    print("  Windows güvenlik duvarı sorarsa 'Özel ağlar' için izin verin.")
    print("  Kapatmak için bu pencerede Ctrl+C")
    print(cizgi)
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatılıyor...")
        sunucu.server_close()


if __name__ == "__main__":
    main()

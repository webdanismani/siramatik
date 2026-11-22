#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TV uygulaması klasörlerini hazırlar:
  tv-uygulamasi/tizen  -> Samsung (Tizen Studio ile .wgt yapılır)
  tv-uygulamasi/webos  -> LG (webOS CLI: ares-package ile .ipk yapılır)

Ekran dosyaları (genel/ekran.*) uygulamanın içine kopyalanır; uygulama ilk açılışta
sunucu adresini sorar ve verileri ağ üzerinden o sunucudan çeker.
Ekranı değiştirdikten sonra bu betiği yeniden çalıştırın:  python tv-hazirla.py
"""
import os
import re
import shutil
import struct
import zlib

KOK = os.path.dirname(os.path.abspath(__file__))
GENEL = os.path.join(KOK, "genel")
HEDEF = os.path.join(KOK, "tv-uygulamasi")
with open(os.path.join(KOK, "sunucu.py"), encoding="utf-8") as _f:
    SURUM = re.search(r'^SURUM = "([^"]+)"', _f.read(), re.M).group(1)

TIZEN_CONFIG = f"""<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://siramatik.local/ekran" version="{SURUM}" viewmodes="maximized">
  <tizen:application id="SrMtkEkran.Siramatik" package="SrMtkEkran" required_version="2.3"/>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>
  <icon src="icon.png"/>
  <name>Sıramatik</name>
  <author href="https://webdanismani.com">Web Danışmanı</author>
  <description>Sıra numarası ekranı. Web Danışmanı (webdanismani.com) tarafından geliştirilmiştir. Destek: oblifex.com</description>
  <tizen:profile name="tv-samsung"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable"
                 encryption="disable" install-location="auto" hwkey-event="enable"/>
  <access origin="*" subdomains="true"/>
  <tizen:allow-navigation>*</tizen:allow-navigation>
</widget>
"""

WEBOS_APPINFO = f"""{{
  "id": "com.siramatik.ekran",
  "version": "{SURUM}",
  "vendor": "Web Danışmanı",
  "type": "web",
  "main": "index.html",
  "title": "Sıramatik",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true
}}
"""


def png_yaz(yol, boyut):
    """Harici kütüphane olmadan basit bir uygulama simgesi çizer (degrade zemin + bilet)."""
    satirlar = []
    r_kose = boyut * 0.22
    for y in range(boyut):
        satir = bytearray([0])
        for x in range(boyut):
            # yuvarlatılmış kare maskesi
            dx = max(r_kose - x, 0, x - (boyut - 1 - r_kose))
            dy = max(r_kose - y, 0, y - (boyut - 1 - r_kose))
            icinde = dx * dx + dy * dy <= r_kose * r_kose
            if not icinde:
                satir += bytes([0, 0, 0, 0])
                continue
            t = (x + y) / (2 * boyut)
            r = int(59 + (139 - 59) * t)
            g = int(130 + (92 - 130) * t)
            b = int(246 + (246 - 246) * t)
            # ortada beyaz "bilet" ve üzerinde üç çizgi
            bx0, bx1 = boyut * 0.24, boyut * 0.76
            by0, by1 = boyut * 0.28, boyut * 0.72
            if bx0 <= x <= bx1 and by0 <= y <= by1:
                r, g, b = 255, 255, 255
                for cy in (0.40, 0.50, 0.60):
                    if abs(y - boyut * cy) < boyut * 0.025 and boyut * 0.32 <= x <= boyut * (0.68 if cy != 0.60 else 0.54):
                        r, g, b = 59, 110, 240
            satir += bytes([r, g, b, 255])
        satirlar.append(bytes(satir))
    ham = zlib.compress(b"".join(satirlar), 9)

    def parca(tur, veri):
        return struct.pack(">I", len(veri)) + tur + veri + struct.pack(">I", zlib.crc32(tur + veri) & 0xFFFFFFFF)

    with open(yol, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(parca(b"IHDR", struct.pack(">IIBBBBB", boyut, boyut, 8, 6, 0, 0, 0)))
        f.write(parca(b"IDAT", ham))
        f.write(parca(b"IEND", b""))


def index_uret():
    with open(os.path.join(GENEL, "ekran.html"), "r", encoding="utf-8") as f:
        html = f.read()
    html = html.replace('href="/ekran.css"', 'href="ekran.css"')
    html = html.replace('<script src="/ortak.js"></script>',
                        '<script>window.SIRA_TV_UYGULAMASI = true;</script>\n<script src="ortak.js"></script>')
    html = html.replace('src="/ekran.js"', 'src="ekran.js"')
    return html


def hazirla(ad, ek_dosyalar):
    klasor = os.path.join(HEDEF, ad)
    os.makedirs(klasor, exist_ok=True)
    with open(os.path.join(klasor, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(index_uret())
    for dosya in ("ekran.css", "ekran.js", "ortak.js"):
        shutil.copyfile(os.path.join(GENEL, dosya), os.path.join(klasor, dosya))
    for dosya_adi, icerik in ek_dosyalar.items():
        if isinstance(icerik, int):
            png_yaz(os.path.join(klasor, dosya_adi), icerik)
        else:
            with open(os.path.join(klasor, dosya_adi), "w", encoding="utf-8", newline="\n") as f:
                f.write(icerik)
    print(f"  hazır: {klasor}")


def main():
    print("TV uygulamaları hazırlanıyor…")
    hazirla("tizen", {"config.xml": TIZEN_CONFIG, "icon.png": 512})
    hazirla("webos", {"appinfo.json": WEBOS_APPINFO, "icon.png": 80, "largeIcon.png": 130})
    print("Bitti. Kurulum adımları için README.md > 'TV uygulaması olarak kurmak' bölümüne bakın.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub sürümü (Release) için indirilebilir zip üretir:
  dist/siramatik-v<SURUM>.zip

İçerik: sunucu, sayfalar, TV uygulama klasörleri (hazır üretilmiş), belgeler.
Çalışma verisi (veri.json), git ve geliştirme dosyaları dahil edilmez.

Web Danışmanı — https://webdanismani.com · Destek: https://oblifex.com
"""
import os
import re
import subprocess
import sys
import zipfile

KOK = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(KOK, "sunucu.py"), encoding="utf-8") as f:
    SURUM = re.search(r'^SURUM = "([^"]+)"', f.read(), re.M).group(1)

DAHIL_DOSYALAR = ["BASLAT.bat", "sunucu.py", "tv-hazirla.py", "README.md", "LICENSE", "CHANGELOG.md"]
DAHIL_KLASORLER = ["genel", "tv-uygulamasi"]


def main():
    # TV klasörlerini güncel ekran dosyalarıyla yeniden üret
    subprocess.check_call([sys.executable, os.path.join(KOK, "tv-hazirla.py")])

    dist = os.path.join(KOK, "dist")
    os.makedirs(dist, exist_ok=True)
    kok_ad = f"siramatik-v{SURUM}"
    hedef = os.path.join(dist, kok_ad + ".zip")
    if os.path.exists(hedef):
        os.remove(hedef)

    adet = 0
    with zipfile.ZipFile(hedef, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for ad in DAHIL_DOSYALAR:
            z.write(os.path.join(KOK, ad), f"{kok_ad}/{ad}")
            adet += 1
        for klasor in DAHIL_KLASORLER:
            for kok, _, dosyalar in os.walk(os.path.join(KOK, klasor)):
                for d in sorted(dosyalar):
                    if d.endswith((".pyc",)) or d.startswith("."):
                        continue
                    tam = os.path.join(kok, d)
                    goreli = os.path.relpath(tam, KOK).replace(os.sep, "/")
                    z.write(tam, f"{kok_ad}/{goreli}")
                    adet += 1
    boyut = os.path.getsize(hedef) / 1024
    print(f"Hazır: {hedef}  ({adet} dosya, {boyut:.0f} KB)")


if __name__ == "__main__":
    main()

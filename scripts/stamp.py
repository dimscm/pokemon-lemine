"""Beri penanda versi (?v=<hash isi file>) pada file lokal di index.html.

Tanpa penanda ini browser dan cache GitHub Pages bisa terus memakai file lama
setelah data atau kode diperbarui. Jalankan setiap kali mengubah file web:
    python3 scripts/stamp.py
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ["style.css", "config.js", "data/outlets.js", "app.js"]


def stamp():
    index = ROOT / "index.html"
    html = index.read_text(encoding="utf-8")
    for asset in ASSETS:
        digest = hashlib.sha1((ROOT / asset).read_bytes()).hexdigest()[:10]
        html, n = re.subn(r'(["\'])' + re.escape(asset) + r'(\?v=[0-9a-f]*)?\1', r"\g<1>" + asset + "?v=" + digest + r"\g<1>", html)
        if n != 1:
            raise SystemExit(f"{asset}: ditemukan {n} kali di index.html, seharusnya 1")
    index.write_text(html, encoding="utf-8")
    print("index.html diberi penanda versi")


if __name__ == "__main__":
    stamp()

"""Konversi Data_Outlet_tidak_jual_LM.xlsx -> data/outlets.js untuk web.

Sheet1 adalah data utama (kolom lengkap, punya id). Sheet2 berisi sebagian kolom
saja; outlet di Sheet2 yang belum ada di Sheet1 (mis. Kota Bekasi) ikut
ditambahkan dengan id stabil yang dibentuk dari nama, koordinat, dan waktu survei.

Pemakaian: python3 scripts/convert.py path/ke/file.xlsx
"""
import datetime
import hashlib
import json
import sys

import openpyxl

src = sys.argv[1] if len(sys.argv) > 1 else "Data_Outlet_tidak_jual_LM.xlsx"
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
skip = {"Metric Data", "description"}
EXCEL_EPOCH = datetime.datetime(1899, 12, 30)


def read(name):
    rows = wb[name].iter_rows(values_only=True)
    header = [str(h).strip() for h in next(rows)]
    return header, [dict(zip(header, r)) for r in rows if any(v not in (None, "") for v in r)]


def clean(v, col=""):
    if v is None:
        return ""
    if col == "created_at" and isinstance(v, (int, float)):
        v = EXCEL_EPOCH + datetime.timedelta(days=v)
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, float):
        return round(v, 6)
    return str(v).strip()


def key(r):
    return (round(float(r["latitude"]), 6), round(float(r["longitude"]), 6), str(r["Store Name"] or "").strip())


header, main = read("Sheet1")
cols = [h for h in header if h not in skip]
out = [[clean(r.get(c), c) for c in cols] for r in main]

extra = 0
if "Sheet2" in wb.sheetnames:
    known = {key(r) for r in main}
    _, more = read("Sheet2")
    for r in more:
        if key(r) in known:
            continue
        known.add(key(r))
        raw = "|".join(str(x) for x in (r.get("Store Name"), r.get("latitude"), r.get("longitude"), r.get("created_at")))
        r = dict(r, id="s2-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20])
        out.append([clean(r.get(c), c) for c in cols])
        extra += 1

payload = {"cols": cols, "rows": out}
with open("data/outlets.js", "w", encoding="utf-8") as f:
    f.write("window.OUTLET_DATA=")
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print(f"{len(out)} outlet ditulis ke data/outlets.js ({len(main)} dari Sheet1, {extra} tambahan dari Sheet2)")

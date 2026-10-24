"""Konversi Data_Outlet_tidak_jual_LM.xlsx -> data/outlets.js untuk web.

Pemakaian: python3 scripts/convert.py path/ke/file.xlsx
"""
import datetime
import json
import sys

import openpyxl

src = sys.argv[1] if len(sys.argv) > 1 else "Data_Outlet_tidak_jual_LM.xlsx"
ws = openpyxl.load_workbook(src, read_only=True, data_only=True)["Sheet1"]
rows = ws.iter_rows(values_only=True)
header = [str(h).strip() for h in next(rows)]
skip = {"Metric Data", "description"}
keep = [i for i, h in enumerate(header) if h not in skip]


def clean(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, float):
        return round(v, 6)
    return str(v).strip()


out = [[clean(r[i]) for i in keep] for r in rows if any(r)]
payload = {"cols": [header[i] for i in keep], "rows": out}
with open("data/outlets.js", "w", encoding="utf-8") as f:
    f.write("window.OUTLET_DATA=")
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print(f"{len(out)} outlet ditulis ke data/outlets.js")

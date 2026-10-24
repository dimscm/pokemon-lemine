/**
 * Penyimpanan tanda kunjungan untuk web Outlet Tidak Jual LM.
 *
 * Pasang di Google Sheet tim: Extensions → Apps Script, tempel file ini,
 * lalu Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Opsional: Project Settings → Script properties → KODE_TIM = <kode rahasia tim>.
 */
const SHEET_NAME = "Kunjungan";
const HEADERS = ["id", "Nama Toko", "Kecamatan", "Kelurahan", "Status Kunjungan",
  "Tanggal Kunjungan", "Dikunjungi oleh", "Catatan", "Terakhir diperbarui"];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function keyOk_(key) {
  const want = PropertiesService.getScriptProperties().getProperty("KODE_TIM");
  return !want || String(key || "") === want;
}

function toIso_(v) { return v instanceof Date ? v.toISOString() : String(v || ""); }
function toDate_(iso) { return iso ? new Date(iso) : ""; }
// Teks yang diawali = + - @ bisa dibaca Sheets sebagai rumus.
function text_(v) { const s = String(v || ""); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function untext_(v) { const s = String(v || ""); return s.charAt(0) === "'" ? s.slice(1) : s; }

function doGet(e) {
  if (!keyOk_(e.parameter.key)) return json_({ ok: false, error: "kode" });
  const rows = getSheet_().getDataRange().getValues().slice(1);
  const visits = rows.filter((r) => r[0]).map((r) => ({
    id: String(r[0]),
    visited: r[4] === "Sudah didatangi",
    visitedAt: toIso_(r[5]),
    by: untext_(r[6]),
    note: untext_(r[7]),
    updatedAt: toIso_(r[8]),
  }));
  return json_({ ok: true, visits: visits });
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "format" }); }
  if (!keyOk_(b.key)) return json_({ ok: false, error: "kode" });
  if (!b.id) return json_({ ok: false, error: "format" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_();
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => String(r[0]));
    const idx = ids.indexOf(String(b.id));
    if (b.remove) {
      if (idx > 0) sh.deleteRow(idx + 1);
      return json_({ ok: true });
    }
    const row = [String(b.id), text_(b.nama), text_(b.kecamatan), text_(b.kelurahan),
      b.visited ? "Sudah didatangi" : "Belum didatangi", toDate_(b.visitedAt),
      text_(b.by), text_(b.note), toDate_(b.updatedAt)];
    if (idx > 0) sh.getRange(idx + 1, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

# Outlet Tidak Jual LM

Web statis untuk menjelajahi data survei 3.022 outlet (Jakarta Timur, Kota Depok, dan Kota Bekasi) yang tidak menjual LM.

Fitur:
- **Peta** outlet (cluster, warna per tipe toko) dengan popup & detail
- **Tabel** yang bisa diurutkan, klik baris untuk detail lengkap + foto display
- **Ringkasan** distribusi per kecamatan, brand AMDK, top seller, sumber pembelian, omzet, dll.
- Filter: pencarian, kota → kecamatan → kelurahan, tipe toko, akses jalan, komunitas, top seller, brand AMDK, fasilitas pendingin
- Tanda **sudah didatangi** + catatan per outlet, terlihat oleh seluruh tim lewat Google Sheet
- Unduh Excel sesuai filter, termasuk status, tanggal, petugas, dan catatan kunjungan

## Menjalankan

Buka `index.html` langsung di browser, atau:

```sh
python3 -m http.server 8000   # lalu buka http://localhost:8000
```

Bisa juga di-hosting via GitHub Pages (Settings → Pages → branch ini, folder root).

## Memperbarui data

```sh
pip install openpyxl
python3 scripts/convert.py Data_Outlet_tidak_jual_LM.xlsx
```

Skrip membaca `Sheet1` (data lengkap), menambahkan outlet dari `Sheet2` yang belum ada di Sheet1
(mis. Kota Bekasi, kolomnya lebih sedikit), lalu menulis ulang `data/outlets.js`.

## Tanda kunjungan bersama (Google Sheet)

Tanpa pengaturan, tanda kunjungan hanya tersimpan di browser masing-masing. Supaya seluruh tim
melihat outlet mana yang sudah didatangi, sambungkan ke Google Sheet:

1. Buat Google Sheet baru (mis. "Kunjungan Outlet LM").
2. Di sheet itu buka **Extensions → Apps Script**, hapus isi `Code.gs`, lalu tempel isi
   [`apps-script/Code.gs`](apps-script/Code.gs). Simpan.
3. (Disarankan) **Project Settings → Script Properties → Add script property**:
   `KODE_TIM` = kode rahasia tim. Tanpa ini, siapa pun yang tahu alamatnya bisa mengubah data.
4. **Deploy → New deployment → Select type: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Klik **Deploy**, izinkan aksesnya, lalu salin **Web app URL** (berakhiran `/exec`).
5. Tempel URL itu ke `config.js`:
   ```js
   window.VISITS_API = "https://script.google.com/macros/s/XXXX/exec";
   ```
   lalu commit & push.

Tab **Kunjungan** di sheet terisi otomatis (id, nama toko, kecamatan, kelurahan, status, tanggal,
petugas, catatan). Web memuat ulang data tiap 30 detik. Kalau `Code.gs` diubah, buat versi baru
lewat **Deploy → Manage deployments → Edit → Version: New version** supaya URL tetap sama.

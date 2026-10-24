# Outlet Tidak Jual LM

Web statis untuk menjelajahi data survei 2.020 outlet (Kota Depok & Jakarta Timur) yang tidak menjual LM.

Fitur:
- **Peta** outlet (cluster, warna per tipe toko) dengan popup & detail
- **Tabel** yang bisa diurutkan, klik baris untuk detail lengkap + foto display
- **Ringkasan** distribusi per kecamatan, brand AMDK, top seller, sumber pembelian, omzet, dll.
- Filter: pencarian, kota → kecamatan → kelurahan, tipe toko, akses jalan, komunitas, top seller, brand AMDK, fasilitas pendingin
- Unduh CSV sesuai filter

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

Skrip membaca `Sheet1` dan menulis ulang `data/outlets.js`.

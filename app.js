(function () {
  const RAW = window.OUTLET_DATA;
  const outlets = RAW.rows.map((r, idx) => {
    const o = { _i: idx };
    RAW.cols.forEach((c, i) => { o[c] = r[i]; });
    o._brands = splitList(o["Brand Presence AMDK"]);
    o._rev = toNum(o["Daily Revenue Average"]);
    o._search = [o["Store Name"], o.name, o["Store Owner"], o.Address, o.Kelurahan, o.Kecamatan]
      .join(" ").toLowerCase();
    return o;
  });

  const BRANDS = ["Aqua", "Aquviva", "Cleo", "Crystaline", "Nestle Pure Life", "Lainnya"];
  const COOLERS = ["Refrigerator", "Chiller", "Coolbox", "Showcase"];
  const BRAND_COLS = ["AQUA", "AQUVIVA", "CLEO", "CRYSTALINE", "NESTLE PURELIFE"];
  const PHOTO_COLS = ["Storefront Display Photo", "Store-in Display Photo", "Refrigerator Display",
    "Chiller Display", "Coolbox Display", "Showcase Display", "Standing Cabinet / Shelves Display"];
  const PAGE = 50;
  const LS_KEY = "outlet-lm-visits";
  const COLOR_VISITED = "#16a34a";
  const COLOR_PENDING = "#ea580c";

  const state = { brands: new Set(), coolers: new Set(), sort: "created_at", asc: false, page: 0 };
  let filtered = outlets;

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("id-ID");
  const rupiah = (n) => "Rp " + fmt.format(Math.round(n));

  function splitList(s) { return (s || "").split(",").map((x) => x.trim()).filter(Boolean); }
  function toNum(s) { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function uniq(list, key) {
    return [...new Set(list.map((o) => o[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  }
  function countBy(list, fn) {
    const m = new Map();
    list.forEach((o) => [].concat(fn(o)).forEach((k) => { if (k) m.set(k, (m.get(k) || 0) + 1); }));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
  function fillSelect(el, values, keep) {
    const cur = keep ? el.value : "";
    el.innerHTML = '<option value="">Semua</option>' +
      values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    el.value = values.includes(cur) ? cur : "";
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  }

  // ---------- visit store ----------
  // Di claude.ai tanda kunjungan disimpan bersama lewat `db`; di tempat lain (mis. GitHub Pages)
  // disimpan di browser ini saja.
  const visits = new Map();
  const store = { mode: window.claude?.use ? "pending" : "local", db: null, user: null, uid: null, canWrite: true };
  const isVisited = (o) => !!visits.get(o.id)?.visited;

  function loadLocal() {
    try {
      Object.entries(JSON.parse(localStorage.getItem(LS_KEY) || "{}")).forEach(([k, v]) => visits.set(k, v));
    } catch (e) { /* storage tidak tersedia */ }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(visits))); } catch (e) { /* abaikan */ }
  }
  function renderSyncNote() {
    const text = {
      pending: "Menghubungkan penyimpanan…",
      shared: store.canWrite ? "Tanda kunjungan tersimpan bersama untuk semua yang membuka halaman ini" : "Kamu hanya bisa melihat tanda kunjungan",
      local: "Tanda kunjungan tersimpan di browser ini saja",
    }[store.mode];
    $("syncNote").textContent = text;
  }

  async function initStore() {
    if (store.mode === "local") { loadLocal(); renderSyncNote(); return; }
    renderSyncNote();
    const db = await window.claude.use("db");
    if (!db) { store.mode = "local"; loadLocal(); renderSyncNote(); refresh(); return; }
    store.db = db;
    store.user = await window.claude.use("user");
    store.uid = store.user ? await store.user.id() : null;
    store.canWrite = (store.user ? await store.user.can("data.write") : null) !== false;
    store.mode = "shared";
    renderSyncNote();
    db.collection("visits").onSnapshot((snap) => {
      visits.clear();
      snap.docs.forEach((d) => visits.set(d.id, d.data()));
      refresh();
    }, () => {
      $("syncNote").textContent = "Koneksi penyimpanan terputus. Muat ulang halaman untuk menyambung lagi.";
    });
  }

  async function saveVisit(id, rec) {
    if (store.mode === "shared") {
      const ref = store.db.doc("visits/" + id);
      if (rec) await ref.set(rec); else await ref.delete();
      return;
    }
    if (rec) visits.set(id, rec); else visits.delete(id);
    saveLocal();
    refresh();
  }

  async function names(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!store.user || !list.length) return {};
    const ps = await store.user.profiles(list);
    return Object.fromEntries(list.map((id) => [id, ps[id]?.name || ""]));
  }

  // ---------- filters ----------
  const selects = {
    fKota: "Kota", fKec: "Kecamatan", fKel: "Kelurahan", fType: "Store Type",
    fAccess: "Store Access Type", fComm: "Retail Community", fTop: "Top Seller AMDK",
  };
  fillSelect($("fKota"), uniq(outlets, "Kota"));
  fillSelect($("fType"), uniq(outlets, "Store Type"));
  fillSelect($("fAccess"), uniq(outlets, "Store Access Type"));
  fillSelect($("fComm"), uniq(outlets, "Retail Community"));
  fillSelect($("fTop"), uniq(outlets, "Top Seller AMDK"));

  function cascade() {
    const kota = $("fKota").value;
    const byKota = kota ? outlets.filter((o) => o.Kota === kota) : outlets;
    fillSelect($("fKec"), uniq(byKota, "Kecamatan"), true);
    const kec = $("fKec").value;
    fillSelect($("fKel"), uniq(kec ? byKota.filter((o) => o.Kecamatan === kec) : byKota, "Kelurahan"), true);
  }
  cascade();

  function makeChips(el, items, set) {
    el.innerHTML = items.map((b) => `<button type="button" class="chip" data-v="${esc(b)}">${esc(b)}</button>`).join("");
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const v = btn.dataset.v;
      set.has(v) ? set.delete(v) : set.add(v);
      btn.classList.toggle("on", set.has(v));
      apply();
    });
  }
  makeChips($("fBrands"), BRANDS, state.brands);
  makeChips($("fCool"), COOLERS, state.coolers);

  Object.keys(selects).concat("fVisit").forEach((id) => $(id).addEventListener("change", () => {
    if (id === "fKota" || id === "fKec") cascade();
    apply();
  }));
  let t;
  $("fSearch").addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 150); });
  $("btnReset").addEventListener("click", () => {
    $("fSearch").value = "";
    $("fVisit").value = "";
    Object.keys(selects).forEach((id) => { $(id).value = ""; });
    state.brands.clear(); state.coolers.clear();
    document.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
    cascade(); apply();
  });
  $("btnFilters").addEventListener("click", () => $("filters").classList.toggle("open"));

  function apply(keepView) {
    const q = $("fSearch").value.trim().toLowerCase();
    const visit = $("fVisit").value;
    const sel = Object.entries(selects).map(([id, key]) => [key, $(id).value]).filter(([, v]) => v);
    filtered = outlets.filter((o) => {
      if (q && !o._search.includes(q)) return false;
      if (visit && (visit === "sudah") !== isVisited(o)) return false;
      for (const [k, v] of sel) if (o[k] !== v) return false;
      for (const b of state.brands) if (!o._brands.includes(b)) return false;
      for (const c of state.coolers) if (o[c + " Availability"] !== "Ya") return false;
      return true;
    });
    if (!keepView) state.page = 0;
    renderKpis(); renderMap(keepView); renderTable(); renderSummary();
  }
  // Dipanggil saat data kunjungan berubah: jangan geser peta atau halaman tabel.
  function refresh() { apply(true); }

  // ---------- KPIs ----------
  function renderKpis() {
    const n = filtered.length;
    const pct = (k) => (n ? Math.round((filtered.filter((o) => o._brands.includes(k)).length / n) * 100) : 0);
    const avgRev = n ? filtered.reduce((s, o) => s + o._rev, 0) / n : 0;
    const cooler = filtered.filter((o) => COOLERS.some((c) => o[c + " Availability"] === "Ya")).length;
    const kec = new Set(filtered.map((o) => o.Kecamatan)).size;
    const visited = filtered.filter(isVisited).length;
    $("kpis").innerHTML = [
      ["Jumlah outlet", fmt.format(n), `dari ${fmt.format(outlets.length)} total`],
      ["Sudah didatangi", fmt.format(visited), n ? `${Math.round((visited / n) * 100)}% · ${fmt.format(n - visited)} belum` : "–"],
      ["Kecamatan", fmt.format(kec), `${new Set(filtered.map((o) => o.Kelurahan)).size} kelurahan`],
      ["Rata-rata omzet/hari", rupiah(avgRev), "Daily Revenue Average"],
      ["Punya pendingin", n ? Math.round((cooler / n) * 100) + "%" : "–", `${fmt.format(cooler)} outlet`],
      ["Ada Aqua / Aquviva", `${pct("Aqua")}% / ${pct("Aquviva")}%`, "Brand presence"],
    ].map(([l, v, h]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join("");
  }

  // ---------- map ----------
  const map = L.map("map", { preferCanvas: true, maxZoom: 19 }).setView([-6.32, 106.84], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  const cluster = L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false });
  map.addLayer(cluster);

  function renderMap(keepView) {
    cluster.clearLayers();
    const markers = filtered.filter((o) => o.latitude && o.longitude).map((o) => {
      const done = isVisited(o);
      const m = L.circleMarker([o.latitude, o.longitude], {
        radius: 7, weight: 2, color: "#fff", fillColor: done ? COLOR_VISITED : COLOR_PENDING, fillOpacity: 0.95,
      });
      m.bindPopup(`<div class="pop-title">${esc(o["Store Name"] || o.name)}</div>
        <div><span class="pill ${done ? "pill-done" : "pill-todo"}">${done ? "Sudah didatangi" : "Belum didatangi"}</span></div>
        <div>${esc(o["Store Type"])} · ${esc(o.Kelurahan)}, ${esc(o.Kecamatan)}</div>
        <div>Top seller: <b>${esc(o["Top Seller AMDK"])}</b></div>
        <button class="btn pop-btn" data-open="${o._i}">Lihat detail</button>`);
      return m;
    });
    cluster.addLayers(markers);
    if (markers.length && !keepView) map.fitBounds(cluster.getBounds(), { padding: [30, 30], maxZoom: 16 });
  }
  map.on("popupopen", (e) => {
    const b = e.popup.getElement().querySelector("[data-open]");
    if (b) b.addEventListener("click", () => openDetail(+b.dataset.open));
  });

  // ---------- table ----------
  document.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    state.asc = state.sort === k ? !state.asc : true;
    state.sort = k; state.page = 0;
    renderTable();
  }));
  $("prev").addEventListener("click", () => { state.page--; renderTable(); });
  $("next").addEventListener("click", () => { state.page++; renderTable(); });

  function renderTable() {
    const k = state.sort, dir = state.asc ? 1 : -1;
    const rows = [...filtered].sort((a, b) => {
      if (k === "Daily Revenue Average") return (a._rev - b._rev) * dir;
      if (k === "_visit") return (isVisited(a) - isVisited(b)) * dir;
      return String(a[k]).localeCompare(String(b[k]), "id") * dir;
    });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(Math.max(0, state.page), pages - 1);
    const slice = rows.slice(state.page * PAGE, state.page * PAGE + PAGE);
    document.querySelector("#tbl tbody").innerHTML = slice.map((o) => {
      const v = visits.get(o.id);
      const done = !!v?.visited;
      return `<tr data-i="${o._i}">
      <td><span class="pill ${done ? "pill-done" : "pill-todo"}">${done ? "Sudah" : "Belum"}</span></td>
      <td>${esc(o["Store Name"] || o.name)}</td><td>${esc(o["Store Owner"])}</td><td>${esc(o["Store Type"])}</td>
      <td>${esc(o.Kecamatan)}</td><td>${esc(o.Kelurahan)}</td><td>${esc(o["Top Seller AMDK"])}</td>
      <td class="num">${o._rev ? fmt.format(o._rev) : "–"}</td>
      <td class="note-cell" title="${esc(v?.note)}">${esc(v?.note)}</td></tr>`;
    }).join("") ||
      '<tr><td colspan="9">Tidak ada outlet yang cocok dengan filter.</td></tr>';
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === k);
      th.classList.toggle("asc", th.dataset.sort === k && state.asc);
    });
    $("pageInfo").textContent = `Halaman ${state.page + 1} dari ${pages} · ${fmt.format(rows.length)} outlet`;
    $("prev").disabled = state.page === 0;
    $("next").disabled = state.page >= pages - 1;
  }
  document.querySelector("#tbl tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-i]");
    if (tr) openDetail(+tr.dataset.i);
  });

  // ---------- summary ----------
  function barCard(title, entries, limit = 12) {
    const top = entries.slice(0, limit);
    const max = top.length ? top[0][1] : 1;
    return `<div class="card"><h3>${title}</h3>${top.map(([k, v]) => `<div class="bar-row">
      <span class="name" title="${esc(k)}">${esc(k)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div>
      <span class="count">${fmt.format(v)}</span></div>`).join("") || "<p>Tidak ada data.</p>"}</div>`;
  }
  function renderSummary() {
    const revBand = (o) => {
      const r = o._rev;
      if (!r) return "Tidak diisi";
      if (r < 500000) return "< 500 rb";
      if (r < 1000000) return "500 rb – 1 jt";
      if (r < 2000000) return "1 – 2 jt";
      if (r < 5000000) return "2 – 5 jt";
      return "≥ 5 jt";
    };
    $("charts").innerHTML = [
      barCard("Sudah didatangi per Kecamatan", countBy(filtered.filter(isVisited), (o) => o.Kecamatan), 15),
      barCard("Outlet per Kecamatan", countBy(filtered, (o) => o.Kecamatan), 15),
      barCard("Brand AMDK yang tersedia", countBy(filtered, (o) => o._brands)),
      barCard("Top Seller AMDK", countBy(filtered, (o) => o["Top Seller AMDK"])),
      barCard("Sumber pembelian Aqua", countBy(filtered, (o) => o["AQUA Source Of Purchase Type"])),
      barCard("Rentang omzet harian", countBy(filtered, revBand)),
      barCard("Tipe toko", countBy(filtered, (o) => o["Store Type"])),
      barCard("Akses jalan", countBy(filtered, (o) => o["Store Access Type"])),
      barCard("POI terdekat", countBy(filtered, (o) => o["Nearest POI"])),
      barCard("Komunitas retail", countBy(filtered, (o) => o["Retail Community"] || "Tidak diisi")),
      barCard("Top 3 kategori yang dijual", countBy(filtered, (o) => splitList(o["Top 3 Category Carry"]))),
    ].join("");
  }

  // ---------- detail ----------
  function kv(pairs) {
    const rows = pairs.filter(([, v]) => v !== "" && v != null);
    return rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : "";
  }
  function section(title, body) { return body ? `<div class="detail-section"><h3>${title}</h3>${body}</div>` : ""; }

  function visitSection(o) {
    const v = visits.get(o.id);
    const locked = store.mode === "pending" || !store.canWrite;
    return `<div class="detail-section visit-box">
      <h3>Kunjungan</h3>
      <label class="check"><input type="checkbox" id="visitDone" ${v?.visited ? "checked" : ""} ${locked ? "disabled" : ""}> Sudah didatangi</label>
      <label class="field"><span>Catatan</span>
        <textarea id="visitNote" rows="3" placeholder="mis. pemilik tertarik, minta dihubungi minggu depan" ${locked ? "disabled" : ""}>${esc(v?.note)}</textarea>
      </label>
      <div class="visit-actions">
        <button class="btn" id="visitSave" ${locked ? "disabled" : ""}>Simpan</button>
        <span class="visit-meta" id="visitMeta"></span>
      </div>
    </div>`;
  }

  async function renderVisitMeta(o) {
    const v = visits.get(o.id);
    const el = $("visitMeta");
    if (!el) return;
    if (!v) { el.textContent = store.mode === "pending" ? "Menghubungkan penyimpanan…" : ""; return; }
    const who = (await names([v.by]))[v.by];
    el.textContent = [v.visited && v.visitedAt ? "Didatangi " + fmtDate(v.visitedAt) : "",
      who ? "oleh " + who : "", v.updatedAt ? "· diperbarui " + fmtDate(v.updatedAt) : ""].filter(Boolean).join(" ");
  }

  function openDetail(i) {
    const o = outlets[i];
    const e = (k) => esc(o[k]);
    const coolers = COOLERS.map((c) => [c, o[c + " Availability"] === "Ya" ? `Ya (${e(c + " Amount")})` : esc(o[c + " Availability"])]);
    const brandRows = BRAND_COLS.map((b) => {
      const sku = o[b + " SKU Availability"], src = o[b + " Source Of Purchase Type"];
      if (!sku && !src) return "";
      return `<div class="detail-section"><h3>${b}</h3>${kv([
        ["SKU tersedia", esc(sku)],
        ["Sumber pembelian", esc(src)],
        ["Nama sumber", e(b + " Source Of Purchase Name")],
        ["Lokasi sumber", e(b + " Source Of Purchase Location")],
        ["Cara order", e(b + " Product Order")],
        ["Pengiriman", e(b + " Product Delivery")],
      ])}</div>`;
    }).join("");
    const photos = PHOTO_COLS.flatMap((c) => splitList(o[c]).map((u) => [c, u]))
      .filter(([, u]) => /^https:\/\//.test(u))
      .map(([c, u]) => `<figure><a href="${esc(u)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(u)}" alt="${esc(c)}"></a><figcaption>${esc(c)}</figcaption></figure>`)
      .join("");
    const gmaps = `https://www.google.com/maps?q=${o.latitude},${o.longitude}`;

    $("modalBody").innerHTML = `
      <div class="detail-head"><h2>${esc(o["Store Name"] || o.name)}</h2>
        <p>${e("Address")}</p>
        <p><a href="${gmaps}" target="_blank" rel="noopener">Buka di Google Maps ↗</a></p></div>
      ${visitSection(o)}
      ${section("Info toko", kv([
        ["Pemilik", e("Store Owner")], ["Tipe toko", e("Store Type")],
        ["Komunitas retail", esc(o["Retail Community"] + (o["Retail Community Others"] ? " – " + o["Retail Community Others"] : ""))],
        ["Akses jalan", e("Store Access Type")], ["POI terdekat", e("Nearest POI")],
        ["Luas toko (m²)", e("Shop Area (M2)")],
        ["Wilayah", esc([o.Kelurahan, o.Kecamatan, o.Kota, o.Province].filter(Boolean).join(", "))],
        ["Disurvei", e("created_at")],
      ]))}
      ${section("Penjualan", kv([
        ["Omzet harian rata-rata", o._rev ? rupiah(o._rev) : ""],
        ["Pembelian AMDK / minggu (karton)", e("Weekly Average Purchase AMDK in Carton (Except Galoon)")],
        ["Daya beli AMDK (1x belanja)", toNum(o["AMDK Buying Power Average (1 Time Shopping)"]) ? rupiah(toNum(o["AMDK Buying Power Average (1 Time Shopping)"])) : ""],
        ["Frekuensi belanja / bulan", e("Store Shopping Frequency Average (in 1 month)")],
        ["Kategori yang dijual", e("Available Category Carry")],
        ["Top 3 kategori", e("Top 3 Category Carry")],
      ]))}
      ${section("Fasilitas pendingin", kv(coolers))}
      ${section("AMDK", kv([["Brand yang ada", e("Brand Presence AMDK")], ["Top seller", e("Top Seller AMDK")]]))}
      ${brandRows}
      ${section("Foto", photos ? `<div class="photos">${photos}</div>` : "")}`;
    $("modal").classList.remove("hidden");
    renderVisitMeta(o);

    $("visitSave").addEventListener("click", async () => {
      const btn = $("visitSave");
      const done = $("visitDone").checked;
      const note = $("visitNote").value.trim();
      const prev = visits.get(o.id);
      const now = new Date().toISOString();
      const rec = done || note ? {
        visited: done,
        note,
        visitedAt: done ? (prev?.visited && prev.visitedAt) || now : "",
        updatedAt: now,
        by: store.uid || "",
      } : null;
      btn.disabled = true;
      $("visitMeta").textContent = "Menyimpan…";
      try {
        await saveVisit(o.id, rec);
        if (rec) visits.set(o.id, rec); else visits.delete(o.id);
        await renderVisitMeta(o);
        $("visitMeta").textContent = "Tersimpan. " + $("visitMeta").textContent;
      } catch (err) {
        if (err?.code === "invalid_argument") {
          store.canWrite = false;
          renderSyncNote();
          $("visitMeta").textContent = "Kamu tidak punya izin mengubah data ini. Minta akses Contributor atau Editor ke pemilik halaman.";
        } else if (err?.code === "quota_exceeded") {
          $("visitMeta").textContent = "Penyimpanan penuh. Hapus tanda yang tidak dipakai lalu coba lagi.";
        } else {
          $("visitMeta").textContent = "Gagal menyimpan. Periksa koneksi lalu coba lagi.";
        }
      } finally {
        btn.disabled = !store.canWrite;
      }
    });
  }
  function closeModal() { $("modal").classList.add("hidden"); }
  $("modalClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + b.dataset.tab));
    if (b.dataset.tab === "map") map.invalidateSize();
  }));

  // ---------- export ----------
  async function exportExcel() {
    const btn = $("btnExport");
    btn.disabled = true;
    try {
      const who = await names(filtered.map((o) => visits.get(o.id)?.by));
      const extra = ["Status Kunjungan", "Tanggal Kunjungan", "Dikunjungi oleh", "Catatan", "Terakhir diperbarui"];
      const aoa = [extra.concat(RAW.cols), ...filtered.map((o) => {
        const v = visits.get(o.id);
        return [v?.visited ? "Sudah didatangi" : "Belum didatangi", fmtDate(v?.visitedAt), who[v?.by] || "",
          v?.note || "", fmtDate(v?.updatedAt)].concat(RAW.cols.map((c) => o[c]));
      })];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!autofilter"] = { ref: ws["!ref"] };
      XLSX.utils.book_append_sheet(wb, ws, "Outlet");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const filename = `outlet_tidak_jual_LM_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const downloads = window.claude?.use ? await window.claude.use("downloads") : null;
      if (downloads) {
        await downloads.save({ filename, data: new Blob([buf]) }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } finally {
      btn.disabled = false;
    }
  }
  $("btnExport").addEventListener("click", exportExcel);

  const dates = outlets.map((o) => o.created_at).filter(Boolean).sort();
  $("subtitle").textContent = `${fmt.format(outlets.length)} outlet hasil survei · ${dates[0].slice(0, 10)} s/d ${dates[dates.length - 1].slice(0, 10)}`;
  initStore();
  apply();
})();

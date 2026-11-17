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
  // Hasil kunjungan yang bisa dipilih petugas, dan alasan bila outlet belum mau CB.
  const RESULTS = ["Deal NOO", "CB", "Belum mau CB"];
  const REASONS = ["Akses kendaraan susah", "Jalan buntu", "Harga tidak masuk / beli di agen"];
  const OTHER = "Lainnya";
  const STATUS = {
    todo: { label: "Belum didatangi", short: "Belum", cls: "todo", color: "#ea580c", rank: 0 },
    visited: { label: "Didatangi, belum ada hasil", short: "Didatangi", cls: "visited", color: "#64748b", rank: 1 },
    "Belum mau CB": { label: "Belum mau CB", short: "Belum mau CB", cls: "nocb", color: "#dc2626", rank: 2 },
    CB: { label: "CB", short: "CB", cls: "cb", color: "#7c3aed", rank: 3 },
    "Deal NOO": { label: "Deal NOO", short: "Deal NOO", cls: "noo", color: "#16a34a", rank: 4 },
  };

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
  // Di claude.ai tanda kunjungan disimpan bersama lewat `db`; di tempat lain lewat Google Sheet
  // tim (window.VISITS_API, lihat apps-script/Code.gs), atau di browser ini saja bila belum diatur.
  const API = window.VISITS_API || "";
  const API_KEY_LS = "outlet-lm-team-key";
  const NAME_LS = "outlet-lm-name";
  const visits = new Map();
  const store = {
    mode: window.claude?.use ? "pending" : API ? "api" : "local",
    db: null, user: null, uid: null, canWrite: true, needKey: false, loadedAt: null,
  };
  function statusKey(o) {
    const v = visits.get(o.id);
    if (v?.result && STATUS[v.result]) return v.result;
    return v?.visited ? "visited" : "todo";
  }
  const statusOf = (o) => STATUS[statusKey(o)];
  const isVisited = (o) => statusKey(o) !== "todo";
  const reasonsOf = (o) => visits.get(o.id)?.reasons || [];
  function pill(o, short) {
    const st = statusOf(o);
    return `<span class="pill pill-${st.cls}">${short ? st.short : st.label}</span>`;
  }

  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } }

  async function apiLoad() {
    const res = await fetch(API + "?key=" + encodeURIComponent(lsGet(API_KEY_LS)));
    const j = await res.json();
    if (!j.ok) {
      store.needKey = j.error === "kode";
      renderSyncNote();
      throw { code: j.error };
    }
    store.needKey = false;
    store.loadedAt = new Date();
    const sig = JSON.stringify(j.visits);
    if (sig === store.lastSig) { renderSyncNote(); return; }
    store.lastSig = sig;
    visits.clear();
    store.apiVersion = j.version || 1;
    j.visits.forEach((v) => visits.set(v.id, Object.assign({}, v, {
      result: v.result || "",
      reasons: String(v.reasons || "").split("; ").filter(Boolean),
    })));
    renderSyncNote();
    refresh();
  }

  async function apiSave(o, rec) {
    const body = Object.assign({
      key: lsGet(API_KEY_LS), id: o.id, nama: o["Store Name"] || o.name,
      kecamatan: o.Kecamatan, kelurahan: o.Kelurahan, remove: !rec,
    }, rec || {});
    if (rec) body.reasons = (rec.reasons || []).join("; ");
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) {
      if (j.error === "kode") { store.needKey = true; renderSyncNote(); }
      throw { code: j.error === "kode" ? "kode" : "api" };
    }
  }

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
      api: store.needKey ? "Masukkan kode tim untuk melihat dan menandai kunjungan"
        : store.loadedAt ? "Tanda kunjungan tersimpan di Google Sheet tim · dimuat " +
          store.loadedAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
        : "Memuat tanda kunjungan dari Google Sheet…",
    }[store.mode];
    $("syncNote").textContent = text;
    $("keyForm").hidden = !store.needKey;
  }

  $("keyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    lsSet(API_KEY_LS, $("teamKey").value.trim());
    apiLoad().catch(() => {});
  });

  async function initStore() {
    if (store.mode === "local") { loadLocal(); renderSyncNote(); return; }
    if (store.mode === "api") {
      renderSyncNote();
      const load = () => apiLoad().catch((err) => {
        if (err?.code !== "kode") $("syncNote").textContent = "Gagal memuat dari Google Sheet. Mencoba lagi sebentar lagi…";
      });
      load();
      setInterval(() => { if (!document.hidden) load(); }, 30000);
      return;
    }
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

  async function saveVisit(o, rec) {
    const id = o.id;
    if (store.mode === "api") {
      await apiSave(o, rec);
      if (rec) visits.set(id, rec); else visits.delete(id);
      refresh();
      return;
    }
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
    // Di Google Sheet, `by` sudah berupa nama yang diketik petugas.
    if (store.mode === "api") return Object.fromEntries(list.map((n) => [n, n]));
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

  Object.keys(selects).concat("fVisit", "fReason", "fRadius").forEach((id) => $(id).addEventListener("change", () => {
    if (id === "fKota" || id === "fKec") cascade();
    apply();
  }));
  let t;
  $("fSearch").addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 150); });
  $("btnReset").addEventListener("click", () => {
    $("fSearch").value = "";
    $("fVisit").value = "";
    $("fReason").value = "";
    $("fRadius").value = "";
    Object.keys(selects).forEach((id) => { $(id).value = ""; });
    state.brands.clear(); state.coolers.clear();
    document.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
    cascade(); apply();
  });
  function setFiltersOpen(open) {
    $("filters").classList.toggle("open", open);
    document.body.classList.toggle("no-scroll", open || !$("modal").classList.contains("hidden"));
  }
  $("btnFilters").addEventListener("click", () => setFiltersOpen(!$("filters").classList.contains("open")));
  $("btnFiltersClose").addEventListener("click", () => setFiltersOpen(false));
  $("btnApply").addEventListener("click", () => { setFiltersOpen(false); window.scrollTo(0, 0); });

  function activeFilterCount() {
    return [$("fSearch").value.trim(), $("fVisit").value, $("fReason").value, $("fRadius").value]
      .concat(Object.keys(selects).map((id) => $(id).value)).filter(Boolean).length
      + state.brands.size + state.coolers.size;
  }

  function apply(keepView) {
    const q = $("fSearch").value.trim().toLowerCase();
    const visit = $("fVisit").value;
    const reason = $("fReason").value;
    const radius = me.lat != null ? +$("fRadius").value : 0;
    const sel = Object.entries(selects).map(([id, key]) => [key, $(id).value]).filter(([, v]) => v);
    filtered = outlets.filter((o) => {
      if (q && !o._search.includes(q)) return false;
      if (visit) {
        const k = statusKey(o);
        if (visit === "belum" ? k !== "todo" : visit === "sudah" ? k === "todo" : k !== visit) return false;
      }
      if (reason && !reasonsOf(o).some((x) => (reason === OTHER ? x.startsWith(OTHER) : x === reason))) return false;
      if (radius && o._dist > radius) return false;
      for (const [k, v] of sel) if (o[k] !== v) return false;
      for (const b of state.brands) if (!o._brands.includes(b)) return false;
      for (const c of state.coolers) if (o[c + " Availability"] !== "Ya") return false;
      return true;
    });
    if (!keepView) state.page = 0;
    renderKpis(); renderMap(keepView); renderTable(); renderNearby();
    // Ringkasan cukup digambar saat tabnya dibuka.
    if (activeTab === "summary") renderSummary(); else summaryDirty = true;
    const n = activeFilterCount();
    $("filterCount").textContent = n;
    $("filterCount").hidden = !n;
    $("btnApply").textContent = `Lihat ${fmt.format(filtered.length)} outlet`;
  }
  let activeTab = "map";
  let summaryDirty = true;
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
      ...RESULTS.map((res) => {
        const c = filtered.filter((o) => statusKey(o) === res).length;
        return [res, fmt.format(c), visited ? `${Math.round((c / visited) * 100)}% dari yang didatangi` : "–"];
      }),
      ["Kecamatan", fmt.format(kec), `${new Set(filtered.map((o) => o.Kelurahan)).size} kelurahan`],
      ["Rata-rata omzet/hari", rupiah(avgRev), "Daily Revenue Average"],
      ["Punya pendingin", n ? Math.round((cooler / n) * 100) + "%" : "–", `${fmt.format(cooler)} outlet`],
      ["Ada Aqua / Aquviva", `${pct("Aqua")}% / ${pct("Aquviva")}%`, "Brand presence"],
    ].map(([l, v, h]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join("");
  }

  // ---------- map ----------
  const map = L.map("map", { preferCanvas: true, maxZoom: 19 }).setView([-6.32, 106.84], 11);
  // Toleransi sentuh lebih lebar supaya titik kecil mudah diketuk di HP.
  const renderer = L.canvas({ tolerance: 10 });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  const cluster = L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false });
  map.addLayer(cluster);

  const markers = new Map();
  let shownKey = "";

  function popupHtml(o) {
    return `<div class="pop-title">${esc(o["Store Name"] || o.name)}</div>
      <div>${pill(o)}</div>
      <div>${esc(o["Store Type"])} · ${esc(o.Kelurahan)}, ${esc(o.Kecamatan)}</div>
      <div>Top seller: <b>${esc(o["Top Seller AMDK"])}</b></div>
      ${o._dist != null ? `<div>${fmtDist(o._dist)} dari lokasimu</div>` : ""}
      <button class="btn pop-btn" data-open="${o._i}">Lihat detail</button>`;
  }

  function markerFor(o) {
    let m = markers.get(o._i);
    if (!m) {
      m = L.circleMarker([o.latitude, o.longitude], { renderer, radius: 8, weight: 2, color: "#fff", fillOpacity: 0.95 });
      m.bindPopup(() => popupHtml(o));
      markers.set(o._i, m);
    }
    const fill = statusOf(o).color;
    if (m.options.fillColor !== fill) m.setStyle({ fillColor: fill });
    return m;
  }

  function renderMap(keepView) {
    const list = filtered.filter((o) => o.latitude && o.longitude);
    const key = list.map((o) => o._i).join(",");
    const ms = list.map(markerFor);
    // Isi peta hanya dibangun ulang bila daftar outletnya berubah; popup yang sedang terbuka tetap aman.
    if (key !== shownKey) {
      cluster.clearLayers();
      cluster.addLayers(ms);
      shownKey = key;
    } else {
      cluster.refreshClusters();
    }
    // Batas dihitung dari koordinat, bukan dari cluster yang masih memuat bertahap.
    if (list.length && !keepView) {
      map.fitBounds(L.latLngBounds(list.map((o) => [o.latitude, o.longitude])), { padding: [30, 30], maxZoom: 16 });
    }
  }
  // ---------- lokasi saya ----------
  const me = { lat: null, lng: null, acc: null, watch: null, picking: false, appliedAt: null, shown: 10 };
  const meLayer = L.layerGroup().addTo(map);

  function distM(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
  }
  function fmtDist(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + " m";
    return (m / 1000).toLocaleString("id-ID", { maximumFractionDigits: m < 10000 ? 1 : 0 }) + " km";
  }
  function setLocNote(text) { $("locNote").textContent = text; }

  function setMe(lat, lng, acc, recenter, manual) {
    const first = me.lat == null;
    const moved = me.appliedAt ? distM(me.appliedAt[0], me.appliedAt[1], lat, lng) : Infinity;
    Object.assign(me, { lat, lng, acc });
    meLayer.clearLayers();
    if (acc) L.circle([lat, lng], { radius: acc, color: "#2563eb", weight: 1, fillOpacity: 0.08 }).addTo(meLayer);
    L.circleMarker([lat, lng], { radius: 8, weight: 3, color: "#fff", fillColor: "#2563eb", fillOpacity: 1 })
      .bindTooltip(manual ? "Titik yang kamu pilih" : "Lokasi kamu").addTo(meLayer);
    $("fRadius").disabled = false;
    setLocNote(manual ? "Memakai titik yang kamu pilih di peta."
      : `Lokasi ditemukan${acc ? ` (akurasi ± ${fmtDist(acc)})` : ""}. Daftar diperbarui saat kamu bergerak.`);
    // Hitung ulang hanya bila bergeser cukup jauh, supaya peta tidak digambar ulang terus-menerus.
    if (moved > 30) {
      outlets.forEach((o) => { o._dist = o.latitude && o.longitude ? distM(lat, lng, o.latitude, o.longitude) : null; });
      me.appliedAt = [lat, lng];
      if (first) { state.sort = "_dist"; state.asc = true; }
      apply(true);
    }
    if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }

  function startPick(reason) {
    me.picking = true;
    $("map").classList.add("picking");
    setLocNote((reason ? reason + " " : "") + "Ketuk peta di posisi kamu untuk memakai titik itu.");
  }
  map.on("click", (e) => {
    if (!me.picking) return;
    me.picking = false;
    $("map").classList.remove("picking");
    if (me.watch != null) { navigator.geolocation.clearWatch(me.watch); me.watch = null; }
    setMe(e.latlng.lat, e.latlng.lng, null, false, true);
  });

  function locate() {
    if (!navigator.geolocation) { startPick("Browser ini tidak bisa membaca lokasi."); return; }
    setLocNote("Mencari lokasi…");
    navigator.geolocation.getCurrentPosition((pos) => {
      setMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
      if (me.watch == null) {
        me.watch = navigator.geolocation.watchPosition(
          (p) => setMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy, false),
          () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
      }
    }, (err) => {
      startPick(err.code === 1 ? "Izin lokasi ditolak atau tidak tersedia di halaman ini."
        : "Lokasi belum ditemukan. Pastikan GPS menyala.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  $("btnLocate").addEventListener("click", locate);
  $("btnPick").addEventListener("click", () => startPick(""));

  const LocateControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const b = L.DomUtil.create("button", "locate-btn");
      b.type = "button";
      b.title = "Lokasi saya";
      b.setAttribute("aria-label", "Lokasi saya");
      b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", locate);
      return b;
    },
  });
  map.addControl(new LocateControl());

  function renderNearby() {
    const list = $("nearbyList");
    if (me.lat == null) { list.innerHTML = ""; $("nearbyMore").hidden = true; return; }
    const near = filtered.filter((o) => o._dist != null).sort((a, b) => a._dist - b._dist);
    list.innerHTML = near.slice(0, me.shown).map((o) => {
      return `<li class="near-item">
        <span class="near-dist">${fmtDist(o._dist)}</span>
        <button type="button" class="near-main" data-open="${o._i}">
          <b>${esc(o["Store Name"] || o.name)}</b>
          <small>${esc(o.Kelurahan)} · ${esc(o["Store Type"])} · Top seller ${esc(o["Top Seller AMDK"])}</small>
        </button>
        ${pill(o, true)}
        <a class="near-route" href="https://www.google.com/maps/dir/?api=1&destination=${o.latitude},${o.longitude}" target="_blank" rel="noopener">Rute ↗</a>
      </li>`;
    }).join("") || '<li class="near-empty">Tidak ada outlet yang cocok dengan filter di sekitar lokasi ini.</li>';
    $("nearbyMore").hidden = near.length <= me.shown;
  }
  $("nearbyList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) openDetail(+b.dataset.open);
  });
  $("nearbyMore").addEventListener("click", () => { me.shown += 10; renderNearby(); });

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
  $("mSort").addEventListener("change", () => {
    const [k, dir] = $("mSort").value.split("|");
    state.sort = k; state.asc = dir === "asc"; state.page = 0;
    renderTable();
  });
  $("next").addEventListener("click", () => { state.page++; renderTable(); });

  function renderTable() {
    const k = state.sort, dir = state.asc ? 1 : -1;
    const rows = [...filtered].sort((a, b) => {
      if (k === "Daily Revenue Average") return (a._rev - b._rev) * dir;
      if (k === "_visit") return (statusOf(a).rank - statusOf(b).rank) * dir;
      if (k === "_dist") return ((a._dist ?? Infinity) - (b._dist ?? Infinity)) * dir;
      return String(a[k]).localeCompare(String(b[k]), "id") * dir;
    });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(Math.max(0, state.page), pages - 1);
    const slice = rows.slice(state.page * PAGE, state.page * PAGE + PAGE);
    document.querySelector("#tbl tbody").innerHTML = slice.map((o) => {
      const v = visits.get(o.id);
      const noteText = [reasonsOf(o).join(", "), v?.note].filter(Boolean).join(" · ");
      return `<tr data-i="${o._i}">
      <td class="c-status">${pill(o, true)}</td>
      <td class="c-name">${esc(o["Store Name"] || o.name)}</td><td class="c-owner">${esc(o["Store Owner"])}</td><td class="c-type">${esc(o["Store Type"])}</td>
      <td class="c-kec">${esc(o.Kecamatan)}</td><td class="c-kel" data-kec="${esc(o.Kecamatan)}">${esc(o.Kelurahan)}</td><td class="c-top">${esc(o["Top Seller AMDK"])}</td>
      <td class="num c-rev">${o._rev ? fmt.format(o._rev) : "–"}</td>
      <td class="note-cell c-note" title="${esc(noteText)}">${esc(noteText)}</td>
      <td class="num dist-col c-dist"${me.lat == null ? " hidden" : ""}>${o._dist != null ? fmtDist(o._dist) : ""}</td></tr>`;
    }).join("") ||
      '<tr><td colspan="10">Tidak ada outlet yang cocok dengan filter.</td></tr>';
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === k);
      th.classList.toggle("asc", th.dataset.sort === k && state.asc);
    });
    document.querySelectorAll("th.dist-col").forEach((th) => { th.hidden = me.lat == null; });
    const ms = $("mSort"), want = `${k}|${state.asc ? "asc" : "desc"}`;
    if ([...ms.options].some((op) => op.value === want)) ms.value = want;
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
  // Nama petugas: di Google Sheet sudah berupa nama; di claude.ai berupa id yang perlu diterjemahkan.
  const nameCache = {};
  const namesPending = new Set();
  function personName(id) {
    if (!id) return "Tidak diisi";
    if (store.mode !== "shared") return id;
    if (id in nameCache) return nameCache[id] || "Tanpa nama";
    if (!namesPending.has(id)) {
      namesPending.add(id);
      names([id]).then((m) => {
        nameCache[id] = m[id] || "";
        if (activeTab === "summary") renderSummary();
      });
    }
    return "Memuat nama…";
  }

  function renderSummary() {
    summaryDirty = false;
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
      barCard("Hasil kunjungan", countBy(filtered, (o) => statusOf(o).label)),
      barCard("Alasan belum mau CB", countBy(filtered.filter((o) => statusKey(o) === "Belum mau CB"),
        (o) => reasonsOf(o).map((x) => (x.startsWith(OTHER) ? OTHER : x)))),
      barCard("Kunjungan per petugas", countBy(filtered.filter(isVisited), (o) => personName(visits.get(o.id)?.by)), 20),
      barCard("Deal NOO per Kecamatan", countBy(filtered.filter((o) => statusKey(o) === "Deal NOO"), (o) => o.Kecamatan), 15),
      barCard("Belum mau CB per Kecamatan", countBy(filtered.filter((o) => statusKey(o) === "Belum mau CB"), (o) => o.Kecamatan), 15),
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
    const locked = store.mode === "pending" || !store.canWrite || store.needKey;
    // Google Sheet dengan skrip lama belum punya kolom hasil kunjungan.
    const noResult = store.mode === "api" && store.apiVersion < 2;
    const res = v?.result || "";
    const reasons = v?.reasons || [];
    const other = reasons.find((x) => x.startsWith(OTHER));
    const otherText = other ? other.replace(/^Lainnya:?\s*/, "") : "";
    const dis = locked || noResult ? "disabled" : "";
    return `<div class="detail-section visit-box">
      <h3>Kunjungan</h3>
      <label class="check"><input type="checkbox" id="visitDone" ${v?.visited || res ? "checked" : ""} ${locked ? "disabled" : ""}> Sudah didatangi</label>
      <fieldset class="field result-field">
        <legend>Hasil kunjungan</legend>
        ${noResult ? `<p class="warn">Hasil kunjungan belum bisa disimpan karena skrip Google Sheet masih versi lama. Minta admin memperbarui Apps Script (lihat README).</p>` : ""}
        <div class="seg" role="radiogroup">
          ${["", ...RESULTS].map((x) => `<label class="seg-opt seg-${x ? STATUS[x].cls : "none"}">
            <input type="radio" name="visitResult" value="${esc(x)}" ${res === x ? "checked" : ""} ${dis}>
            <span>${x || "Belum ada"}</span></label>`).join("")}
        </div>
      </fieldset>
      <fieldset class="field reason-field" id="reasonBox" ${res === "Belum mau CB" ? "" : "hidden"}>
        <legend>Alasan belum mau CB <small>(boleh lebih dari satu)</small></legend>
        ${[...REASONS, OTHER].map((x) => `<label class="check reason-opt">
          <input type="checkbox" name="visitReason" value="${esc(x)}" ${(x === OTHER ? !!other : reasons.includes(x)) ? "checked" : ""} ${dis}> ${esc(x)}</label>`).join("")}
        <input type="text" id="reasonOther" placeholder="Tulis alasan lainnya" value="${esc(otherText)}" ${other ? "" : "hidden"} ${dis}>
      </fieldset>
      <label class="field"><span>Catatan</span>
        <textarea id="visitNote" rows="3" placeholder="mis. pemilik tertarik, minta dihubungi minggu depan" ${locked ? "disabled" : ""}>${esc(v?.note)}</textarea>
      </label>
      ${store.mode === "api" ? `<label class="field"><span>Nama kamu</span>
        <input type="text" id="visitBy" value="${esc(lsGet(NAME_LS))}" placeholder="mis. Dimas" ${locked ? "disabled" : ""}>
      </label>` : ""}
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
    const nm = await names([v.by, v.updatedBy]);
    const who = nm[v.by], editor = nm[v.updatedBy];
    el.textContent = [v.result ? v.result + " ·" : "", v.visited && v.visitedAt ? "Didatangi " + fmtDate(v.visitedAt) : "",
      who ? "oleh " + who : "", v.updatedAt ? "· diperbarui " + fmtDate(v.updatedAt) : "",
      editor && editor !== who ? "oleh " + editor : ""].filter(Boolean).join(" ");
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
        ${o._dist != null ? `<p><b>${fmtDist(o._dist)}</b> dari lokasimu</p>` : ""}
        <p><a href="${gmaps}" target="_blank" rel="noopener">Buka di Google Maps ↗</a></p></div>
      ${section("Foto", photos ? `<div class="photos">${photos}</div>`
        : `<p class="no-photo">Tidak ada foto untuk outlet ini.${o.id.startsWith("s2-") ? " Data survei Kota Bekasi tidak menyertakan foto." : ""}</p>`)}
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
`;
    $("modal").classList.remove("hidden");
    $("modal").scrollTop = 0;
    document.body.classList.add("no-scroll");
    $("modalBody").querySelectorAll(".photos img").forEach((img) => img.addEventListener("error", () => {
      const fail = document.createElement("span");
      fail.className = "photo-fail";
      fail.textContent = "Foto tidak bisa dimuat. Ketuk untuk membuka langsung.";
      img.replaceWith(fail);
    }, { once: true }));
    renderVisitMeta(o);

    // Memilih hasil berarti outlet sudah didatangi; alasan hanya untuk "Belum mau CB".
    $("modalBody").querySelectorAll('input[name="visitResult"]').forEach((el) => el.addEventListener("change", () => {
      if (el.value) $("visitDone").checked = true;
      $("reasonBox").hidden = el.value !== "Belum mau CB";
    }));
    const otherBox = $("modalBody").querySelector(`input[name="visitReason"][value="${OTHER}"]`);
    otherBox.addEventListener("change", () => {
      $("reasonOther").hidden = !otherBox.checked;
      if (otherBox.checked) $("reasonOther").focus();
    });

    $("visitSave").addEventListener("click", async () => {
      const btn = $("visitSave");
      const note = $("visitNote").value.trim();
      const prev = visits.get(o.id);
      const result = $("modalBody").querySelector('input[name="visitResult"]:checked')?.value || "";
      const done = $("visitDone").checked || !!result;
      let reasons = [];
      if (result === "Belum mau CB") {
        reasons = [...$("modalBody").querySelectorAll('input[name="visitReason"]:checked')].map((el) => el.value)
          .filter((x) => x !== OTHER);
        if (otherBox.checked) {
          const txt = $("reasonOther").value.trim();
          if (!txt) { $("visitMeta").textContent = "Tulis alasan lainnya, atau hapus centang Lainnya."; $("reasonOther").focus(); return; }
          reasons.push(`${OTHER}: ${txt}`);
        }
        if (!reasons.length) { $("visitMeta").textContent = "Pilih minimal satu alasan belum mau CB."; return; }
      }
      const now = new Date().toISOString();
      let by = store.uid || "";
      if (store.mode === "api") {
        by = $("visitBy").value.trim();
        if (!by) { $("visitMeta").textContent = "Isi nama kamu dulu supaya tim tahu siapa yang datang."; $("visitBy").focus(); return; }
        lsSet(NAME_LS, by);
      }
      const rec = done || note ? {
        visited: done,
        result,
        reasons,
        note,
        visitedAt: done ? (prev?.visited && prev.visitedAt) || now : "",
        updatedAt: now,
        // Nama pengunjung pertama tidak ditimpa; yang terakhir mengubah dicatat terpisah.
        by: (prev?.visited && prev.by) || by,
        updatedBy: by,
      } : null;
      btn.disabled = true;
      $("visitMeta").textContent = "Menyimpan…";
      try {
        await saveVisit(o, rec);
        if (rec) visits.set(o.id, rec); else visits.delete(o.id);
        await renderVisitMeta(o);
        $("visitMeta").textContent = "Tersimpan. " + $("visitMeta").textContent;
      } catch (err) {
        if (err?.code === "invalid_argument") {
          store.canWrite = false;
          renderSyncNote();
          $("visitMeta").textContent = "Kamu tidak punya izin mengubah data ini. Minta akses Contributor atau Editor ke pemilik halaman.";
        } else if (err?.code === "kode") {
          $("visitMeta").textContent = "Kode tim salah atau belum diisi. Masukkan kode tim di bagian atas halaman.";
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
  function closeModal() {
    $("modal").classList.add("hidden");
    document.body.classList.toggle("no-scroll", $("filters").classList.contains("open"));
  }
  $("modalClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + b.dataset.tab));
    activeTab = b.dataset.tab;
    if (activeTab === "map") map.invalidateSize();
    if (activeTab === "summary" && summaryDirty) { renderSummary(); summaryDirty = false; }
  }));

  // ---------- export ----------
  async function exportExcel() {
    const btn = $("btnExport");
    btn.disabled = true;
    try {
      const who = await names(filtered.flatMap((o) => [visits.get(o.id)?.by, visits.get(o.id)?.updatedBy]));
      const extra = ["Status Kunjungan", "Hasil Kunjungan", "Alasan Belum Mau CB", "Tanggal Kunjungan",
        "Dikunjungi oleh", "Catatan", "Terakhir diperbarui", "Diperbarui oleh"];
      const aoa = [extra.concat(RAW.cols), ...filtered.map((o) => {
        const v = visits.get(o.id);
        return [isVisited(o) ? "Sudah didatangi" : "Belum didatangi", v?.result || "", reasonsOf(o).join("; "),
          fmtDate(v?.visitedAt), who[v?.by] || "", v?.note || "", fmtDate(v?.updatedAt),
          who[v?.updatedBy] || who[v?.by] || ""].concat(RAW.cols.map((c) => o[c]));
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
  const setTopbarH = () => document.documentElement.style.setProperty("--topbar-h", document.querySelector(".topbar").offsetHeight + "px");
  setTopbarH();
  window.addEventListener("resize", setTopbarH);

  initStore();
  apply();
})();

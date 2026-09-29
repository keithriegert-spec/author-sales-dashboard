"use strict";
(() => {
  const ID_PEPPER = "stable-author-dashboard-v1:"; // must match build.py
  const SESSION_KEY = "asd-session";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("en-US");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- crypto ----------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function fileId(username) {
    const bytes = new TextEncoder().encode(ID_PEPPER + username.trim().toLowerCase());
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }

  async function decrypt(blob, password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(blob.salt), iterations: blob.iter },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---------- session ----------
  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch {} },
    clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} },
  };

  function showLogin() {
    $("dash-view").hidden = true;
    $("login-view").hidden = false;
    $("username").focus();
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("username").value, p = $("password").value;
    const err = $("login-error"), btn = $("login-btn");
    err.hidden = true;
    if (!u.trim() || !p) { err.textContent = "Enter your username and password."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const res = await fetch(`data/${await fileId(u)}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("not found");
      const data = await decrypt(await res.json(), p);
      store.set(data);
      $("password").value = "";
      showDashboard(data);
    } catch {
      err.textContent = "That username and password don't match. Please try again.";
      err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });

  $("logout").addEventListener("click", () => { store.clear(); location.reload(); });

  // ---------- data helpers ----------
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const longDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const sum = (arr) => arr.reduce((a, r) => a + r.units, 0);

  function toMonthly(weeks) {
    const out = [];
    for (const w of weeks) {
      const last = out[out.length - 1];
      if (last && last.date.getFullYear() === w.date.getFullYear() && last.date.getMonth() === w.date.getMonth()) {
        last.units += w.units; last.through = w.date;
      } else {
        out.push({ date: new Date(w.date.getFullYear(), w.date.getMonth(), 1), units: w.units, through: w.date });
      }
    }
    return out;
  }

  function deltaHTML(el, cur, prev, suffix) {
    el.textContent = "";
    if (!prev) return;
    const pct = (cur - prev) / prev * 100;
    const span = document.createElement("span");
    const up = pct >= 0;
    span.className = up ? "up" : "down";
    span.textContent = `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`;
    el.append(span, ` ${suffix}`);
  }

  // ---------- dashboard ----------
  let state = null;

  function showDashboard(data) {
    const weeks = data.weeks.map(([d, u]) => ({ date: parseDate(d), units: u }));
    state = { weeks, months: toMonthly(weeks), range: 0, gran: "month", granTouched: false };

    $("login-view").hidden = true;
    $("dash-view").hidden = false;
    $("author-name").textContent = data.name;
    document.title = `${data.name} · Author Sales`;

    const last = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
    $("stat-week").textContent = fmt.format(last.units);
    $("stat-week-sub").textContent = `Week ending ${longDate(last.date)}`;
    deltaHTML($("stat-week-delta"), last.units, prev && prev.units, "vs. prior week");

    const yr = last.date.getFullYear();
    const ytd = sum(weeks.filter((w) => w.date.getFullYear() === yr));
    const lyCut = new Date(yr - 1, last.date.getMonth(), last.date.getDate());
    const lytd = sum(weeks.filter((w) => w.date.getFullYear() === yr - 1 && w.date <= lyCut));
    $("stat-ytd").textContent = fmt.format(ytd);
    $("stat-ytd-sub").textContent = `Jan 1 – ${MONTHS[last.date.getMonth()]} ${last.date.getDate()}, ${yr}`;
    deltaHTML($("stat-ytd-delta"), ytd, lytd, `vs. same period ${yr - 1}`);

    $("stat-life").textContent = fmt.format(sum(weeks));
    $("stat-life-sub").textContent = `Since ${MONTHS[weeks[0].date.getMonth()]} ${weeks[0].date.getFullYear()} · ${fmt.format(weeks.length)} weeks`;

    $("foot").textContent = `Figures are unit sales reported weekly. Data updated ${data.built ? longDate(parseDate(data.built)) : ""}.`;
    render();
  }

  document.querySelectorAll("#range-seg button").forEach((b) => b.addEventListener("click", () => {
    state.range = Number(b.dataset.range);
    if (!state.granTouched) state.gran = state.range && state.range <= 12 ? "week" : "month";
    render();
  }));
  document.querySelectorAll("#gran-seg button").forEach((b) => b.addEventListener("click", () => {
    state.gran = b.dataset.gran; state.granTouched = true; render();
  }));

  function currentSeries() {
    const src = state.gran === "week" ? state.weeks : state.months;
    if (!state.range) return src;
    const end = state.weeks[state.weeks.length - 1].date;
    const start = new Date(end.getFullYear(), end.getMonth() - state.range, end.getDate());
    return src.filter((p) => (p.through || p.date) > start);
  }

  function periodLabel(p) {
    if (state.gran === "week") return `Week ending ${longDate(p.date)}`;
    const label = `${MONTHS[p.date.getMonth()]} ${p.date.getFullYear()}`;
    const monthEnd = new Date(p.date.getFullYear(), p.date.getMonth() + 1, 0);
    const isLatest = p === state.months[state.months.length - 1];
    return isLatest && p.through < new Date(monthEnd - 6 * 864e5) ? `${label} (through ${MONTHS[p.through.getMonth()]} ${p.through.getDate()})` : label;
  }

  function niceMax(v) {
    if (v <= 0) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(v / 4)));
    const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= v);
    return nice * 4;
  }

  function xTicks(series) {
    const first = series[0].date, last = series[series.length - 1].date;
    const years = (last - first) / (365.25 * 864e5);
    const stepM = years > 6 ? 24 : years > 2.5 ? 12 : years > 1.2 ? 6 : years > 0.6 ? 2 : 1;
    const ticks = [];
    const d = new Date(first.getFullYear(), stepM >= 12 ? 0 : Math.ceil((first.getMonth() + 1) / stepM) * stepM, 1);
    if (stepM === 24 && d.getFullYear() % 2) d.setFullYear(d.getFullYear() + 1);
    for (; d <= last; d.setMonth(d.getMonth() + stepM)) {
      if (d < first) continue;
      const label = stepM >= 12 ? String(d.getFullYear())
        : d.getMonth() === 0 ? String(d.getFullYear()) : MONTHS[d.getMonth()];
      ticks.push({ date: new Date(d), label });
    }
    return ticks;
  }

  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  function render() {
    document.querySelectorAll("#range-seg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.range) === state.range)));
    document.querySelectorAll("#gran-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gran === state.gran)));

    const series = currentSeries();
    const total = sum(series);
    $("chart-sub").textContent = `${state.gran === "week" ? "Weekly" : "Monthly"} units · ${fmt.format(total)} in this range`;

    // table
    const tbody = $("data-table").tBodies[0];
    tbody.textContent = "";
    for (let i = series.length - 1; i >= 0; i--) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = periodLabel(series[i]);
      tr.insertCell().textContent = fmt.format(series[i].units);
    }

    drawChart(series);
  }

  function drawChart(series) {
    const host = $("chart"), tip = $("tooltip");
    host.textContent = ""; tip.hidden = true;
    if (series.length < 2) { host.textContent = "Not enough data in this range."; return; }

    const W = host.clientWidth, H = host.clientHeight;
    const m = { t: 8, r: 8, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const t0 = +series[0].date, t1 = +series[series.length - 1].date;
    const yMax = niceMax(Math.max(...series.map((p) => p.units)));
    const x = (d) => m.l + ((+d - t0) / (t1 - t0)) * iw;
    const y = (v) => m.t + ih - (v / yMax) * ih;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Line chart of ${state.gran}ly unit sales` }, host);
    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: "fill-grad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-opacity": 0.22 }, grad);
    el("stop", { offset: "100%", "stop-opacity": 0.02 }, grad);

    const grid = el("g", { class: "grid" }, svg);
    for (let i = 1; i <= 4; i++) {
      const v = (yMax / 4) * i, yy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy }, grid);
      const t = el("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end" }, svg);
      t.textContent = fmt.format(v);
    }
    el("text", { x: m.l - 8, y: y(0) + 4, "text-anchor": "end" }, svg).textContent = "0";

    for (const tk of xTicks(series)) {
      const xx = x(tk.date);
      if (xx < m.l + 12 || xx > W - m.r - 12) continue;
      el("text", { x: xx, y: H - 6, "text-anchor": "middle" }, svg).textContent = tk.label;
    }

    const pts = series.map((p) => [x(p.date), y(p.units)]);
    const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    el("path", { class: "area", d: `${linePath}L${pts[pts.length - 1][0].toFixed(1)},${y(0)}L${pts[0][0].toFixed(1)},${y(0)}Z` }, svg);
    el("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);
    el("path", { class: "line", d: linePath }, svg);

    const cross = el("line", { class: "cross", y1: m.t, y2: m.t + ih, visibility: "hidden" }, svg);
    const dot = el("circle", { class: "dot", r: 5, visibility: "hidden" }, svg);
    const hit = el("rect", { class: "hit", x: m.l, y: 0, width: iw, height: H, tabindex: 0,
      "aria-label": "Sales chart. Use left and right arrow keys to read values." }, svg);

    let idx = -1;
    const show = (i) => {
      idx = Math.max(0, Math.min(series.length - 1, i));
      const [px, py] = pts[idx];
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
      tip.textContent = "";
      const v = document.createElement("div"); v.className = "tt-value";
      const key = document.createElement("span"); key.className = "tt-key";
      v.append(key, fmt.format(series[idx].units) + " units");
      const l = document.createElement("div"); l.className = "tt-label"; l.textContent = periodLabel(series[idx]);
      tip.append(v, l);
      tip.hidden = false;
      const hostBox = host.getBoundingClientRect(), cardBox = host.offsetParent.getBoundingClientRect();
      const ox = hostBox.left - cardBox.left, oy = hostBox.top - cardBox.top;
      const tw = tip.offsetWidth;
      let left = ox + px + 14;
      if (left + tw > cardBox.width - 8) left = ox + px - tw - 14;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${oy + Math.max(0, Math.min(py - 30, ih - 40))}px`;
    };
    const hide = () => {
      idx = -1; tip.hidden = true;
      cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
    };
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((clientX - r.left) * (W / r.width) - m.l) / iw * (t1 - t0);
      let lo = 0, hi = series.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; (+series[mid].date < t ? (lo = mid) : (hi = mid)); }
      return Math.abs(+series[lo].date - t) <= Math.abs(+series[hi].date - t) ? lo : hi;
    };
    hit.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
    hit.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    hit.addEventListener("focus", () => show(series.length - 1));
    hit.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, Home: -1e9, End: 1e9 }[e.key];
      if (step === undefined) return;
      e.preventDefault(); show((idx < 0 ? series.length - 1 : idx) + step);
    });
  }

  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state && !$("dash-view").hidden) drawChart(currentSeries()); }, 80);
  }).observe($("chart"));

  // ---------- boot ----------
  const saved = store.get();
  if (saved && saved.weeks) showDashboard(saved); else showLogin();
})();

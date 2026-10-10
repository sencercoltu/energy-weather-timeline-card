/**
 * Energy & Weather Timeline Card
 * ------------------------------------------------------------------
 * Clock, current weather, warning banner, storm alert and one sliding timeline
 * centred on now (yesterday, today and tomorrow joined) with hourly weather,
 * solar production + forecast, home use, grid import/export, battery state of
 * charge, backup reserve, import and export tariff bands, rain, humidity and UV,
 * followed by six summary tiles.
 *
 * Target:   Home Assistant 2026.10
 * Card:     type: custom:energy-weather-timeline-card
 * Resource: /local/energy-weather-timeline-card.js  (JavaScript module)
 *
 * No external imports: plain custom element + Shadow DOM. The visual editor
 * uses Home Assistant's built-in form editor (static getConfigForm).
 */

/* [OLD 2026-10-09] Bumped for the solar forecast fix (see _solarForecast).
const CARD_VERSION = "1.0.0";
[/OLD] */
/* [OLD 2026-10-09 v1.0.1->v1.0.2] Version bump for the generic forecast-attribute reader.
const CARD_VERSION = "1.0.1";
[/OLD] */
/* [OLD 2026-10-09 v1.0.2->v1.0.3] Version bump for the energy-flow fallbacks and diagnostics.
const CARD_VERSION = "1.0.2";
[/OLD] */
/* [OLD 2026-10-09 v1.0.3->v1.0.4] Version bump to publish the first GitHub release with the release workflow.
const CARD_VERSION = "1.0.3";
[/OLD] */
/* [OLD 2026-10-09 v1.0.4->v1.1.0] Version bump for the sliding timeline, export tariff, storm alert and battery time left.
const CARD_VERSION = "1.0.4";
[/OLD] */
/* [OLD 2026-10-09 v1.1.0->v1.2.0] Version bump for the export price entity.
const CARD_VERSION = "1.1.0";
[/OLD] */
/* [OLD 2026-10-09 v1.2.0->v1.3.0] Version bump for MWh, the Now label on the time axis and fitting the sections grid.
const CARD_VERSION = "1.2.0";
[/OLD] */
/* [OLD 2026-10-10 v1.3.0->v1.4.0] Version bump for round axis steps, the impossible-hour guard, the Buy band from a price entity, the Now chip back at the top and the money tile.
const CARD_VERSION = "1.3.0";
[/OLD] */
/* [OLD 2026-10-10 v1.4.0->v1.5.0] Version bump for per-battery charge lines and the see-through Now label.
const CARD_VERSION = "1.4.0";
[/OLD] */
/* [OLD 2026-10-10 v1.5.0->v1.5.1] Version bump for the running hour of a meter that reset at midnight.
const CARD_VERSION = "1.5.0";
[/OLD] */
const CARD_VERSION = "1.5.1";
const CARD_TAG = "energy-weather-timeline-card";
const HOUR = 3600000;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r1 = (n) => Math.round(n * 10) / 10;
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
// statistics return ms epoch, history returns seconds epoch, attributes return ISO strings
const toMs = (v) => (typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : Date.parse(v));
const sum = (arr, upto = arr.length - 1) => {
  let s = 0;
  for (let i = 0; i <= upto && i < arr.length; i++) if (arr[i] != null) s += arr[i];
  return s;
};
const argmax = (arr, upto = arr.length - 1) => {
  let best = -1;
  for (let i = 0; i <= upto && i < arr.length; i++) if (arr[i] != null && (best < 0 || arr[i] > arr[best])) best = i;
  return best;
};

const ENERGY_F = { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };
const POWER_F = { W: 0.001, kW: 1, MW: 1000 };
const LENGTH_F = { mm: 1, cm: 10, in: 25.4 };

const energyKWh = (st) => {
  const v = num(st?.state);
  return v === null ? null : v * (ENERGY_F[st.attributes?.unit_of_measurement] ?? 1);
};
const powerKW = (st, invert) => {
  const v = num(st?.state);
  if (v === null) return null;
  const kw = v * (POWER_F[st.attributes?.unit_of_measurement] ?? 0.001);
  return invert ? -kw : kw;
};
const lengthMm = (st) => {
  const v = num(st?.state);
  return v === null ? null : v * (LENGTH_F[st.attributes?.unit_of_measurement] ?? 1);
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const bearingDeg = (b) => {
  if (b === null || b === undefined) return null;
  const n = num(b);
  if (n !== null) return n;
  const i = COMPASS.indexOf(String(b).toUpperCase());
  return i >= 0 ? i * 22.5 : null;
};
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// added 2026-10-09 v1.1.0: storm alert — wind units to km/h, and what counts as storm-force
const WIND_KMH = { "km/h": 1, "m/s": 3.6, mph: 1.609344, kn: 1.852, knots: 1.852, "ft/s": 1.09728 };
const STORM_GUST_KMH = 75;  // gusts at or above this raise the alert
const STORM_WIND_KMH = 55;  // as does a mean wind at or above this
const STORM_AHEAD_H = 24;   // how far ahead the forecast is checked

/* ------------------------------------------------------------------ */
/* Time zone helpers (the card follows HA's time zone, not the device) */
/* ------------------------------------------------------------------ */

const _partsFmt = new Map();
function tzParts(ms, tz) {
  let f = _partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    _partsFmt.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
function tzOffset(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
function dayStart(ms, tz) {
  const p = tzParts(ms, tz);
  const midnightUtc = Date.UTC(p.y, p.mo - 1, p.d);
  let guess = midnightUtc - tzOffset(ms, tz);
  guess = midnightUtc - tzOffset(guess, tz); // second pass handles DST days
  return guess;
}

/* Sunrise / sunset (NOAA sunrise equation), returns UTC ms */
function sunTimes(dayStartMs, lat, lon) {
  const rad = Math.PI / 180;
  const jd = (dayStartMs + 12 * HOUR) / 86400000 + 2440587.5;
  const n = Math.ceil(jd - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosW < -1 || cosW > 1) return null; // polar day / night
  const w = Math.acos(cosW) / rad;
  const toMsJ = (j) => (j - 2440587.5) * 86400000;
  return { rise: toMsJ(jTransit - w / 360), set: toMsJ(jTransit + w / 360) };
}

/* ------------------------------------------------------------------ */
/* Tariff schedule                                                     */
/* ------------------------------------------------------------------ */

const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? "").trim());
  return m ? Math.min(24, +m[1] + +m[2] / 60) : null;
};
function parseTariff(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const a = hhmm(p.start), b0 = hhmm(p.end);
    if (a === null || b0 === null) continue;
    const b = b0 === 0 ? 24 : b0;
    const type = ["off_peak", "peak", "standard"].includes(p.type) ? p.type : "standard";
    const seg = { rate: num(p.rate), type, label: p.label ? String(p.label) : null };
    if (b > a) out.push({ a, b, ...seg });
    else if (b < a) { out.push({ a, b: 24, ...seg }); out.push({ a: 0, b, ...seg }); }
  }
  return out.sort((x, y) => x.a - y.a);
}
function tariffSegments(sched, stdRate) {
  const out = [];
  let t = 0;
  for (const s of sched) {
    if (s.a > t + 1e-6) out.push({ a: t, b: s.a, rate: stdRate, type: "standard", label: null });
    out.push(s);
    t = Math.max(t, s.b);
  }
  if (t < 24 - 1e-6) out.push({ a: t, b: 24, rate: stdRate, type: "standard", label: null });
  return out;
}

/* ------------------------------------------------------------------ */
/* Weather icons (inline SVG, 32x32 box)                               */
/* ------------------------------------------------------------------ */

const ICON = {
  SUN: "M9,16a7,7 0 1,0 14,0a7,7 0 1,0 -14,0",
  SUN_S: "M17,10a6,6 0 1,0 12,0a6,6 0 1,0 -12,0",
  MOON: "M19,5.5A10.5,10.5 0 1,0 26.5,21A9.5,9.5 0 0,1 19,5.5Z",
  MOON_S: "M22,3A7,7 0 1,0 28,13A6.3,6.3 0 0,1 22,3Z",
  CLOUD: "M9,25h15a5.5,5.5 0 0,0 .5-11a7,7 0 0,0 -13.5,1.5a4.75,4.75 0 0,0 -2,9.5z",
  BACK: "M17,15h10a4,4 0 0,0 0-8a5.5,5.5 0 0,0 -10.5,1.5a3.2,3.2 0 0,0 .5,6.5z",
  RAIN: "M12,27.5l-1.2,3M17,27.5l-1.2,3M22,27.5l-1.2,3",
  POUR: "M10,27.5l-1.4,3.5M14.5,27.5l-1.4,3.5M19,27.5l-1.4,3.5M23.5,27.5l-1.4,3.5",
  SNOW: "M11,29a1.4,1.4 0 1,0 2.8,0a1.4,1.4 0 1,0 -2.8,0M16,30.5a1.4,1.4 0 1,0 2.8,0a1.4,1.4 0 1,0 -2.8,0M21,29a1.4,1.4 0 1,0 2.8,0a1.4,1.4 0 1,0 -2.8,0",
  BOLT: "M17.5,19l-4.5,7h3.5l-1.5,5.5l6-8.5h-3.5l2.5-4z",
  FOG: "M5,27.5h22M8,31h16",
  WIND: "M4,12h15a3.5,3.5 0 1,0 -3.5-3.5M4,18h21a3.5,3.5 0 1,1 -3.5,3.5M4,24h11",
  WARN: "M16,4L29,27H3Z",
};
function iconPaths(cond, night) {
  const c = String(cond || "");
  const L = [];
  const back = () => L.push(`<path d="${ICON.BACK}" style="fill:var(--ewt-cloud-back,#8C929A)"/>`);
  const cloud = (dark) => L.push(`<path d="${ICON.CLOUD}" style="fill:${dark ? "var(--ewt-cloud-dark,#B8BDC5)" : "var(--ewt-cloud,#E4E6EA)"}"/>`);
  const orb = (d, col) => L.push(`<path d="${d}" style="fill:${col}"/>`);
  const strokes = (d, col, w = 2) => L.push(`<path d="${d}" style="fill:none;stroke:${col};stroke-width:${w};stroke-linecap:round"/>`);
  switch (c) {
    case "sunny": night ? orb(ICON.MOON, "var(--ewt-moon,#FFF1A8)") : orb(ICON.SUN, "var(--ewt-sun,#FDD835)"); break;
    case "clear-night": orb(ICON.MOON, "var(--ewt-moon,#FFF1A8)"); break;
    case "partlycloudy": night ? orb(ICON.MOON_S, "var(--ewt-moon,#FFF1A8)") : orb(ICON.SUN_S, "var(--ewt-sun,#FDD835)"); cloud(false); break;
    case "cloudy": back(); cloud(false); break;
    case "fog": cloud(false); strokes(ICON.FOG, "#9E9E9E", 1.8); break;
    case "rainy": back(); cloud(true); strokes(ICON.RAIN, "#4FC3F7"); break;
    case "pouring": back(); cloud(true); strokes(ICON.POUR, "#4FC3F7"); break;
    case "snowy": cloud(false); L.push(`<path d="${ICON.SNOW}" style="fill:#FFFFFF"/>`); break;
    case "snowy-rainy": cloud(true); strokes("M12,27.5l-1.2,3M22,27.5l-1.2,3", "#4FC3F7"); L.push(`<path d="M16,30a1.4,1.4 0 1,0 2.8,0a1.4,1.4 0 1,0 -2.8,0" style="fill:#FFFFFF"/>`); break;
    case "hail": cloud(true); L.push(`<path d="${ICON.SNOW}" style="fill:#CFE8F5"/>`); break;
    case "lightning": back(); cloud(true); orb(ICON.BOLT, "#FDD835"); break;
    case "lightning-rainy": cloud(true); strokes("M10,27.5l-1.2,3M24,27.5l-1.2,3", "#4FC3F7"); orb(ICON.BOLT, "#FDD835"); break;
    case "windy": strokes(ICON.WIND, "#B8BDC5", 2.2); break;
    case "windy-variant": cloud(false); strokes("M4,29h16M8,32h12", "#B8BDC5", 1.8); break;
    case "exceptional": L.push(`<path d="${ICON.WARN}" style="fill:none;stroke:#F6C744;stroke-width:2.2;stroke-linejoin:round"/>`); strokes("M16,12v7M16,23v.2", "#F6C744", 2.4); break;
    default: cloud(false);
  }
  return L.join("");
}
const iconSvg = (cond, night, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${iconPaths(cond, night)}</svg>`;

/* Legend swatches used by the tiles */
const SW = {
  solar: `<svg width="10" height="12" viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="1" width="10" height="12" rx="2" style="fill:#FF9800;fill-opacity:.6;stroke:#FFA726"/></svg>`,
  fc: `<svg width="16" height="4" viewBox="0 0 18 4" aria-hidden="true"><path d="M0,2H18" class="sw-fc"/></svg>`,
  home: `<svg width="16" height="4" viewBox="0 0 18 4" aria-hidden="true"><path d="M0,2H18" style="stroke:#F48FB1;stroke-width:2.5"/></svg>`,
  grid: `<svg width="16" height="4" viewBox="0 0 18 4" aria-hidden="true"><path d="M0,2H18" style="stroke:#5B8DEF;stroke-width:2.5"/></svg>`,
  exp: `<svg width="8" height="10" viewBox="0 0 8 10" aria-hidden="true"><rect x=".5" y=".5" width="7" height="9" rx="1.5" style="fill:#9575CD;fill-opacity:.7;stroke:#B39DDB"/></svg>`,
  soc: `<svg width="12" height="10" viewBox="0 0 14 12" aria-hidden="true"><path d="M1,11V6Q4,2 7,4T13,2V11Z" style="fill:#4DD0A1;fill-opacity:.25;stroke:#4DD0A1;stroke-width:1.5"/></svg>`,
  cost: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8" class="sw-cost"/></svg>`,
};

/* ------------------------------------------------------------------ */
/* Solar forecast from entity attributes (added 2026-10-09, v1.0.2)    */
/* Finds any time series in the attributes, whatever its layout:       */
/*   [{period_start, pv_estimate}, …]  [[time, value], …]  {time: value} */
/* and works out its unit (kWh, Wh, kW, W per interval) by comparing   */
/* today's sum with the sensor's own daily total.                      */
/* ------------------------------------------------------------------ */

const FC_TIME_KEYS = ["period_start", "period_end", "start", "datetime", "date_time", "time", "timestamp", "period", "from", "begin", "date"];
const FC_VALUE_KEYS = ["pv_estimate", "pv_estimate50", "estimate", "energy", "wh", "kwh", "value", "forecast", "power", "watts", "pv_power", "production"];
const isTimeLike = (v) =>
  (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) || (typeof v === "number" && v > 1e9 && v < 1e13);
const parseTime = (v) => (typeof v === "number" ? toMs(v) : Date.parse(String(v).replace(" ", "T")));

function readForecastAttributes(attrs, ds, stateKwh) {
  const cands = [];
  for (const [name, val] of Object.entries(attrs)) {
    let pts = null, vk = "", shift = 0;
    if (Array.isArray(val) && val.length >= 3) {
      const first = val.find((x) => x != null);
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const keys = Object.keys(first);
        const tk = FC_TIME_KEYS.find((k) => isTimeLike(first[k])) || keys.find((k) => isTimeLike(first[k]));
        if (!tk) continue;
        vk = FC_VALUE_KEYS.find((k) => typeof first[k] !== "boolean" && num(first[k]) !== null)
          || keys.find((k) => k !== tk && typeof first[k] !== "boolean" && !isTimeLike(first[k]) && num(first[k]) !== null);
        if (!vk) continue;
        pts = val.map((x) => (x && typeof x === "object" ? [parseTime(x[tk]), num(x[vk])] : null));
        if (tk === "period_end") shift = -1; // timestamps mark the end of each interval
      } else if (Array.isArray(first) && first.length >= 2 && isTimeLike(first[0])) {
        pts = val.map((x) => (Array.isArray(x) ? [parseTime(x[0]), num(x[1])] : null));
      }
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      const ents = Object.entries(val);
      if (ents.length >= 3 && ents.every(([k, v]) => isTimeLike(k) && num(v) !== null)) pts = ents.map(([k, v]) => [parseTime(k), num(v)]);
    }
    if (!pts) continue;
    pts = pts.filter((p) => p && Number.isFinite(p[0]) && p[1] !== null).sort((a, b) => a[0] - b[0]);
    if (pts.length >= 3) cands.push({ name, vk, pts, shift });
  }

  if (!cands.length) {
    const sample = Object.entries(attrs)
      .filter(([, v]) => v && typeof v === "object")
      .map(([k, v]) => `${k}=${JSON.stringify(Array.isArray(v) ? v[0] : v).slice(0, 120)}`)
      .slice(0, 3);
    return { hours: null, note: `no time series found in attributes (${Object.keys(attrs).join(", ") || "none"})${sample.length ? `; sample: ${sample.join(" | ")}` : ""}` };
  }

  // Solcast-style per-site series (name_xxxx-xxxx-…) are summed unless a combined series exists
  const siteRe = /[_-][0-9a-z]{4}(?:[-_][0-9a-z]{4}){2,}$/i;
  const names = new Set(cands.map((x) => x.name));
  const grouped = new Map();
  for (const cd of cands) {
    const base = cd.name.replace(siteRe, "");
    if (base !== cd.name && names.has(base)) continue;
    const g = grouped.get(base);
    if (g && base !== cd.name) g.pts = g.pts.concat(cd.pts).sort((a, b) => a[0] - b[0]);
    else grouped.set(base, { ...cd, name: base, pts: cd.pts.slice() });
  }

  const UNITS = [
    ["kWh", (v) => v],
    ["Wh", (v) => v / 1000],
    ["kW", (v, h) => v * h],
    ["W", (v, h) => (v * h) / 1000],
  ];
  const guessUnit = (cd) => {
    const n = `${cd.name} ${cd.vk}`.toLowerCase();
    if (/kwh/.test(n)) return "kWh";
    if (/wh/.test(n)) return "Wh";
    if (/watt|power|\bw\b/.test(n)) return "W";
    const max = Math.max(...cd.pts.map((p) => p[1]));
    return max > 50 ? "W" : "kW";
  };

  let best = null;
  for (const cd of grouped.values()) {
    const ts = [...new Set(cd.pts.map((p) => p[0]))];
    const diffs = ts.slice(1).map((t, i) => (t - ts[i]) / HOUR).filter((d) => d > 0).sort((a, b) => a - b);
    const step = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 1;
    const nameBonus = /hour|detailed|period|forecast/i.test(cd.name) ? 0.01 : 0;
    for (const [unit, conv] of UNITS) {
      const out = Array(24).fill(0);
      let any = false, tomorrow = 0, today = 0;
      const byHour = {}; // added 2026-10-09 v1.1.0: every hour in the series, keyed by hours since ds
      for (const [t0, v] of cd.pts) {
        const t = t0 + cd.shift * step * HOUR;
        const i = Math.floor((t - ds) / HOUR), kwh = conv(v, step);
        byHour[i] = (byHour[i] || 0) + kwh; // added 2026-10-09 v1.1.0
        if (i >= 0 && i < 24) { out[i] += kwh; today += kwh; any = true; }
        else if (i >= 24 && i < 48) tomorrow += kwh;
      }
      if (!any) continue;
      const score = stateKwh > 0
        ? (today > 0 ? Math.abs(Math.log(today / stateKwh)) : 99) - nameBonus
        : (unit === guessUnit(cd) ? 0 : 1) - nameBonus;
      if (!best || score < best.score)
        /* [OLD 2026-10-09 v1.0.4->v1.1.0] Returned today's hours only.
        best = { score, hours: out, tomorrow: tomorrow || null, label: `${cd.name}${cd.vk ? `.${cd.vk}` : ""} (${unit} per ${r1(step * 60)} min)` };
        [/OLD] */
        best = { score, hours: out, tomorrow: tomorrow || null, byHour, label: `${cd.name}${cd.vk ? `.${cd.vk}` : ""} (${unit} per ${r1(step * 60)} min)` };
    }
  }
  if (!best) return { hours: null, note: `time series found (${[...grouped.keys()].join(", ")}) but none has entries for today` };
  return best;
}

/* ------------------------------------------------------------------ */
/* Price entities (added 2026-10-09, v1.2.0)                           */
/* A price entity can carry its rates as a schedule in its attributes  */
/* (Octopus Energy day-rates events: rates[{start, end, value_inc_vat}]; */
/* Nord Pool: raw_today / raw_tomorrow [{start, end, value}]), and a   */
/* numeric state whose recorder history gives the past rates.          */
/* ------------------------------------------------------------------ */

// a plain number only: "0.15" yes, "2026-10-09T16:00:00" no (parseFloat would give 2026)
const strictNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return /^\s*-?\d+(\.\d+)?(e-?\d+)?\s*$/i.test(String(v ?? "")) ? parseFloat(v) : null;
};
// unit_of_measurement → factor to currency per kWh (pence/cents per kWh → 0.01, per MWh → 0.001)
const rateFactor = (unit) => {
  const u = String(unit || "");
  let f = /^(p|c|ct|¢|cents?|pence)\s*\//i.test(u) || /^GBp\b/.test(u) ? 0.01 : 1;
  if (/mwh/i.test(u)) f /= 1000;
  return f;
};
const RATE_TIME_KEYS = ["start", "from", "valid_from", "period_start", "start_time", "datetime", "time", "begin"];
const RATE_END_KEYS = ["end", "to", "valid_to", "period_end", "end_time", "until"];
const RATE_VALUE_KEYS = ["value_inc_vat", "rate_inc_vat", "price_inc_vat", "value", "price", "rate", "unit_rate", "export_rate", "import_rate", "total", "value_exc_vat"];
function readRateSchedule(attrs) {
  const rows = [], names = [];
  for (const [name, val] of Object.entries(attrs || {})) {
    if (!Array.isArray(val) || !val.length) continue;
    const first = val.find((x) => x && typeof x === "object" && !Array.isArray(x));
    if (!first) continue;
    const tk = RATE_TIME_KEYS.find((k) => isTimeLike(first[k]));
    const vk = RATE_VALUE_KEYS.find((k) => typeof first[k] !== "boolean" && !isTimeLike(first[k]) && num(first[k]) !== null);
    if (!tk || !vk) continue;
    const ek = RATE_END_KEYS.find((k) => isTimeLike(first[k]));
    const got = val
      .filter((x) => x && typeof x === "object")
      .map((x) => ({ t0: parseTime(x[tk]), t1: ek ? parseTime(x[ek]) : NaN, v: num(x[vk]) }))
      .filter((r) => Number.isFinite(r.t0) && r.v !== null);
    if (!got.length) continue;
    rows.push(...got);
    names.push(`${name}.${vk}`);
  }
  rows.sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const r of rows) if (!out.length || out[out.length - 1].t0 !== r.t0) out.push({ ...r });
  const steps = out.slice(1).map((r, i) => r.t0 - out[i].t0).filter((d) => d > 0).sort((a, b) => a - b);
  const step = steps.length ? steps[Math.floor(steps.length / 2)] : HOUR;
  out.forEach((r, i) => {
    if (!Number.isFinite(r.t1) || r.t1 <= r.t0) r.t1 = i + 1 < out.length ? Math.min(out[i + 1].t0, r.t0 + step) : r.t0 + step;
  });
  return { entries: out, names };
}

/* ------------------------------------------------------------------ */
/* Energy fallbacks (added 2026-10-09, v1.0.3)                         */
/* ------------------------------------------------------------------ */

// Hourly change of a cumulative meter from its raw recorder history (handles meter resets)
// v1.1.0: ds is the start of the first hour, nh the index of the running hour (any length, not just one day)
function cumulativeHours(series, live, ds, now, nh) {
  const pts = series.slice();
  if (live !== null && live !== undefined) pts.push([now, live]);
  const valAt = (t) => {
    let v = pts.length ? pts[0][1] : null;
    for (const [ts, x] of pts) { if (ts <= t) v = x; else break; }
    return v;
  };
  /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fixed 24-hour day; the sliding timeline reaches back into yesterday.
  const arr = Array(24).fill(null);
  for (let h = 0; h <= nh; h++) {
    const a = valAt(ds + h * HOUR), b = valAt(Math.min(now, ds + (h + 1) * HOUR));
  [/OLD] */
  const arr = Array(nh + 1).fill(null);
  for (let h = 0; h <= nh; h++) {
    const a = valAt(ds + h * HOUR), b = valAt(Math.min(now, ds + (h + 1) * HOUR));
    arr[h] = a === null || b === null ? 0 : b >= a ? b - a : Math.max(0, b);
  }
  return arr;
}

// Hourly kWh from a power sensor's history (kW, signed). sign picks the direction to count:
// +1 counts positive power (import, production, use), -1 counts negative power (export).
// v1.1.0: ds is the start of the first hour, nh the index of the running hour (any length, not just one day)
function integratePower(series, live, sign, ds, now, nh) {
  const pts = series.slice();
  if (live && live[1] !== null && Number.isFinite(live[0])) {
    const lastT = pts.length ? pts[pts.length - 1][0] : ds;
    pts.push([Math.max(lastT, Math.min(now, live[0])), live[1]]);
  }
  /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fixed 24-hour day; the sliding timeline reaches back into yesterday.
  const arr = Array(24).fill(null);
  for (let h = 0; h <= nh; h++) arr[h] = 0;
  [/OLD] */
  const arr = Array(nh + 1).fill(null);
  for (let h = 0; h <= nh; h++) arr[h] = 0;
  for (let i = 0; i < pts.length; i++) {
    let t0 = Math.max(ds, pts[i][0]);
    const t1 = Math.min(now, i + 1 < pts.length ? pts[i + 1][0] : now);
    const kw = Math.max(0, pts[i][1] * sign);
    if (!(kw > 0) || t1 <= t0) continue;
    while (t0 < t1) {
      const h = Math.floor((t0 - ds) / HOUR);
      const end = Math.min(t1, ds + (h + 1) * HOUR);
      /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fixed 24-hour day.
      if (h >= 0 && h < 24) arr[h] += (kw * (end - t0)) / HOUR;
      [/OLD] */
      if (h >= 0 && h <= nh) arr[h] += (kw * (end - t0)) / HOUR;
      t0 = end;
    }
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* Timeline chart (pure function: model -> SVG string)                 */
/* ------------------------------------------------------------------ */

// added 2026-10-10 v1.4.0: a round axis step — 0.5, 1, 2, 5, 10, 20 … kWh (whole kWh once the top reaches 2) — giving
// as many steps as the plot height has room for (2 to 5)
function axisStep(max, plotH) {
  const most = Math.max(2, Math.min(5, Math.floor(plotH / 30)));
  const want = Math.max(1, max) / most;
  const p = Math.pow(10, Math.floor(Math.log10(want)));
  const step = [1, 2, 5, 10].map((x) => x * p).find((x) => x >= want - 1e-9);
  return Math.max(max >= 2 ? 1 : 0.5, step);
}

// added 2026-10-10 v1.4.0: hourly energy a home can't produce (over SANE_KWH_H kWh in an hour). When a fifth or more of
// the hours are over (and at least three, if the sensor claims an energy unit), the sensor reports Wh, so
// every hour is divided by 1000. Any hour still over the limit is a meter that dropped to zero and came
// back, and is left out. arr runs over the fetched hours, 0..nI-1 finished and nI the running one;
// unitKnown says the sensor has an energy unit; at(i) gives a clock label for the console note.
const SANE_KWH_H = 100;
function saneFlow(arr, nI, at, unitKnown) {
  let out = arr.slice();
  const notes = [];
  const done = out.slice(0, nI).filter((v) => v != null && v > 1e-4);
  const over = done.filter((v) => v > SANE_KWH_H).length;
  if ((unitKnown ? over >= 3 : over >= 1) && over >= 0.2 * done.length) {
    out = out.map((v) => (v == null ? v : v / 1000));
    notes.push(`${over} of ${done.length} hours read over ${SANE_KWH_H} kWh, so the values look like Wh and were divided by 1000`);
  }
  const bad = [];
  out = out.map((v, i) => {
    if (v != null && v > SANE_KWH_H) { bad.push(`${at(i)} (${Math.round(v)} kWh)`); return null; }
    return v;
  });
  if (bad.length) notes.push(`left out ${bad.length} hour${bad.length > 1 ? "s" : ""} over ${SANE_KWH_H} kWh, a meter that dropped to zero and came back: ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? " …" : ""}`);
  return { arr: out, note: notes.join("; ") };
}

// added 2026-10-10 v1.5.0: the per-battery charge entities from the config (a list, or one id)
const unitSocIds = (c) => (Array.isArray(c.battery_unit_soc_entities) ? c.battery_unit_soc_entities : [c.battery_unit_soc_entities]).filter((x) => typeof x === "string" && x);

function smooth(pts, base, top) {
  const f = r1;
  const cy = (y) => Math.max(top, Math.min(base, y));
  let s = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    s += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(cy(p1[1] + (p2[1] - p0[1]) / 6))} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(cy(p2[1] - (p3[1] - p1[1]) / 6))} ${f(p2[0])},${f(p2[1])}`;
  }
  return s;
}
const fmtTick = (v) => (v < 0 ? "−" : "") + String(r1(Math.abs(v)));

/* [OLD 2026-10-09 v1.0.4->v1.1.0] Fixed midnight-to-midnight day; replaced by the sliding window below. Also drew the wind row and the 'Today so far' / 'Forecast' labels.
function chartSvg(W, m) {
  const f = r1;
  const L = 30, R = m.soc ? 40 : 14;
  const iw = Math.max(60, W - L - R);
  const X = (h) => L + (Math.max(0, Math.min(24, h)) / 24) * iw;
  const hasWx = !!(m.slots && m.slots.length);
  const top = hasWx ? 92 : 30;
  const posH = 156;

  // scales: one kWh axis for everything, SOC mapped 0-100 % onto the positive half
  const rateAtNow = (a) => (a && m.frac >= 0.2 && a[m.nh] != null ? a[m.nh] / m.frac : 0);
  let maxPos = 0;
  for (const a of [m.solar, m.solarFc, m.home, m.imp]) if (a) for (let i = 0; i < a.length; i++) if (a[i] != null && a[i] > maxPos) maxPos = a[i];
  maxPos = Math.max(maxPos, rateAtNow(m.home), rateAtNow(m.imp));
  const kMax = maxPos <= 1 ? 1 : maxPos <= 2 ? 2 : Math.ceil(maxPos);
  let maxExp = 0;
  if (m.exp) m.exp.forEach((v) => { if (v != null && v > maxExp) maxExp = v; });
  const kNeg = m.exp ? Math.max(0.5, Math.ceil(maxExp * 2) / 2) : 0;
  const zero = top + posH;
  const Y = (v) => zero - (Math.max(-kNeg, Math.min(kMax, v)) / kMax) * posH;
  const YS = (p) => zero - (Math.max(0, Math.min(100, p)) / 100) * posH;
  const bottom = zero + (kNeg / kMax) * posH;

  // lanes under the chart
  const xLabelBase = bottom + 15;
  let rowY = bottom + 24;
  let tariffY = null, rainBase = null, humY = null, windY = null;
  if (m.tariff) { tariffY = rowY; rowY += 20; }
  if (m.rainMm) { rainBase = rowY + 22; rowY += 28; }
  if (hasWx && m.showHum) { humY = rowY + 10; rowY += 16; }
  if (hasWx && m.showWind) { windY = rowY + 7; rowY += 18; }
  const H = Math.ceil(rowY + 2);
  const nowX = X(m.now);
  const right = L + iw;
  const P = [];
  const rect = (x0, x1, y0, y1) => `M${f(x0)},${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`;

  // background: night, forecast tint, grid lines
  if (m.sunrise != null && m.sunset != null)
    P.push(`<path class="night" d="${rect(X(0), X(m.sunrise), 20, H)}${rect(X(m.sunset), X(24), 20, H)}"/>`);
  P.push(`<path class="fct" d="${rect(nowX, right, 20, H)}"/>`);
  let gl = "";
  for (let i = 1; i <= 4; i++) gl += `M${L},${f(Y((kMax * i) / 4))}H${f(right)}`;
  P.push(`<path class="gl" d="${gl}"/>`);
  if (kNeg) P.push(`<path class="gl dash" d="M${L},${f(Y(-kNeg))}H${f(right)}"/>`);

  // battery SOC area, reserve, line
  if (m.soc) {
    if (m.soc.length > 1) {
      let d = "";
      m.soc.forEach((p, i) => { d += `${i ? "L" : "M"}${f(X(p[0]))},${f(YS(p[1]))}`; });
      const first = m.soc[0], last = m.soc[m.soc.length - 1];
      P.push(`<path class="soc-a" d="${d}L${f(X(last[0]))},${f(zero)}L${f(X(first[0]))},${f(zero)}Z"/>`);
      if (m.reserve != null) P.push(`<path class="res" d="M${L},${f(YS(m.reserve))}H${f(right)}"/>`);
      P.push(`<path class="soc-l" d="${d}"/>`);
    } else if (m.reserve != null) {
      P.push(`<path class="res" d="M${L},${f(YS(m.reserve))}H${f(right)}"/>`);
    }
  }

  // bars: solar up, export down; the running hour is drawn dashed
  const bw = (iw / 24) * 0.62;
  const bar = (h, v, down) => {
    const x0 = X(h + 0.5) - bw / 2, y = Y(down ? -v : v), hgt = Math.abs(y - zero);
    if (hgt < 0.5) return "";
    const r = Math.min(3, hgt / 2, bw / 2);
    return down
      ? `M${f(x0)},${f(zero)}V${f(y - r)}Q${f(x0)},${f(y)} ${f(x0 + r)},${f(y)}H${f(x0 + bw - r)}Q${f(x0 + bw)},${f(y)} ${f(x0 + bw)},${f(y - r)}V${f(zero)}Z`
      : `M${f(x0)},${f(zero)}V${f(y + r)}Q${f(x0)},${f(y)} ${f(x0 + r)},${f(y)}H${f(x0 + bw - r)}Q${f(x0 + bw)},${f(y)} ${f(x0 + bw)},${f(y + r)}V${f(zero)}Z`;
  };
  const bars = (arr, down, cls) => {
    if (!arr) return;
    let full = "", part = "";
    arr.forEach((v, h) => {
      if (v == null || v <= 0 || h > m.nh) return;
      if (h === m.nh) part = bar(h, v, down);
      else full += bar(h, v, down);
    });
    if (full) P.push(`<path class="${cls}" d="${full}"/>`);
    if (part) P.push(`<path class="${cls} part" d="${part}"/>`);
  };
  bars(m.solar, false, "sol");
  bars(m.exp, true, "exp");
  P.push(`<path class="axis" d="M${L},${f(zero)}H${f(right)}"/>`);

  // solar forecast for the whole day
  if (m.solarFc) {
    const pts = [[X(0), zero]].concat(m.solarFc.map((v, h) => [X(h + 0.5), Y(v || 0)]), [[X(24), zero]]);
    P.push(`<path class="fc" d="${smooth(pts, zero, top)}"/>`);
  }
  // grid import and home use, up to now (running hour shown as its rate)
  const line = (arr, cls) => {
    if (!arr) return;
    const pts = [];
    for (let h = 0; h < m.nh; h++) if (arr[h] != null) pts.push([X(h + 0.5), Y(arr[h])]);
    if (m.frac >= 0.2 && arr[m.nh] != null) pts.push([nowX, Y(arr[m.nh] / m.frac)]);
    if (!pts.length) return;
    pts.unshift([X(0), pts[0][1]]);
    P.push(`<path class="${cls}" d="${smooth(pts, zero, top)}"/>`);
  };
  line(m.imp, "imp");
  line(m.home, "home");

  // tariff band
  if (m.tariff) {
    for (const s of m.tariff) {
      const cls = s.type === "off_peak" ? "t-off" : s.type === "peak" ? "t-peak" : "t-std";
      P.push(`<path class="${cls}" d="${rect(X(s.a) + 0.5, X(s.b) - 0.5, tariffY, tariffY + 14)}"/>`);
    }
  }

  // rain lane: faint = chance, solid = mm
  let probLabel = null;
  if (rainBase != null) {
    P.push(`<path class="lane" d="M${L},${f(rainBase + 0.5)}H${f(right)}"/>`);
    let maxMm = 0.5;
    m.rainMm.forEach((v) => { if (v != null && v > maxMm) maxMm = v; });
    let pp = "", mm = "", bestP = 0;
    for (let h = 0; h < 24; h++) {
      const p = m.rainProb ? m.rainProb[h] : null;
      if (p != null && p > 0) {
        pp += rect(X(h + 0.5) - bw / 2, X(h + 0.5) + bw / 2, rainBase - (p / 100) * 22, rainBase);
        if (p >= 30 && p > bestP) { bestP = p; probLabel = { x: X(h + 0.5), y: rainBase - (p / 100) * 22 - 3, t: `${Math.round(p)}%` }; }
      }
      const v = m.rainMm[h];
      if (v != null && v > 0) mm += rect(X(h + 0.5) - bw / 4, X(h + 0.5) + bw / 4, rainBase - Math.max(2.5, (v / maxMm) * 22), rainBase);
    }
    if (pp) P.push(`<path class="pop" d="${pp}"/>`);
    if (mm) P.push(`<path class="mm" d="${mm}"/>`);
  }

  // now line + battery dot
  P.push(`<path class="nowl" d="M${f(nowX)},20V${H}"/>`);
  if (m.soc && m.socNow != null) P.push(`<circle class="soc-d" cx="${f(nowX)}" cy="${f(YS(m.socNow))}" r="4"/>`);

  // weather lane, humidity and wind rows
  if (hasWx) {
    for (const s of m.slots) {
      const x = X(s.h);
      P.push(`<svg x="${f(x - 14)}" y="20" width="28" height="28" viewBox="0 0 32 32">${iconPaths(s.cond, s.night)}</svg>`);
      if (s.temp != null) P.push(`<text class="tmp" x="${f(x)}" y="61" text-anchor="middle">${esc(s.temp)}</text>`);
      if (s.uv) P.push(`<rect class="uvb" x="${f(x - 15)}" y="65" width="30" height="12" rx="3"/><text class="uvt" x="${f(x)}" y="74" text-anchor="middle">${esc(s.uv)}</text>`);
      if (humY != null && s.hum != null) P.push(`<text class="t10" x="${f(x)}" y="${f(humY)}" text-anchor="middle">${Math.round(s.hum)}%</text>`);
      if (windY != null && s.wspd != null) {
        const rot = s.wdeg != null ? (s.wdeg + 180) % 360 : null;
        if (rot != null) P.push(`<path class="warr" d="M0,4.5V-4M-2.8,-1.2L0,-4.4L2.8,-1.2" transform="translate(${f(x - 6)},${f(windY)}) rotate(${f(rot)})"/>`);
        P.push(`<text class="t10b" x="${f(rot != null ? x - 1 : x)}" y="${f(windY + 3.5)}" text-anchor="${rot != null ? "start" : "middle"}">${Math.round(s.wspd)}</text>`);
      }
    }
  }

  // axis labels
  P.push(`<text class="t11" x="0" y="${f(top - 6)}">kWh</text>`);
  const kt = [kMax, kMax / 2, 0];
  if (kNeg) kt.push(-kNeg);
  for (const v of kt) P.push(`<text class="t11" x="${L - 6}" y="${f(Y(v) + 4)}" text-anchor="end">${fmtTick(v)}</text>`);
  if (m.soc) {
    for (const p of [100, 50, 0]) P.push(`<text class="soc-t" x="${f(right + 6)}" y="${f(YS(p) + 4)}">${p}%</text>`);
    if (m.reserve != null) P.push(`<text class="soc-t small" x="${f(right - 4)}" y="${f(YS(m.reserve) - 5)}" text-anchor="end">Reserve ${Math.round(m.reserve)}%</text>`);
  }
  if (kNeg) P.push(`<text class="exp-t" x="${L + 4}" y="${f(bottom - 4)}">export</text>`);
  const xStep = iw < 320 ? 6 : 4;
  for (let h = 0; h < 24; h += xStep) P.push(`<text class="t11" x="${f(X(h))}" y="${f(xLabelBase)}" text-anchor="middle">${esc(m.hourLabel(h))}</text>`);

  if (m.tariff) {
    P.push(`<text class="t10" x="0" y="${f(tariffY + 10.5)}">Rate</text>`);
    for (const s of m.tariff) {
      const w = X(s.b) - X(s.a);
      const lbl = m.rateLabel(s);
      if (lbl && w > lbl.length * 5.6 + 8) {
        const cls = s.type === "off_peak" ? "tl-off" : s.type === "peak" ? "tl-peak" : "tl-std";
        P.push(`<text class="${cls}" x="${f((X(s.a) + X(s.b)) / 2)}" y="${f(tariffY + 10.5)}" text-anchor="middle">${esc(lbl)}</text>`);
      }
    }
  }
  if (rainBase != null) {
    P.push(`<text class="t10 rain-t" x="0" y="${f(rainBase - 5)}">Rain</text>`);
    if (probLabel) P.push(`<text class="rain-t t9" x="${f(probLabel.x)}" y="${f(probLabel.y)}" text-anchor="middle">${probLabel.t}</text>`);
  }
  if (humY != null) P.push(`<text class="t10" x="0" y="${f(humY)}">RH</text>`);
  if (windY != null) P.push(`<text class="t10" x="0" y="${f(windY + 3.5)}">Wind</text>`);

  // top row: now chip first, then sunrise/sunset, then the region labels if they fit
  const placed = [];
  const fits = (a, b) => placed.every((p) => b < p[0] - 4 || a > p[1] + 4);
  const chipW = 14 + m.nowLabel.length * 6.3;
  placed.push([nowX - chipW / 2, nowX + chipW / 2]);
  P.push(`<rect class="now-b" x="${f(nowX - chipW / 2)}" y="1" width="${f(chipW)}" height="16" rx="8"/><text class="now-t" x="${f(nowX)}" y="13" text-anchor="middle">${esc(m.nowLabel)}</text>`);
  for (const [h, lbl, cls] of [[m.sunrise, m.riseLabel, "rise"], [m.sunset, m.setLabel, "set"]]) {
    if (h == null || !lbl) continue;
    const x = X(h), w = 16 + lbl.length * 6.2;
    const x0 = [x - w / 2, x - w / 2 + 14, x - w / 2 - 14, x - w / 2 + 26, x - w / 2 - 26].find((a) => a >= 0 && a + w <= W && fits(a, a + w));
    if (x0 === undefined) continue;
    placed.push([x0, x0 + w]);
    P.push(`<path class="${cls}" d="M${f(x0 + 1)},12a5,5 0 0,1 10,0Z"/>`);
    if (cls === "rise") P.push(`<path class="rise-l" d="M${f(x0 + 6)},2V4.5"/>`);
    P.push(`<text class="${cls}-t" x="${f(x0 + 14)}" y="13">${esc(lbl)}</text>`);
  }
  if (fits(L, L + 82)) P.push(`<text class="region" x="${L}" y="13">Today so far</text>`);
  if (fits(right - 62, right)) P.push(`<text class="region" x="${f(right)}" y="13" text-anchor="end">Forecast</text>`);

  return { svg: `<svg class="tl" width="${f(W)}" height="${H}" viewBox="0 0 ${f(W)} ${H}" role="img" aria-label="Today's energy and weather timeline">${P.join("")}</svg>`, H };
}
[/OLD] */

// v1.1.0: sliding window centred on now. Hours are counted from today's midnight (negative = yesterday,
// 24 and up = tomorrow). Arrays in the model start at hour m.k0; m.wStart and m.span give the visible range.
function chartSvg(W, m) {
  const f = r1;
  const L = 30, R = m.soc ? 40 : 14;
  const iw = Math.max(60, W - L - R);
  const right = L + iw;
  const X = (h) => L + ((h - m.wStart) / m.span) * iw;
  const Xc = (h) => Math.max(L, Math.min(right, X(h)));
  const wEnd = m.wStart + m.span;
  const kOf = (j) => m.k0 + j;
  const seen = (j) => kOf(j) + 1 > m.wStart && kOf(j) < wEnd;
  const hasWx = !!(m.slots && m.slots.length);
  const top = hasWx ? 92 : 30;
  /* [OLD 2026-10-09 v1.2.0->v1.3.0] Fixed plot height; the card now fits its height in a sections grid.
  const posH = 156;
  [/OLD] */
  const posH = m.posH || 156;

  // scales over the visible hours: one kWh axis for everything, SOC mapped 0-100 % onto the positive half
  const rateAtNow = (a) => (a && m.frac >= 0.2 && a[m.jNow] != null ? a[m.jNow] / m.frac : 0);
  let maxPos = 0;
  for (const a of [m.solar, m.solarFc, m.home, m.imp]) if (a) a.forEach((v, j) => { if (v != null && v > maxPos && seen(j)) maxPos = v; });
  maxPos = Math.max(maxPos, rateAtNow(m.home), rateAtNow(m.imp));
/* [OLD 2026-10-10 v1.3.0->v1.4.0] Odd maxima (6996, 3498, or 3.5) and lines at quarters of them; the axis now uses round steps.
  const kMax = maxPos <= 1 ? 1 : maxPos <= 2 ? 2 : Math.ceil(maxPos);
  let maxExp = 0;
  if (m.exp) m.exp.forEach((v, j) => { if (v != null && v > maxExp && seen(j)) maxExp = v; });
  const kNeg = m.exp ? Math.max(0.5, Math.ceil(maxExp * 2) / 2) : 0;
[/OLD] */
  // v1.4.0: round steps (see axisStep); the export depth rounds up to whole kWh once the steps are whole
  const kStep = axisStep(maxPos, posH);
  const kMax = Math.max(1, Math.ceil(maxPos / kStep - 1e-9) * kStep);
  let maxExp = 0;
  if (m.exp) m.exp.forEach((v, j) => { if (v != null && v > maxExp && seen(j)) maxExp = v; });
  const kNegU = kStep >= 1 ? 1 : 0.5;
  const kNeg = m.exp ? Math.max(kNegU, Math.ceil(maxExp / kNegU - 1e-9) * kNegU) : 0;
  const zero = top + posH;
  const Y = (v) => zero - (Math.max(-kNeg, Math.min(kMax, v)) / kMax) * posH;
  const YS = (p) => zero - (Math.max(0, Math.min(100, p)) / 100) * posH;
  const bottom = zero + (kNeg / kMax) * posH;
  m.plotScale = 1 + kNeg / kMax; // added 2026-10-09 v1.3.0: the height fit needs this

  // lanes under the chart
  const xLabelBase = bottom + 15;
  let rowY = bottom + 24;
  let tariffY = null, expTariffY = null, rainBase = null, humY = null;
  if (m.tariff) { tariffY = rowY; rowY += 20; }
  if (m.expTariff) { expTariffY = rowY; rowY += 20; }
  if (m.rainMm) { rainBase = rowY + 22; rowY += 28; }
  if (hasWx && m.showHum) { humY = rowY + 10; rowY += 16; }
  const H = Math.ceil(rowY + 2);
  const nowX = X(m.now);
  const G = []; // data layers, clipped to the plot area
  const P = []; // icons and labels, drawn on top
  const rect = (x0, x1, y0, y1) => `M${f(x0)},${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`;

  // background: night, forecast tint, day dividers, grid lines
  let night = "";
  for (const [a, b] of m.nights || []) if (b > m.wStart && a < wEnd) night += rect(Xc(a), Xc(b), 20, H);
  if (night) G.push(`<path class="night" d="${night}"/>`);
  G.push(`<path class="fct" d="${rect(nowX, right, 20, H)}"/>`);
  let dd = "";
  for (const h of m.days || []) dd += `M${f(X(h))},20V${H}`;
  if (dd) G.push(`<path class="daysep" d="${dd}"/>`);
  let gl = "";
/* [OLD 2026-10-10 v1.3.0->v1.4.0] Grid lines at quarters of the maximum.
  for (let i = 1; i <= 4; i++) gl += `M${L},${f(Y((kMax * i) / 4))}H${f(right)}`;
[/OLD] */
  for (let i = 1; i * kStep <= kMax + 1e-9; i++) gl += `M${L},${f(Y(i * kStep))}H${f(right)}`; // v1.4.0: one line per step
  G.push(`<path class="gl" d="${gl}"/>`);
  if (kNeg) G.push(`<path class="gl dash" d="M${L},${f(Y(-kNeg))}H${f(right)}"/>`);

  // battery SOC area, reserve, line
  if (m.soc) {
    if (m.soc.length > 1) {
      let d = "";
      m.soc.forEach((p, i) => { d += `${i ? "L" : "M"}${f(X(p[0]))},${f(YS(p[1]))}`; });
      const first = m.soc[0], last = m.soc[m.soc.length - 1];
      G.push(`<path class="soc-a" d="${d}L${f(X(last[0]))},${f(zero)}L${f(X(first[0]))},${f(zero)}Z"/>`);
      if (m.reserve != null) G.push(`<path class="res" d="M${L},${f(YS(m.reserve))}H${f(right)}"/>`);
      G.push(`<path class="soc-l" d="${d}"/>`);
    } else if (m.reserve != null) {
      G.push(`<path class="res" d="M${L},${f(YS(m.reserve))}H${f(right)}"/>`);
    }
  }

  // bars: solar up, export down; the running hour is drawn dashed
  const bw = (iw / m.span) * 0.62;
  const bar = (k, v, down) => {
    const x0 = X(k + 0.5) - bw / 2, y = Y(down ? -v : v), hgt = Math.abs(y - zero);
    if (hgt < 0.5) return "";
    const r = Math.min(3, hgt / 2, bw / 2);
    return down
      ? `M${f(x0)},${f(zero)}V${f(y - r)}Q${f(x0)},${f(y)} ${f(x0 + r)},${f(y)}H${f(x0 + bw - r)}Q${f(x0 + bw)},${f(y)} ${f(x0 + bw)},${f(y - r)}V${f(zero)}Z`
      : `M${f(x0)},${f(zero)}V${f(y + r)}Q${f(x0)},${f(y)} ${f(x0 + r)},${f(y)}H${f(x0 + bw - r)}Q${f(x0 + bw)},${f(y)} ${f(x0 + bw)},${f(y + r)}V${f(zero)}Z`;
  };
  const bars = (arr, down, cls) => {
    if (!arr) return;
    let full = "", part = "";
    arr.forEach((v, j) => {
      if (v == null || v <= 0 || j > m.jNow) return;
      if (j === m.jNow) part = bar(kOf(j), v, down);
      else full += bar(kOf(j), v, down);
    });
    if (full) G.push(`<path class="${cls}" d="${full}"/>`);
    if (part) G.push(`<path class="${cls} part" d="${part}"/>`);
  };
  bars(m.solar, false, "sol");
  bars(m.exp, true, "exp");
  G.push(`<path class="axis" d="M${L},${f(zero)}H${f(right)}"/>`);

  // solar forecast wherever a source has hours (yesterday, today, tomorrow); gaps split the line
  if (m.solarFc) {
    let run = [];
    const flush = () => {
      if (run.length) {
        const pts = [[X(run[0][0]), zero]].concat(run.map(([k, v]) => [X(k + 0.5), Y(v)]), [[X(run[run.length - 1][0] + 1), zero]]);
        G.push(`<path class="fc" d="${smooth(pts, zero, top)}"/>`);
      }
      run = [];
    };
    m.solarFc.forEach((v, j) => { if (v == null) flush(); else run.push([kOf(j), v]); });
    flush();
  }
  // grid import and home use, up to now (running hour shown as its rate)
  const line = (arr, cls) => {
    if (!arr) return;
    const pts = [];
    for (let j = 0; j < m.jNow; j++) if (arr[j] != null) pts.push([X(kOf(j) + 0.5), Y(arr[j])]);
    if (m.frac >= 0.2 && arr[m.jNow] != null) pts.push([nowX, Y(arr[m.jNow] / m.frac)]);
    if (pts.length < 2) return;
    G.push(`<path class="${cls}" d="${smooth(pts, zero, top)}"/>`);
  };
  line(m.imp, "imp");
  line(m.home, "home");

  // tariff bands: import, then export
  const band = (segs, y, clsOf) => {
    for (const s of segs) {
      const x0 = Xc(s.a) + 0.5, x1 = Xc(s.b) - 0.5;
      if (x1 - x0 >= 1) G.push(`<path class="${clsOf(s)}" d="${rect(x0, x1, y, y + 14)}"/>`);
    }
  };
  const impCls = (s) => (s.type === "off_peak" ? "t-off" : s.type === "peak" ? "t-peak" : "t-std");
  const expCls = (s) => (s.type === "off_peak" ? "e-off" : s.type === "peak" ? "e-peak" : "e-std");
  if (m.tariff) band(m.tariff, tariffY, impCls);
  if (m.expTariff) band(m.expTariff, expTariffY, expCls);

  // rain lane: faint = chance, solid = mm
  let probLabel = null;
  if (rainBase != null) {
    G.push(`<path class="lane" d="M${L},${f(rainBase + 0.5)}H${f(right)}"/>`);
    let maxMm = 0.5;
    m.rainMm.forEach((v, j) => { if (v != null && v > maxMm && seen(j)) maxMm = v; });
    let pp = "", mm = "", bestP = 0;
    for (let j = 0; j < m.rainMm.length; j++) {
      const k = kOf(j), cx = X(k + 0.5);
      const p = m.rainProb ? m.rainProb[j] : null;
      if (p != null && p > 0) {
        pp += rect(cx - bw / 2, cx + bw / 2, rainBase - (p / 100) * 22, rainBase);
        if (p >= 30 && p > bestP && cx > L + 8 && cx < right - 8) { bestP = p; probLabel = { x: cx, y: rainBase - (p / 100) * 22 - 3, t: `${Math.round(p)}%` }; }
      }
      const v = m.rainMm[j];
      if (v != null && v > 0) mm += rect(cx - bw / 4, cx + bw / 4, rainBase - Math.max(2.5, (v / maxMm) * 22), rainBase);
    }
    if (pp) G.push(`<path class="pop" d="${pp}"/>`);
    if (mm) G.push(`<path class="mm" d="${mm}"/>`);
  }

  // storm hours: red strip under the weather lane
  if (hasWx && m.storm && m.storm.spans) {
    let sb = "";
    for (const [a, b] of m.storm.spans) if (b > m.wStart && a < wEnd) sb += rect(Xc(a) + 0.5, Xc(b) - 0.5, top - 10, top - 6);
    if (sb) G.push(`<path class="storm-b" d="${sb}"/>`);
  }

  // now line + battery dot
  G.push(`<path class="nowl" d="M${f(nowX)},20V${H}"/>`);
  if (m.soc && m.socNow != null) G.push(`<circle class="soc-d" cx="${f(nowX)}" cy="${f(YS(m.socNow))}" r="4"/>`);

  // weather lane and humidity row
  if (hasWx) {
    for (const s of m.slots) {
      const x = X(s.h);
      P.push(`<svg x="${f(x - 14)}" y="20" width="28" height="28" viewBox="0 0 32 32">${iconPaths(s.cond, s.night)}</svg>`);
      if (s.temp != null) P.push(`<text class="tmp" x="${f(x)}" y="61" text-anchor="middle">${esc(s.temp)}</text>`);
      if (s.uv) P.push(`<rect class="uvb" x="${f(x - 15)}" y="65" width="30" height="12" rx="3"/><text class="uvt" x="${f(x)}" y="74" text-anchor="middle">${esc(s.uv)}</text>`);
      if (humY != null && s.hum != null) P.push(`<text class="t10" x="${f(x)}" y="${f(humY)}" text-anchor="middle">${Math.round(s.hum)}%</text>`);
    }
  }

  // axis labels
/* [OLD 2026-10-10 v1.3.0->v1.4.0] Labelled the maximum, half of it and zero.
  P.push(`<text class="t11" x="0" y="${f(top - 6)}">kWh</text>`);
  const kt = [kMax, kMax / 2, 0];
  if (kNeg) kt.push(-kNeg);
  for (const v of kt) P.push(`<text class="t11" x="${L - 6}" y="${f(Y(v) + 4)}" text-anchor="end">${fmtTick(v)}</text>`);
[/OLD] */
  // v1.4.0: a label on every step when they are 15 px apart or more, else on every other one counted down
  // from the top; the unit switches to MWh once the top reaches 1000 kWh
  const big = kMax >= 1000;
  P.push(`<text class="t11" x="0" y="${f(top - 6)}">${big ? "MWh" : "kWh"}</text>`);
  const nSteps = Math.round(kMax / kStep), every = (posH / nSteps) >= 15 ? 1 : 2;
  const kt = [];
  for (let i = nSteps; i > 0; i -= every) if (i >= every) kt.push(i * kStep);
  kt.push(0);
  if (kNeg) kt.push(-kNeg);
  for (const v of kt) P.push(`<text class="t11" x="${L - 6}" y="${f(Y(v) + 4)}" text-anchor="end">${fmtTick(big ? v / 1000 : v)}</text>`);
  if (m.soc) {
    for (const p of [100, 50, 0]) P.push(`<text class="soc-t" x="${f(right + 6)}" y="${f(YS(p) + 4)}">${p}%</text>`);
    if (m.reserve != null) P.push(`<text class="soc-t small" x="${f(right - 4)}" y="${f(YS(m.reserve) - 5)}" text-anchor="end">Reserve ${Math.round(m.reserve)}%</text>`);
  }
  if (kNeg) P.push(`<text class="exp-t" x="${L + 4}" y="${f(bottom - 4)}">export</text>`);
  /* [OLD 2026-10-09 v1.2.0->v1.3.0] Hour labels only; the Now chip was at the top.
  for (const t of m.ticks || []) {
    const x = X(t.h);
    if (x < L - 1 || x > right + 1) continue;
    P.push(`<text class="t11${t.day ? " dayt" : ""}" x="${f(x)}" y="${f(xLabelBase)}" text-anchor="middle">${esc(t.label)}</text>`);
  }
  [/OLD] */
/* [OLD 2026-10-10 v1.3.0->v1.4.0] The Now chip sat on the time axis, in a filled blue pill.
  // the Now chip sits on the time axis under the plot; hour labels that would touch it are left out
  const chipW = 14 + m.nowLabel.length * 6.3;
  for (const t of m.ticks || []) {
    const x = X(t.h), tw = t.label.length * 6.2;
    if (x < L - 1 || x > right + 1 || Math.abs(x - nowX) < chipW / 2 + tw / 2 + 4) continue;
    P.push(`<text class="t11${t.day ? " dayt" : ""}" x="${f(x)}" y="${f(xLabelBase)}" text-anchor="middle">${esc(t.label)}</text>`);
  }
  P.push(`<rect class="now-b" x="${f(nowX - chipW / 2)}" y="${f(xLabelBase - 12)}" width="${f(chipW)}" height="16" rx="8"/><text class="now-t" x="${f(nowX)}" y="${f(xLabelBase)}" text-anchor="middle">${esc(m.nowLabel)}</text>`);
[/OLD] */
  // v1.4.0: every hour label again; the Now chip went back to the top row
  for (const t of m.ticks || []) {
    const x = X(t.h);
    if (x < L - 1 || x > right + 1) continue;
    P.push(`<text class="t11${t.day ? " dayt" : ""}" x="${f(x)}" y="${f(xLabelBase)}" text-anchor="middle">${esc(t.label)}</text>`);
  }

  const bandLabels = (segs, y, clsOf) => {
    for (const s of segs) {
      const x0 = Xc(s.a), x1 = Xc(s.b), lbl = m.rateLabel(s);
      if (lbl && x1 - x0 > lbl.length * 5.6 + 8) P.push(`<text class="${clsOf(s)}" x="${f((x0 + x1) / 2)}" y="${f(y + 10.5)}" text-anchor="middle">${esc(lbl)}</text>`);
    }
  };
  if (m.tariff) {
    P.push(`<text class="t10" x="0" y="${f(tariffY + 10.5)}">${m.expTariff ? "Buy" : "Rate"}</text>`);
    bandLabels(m.tariff, tariffY, (s) => (s.type === "off_peak" ? "tl-off" : s.type === "peak" ? "tl-peak" : "tl-std"));
  }
  if (m.expTariff) {
    P.push(`<text class="t10" x="0" y="${f(expTariffY + 10.5)}">Sell</text>`);
    bandLabels(m.expTariff, expTariffY, (s) => (s.type === "peak" ? "el-peak" : "el-std"));
  }
  if (rainBase != null) {
    P.push(`<text class="t10 rain-t" x="0" y="${f(rainBase - 5)}">Rain</text>`);
    if (probLabel) P.push(`<text class="rain-t t9" x="${f(probLabel.x)}" y="${f(probLabel.y)}" text-anchor="middle">${probLabel.t}</text>`);
  }
  if (humY != null) P.push(`<text class="t10" x="0" y="${f(humY)}">RH</text>`);

  // top row: the Now chip, then every sunrise and sunset in view that fits, nearest to now first
  const placed = [];
  const fits = (a, b) => placed.every((p) => b < p[0] - 4 || a > p[1] + 4);
  /* [OLD 2026-10-09 v1.2.0->v1.3.0] The Now chip was here, at the top; it moved to the time axis.
  const chipW = 14 + m.nowLabel.length * 6.3;
  placed.push([nowX - chipW / 2, nowX + chipW / 2]);
  P.push(`<rect class="now-b" x="${f(nowX - chipW / 2)}" y="1" width="${f(chipW)}" height="16" rx="8"/><text class="now-t" x="${f(nowX)}" y="13" text-anchor="middle">${esc(m.nowLabel)}</text>`);
  [/OLD] */
/* [OLD 2026-10-10 v1.4.0->v1.5.0] The Now chip took its space first, so a sunrise or sunset under it was left out.
  // added 2026-10-10 v1.4.0: the Now chip is back at the top — outlined, with no fill, so the chart shows through
  const chipW = 14 + m.nowLabel.length * 6.3;
  placed.push([nowX - chipW / 2, nowX + chipW / 2]);
  P.push(`<rect class="now-o" x="${f(nowX - chipW / 2 + 0.5)}" y="1.5" width="${f(chipW - 1)}" height="15" rx="7.5"/><text class="now-c" x="${f(nowX)}" y="13" text-anchor="middle">${esc(m.nowLabel)}</text>`);
  const marks = (m.sunMarks || []).slice().sort((a, b) => Math.abs(a.h - m.now) - Math.abs(b.h - m.now));
  for (const s of marks) {
    const x = X(s.h), w = 16 + s.label.length * 6.2, cls = s.kind;
    const x0 = [x - w / 2, x - w / 2 + 14, x - w / 2 - 14, x - w / 2 + 26, x - w / 2 - 26].find((a) => a >= 0 && a + w <= W && fits(a, a + w));
    if (x0 === undefined) continue;
[/OLD] */
  // v1.5.0: a sunrise or sunset no longer disappears under the Now chip: it takes a nearby spot clear of the chip,
  // else the spot just beside the chip (on its own side first), and only as a last resort sits under it; the chip
  // is drawn last and see-through
  const chipW = 14 + m.nowLabel.length * 6.3;
  const clearOfChip = (a, b) => b < nowX - chipW / 2 - 4 || a > nowX + chipW / 2 + 4;
  const marks = (m.sunMarks || []).slice().sort((a, b) => Math.abs(a.h - m.now) - Math.abs(b.h - m.now));
  for (const s of marks) {
    const x = X(s.h), w = 16 + s.label.length * 6.2, cls = s.kind;
    const left = nowX - chipW / 2 - 5 - w, right = nowX + chipW / 2 + 5;
    const spots = [x - w / 2, x - w / 2 + 14, x - w / 2 - 14, x - w / 2 + 26, x - w / 2 - 26].concat(x < nowX ? [left, right] : [right, left])
      .filter((a) => a >= 0 && a + w <= W && fits(a, a + w));
    const x0 = spots.find((a) => clearOfChip(a, a + w)) ?? spots[0];
    if (x0 === undefined) continue;
    placed.push([x0, x0 + w]);
    P.push(`<path class="${cls}" d="M${f(x0 + 1)},12a5,5 0 0,1 10,0Z"/>`);
    if (cls === "rise") P.push(`<path class="rise-l" d="M${f(x0 + 6)},2V4.5"/>`);
    P.push(`<text class="${cls}-t" x="${f(x0 + 14)}" y="13">${esc(s.label)}</text>`);
  }
  P.push(`<g class="now-g"><rect class="now-o" x="${f(nowX - chipW / 2 + 0.5)}" y="1.5" width="${f(chipW - 1)}" height="15" rx="7.5"/><text class="now-c" x="${f(nowX)}" y="13" text-anchor="middle">${esc(m.nowLabel)}</text></g>`); // added 2026-10-10 v1.5.0

  const clip = `${m.uid || "ewt"}-clip`;
  return {
    svg: `<svg class="tl" width="${f(W)}" height="${H}" viewBox="0 0 ${f(W)} ${H}" role="img" aria-label="Energy and weather timeline, now in the centre">`
      + `<defs><clipPath id="${clip}"><rect x="${L}" y="0" width="${f(iw)}" height="${H}"/></clipPath></defs>`
      + `<g clip-path="url(#${clip})">${G.join("")}</g>${P.join("")}</svg>`,
    H,
  };
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const STYLE = `
/* [OLD 2026-10-09 v1.2.0->v1.3.0] Did not fill the grid cell in a sections view.
:host { display: block; }
[/OLD] */
:host { display: block; height: 100%; }
ha-card {
  container-type: inline-size;
  height: 100%; box-sizing: border-box; /* added 2026-10-09 v1.3.0: fill the sections grid cell */
  padding: 20px 20px 18px;
  display: flex; flex-direction: column; gap: 12px;
  overflow: hidden;
  --ewt-night: rgba(11, 16, 32, 0.35);
  --ewt-cloud: #E4E6EA; --ewt-cloud-dark: #B8BDC5; --ewt-cloud-back: #8C929A;
  --ewt-sun: #FDD835; --ewt-moon: #FFF1A8;
  --ewt-soc-text: #4DD0A1; --ewt-rain-text: #4FC3F7; --ewt-rise: #FFB74D; --ewt-set: #B9A2E8; --ewt-exp-text: #B39DDB;
}
ha-card.light {
  --ewt-night: rgba(40, 60, 110, 0.07);
  --ewt-cloud: #C9CDD3; --ewt-cloud-dark: #A9AEB6; --ewt-cloud-back: #8C929A;
  --ewt-sun: #F9A825; --ewt-moon: #E6B422;
  --ewt-soc-text: #1E9E73; --ewt-rain-text: #0288D1; --ewt-rise: #E08600; --ewt-set: #7E57C2; --ewt-exp-text: #7E57C2;
}
.clock { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.clock-row { display: flex; align-items: center; justify-content: center; gap: 16px; line-height: 1; }
.date { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.day { font-size: clamp(17px, 4.2cqi, 22px); font-weight: 500; }
.dm { font-size: clamp(14px, 3.4cqi, 18px); color: var(--secondary-text-color); }
.time { font-size: clamp(40px, 11cqi, 62px); font-weight: 500; letter-spacing: -1.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.time .sec { font-size: 0.48em; font-weight: 400; color: var(--secondary-text-color); letter-spacing: 0; }
.time .ap { font-size: 0.32em; font-weight: 500; color: var(--secondary-text-color); margin-left: 4px; letter-spacing: 0; }
.cond { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; font-size: 14px; color: var(--secondary-text-color); text-align: center; }
.cond .t { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }

.warn { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 7px 12px; border-radius: 8px; font-size: 13px; border: 1px solid; }
.warn .w-title { font-weight: 500; }
.warn .w-src { margin-left: auto; font-size: 12px; opacity: 0.85; }
.warn.yellow { background: #3A2F12; border-color: #6E5A1E; color: #F6D98B; }
.warn.amber  { background: #3D2611; border-color: #7A4A1C; color: #F9C08A; }
.warn.red    { background: #3D1515; border-color: #7A2626; color: #F5A3A3; }
.warn svg path { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

.chart { width: 100%; }
svg.tl { display: block; overflow: visible; font-family: inherit; }
svg.tl text { font-family: inherit; }
.night { fill: var(--ewt-night); }
.fct { fill: var(--primary-text-color); fill-opacity: 0.035; }
.gl { fill: none; stroke: var(--divider-color, rgba(127,127,127,.25)); stroke-width: 1; }
.gl.dash { stroke-dasharray: 2 3; }
.axis { fill: none; stroke: var(--secondary-text-color); stroke-opacity: 0.45; stroke-width: 1; }
.soc-a { fill: #4DD0A1; fill-opacity: 0.12; }
.soc-l { fill: none; stroke: #4DD0A1; stroke-width: 2; stroke-linejoin: round; }
.soc-d { fill: #4DD0A1; stroke: var(--ha-card-background, var(--card-background-color, #1C1C1C)); stroke-width: 2; }
.res { fill: none; stroke: #4DD0A1; stroke-opacity: 0.7; stroke-width: 1; stroke-dasharray: 6 4; }
.sol { fill: #FF9800; fill-opacity: 0.6; stroke: #FFA726; stroke-width: 1; }
.exp { fill: #9575CD; fill-opacity: 0.7; stroke: #B39DDB; stroke-width: 1; }
.sol.part { fill-opacity: 0.25; stroke-dasharray: 2 2; }
.exp.part { fill-opacity: 0.3; stroke-dasharray: 2 2; }
.fc { fill: none; stroke: var(--primary-text-color); stroke-opacity: 0.85; stroke-width: 1.5; stroke-dasharray: 5 4; }
.imp { fill: none; stroke: #5B8DEF; stroke-width: 2; }
.home { fill: none; stroke: #F48FB1; stroke-width: 2; }
.t-std { fill: var(--primary-text-color); fill-opacity: 0.08; }
.t-off { fill: #1F5A45; }
.t-peak { fill: #63302A; }
.lane { fill: none; stroke: var(--divider-color, rgba(127,127,127,.25)); stroke-width: 1; }
.pop { fill: #4FC3F7; fill-opacity: 0.2; }
.mm { fill: #4FC3F7; }
.nowl { fill: none; stroke: var(--primary-text-color); stroke-opacity: 0.55; stroke-width: 1; stroke-dasharray: 3 3; }
.now-b { fill: #2F64B0; }
.now-t { fill: #FFFFFF; font-size: 11px; font-weight: 500; }
.rise { fill: var(--ewt-rise); } .rise-l { stroke: var(--ewt-rise); stroke-width: 1.4; stroke-linecap: round; }
.set { fill: var(--ewt-set); }
.rise-t { fill: var(--ewt-rise); font-size: 11px; } .set-t { fill: var(--ewt-set); font-size: 11px; }
.region { fill: var(--secondary-text-color); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.t11 { fill: var(--secondary-text-color); font-size: 11px; font-variant-numeric: tabular-nums; }
.t10 { fill: var(--secondary-text-color); font-size: 10px; font-variant-numeric: tabular-nums; }
.t10b { fill: var(--secondary-text-color); font-size: 10px; font-variant-numeric: tabular-nums; }
.t9 { font-size: 9px; }
.tmp { fill: var(--primary-text-color); font-size: 12px; font-variant-numeric: tabular-nums; }
.uvb { fill: #4A3B10; } .uvt { fill: #F6D98B; font-size: 9px; font-weight: 500; }
.warr { fill: none; stroke: var(--secondary-text-color); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.soc-t { fill: var(--ewt-soc-text); font-size: 11px; } .soc-t.small { font-size: 10px; }
.exp-t { fill: var(--ewt-exp-text); font-size: 10px; }
.rain-t { fill: var(--ewt-rain-text); }
.tl-off { fill: #A5E6C8; font-size: 10px; } .tl-peak { fill: #F5B7A8; font-size: 10px; } .tl-std { fill: var(--secondary-text-color); font-size: 10px; }

.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@container (max-width: 460px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tile { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); min-width: 0; }
.tile .tl { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); }
.tile .tv { font-size: 20px; font-weight: 500; white-space: nowrap; }
.tile .ts { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile .row { display: flex; align-items: center; gap: 10px; }
.bar { position: relative; flex: 1; height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--primary-text-color) 15%, transparent); }
.bar .fill { height: 5px; border-radius: 3px; background: #4DD0A1; }
.bar .tick { position: absolute; top: -2px; width: 2px; height: 9px; border-radius: 1px; background: var(--primary-text-color); }
.sw-fc { stroke: var(--primary-text-color); stroke-width: 1.5; stroke-dasharray: 4 3; }
.sw-cost { fill: none; stroke: var(--secondary-text-color); stroke-width: 1.3; }
.note { font-size: 12px; color: var(--secondary-text-color); text-align: center; }
.note.err { color: var(--error-color, #db4437); }
/* added 2026-10-09 v1.1.0: day dividers, export tariff band, storm alert, earnings */
.daysep { fill: none; stroke: var(--secondary-text-color); stroke-opacity: 0.35; stroke-width: 1; }
.dayt { fill: var(--primary-text-color); font-weight: 600; }
.e-std { fill: #9575CD; fill-opacity: 0.16; }
.e-off { fill: #9575CD; fill-opacity: 0.08; }
.e-peak { fill: #5E3E9E; }
.el-std { fill: var(--secondary-text-color); font-size: 10px; } .el-peak { fill: #E6DBFF; font-size: 10px; }
.storm-b { fill: #E53935; }
.storm { align-self: center; max-width: 100%; box-sizing: border-box; display: inline-flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px 8px; padding: 5px 14px; border-radius: 16px; background: #C62828; color: #FFFFFF; font-size: 13px; line-height: 1.3; text-align: center; }
.storm .s-title { font-weight: 600; }
.storm svg path { fill: #FFFFFF; }
.tile .tv.earn { color: var(--ewt-soc-text); }
/* added 2026-10-10 v1.4.0: the Now chip with no fill; the money tile's split bar and colour dots */
ha-card { --ewt-now: #82AAFF; --ewt-buy: #5B8DEF; --ewt-sell: #9575CD; }
ha-card.light { --ewt-now: #2F64B0; --ewt-buy: #3F6FD8; --ewt-sell: #7E57C2; }
.now-o { fill: none; stroke: var(--ewt-now); stroke-width: 1; }
.now-c { fill: var(--ewt-now); font-size: 11px; font-weight: 600; }
.bar.split { display: flex; overflow: hidden; }
.bar.split .fill { border-radius: 0; }
.bar.split .fill.b { background: var(--ewt-buy); }
.bar.split .fill.s { background: var(--ewt-sell); }
.tile .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; }
.tile .dot.b { background: var(--ewt-buy); }
.tile .dot.s { background: var(--ewt-sell); }
.tile .gap { display: inline-block; width: 10px; }
/* added 2026-10-10 v1.5.0: see-through Now chip; battery tile with the total and one line per battery on a red / yellow / green
   scale (red up to the reserve, yellow to 60 %, green to 100 %), and the reserve mark through all of them */
.now-g { opacity: 0.75; }
.tile .bars { flex: 1; min-width: 0; }
.tile .trk { position: relative; display: flex; flex-direction: column; gap: 7px; }
.tile .trk.u { margin-right: 30px; }
.tile .trk .bar { flex: none; }
.tile .uline { position: relative; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--primary-text-color) 15%, transparent); }
.tile .fill.g { width: 100%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #E53935 0%, #E53935 var(--r), #FBC02D var(--r2), #FBC02D 60%, #4DD0A1 76%, #4DD0A1 100%); }
.tile .bar .fill.g { height: 5px; }
.tile .uline .up { position: absolute; left: calc(100% + 6px); top: -4px; font-size: 9px; line-height: 11px; color: var(--secondary-text-color); white-space: nowrap; }
.tile .rmark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--primary-text-color); }
`;

/* ------------------------------------------------------------------ */
/* Visual editor (Home Assistant built-in form)                        */
/* ------------------------------------------------------------------ */

const LABELS = {
  weather_entity: "Weather",
  rain_entity: "Rain gauge (total, optional)",
  warning_entity: "Weather warning (optional)",
  time_zone: "Time zone",
  show_seconds: "Show seconds",
  solar_energy_entity: "Solar production energy",
  solar_power_entity: "Solar power now",
  solar_forecast_entity: "Solar forecast entity (optional)",
  solar_forecast_tomorrow_entity: "Tomorrow's solar forecast",
  home_energy_entity: "Home consumption energy",
  home_power_entity: "Home power now",
  grid_import_entity: "Grid import energy",
  grid_export_entity: "Grid export energy",
  grid_power_entity: "Grid power now",
  grid_power_invert: "Invert grid power sign",
  battery_name: "Battery name",
  battery_soc_entity: "Battery state of charge",
  battery_unit_soc_entities: "Each battery's state of charge (optional)", // added 2026-10-10 v1.5.0
  battery_power_entity: "Battery power",
  battery_power_invert: "Invert battery power sign",
  battery_capacity: "Usable battery capacity",
  battery_reserve_entity: "Backup reserve entity (optional)",
  battery_reserve: "Backup reserve",
  tariff: "Tariff periods",
  standard_rate: "Standard import rate (per kWh)",
  /* [OLD 2026-10-09 v1.0.4->v1.1.0] Label did not say it is the rate for hours outside the export tariff periods.
  export_rate: "Export rate (per kWh)",
  [/OLD] */
  export_rate: "Standard export rate (per kWh)",
  import_rate_entity: "Import price entity (optional)",
  currency: "Currency",
  show_warning: "Warning banner",
  show_tariff: "Tariff band",
  show_rain: "Rain lane",
  show_humidity: "Humidity row",
  show_wind: "Wind row",
  show_tiles: "Summary tiles",
  timeline_hours: "Timeline length", // added 2026-10-09 v1.1.0
  export_tariff: "Export tariff periods (optional)", // added 2026-10-09 v1.1.0
  show_storm_alert: "Storm alert", // added 2026-10-09 v1.1.0
  export_rate_entity: "Export price entity (optional)", // added 2026-10-09 v1.2.0
};
const HELPERS = {
  rain_entity: "A total/total_increasing precipitation sensor. Fills the rain lane for past hours; forecast hours always come from the weather entity.",
  warning_entity: "Any entity that turns on (or holds warnings) when a warning is active, e.g. a MeteoAlarm binary sensor.",
  time_zone: "Leave empty to follow your Home Assistant profile setting. Example: Europe/London.",
  solar_energy_entity: "Energy sensors need state_class total or total_increasing so Home Assistant keeps hourly statistics.",
  /* [OLD 2026-10-09] Helper text did not warn that Forecast.Solar's sensors carry no hourly data.
  solar_forecast_entity: "Leave empty to use the solar forecast configured in the Energy dashboard (Forecast.Solar, Open-Meteo Solar). For Solcast, pick the 'forecast today' sensor.",
  [/OLD] */
  solar_forecast_entity: "Best left empty: the card then uses the forecast linked to your solar panels in the Energy dashboard. Only pick an entity that carries hourly data in its attributes, such as Solcast's 'forecast today' with detailed attributes enabled. Forecast.Solar's 'energy production today' has no hourly data.",
  solar_forecast_tomorrow_entity: "A sensor with tomorrow's expected production in kWh.",
  grid_power_entity: "Positive while importing, negative while exporting. Use the toggle below if yours is the other way round.",
  battery_power_entity: "Positive while discharging, negative while charging (Powerwall convention). Use the toggle below if yours is the other way round.",
  battery_capacity: "Used for the 'full at' and 'reserve at' estimates. A Powerwall 3 with one expansion is about 27 kWh.",
  battery_reserve_entity: "If set, overrides the fixed reserve value below.",
  battery_unit_soc_entities: "Main battery first, then each expansion. Shown as thin lines under the battery tile's charge bar.", // added 2026-10-10 v1.5.0
  tariff: "List of periods. Example:\n- start: '00:30'\n  end: '05:30'\n  rate: 0.075\n  type: off_peak\n- start: '16:00'\n  end: '19:00'\n  rate: 0.366\n  type: peak\ntype is off_peak, standard or peak. Hours not listed use the standard rate. Optional label replaces the default text.",
  /* [OLD 2026-10-10 v1.3.0->v1.4.0] Did not mention the Buy band.
  import_rate_entity: "Used for the cost tile when no tariff periods are set. Its recorded history gives each hour's price.",
  [/OLD] */
  import_rate_entity: "Used for the Buy band and the cost tile when no tariff periods are set. Its rate list (if it has one), recorded history and current state give each half hour's price.",
  currency: "Leave empty to use the Home Assistant currency.",
  export_rate: "Used for every hour not covered by the export tariff periods.", // added 2026-10-09 v1.1.0
  export_tariff: "Same format as the import tariff periods, with your export rates. Example:\n- start: '16:00'\n  end: '19:00'\n  rate: 0.29\n  type: peak\nHours not listed use the standard export rate. Shown as a second band and used for today's income.", // added 2026-10-09 v1.1.0
  timeline_hours: "How many hours the timeline shows, with now always in the centre. Joins yesterday, today and tomorrow.", // added 2026-10-09 v1.1.0
  show_storm_alert: "A red label when the hourly forecast has thunder, hail, exceptional weather or storm-force wind in the next 24 hours.", // added 2026-10-09 v1.1.0
  export_rate_entity: "Your export price as an entity. Takes priority over the export tariff periods. Past hours come from its recorded history; upcoming hours from a rate list in its attributes, if it has one (Octopus Energy's export day-rates event, Nord Pool's raw_today/raw_tomorrow). Units such as GBP/kWh or p/kWh are converted.", // added 2026-10-09 v1.2.0
};

const ENERGY_SENSOR = { entity: { filter: { domain: "sensor", device_class: "energy" } } };
const POWER_SENSOR = { entity: { filter: { domain: "sensor", device_class: "power" } } };

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

class EnergyWeatherTimelineCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._stats = {};
    this._base = {};
    this._statsDay = null;
    this._hist = {};
    this._histDay = null;
    this._wxHist = [];
    this._forecast = null;
    this._solarFcWs = null;
    this._tariff = [];
    this._lastFetch = 0;
    this._lastSolarFetch = 0;
    this._fetchHour = null;
    this._needFetch = true;
    this._fetching = false;
    this._error = null;
    this._width = 0;
    this._lastMinute = null;
    this._fmtCache = new Map();
    this._series = {};   // added 2026-10-09 v1.0.3: raw recorder history for energy/power fallbacks
    this._flowDiag = {}; // added 2026-10-09 v1.0.3: last console diagnosis per energy flow
    this._expTariff = []; // added 2026-10-09 v1.1.0: export tariff periods
    this._fsK = 0; // added 2026-10-09 v1.1.0: first fetched hour, counted from today's midnight
    this._uid = `ewt${Math.random().toString(36).slice(2, 8)}`; // added 2026-10-09 v1.1.0: unique SVG ids
  }

  /* ---------- editor ---------- */

  static getConfigForm() {
    return {
      schema: [
        {
          name: "clock_weather", type: "expandable", flatten: true, expanded: true, title: "Clock and weather",
          schema: [
            { name: "weather_entity", selector: { entity: { filter: { domain: "weather" } } } },
            { name: "rain_entity", selector: { entity: { filter: { domain: "sensor", device_class: "precipitation" } } } },
            { name: "warning_entity", selector: { entity: {} } },
            {
              name: "", type: "grid", flatten: true,
              schema: [
                { name: "time_zone", selector: { text: {} } },
                { name: "show_seconds", selector: { boolean: {} } },
              ],
            },
          ],
        },
        {
          name: "solar", type: "expandable", flatten: true, title: "Solar",
          schema: [
            { name: "solar_energy_entity", selector: ENERGY_SENSOR },
            { name: "solar_power_entity", selector: POWER_SENSOR },
            { name: "solar_forecast_entity", selector: { entity: { filter: { domain: "sensor" } } } },
            { name: "solar_forecast_tomorrow_entity", selector: { entity: { filter: { domain: "sensor" } } } },
          ],
        },
        {
          name: "home_grid", type: "expandable", flatten: true, title: "Home and grid",
          schema: [
            { name: "home_energy_entity", selector: ENERGY_SENSOR },
            { name: "home_power_entity", selector: POWER_SENSOR },
            { name: "grid_import_entity", selector: ENERGY_SENSOR },
            { name: "grid_export_entity", selector: ENERGY_SENSOR },
            { name: "grid_power_entity", selector: POWER_SENSOR },
            { name: "grid_power_invert", selector: { boolean: {} } },
          ],
        },
        {
          name: "battery", type: "expandable", flatten: true, title: "Battery",
          schema: [
            { name: "battery_name", selector: { text: {} } },
            { name: "battery_soc_entity", selector: { entity: { filter: { domain: "sensor", device_class: "battery" } } } },
            { name: "battery_unit_soc_entities", selector: { entity: { multiple: true, filter: { domain: "sensor" } } } }, // added 2026-10-10 v1.5.0
            { name: "battery_power_entity", selector: POWER_SENSOR },
            { name: "battery_power_invert", selector: { boolean: {} } },
            { name: "battery_capacity", selector: { number: { min: 0, max: 500, step: 0.1, mode: "box", unit_of_measurement: "kWh" } } },
            { name: "battery_reserve_entity", selector: { entity: { filter: [{ domain: "sensor" }, { domain: "number" }, { domain: "input_number" }] } } },
            { name: "battery_reserve", selector: { number: { min: 0, max: 100, step: 1, mode: "slider", unit_of_measurement: "%" } } },
          ],
        },
        {
          name: "tariff_cost", type: "expandable", flatten: true, title: "Tariff and cost",
          schema: [
            { name: "tariff", selector: { object: {} } },
            {
              name: "", type: "grid", flatten: true,
              schema: [
                { name: "standard_rate", selector: { number: { min: 0, max: 10, step: 0.001, mode: "box" } } },
                { name: "export_rate", selector: { number: { min: 0, max: 10, step: 0.001, mode: "box" } } },
              ],
            },
            { name: "export_tariff", selector: { object: {} } }, // added 2026-10-09 v1.1.0
            { name: "import_rate_entity", selector: { entity: { filter: { domain: "sensor" } } } },
            { name: "export_rate_entity", selector: { entity: { filter: [{ domain: "sensor" }, { domain: "event" }, { domain: "number" }, { domain: "input_number" }] } } }, // added 2026-10-09 v1.2.0
            { name: "currency", selector: { text: {} } },
          ],
        },
        {
          name: "display", type: "expandable", flatten: true, title: "Show or hide",
          schema: [
            { // added 2026-10-09 v1.1.0
              name: "timeline_hours",
              selector: { select: { mode: "dropdown", options: [
                { value: "24", label: "24 hours (12 either side of now)" },
                { value: "36", label: "36 hours (18 either side of now)" },
                { value: "48", label: "48 hours (24 either side of now)" },
              ] } },
            },
            {
              name: "", type: "grid", flatten: true,
              schema: [
                { name: "show_warning", selector: { boolean: {} } },
                { name: "show_tariff", selector: { boolean: {} } },
                { name: "show_rain", selector: { boolean: {} } },
                { name: "show_humidity", selector: { boolean: {} } },
                /* [OLD 2026-10-09 v1.0.4->v1.1.0] The wind row was removed from the timeline.
                { name: "show_wind", selector: { boolean: {} } },
                [/OLD] */
                { name: "show_storm_alert", selector: { boolean: {} } },
                { name: "show_tiles", selector: { boolean: {} } },
              ],
            },
          ],
        },
      ],
      computeLabel: (s) => LABELS[s.name],
      computeHelper: (s) => HELPERS[s.name],
      assertConfig: (config) => {
        if (config.tariff !== undefined && config.tariff !== null && !Array.isArray(config.tariff))
          throw new Error("'tariff' must be a list of periods");
        if (config.export_tariff !== undefined && config.export_tariff !== null && !Array.isArray(config.export_tariff)) // added 2026-10-09 v1.1.0
          throw new Error("'export_tariff' must be a list of periods");
      },
    };
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const dc = (id) => hass.states[id]?.attributes?.device_class;
    const find = (re, cls) => ids.find((i) => i.startsWith("sensor.") && re.test(i) && (!cls || dc(i) === cls));
    const cfg = {
      weather_entity: ids.find((i) => i.startsWith("weather.")),
      solar_energy_entity: find(/solar|pv/, "energy"),
      battery_soc_entity: find(/powerwall|battery/, "battery"),
      battery_reserve: 20,
    };
    Object.keys(cfg).forEach((k) => cfg[k] === undefined && delete cfg[k]);
    return cfg;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.tariff !== undefined && config.tariff !== null && !Array.isArray(config.tariff))
      throw new Error("'tariff' must be a list of periods");
    if (config.export_tariff !== undefined && config.export_tariff !== null && !Array.isArray(config.export_tariff)) // added 2026-10-09 v1.1.0
      throw new Error("'export_tariff' must be a list of periods");
    const prev = this._config;
    /* [OLD 2026-10-09 v1.0.4->v1.1.0] Defaults had the wind row and no storm alert.
    this._config = {
      show_seconds: true, show_warning: true, show_tariff: true, show_rain: true,
      show_humidity: true, show_wind: true, show_tiles: true, battery_reserve: 20,
      ...config,
    };
    [/OLD] */
    this._config = {
      show_seconds: true, show_warning: true, show_tariff: true, show_rain: true,
      show_humidity: true, show_tiles: true, show_storm_alert: true, battery_reserve: 20,
      ...config,
    };
    this._tariff = parseTariff(this._config.tariff);
    this._expTariff = parseTariff(this._config.export_tariff); // added 2026-10-09 v1.1.0
    if (prev && prev.weather_entity !== this._config.weather_entity) {
      this._wxHist = [];
      this._forecast = null;
      this._subscribeForecast();
    }
    this._needFetch = true;
    this._lastSolarFetch = 0;
    this._ensureDom();
    this._scheduleRender();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!old) {
      this._ensureDom();
      if (this.isConnected) this._start();
      this._scheduleRender();
      return;
    }
    if (old.connection !== hass.connection) this._subscribeForecast();
    if (this._entitiesChanged(old, hass)) this._scheduleRender();
  }
  get hass() { return this._hass; }

  getCardSize() { return 16; }
  /* [OLD 2026-10-09 v1.2.0->v1.3.0] No rows, so the sections grid ignored the card's height.
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  [/OLD] */
  // v1.3.0: a default size in the sections grid; the card fits whatever rows and columns it is given
  getGridOptions() { return { columns: 12, rows: 12, min_columns: 6, min_rows: 7 }; }

  connectedCallback() {
    this._ensureDom();
    if (this._hass && this._config) this._start();
  }
  disconnectedCallback() {
    clearInterval(this._tick);
    this._tick = null;
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this._unsubscribeForecast();
  }

  /* ---------- lifecycle helpers ---------- */

  _ensureDom() {
    if (this._root) return;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div id="root"></div></ha-card>`;
    this._card = this.shadowRoot.querySelector("ha-card");
    this._root = this.shadowRoot.getElementById("root");
    this._root.style.display = "contents";
  }

  _start() {
    if (!this._tick) this._tick = setInterval(() => this._onTick(), 1000);
    if (!this._ro && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => {
        const w = this._chartWidth();
        if (Math.abs(w - this._width) > 2) this._scheduleRender();
      });
      this._ro.observe(this._card);
    }
    if (!this._unsubForecast && !this._forecastPending) this._subscribeForecast();
    this._maybeFetch();
  }

  _entityIds() {
    const c = this._config || {};
    return [
      "weather_entity", "rain_entity", "warning_entity", "solar_energy_entity", "solar_power_entity",
      "solar_forecast_entity", "solar_forecast_tomorrow_entity", "home_energy_entity", "home_power_entity",
      "grid_import_entity", "grid_export_entity", "grid_power_entity", "battery_soc_entity",
      /* [OLD 2026-10-09 v1.1.0->v1.2.0] No export price entity.
      "battery_power_entity", "battery_reserve_entity", "import_rate_entity",
      [/OLD] */
    /* [OLD 2026-10-10 v1.4.0->v1.5.0] No per-battery charge entities.
      "battery_power_entity", "battery_reserve_entity", "import_rate_entity", "export_rate_entity",
    ].map((k) => c[k]).filter(Boolean);
    [/OLD] */
      "battery_power_entity", "battery_reserve_entity", "import_rate_entity", "export_rate_entity",
    ].map((k) => c[k]).concat(unitSocIds(c)).filter(Boolean); // v1.5.0: and each battery's charge
  }
  _entitiesChanged(a, b) {
    for (const id of this._entityIds()) if (a.states[id] !== b.states[id]) return true;
    return a.locale !== b.locale || a.config !== b.config || a.themes?.darkMode !== b.themes?.darkMode;
  }

  _onTick() {
    if (!this._hass || !this._config) return;
    this._updateClock();
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== this._lastMinute) {
      this._lastMinute = minute;
      this._scheduleRender();
    }
    this._maybeFetch();
  }

  _maybeFetch() {
    if (!this._hass || !this._config || this._fetching) return;
    const now = Date.now(), tz = this._tz(), ds = dayStart(now, tz);
    const hs = ds + Math.floor((now - ds) / HOUR) * HOUR;
    const newDay = this._statsDay !== null && this._statsDay !== ds;
    const newHour = this._fetchHour !== null && hs !== this._fetchHour && now - hs > 45000; // wait for HA to compile the last hour
    if (this._needFetch || newDay || newHour || now - this._lastFetch > 5 * 60000) this._fetchAll();
  }

  _subscribeForecast() {
    this._unsubscribeForecast();
    const hass = this._hass, id = this._config?.weather_entity;
    if (!hass || !id || !hass.connection || !this.isConnected) return;
    this._forecastPending = true;
    hass.connection
      .subscribeMessage((msg) => { this._forecast = msg?.forecast || []; this._scheduleRender(); },
        { type: "weather/subscribe_forecast", entity_id: id, forecast_type: "hourly" })
      .then((unsub) => {
        this._forecastPending = false;
        if (!this.isConnected) { unsub(); return; }
        this._unsubForecast = unsub;
      })
      .catch((err) => {
        this._forecastPending = false;
        this._forecast = [];
        console.warn(`${CARD_TAG}: hourly forecast unavailable for ${id}`, err);
      });
  }
  _unsubscribeForecast() {
    if (this._unsubForecast) {
      try { this._unsubForecast(); } catch (e) { /* connection already closed */ }
      this._unsubForecast = null;
    }
  }

  /* ---------- data ---------- */

  async _fetchAll() {
    const hass = this._hass, c = this._config;
    if (!hass || !c || this._fetching) return;
    this._fetching = true;
    this._needFetch = false;
    const tz = this._tz(), now = Date.now(), ds = dayStart(now, tz);
    const hs = ds + Math.floor((now - ds) / HOUR) * HOUR;
    const nh = Math.floor((now - ds) / HOUR);
    // added 2026-10-09 v1.1.0: fetch from the first hour the sliding timeline can show (reaches into yesterday)
    const fsK = this._fetchStartK(now, ds), fs = ds + fsK * HOUR, nI = nh - fsK;
    this._lastFetch = now;
    this._fetchHour = hs;
    const iso = (ms) => new Date(ms).toISOString();
    const errors = [];
    const jobs = [];

    /* [OLD 2026-10-09 v1.0.2->v1.0.3] Replaced: a sensor without long-term statistics (no state_class) silently gave
       all-zero hours, and there was no fallback to recorder history or to a power sensor.
    // hourly energy (and rain) from long-term statistics
    const statIds = [c.solar_energy_entity, c.home_energy_entity, c.grid_import_entity, c.grid_export_entity, c.rain_entity].filter(Boolean);
    if (statIds.length) {
      const req = (period, start) =>
        hass.callWS({
          type: "recorder/statistics_during_period",
          start_time: iso(start), end_time: iso(now), statistic_ids: statIds, period,
          types: ["change", "state"], units: { energy: "kWh", distance: "mm" },
        });
      jobs.push(
        Promise.all([req("hour", ds), req("5minute", hs)])
          .then(([hourly, five]) => {
            const stats = {}, base = {};
            for (const id of statIds) {
              const arr = Array(24).fill(null);
              for (let i = 0; i < nh; i++) arr[i] = 0;
              let b = null;
              for (const p of (hourly && hourly[id]) || []) {
                const s = toMs(p.start), i = Math.floor((s - ds) / HOUR + 1e-6);
                if (i >= 0 && i < nh) arr[i] = Math.max(0, num(p.change) ?? 0);
                const e = p.end != null ? toMs(p.end) : s + HOUR;
                if (Math.abs(e - hs) < 1000 && num(p.state) !== null) b = { state: num(p.state), change: 0 };
              }
              const fl = (five && five[id]) || [];
              if (!b && fl.length)
                b = { change: fl.reduce((a, p) => a + Math.max(0, num(p.change) ?? 0), 0), state: num(fl[fl.length - 1].state) };
              stats[id] = arr;
              base[id] = b || { change: 0, state: null };
            }
            this._stats = stats;
            this._base = base;
            this._statsDay = ds;
          })
          .catch((e) => errors.push(`statistics (${e.message || e.code || e})`))
      );
    }
    [/OLD] */

    // energy flows: long-term statistics first; recorder history for sensors without statistics;
    // power history (integrated) when there is no energy sensor or it showed no change today
    const flows = this._flowDefs();
    const statIds = [...new Set(flows.map((f) => f.energy).filter(Boolean))];
    jobs.push((async () => {
      const stats = {}, base = {};
      if (statIds.length) {
        const req = (period, start) =>
          hass.callWS({
            type: "recorder/statistics_during_period",
            start_time: iso(start), end_time: iso(now), statistic_ids: statIds, period,
            types: ["change", "state"], units: { energy: "kWh", distance: "mm" },
          });
        try {
          /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fetched today only.
          const [hourly, five] = await Promise.all([req("hour", ds), req("5minute", hs)]);
          [/OLD] */
          const [hourly, five] = await Promise.all([req("hour", fs), req("5minute", hs)]);
          for (const id of statIds) {
            const rows = (hourly && hourly[id]) || [];
            const fl = (five && five[id]) || [];
            if (!rows.length && !fl.length) continue; // no long-term statistics for this sensor
            /* [OLD 2026-10-09 v1.0.4->v1.1.0] Hours counted from today's midnight only.
            const arr = Array(24).fill(null);
            for (let i = 0; i < nh; i++) arr[i] = 0;
            let b = null;
            for (const p of rows) {
              const st = toMs(p.start), i = Math.floor((st - ds) / HOUR + 1e-6);
              if (i >= 0 && i < nh) arr[i] = Math.max(0, num(p.change) ?? 0);
            [/OLD] */
            const arr = Array(nI + 1).fill(null);
            for (let i = 0; i < nI; i++) arr[i] = 0;
            let b = null;
            for (const p of rows) {
              const st = toMs(p.start), i = Math.floor((st - fs) / HOUR + 1e-6);
              if (i >= 0 && i < nI) arr[i] = Math.max(0, num(p.change) ?? 0);
              const e = p.end != null ? toMs(p.end) : st + HOUR;
              if (Math.abs(e - hs) < 1000 && num(p.state) !== null) b = { state: num(p.state), change: 0 };
            }
            if (!b && fl.length)
              b = { change: fl.reduce((a, p) => a + Math.max(0, num(p.change) ?? 0), 0), state: num(fl[fl.length - 1].state) };
            stats[id] = arr;
            base[id] = b || { change: 0, state: null };
          }
        } catch (e) {
          errors.push(`statistics (${e.message || e.code || e})`);
        }
      }
      const histIds = new Set();
      for (const f of flows) {
        if (f.energy && !stats[f.energy]) histIds.add(f.energy);
        const today = f.energy && stats[f.energy] ? sum(stats[f.energy]) + (base[f.energy]?.change || 0) : null;
        if (f.power && (today === null || today < 0.01)) histIds.add(f.power);
      }
      const series = {};
      if (histIds.size) {
        const powerIds = new Set(flows.map((f) => f.power).filter(Boolean));
        try {
          const r = await hass.callWS({
            /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fetched today only.
            type: "history/history_during_period", start_time: iso(ds), end_time: iso(now),
            entity_ids: [...histIds], minimal_response: true, no_attributes: true, significant_changes_only: false,
            [/OLD] */
            type: "history/history_during_period", start_time: iso(fs), end_time: iso(now),
            entity_ids: [...histIds], minimal_response: true, no_attributes: true, significant_changes_only: false,
          });
          for (const id of histIds) {
            const unit = hass.states[id]?.attributes?.unit_of_measurement;
            const k = powerIds.has(id) ? POWER_F[unit] ?? 0.001 : id === c.rain_entity ? LENGTH_F[unit] ?? 1 : ENERGY_F[unit] ?? 1;
            series[id] = ((r && r[id]) || [])
              /* [OLD 2026-10-09 v1.0.4->v1.1.0] Clamped to today's midnight.
              .map((e) => [Math.max(ds, toMs(e.lu ?? e.lc)), num(e.s)])
              .filter((x) => x[1] !== null && Number.isFinite(x[0]))
              [/OLD] */
              .map((e) => [Math.max(fs, toMs(e.lu ?? e.lc)), num(e.s)])
              .filter((x) => x[1] !== null && Number.isFinite(x[0]))
              .map(([t, v]) => [t, v * k]);
          }
        } catch (e) {
          errors.push(`energy history (${e.message || e.code || e})`);
        }
      }
      this._stats = stats;
      this._base = base;
      this._series = series;
      this._statsDay = ds;
      this._fsK = fsK; // added 2026-10-09 v1.1.0
    })());

    // battery SOC and import price history
    /* [OLD 2026-10-09 v1.1.0->v1.2.0] No export price entity.
    const histIds = [c.battery_soc_entity, c.import_rate_entity].filter(Boolean);
    [/OLD] */
    const histIds = [c.battery_soc_entity, c.import_rate_entity, c.export_rate_entity].filter(Boolean);
    if (histIds.length) {
      jobs.push(
        hass.callWS({
          /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fetched today only.
          type: "history/history_during_period", start_time: iso(ds), end_time: iso(now),
          entity_ids: histIds, minimal_response: true, no_attributes: true, significant_changes_only: false,
          [/OLD] */
          type: "history/history_during_period", start_time: iso(fs), end_time: iso(now),
          entity_ids: histIds, minimal_response: true, no_attributes: true, significant_changes_only: false,
        })
          .then((r) => {
            const out = {};
            for (const id of histIds)
              out[id] = ((r && r[id]) || [])
                /* [OLD 2026-10-09 v1.0.4->v1.1.0] Clamped to today's midnight.
                .map((e) => [Math.max(ds, toMs(e.lu ?? e.lc)), num(e.s)])
                .filter((p) => p[1] !== null && Number.isFinite(p[0]));
                [/OLD] */
                .map((e) => [Math.max(fs, toMs(e.lu ?? e.lc)), num(e.s)])
                .filter((p) => p[1] !== null && Number.isFinite(p[0]));
            this._hist = out;
            this._histDay = ds;
          })
          .catch((e) => errors.push(`history (${e.message || e.code || e})`))
      );
    }

    // weather history (past hours of the weather lane)
    if (c.weather_entity) {
      jobs.push(
        hass.callWS({
          /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fetched today only.
          type: "history/history_during_period", start_time: iso(ds), end_time: iso(now),
          entity_ids: [c.weather_entity], minimal_response: false, no_attributes: false, significant_changes_only: false,
          [/OLD] */
          type: "history/history_during_period", start_time: iso(fs), end_time: iso(now),
          entity_ids: [c.weather_entity], minimal_response: false, no_attributes: false, significant_changes_only: false,
        })
          .then((r) => {
            let lastA = {};
            this._wxHist = ((r && r[c.weather_entity]) || []).map((e) => {
              if (e.a) lastA = e.a;
              /* [OLD 2026-10-09 v1.0.4->v1.1.0] Clamped to today's midnight.
              return { t: Math.max(ds, toMs(e.lu ?? e.lc)), s: e.s, a: e.a || lastA };
              [/OLD] */
              return { t: Math.max(fs, toMs(e.lu ?? e.lc)), s: e.s, a: e.a || lastA };
            });
          })
          .catch((e) => errors.push(`weather history (${e.message || e.code || e})`))
      );
    }

    /* [OLD 2026-10-09] Only fetched the Energy dashboard forecast when no forecast entity was set,
       so an entity without hourly attributes left today's forecast empty, and errors were swallowed.
    // solar forecast from the Energy dashboard (refreshed every 30 min)
    if (!c.solar_forecast_entity && now - this._lastSolarFetch > 30 * 60000) {
      this._lastSolarFetch = now;
      jobs.push(
        hass.callWS({ type: "energy/solar_forecast" })
          .then((r) => { this._solarFcWs = r; })
          .catch(() => { this._solarFcWs = null; })
      );
    }
    [/OLD] */
    // solar forecast from the Energy dashboard (refreshed every 30 min); also the fallback for an entity without hourly data
    if (now - this._lastSolarFetch > 30 * 60000) {
      this._lastSolarFetch = now;
      jobs.push(
        hass.callWS({ type: "energy/solar_forecast" })
          .then((r) => { this._solarFcWs = r; this._solarFcWsError = null; })
          .catch((e) => { this._solarFcWs = null; this._solarFcWsError = e?.message || e?.code || String(e); })
      );
    }

    await Promise.all(jobs);
    this._fetching = false;
    this._error = errors.length ? `Could not load ${errors.join(", ")}.` : null;
    this._scheduleRender();
  }

  // added 2026-10-09 v1.0.3: where each energy flow can come from
  _flowDefs() {
    const c = this._config;
    const inv = !!c.grid_power_invert;
    return [
      { key: "solar", label: "Solar", energy: c.solar_energy_entity, power: c.solar_power_entity, sign: 1, conv: energyKWh },
      { key: "home", label: "Home", energy: c.home_energy_entity, power: c.home_power_entity, sign: 1, conv: energyKWh },
      { key: "imp", label: "Grid import", energy: c.grid_import_entity, power: c.grid_power_entity, sign: inv ? -1 : 1, conv: energyKWh },
      { key: "exp", label: "Grid export", energy: c.grid_export_entity, power: c.grid_power_entity, sign: inv ? 1 : -1, conv: energyKWh },
      { key: "rain", label: "Rain", energy: c.rain_entity, power: null, sign: 1, conv: lengthMm },
    ];
  }

  /* [OLD 2026-10-09] Replaced: read only detailedHourly / detailedForecast / wh_hours from the chosen entity,
     missed Solcast per-site attributes and Open-Meteo's wh_period, and never fell back to the Energy
     dashboard forecast when the entity had no hourly data, so "today" stayed empty.
  _solarForecast(ds) {
    const c = this._config, hass = this._hass;
    const out = Array(24).fill(0);
    let any = false, tomorrow = null;
    const add = (t, kwh) => {
      if (!Number.isFinite(t)) return;
      const i = Math.floor((t - ds) / HOUR);
      if (i >= 0 && i < 24) { out[i] += kwh; any = true; }
      else if (i >= 24 && i < 48) tomorrow = (tomorrow || 0) + kwh;
    };
    const e = c.solar_forecast_entity && hass.states[c.solar_forecast_entity];
    if (e) {
      const a = e.attributes || {};
      if (Array.isArray(a.detailedHourly)) a.detailedHourly.forEach((p) => add(toMs(p.period_start), num(p.pv_estimate) || 0));
      else if (Array.isArray(a.detailedForecast)) a.detailedForecast.forEach((p) => add(toMs(p.period_start), (num(p.pv_estimate) || 0) * 0.5));
      else if (a.wh_hours && typeof a.wh_hours === "object") Object.entries(a.wh_hours).forEach(([k, v]) => add(toMs(k), (num(v) || 0) / 1000));
    } else if (this._solarFcWs && typeof this._solarFcWs === "object") {
      for (const entry of Object.values(this._solarFcWs)) {
        const wh = entry && entry.wh_hours;
        if (wh) for (const [k, v] of Object.entries(wh)) add(toMs(k), (num(v) || 0) / 1000);
      }
    }
    const tEnt = c.solar_forecast_tomorrow_entity && hass.states[c.solar_forecast_tomorrow_entity];
    if (tEnt) { const v = energyKWh(tEnt); if (v !== null) tomorrow = v; }
    return { hours: any ? out : null, tomorrow };
  }
  [/OLD] */
  /* [OLD 2026-10-09 v1.0.1->v1.0.2] Replaced: only recognised a few fixed attribute layouts (detailedHourly, detailedForecast,
     per-site detailed*, wh_hours, wh_period), so forecasts stored in any other attribute shape were ignored.
  _solarForecast(ds) {
    const c = this._config, hass = this._hass;
    const out = Array(24).fill(0);
    let any = false, tomorrow = null, total = null, source = null;
    const notes = [];
    const add = (t, kwh) => {
      if (!Number.isFinite(t) || !Number.isFinite(kwh)) return;
      const i = Math.floor((t - ds) / HOUR);
      if (i >= 0 && i < 24) { out[i] += kwh; any = true; }
      else if (i >= 24 && i < 48) tomorrow = (tomorrow || 0) + kwh;
    };
    // Solcast-style list: [{ period_start, pv_estimate (kW) }], hourly or half-hourly
    const fromList = (list, hoursPerItem) => list.forEach((p) =>
      add(toMs(p.period_start ?? p.period_end ?? p.datetime), (num(p.pv_estimate) ?? 0) * hoursPerItem));
    // dict of { timestamp: Wh }
    const fromWh = (dict) => Object.entries(dict).forEach(([k, v]) => add(toMs(k), (num(v) ?? 0) / 1000));

    const e = c.solar_forecast_entity && hass.states[c.solar_forecast_entity];
    if (c.solar_forecast_entity && !e) notes.push(`${c.solar_forecast_entity} not found`);
    if (e) {
      const a = e.attributes || {};
      const keys = Object.keys(a);
      const perSite = (prefix) => keys.filter((k) => k.startsWith(prefix) && k !== prefix && Array.isArray(a[k]));
      if (Array.isArray(a.detailedHourly) && a.detailedHourly.length) { fromList(a.detailedHourly, 1); source = "entity:detailedHourly"; }
      else if (Array.isArray(a.detailedForecast) && a.detailedForecast.length) { fromList(a.detailedForecast, 0.5); source = "entity:detailedForecast"; }
      else if (perSite("detailedHourly").length) { perSite("detailedHourly").forEach((k) => fromList(a[k], 1)); source = "entity:detailedHourly_<site>"; }
      else if (perSite("detailedForecast").length) { perSite("detailedForecast").forEach((k) => fromList(a[k], 0.5)); source = "entity:detailedForecast_<site>"; }
      else if (a.wh_hours && typeof a.wh_hours === "object") { fromWh(a.wh_hours); source = "entity:wh_hours"; }
      else if (a.wh_period && typeof a.wh_period === "object") { fromWh(a.wh_period); source = "entity:wh_period"; }
      if (!any) {
        notes.push(source
          ? `${c.solar_forecast_entity} (${source.slice(7)}) has no entries for today`
          : `${c.solar_forecast_entity} has no hourly forecast attributes (has: ${keys.join(", ") || "none"})`);
        total = energyKWh(e); // still show today's total in the tile
      }
    }
    if (!any) {
      out.fill(0);
      tomorrow = null;
      if (this._solarFcWs && typeof this._solarFcWs === "object") {
        const entries = Object.values(this._solarFcWs).filter((x) => x && x.wh_hours);
        entries.forEach((x) => fromWh(x.wh_hours));
        if (any) source = "energy dashboard";
        else notes.push(entries.length ? "Energy dashboard forecast has no data for today" : "no forecast is linked to your solar panels in the Energy dashboard");
      } else if (this._solarFcWsError) notes.push(`Energy dashboard forecast failed: ${this._solarFcWsError}`);
      else if (this._lastSolarFetch) notes.push("Energy dashboard forecast not loaded yet");
    }
    const tEnt = c.solar_forecast_tomorrow_entity && hass.states[c.solar_forecast_tomorrow_entity];
    if (tEnt) { const v = energyKWh(tEnt); if (v !== null) tomorrow = v; }

    // one console line whenever the outcome changes, to make setup problems easy to see
    const diag = any ? `today's forecast from ${source}` : `no hourly solar forecast for today: ${notes.join("; ")}`;
    if (diag !== this._fcDiag) {
      this._fcDiag = diag;
      (any ? console.info : console.warn)(`${CARD_TAG}: ${diag}`);
    }
    return { hours: any ? out : null, tomorrow, total: any ? null : total };
  }
  [/OLD] */
  /* [OLD 2026-10-09 v1.0.4->v1.1.0] Read today's hours only; replaced by the version below that keeps every hour for the sliding timeline.
  _solarForecast(ds) {
    const c = this._config, hass = this._hass;
    let hours = null, tomorrow = null, total = null, source = null;
    const notes = [];

    const e = c.solar_forecast_entity && hass.states[c.solar_forecast_entity];
    if (c.solar_forecast_entity && !e) notes.push(`${c.solar_forecast_entity} not found`);
    if (e) {
      const r = readForecastAttributes(e.attributes || {}, ds, energyKWh(e));
      if (r.hours) { hours = r.hours; tomorrow = r.tomorrow; source = `${c.solar_forecast_entity} → ${r.label}`; }
      else { notes.push(`${c.solar_forecast_entity}: ${r.note}`); total = energyKWh(e); }
    }
    if (!hours) {
      if (this._solarFcWs && typeof this._solarFcWs === "object") {
        const entries = Object.values(this._solarFcWs).filter((x) => x && x.wh_hours);
        const out = Array(24).fill(0);
        let any = false, tmr = null;
        for (const x of entries) for (const [k, v] of Object.entries(x.wh_hours)) {
          const i = Math.floor((toMs(k) - ds) / HOUR), kwh = (num(v) ?? 0) / 1000;
          if (i >= 0 && i < 24) { out[i] += kwh; any = true; } else if (i >= 24 && i < 48) tmr = (tmr || 0) + kwh;
        }
        if (any) { hours = out; tomorrow = tmr; source = "Energy dashboard"; }
        else notes.push(entries.length ? "Energy dashboard forecast has no data for today" : "no forecast is linked to your solar panels in the Energy dashboard");
      } else if (this._solarFcWsError) notes.push(`Energy dashboard forecast failed: ${this._solarFcWsError}`);
    }
    const tEnt = c.solar_forecast_tomorrow_entity && hass.states[c.solar_forecast_tomorrow_entity];
    if (tEnt) { const v = energyKWh(tEnt); if (v !== null) tomorrow = v; }

    // one console line whenever the outcome changes
    const diag = hours ? `today's forecast from ${source}` : `no hourly solar forecast for today — ${notes.join("; ")}`;
    if (diag !== this._fcDiag) {
      this._fcDiag = diag;
      (hours ? console.info : console.warn)(`${CARD_TAG} v${CARD_VERSION}: ${diag}`);
    }
    this._fcNote = hours ? null : notes[0] || null;
    return { hours, tomorrow, total: hours ? null : total };
  }
  [/OLD] */
  // v1.1.0: also returns byHour — kWh per hour keyed by hours since today's midnight — for every hour the
  // sources hold, so the sliding timeline can show yesterday's and tomorrow's forecast. Priority per hour:
  // today's forecast entity, then tomorrow's forecast entity, then the Energy dashboard forecast.
  _solarForecast(ds) {
    const c = this._config, hass = this._hass, tz = this._tz();
    let tomorrow = null, total = null, source = null;
    const notes = [], byHour = {};
    const put = (map, shift) => { for (const [k, v] of Object.entries(map || {})) if (Number.isFinite(v)) byHour[+k + shift] = v; };

    // Energy dashboard forecast (also the fallback for an entity without hourly data)
    let dashToday = false;
    if (this._solarFcWs && typeof this._solarFcWs === "object") {
      const entries = Object.values(this._solarFcWs).filter((x) => x && x.wh_hours);
      const dash = {};
      let tmr = null;
      for (const x of entries) for (const [k, v] of Object.entries(x.wh_hours)) {
        const i = Math.floor((toMs(k) - ds) / HOUR), kwh = (num(v) ?? 0) / 1000;
        if (!Number.isFinite(i)) continue;
        dash[i] = (dash[i] || 0) + kwh;
        if (i >= 0 && i < 24) dashToday = true;
        else if (i >= 24 && i < 48) tmr = (tmr || 0) + kwh;
      }
      put(dash, 0);
      tomorrow = tmr;
      if (dashToday) source = "Energy dashboard";
      else notes.push(entries.length ? "Energy dashboard forecast has no data for today" : "no forecast is linked to your solar panels in the Energy dashboard");
    } else if (this._solarFcWsError) notes.push(`Energy dashboard forecast failed: ${this._solarFcWsError}`);

    // tomorrow's forecast entity: its total, and its hours when it carries them (Solcast does)
    const tEnt = c.solar_forecast_tomorrow_entity && hass.states[c.solar_forecast_tomorrow_entity];
    if (tEnt) {
      const dsT = dayStart(ds + 36 * HOUR, tz);
      const r = readForecastAttributes(tEnt.attributes || {}, dsT, energyKWh(tEnt));
      if (r.byHour) put(r.byHour, Math.round((dsT - ds) / HOUR));
    }

    // today's forecast entity wins wherever it has hours
    const e = c.solar_forecast_entity && hass.states[c.solar_forecast_entity];
    if (c.solar_forecast_entity && !e) notes.push(`${c.solar_forecast_entity} not found`);
    if (e) {
      const r = readForecastAttributes(e.attributes || {}, ds, energyKWh(e));
      if (r.hours) {
        put(r.byHour, 0);
        if (r.tomorrow != null) tomorrow = r.tomorrow;
        source = `${c.solar_forecast_entity} → ${r.label}`;
      } else {
        notes.push(`${c.solar_forecast_entity}: ${r.note}`);
        if (!dashToday) total = energyKWh(e);
      }
    }
    if (tEnt) { const v = energyKWh(tEnt); if (v !== null) tomorrow = v; }

    const hours = Array(24).fill(0);
    let any = false;
    for (let i = 0; i < 24; i++) if (byHour[i] != null) { hours[i] = byHour[i]; any = true; }

    // one console line whenever the outcome changes
    const diag = any ? `today's forecast from ${source}` : `no hourly solar forecast for today — ${notes.join("; ")}`;
    if (diag !== this._fcDiag) {
      this._fcDiag = diag;
      (any ? console.info : console.warn)(`${CARD_TAG} v${CARD_VERSION}: ${diag}`);
    }
    this._fcNote = any ? null : notes[0] || null;
    return { hours: any ? hours : null, tomorrow, total: any ? null : total, byHour: Object.keys(byHour).length ? byHour : null };
  }

  /* ---------- formatting ---------- */

  _tz() {
    const c = this._config, hass = this._hass;
    if (c?.time_zone) return c.time_zone;
    const server = hass?.config?.time_zone;
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return hass?.locale?.time_zone === "local" ? local || server : server || local;
  }
  _lang() { return this._hass?.locale?.language || this._hass?.language || "en"; }
  _h12() {
    const tf = this._hass?.locale?.time_format;
    if (tf === "12") return true;
    if (tf === "24") return false;
    const lang = tf === "system" ? undefined : this._lang();
    try { return !!new Intl.DateTimeFormat(lang, { hour: "numeric" }).resolvedOptions().hour12; } catch (e) { return false; }
  }
  _fmt(key, opts) {
    const k = `${key}|${this._lang()}|${this._tz()}`;
    let f = this._fmtCache.get(k);
    if (!f) {
      try { f = new Intl.DateTimeFormat(this._lang(), { timeZone: this._tz(), ...opts }); }
      catch (e) { f = new Intl.DateTimeFormat("en", { timeZone: this._tz(), ...opts }); }
      this._fmtCache.set(k, f);
    }
    return f;
  }
  _fmtHM(ms) {
    const p = tzParts(ms, this._tz());
    if (!this._h12()) return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
    return `${p.h % 12 || 12}:${String(p.mi).padStart(2, "0")} ${p.h < 12 ? "AM" : "PM"}`;
  }
  _fmtWhen(ms) {
    const tz = this._tz();
    const sameDay = dayStart(ms, tz) === dayStart(Date.now(), tz);
    return sameDay ? this._fmtHM(ms) : `${this._fmt("wd", { weekday: "short" }).format(ms)} ${this._fmtHM(ms)}`;
  }
  _hourLabel(h) {
    if (!this._h12()) return `${String(h).padStart(2, "0")}:00`;
    return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  }
  _clockParts(ms) {
    const p = tzParts(ms, this._tz());
    const h12 = this._h12();
    const hm = h12
      ? `${p.h % 12 || 12}:${String(p.mi).padStart(2, "0")}`
      : `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
    return {
      hm, sec: `:${String(p.s).padStart(2, "0")}`, ap: h12 ? (p.h < 12 ? "AM" : "PM") : "",
      day: this._fmt("day", { weekday: "long" }).format(ms),
      dm: this._fmt("dm", { day: "2-digit", month: "long" }).format(ms),
    };
  }
  _currency() { return this._config.currency || this._hass?.config?.currency || "EUR"; }
  _money(v) {
    try { return new Intl.NumberFormat(this._lang(), { style: "currency", currency: this._currency() }).format(v); }
    catch (e) { return `${v.toFixed(2)} ${this._currency()}`; }
  }
  _rateText(rate) {
    if (rate == null) return "";
    const minor = { GBP: "p", EUR: "c", USD: "¢", AUD: "c", NZD: "c", CAD: "¢" }[this._currency()];
    if (minor && rate < 1) return `${r1(rate * 100)}${minor}`;
    try { return new Intl.NumberFormat(this._lang(), { style: "currency", currency: this._currency(), maximumFractionDigits: 3 }).format(rate); }
    catch (e) { return String(rate); }
  }
  /* [OLD 2026-10-09 v1.2.0->v1.3.0] Always kWh; 1000 kWh and above now shows as MWh with two decimals.
  _kwh(v) { return `${(v ?? 0).toFixed(1)} kWh`; }
  [/OLD] */
  _kwh(v) {
    const x = v ?? 0;
    return Math.abs(x) >= 999.95 ? `${(x / 1000).toFixed(2)} MWh` : `${x.toFixed(1)} kWh`; // 999.95 would round to 1000.0 kWh
  }
  // added 2026-10-09 v1.1.0: duration text for the battery tile, e.g. "3 h 20 min"
  _dur(hours) {
    const mins = Math.max(1, Math.round(hours * 60));
    const h = Math.floor(mins / 60), mi = mins % 60;
    return h ? (mi ? `${h} h ${mi} min` : `${h} h`) : `${mi} min`;
  }
  // added 2026-10-09 v1.1.0: timeline length in hours (24, 36 or 48; anything 12-72 works in YAML)
  _span() {
    const v = num(this._config?.timeline_hours);
    return v !== null && v >= 12 && v <= 72 ? Math.round(v) : 24;
  }
  // added 2026-10-09 v1.1.0: first hour to fetch, counted from today's midnight (never later than midnight)
  _fetchStartK(now, ds) {
    return Math.min(0, Math.floor((now - ds) / HOUR - this._span() / 2) - 1);
  }
  _power(kw) {
    const a = Math.abs(kw);
    return a < 1 ? `${Math.round(a * 1000)} W` : `${a.toFixed(1)} kW`;
  }

  /* ---------- model ---------- */

  /* [OLD 2026-10-09 v1.0.4->v1.1.0] Fixed midnight-to-midnight day; replaced by the sliding-window model below. Also fed the wind row. (inner comment ends written as *\/)
  _model(W) {
    const hass = this._hass, c = this._config;
    const tz = this._tz(), now = Date.now(), ds = dayStart(now, tz);
    const nowH = Math.min(23.999, (now - ds) / HOUR), nh = Math.floor(nowH), frac = nowH - nh;
    const S = (id) => (id ? hass.states[id] : undefined);
    const statsReady = this._statsDay === ds;
    /* [OLD 2026-10-09 v1.0.2->v1.0.3] Replaced by flowOf below: only used long-term statistics, no fallbacks, no diagnosis.
    const hoursOf = (id, conv) => {
      if (!id || !statsReady || !this._stats[id]) return null;
      const arr = this._stats[id].slice();
      const b = this._base[id] || { change: 0, state: null };
      const live = conv(S(id));
      let part = b.change || 0;
      if (b.state != null && live != null && live >= b.state) part += live - b.state;
      arr[nh] = part;
      return arr;
    };
    [/OLD] *\/
    const flowNotes = [];
    const flowOf = (key) => {
      const f = this._flowDefs().find((x) => x.key === key);
      if (!f || (!f.energy && !f.power) || !statsReady) return null;
      let arr = null, src = "", why = "";
      const est = f.energy ? S(f.energy) : null;
      if (f.energy && !est) why = `${f.energy} not found`;
      if (f.energy && this._stats[f.energy]) {
        arr = this._stats[f.energy].slice();
        const b = this._base[f.energy] || { change: 0, state: null };
        const live = f.conv(est);
        let part = b.change || 0;
        if (b.state != null && live != null && live >= b.state) part += live - b.state;
        arr[nh] = part;
        src = `statistics of ${f.energy}`;
      } else if (f.energy && this._series[f.energy]?.length) {
        arr = cumulativeHours(this._series[f.energy], f.conv(est), ds, now, nh);
        const sc = est?.attributes?.state_class;
        src = `recorder history of ${f.energy} (it has no long-term statistics; state_class is ${sc ? `"${sc}"` : "not set"})`;
      } else if (f.energy && est) {
        why = `${f.energy} has no statistics and no history for today`;
      }
      if (f.power && this._series[f.power]?.length && (!arr || sum(arr) < 0.01)) {
        const pst = S(f.power);
        const live = pst ? [Math.max(toMs(pst.last_updated) || now, 0), powerKW(pst)] : null;
        const p = integratePower(this._series[f.power], live, f.sign, ds, now, nh);
        if (!arr || sum(p) > 0.05) {
          if (arr) why = `${f.energy} shows no change today`;
          src = `${f.power}, integrated over time${why ? ` (${why})` : ""}`;
          arr = p;
        }
      }
      const diag = arr ? `${f.label} from ${src}` : `${f.label}: no data${why ? ` — ${why}` : ""}`;
      if (this._flowDiag[key] !== diag) {
        this._flowDiag[key] = diag;
        (arr ? console.info : console.warn)(`${CARD_TAG} v${CARD_VERSION}: ${diag}`);
      }
      if (!arr) flowNotes.push(f.label);
      return arr;
    };
    const hoursOf = (id) => {
      const f = this._flowDefs().find((x) => x.energy === id);
      return f ? flowOf(f.key) : null;
    };

    const m = {
      nh, frac, now: nowH,
      showHum: c.show_humidity !== false, showWind: c.show_wind !== false,
      nowLabel: `Now ${this._fmtHM(now)}`,
      hourLabel: (h) => this._hourLabel(h),
      rateLabel: (s) => {
        const r = this._rateText(s.rate);
        if (s.label) return r ? `${r} ${s.label}` : s.label;
        if (s.type === "off_peak") return r ? `${r} off-peak` : "off-peak";
        if (s.type === "peak") return r ? `${r} peak` : "peak";
        return r;
      },
    };

    // sun
    const lat = num(hass.config?.latitude), lon = num(hass.config?.longitude);
    if (lat !== null && lon !== null) {
      const st = sunTimes(ds, lat, lon);
      if (st) {
        const a = (st.rise - ds) / HOUR, b = (st.set - ds) / HOUR;
        if (a > 0 && a < 24 && b > a && b < 24) {
          m.sunrise = a; m.sunset = b;
          m.riseLabel = this._fmtHM(st.rise); m.setLabel = this._fmtHM(st.set);
        }
      }
    }
    const isNight = (h) => m.sunrise != null && (h < m.sunrise || h > m.sunset);

    // energy
    /* [OLD 2026-10-09 v1.0.2->v1.0.3] Flows now resolve through flowOf (statistics → history → power).
    m.solar = hoursOf(c.solar_energy_entity, energyKWh);
    m.home = hoursOf(c.home_energy_entity, energyKWh);
    m.imp = hoursOf(c.grid_import_entity, energyKWh);
    m.exp = hoursOf(c.grid_export_entity, energyKWh);
    [/OLD] *\/
    m.solar = flowOf("solar");
    m.home = flowOf("home");
    m.imp = flowOf("imp");
    m.exp = flowOf("exp");
    m.flowNotes = flowNotes;
    const sf = this._solarForecast(ds);
    m.solarFc = sf.hours;
    m.tomorrow = sf.tomorrow;
    m.fcTotalOnly = sf.total; // added 2026-10-09: today's total when no hourly forecast exists

    // battery
    if (c.battery_soc_entity) {
      const live = num(S(c.battery_soc_entity)?.state);
      m.socNow = live;
      const raw = this._histDay === ds ? this._hist[c.battery_soc_entity] || [] : [];
      const pts = [];
      let lastBucket = -1;
      for (const [t, v] of raw) {
        const h = (t - ds) / HOUR;
        if (h < 0 || h > nowH) continue;
        const bk = Math.floor(h * 10); // 6-minute buckets
        if (bk === lastBucket) pts[pts.length - 1] = [h, v];
        else { pts.push([h, v]); lastBucket = bk; }
      }
      if (pts.length && pts[0][0] > 0.01) pts.unshift([0, pts[0][1]]);
      if (pts.length && live !== null) pts.push([nowH, live]);
      m.soc = pts;
      const resEnt = num(S(c.battery_reserve_entity)?.state);
      m.reserve = resEnt !== null ? resEnt : num(c.battery_reserve);
      // when did it last become full?
      const series = raw.concat(live !== null ? [[now, live]] : []);
      if (series.length && series[series.length - 1][1] >= 99.5) {
        let i = series.length - 1;
        while (i > 0 && series[i - 1][1] >= 99.5) i--;
        m.fullSince = i > 0 ? series[i][0] : null;
      }
    }

    // weather
    const wx = S(c.weather_entity);
    const fcByHour = {};
    for (const f of this._forecast || []) {
      const i = Math.floor((toMs(f.datetime) - ds) / HOUR);
      if (i >= 0 && i < 24 && !(i in fcByHour)) fcByHour[i] = f;
    }
    const histAt = (t) => {
      let r = null;
      for (const e of this._wxHist) { if (e.t <= t) r = e; else break; }
      return r;
    };
    if (wx) {
      const pick = (src) => src && {
        cond: src.cond, temp: num(src.temp), hum: num(src.hum), uv: num(src.uv),
        wdeg: bearingDeg(src.wb), wspd: num(src.ws),
      };
      const at = (hi) => {
        if (hi < nh) {
          const e = histAt(ds + (hi + 0.5) * HOUR);
          return e ? pick({ cond: e.s, temp: e.a.temperature, hum: e.a.humidity, uv: e.a.uv_index, wb: e.a.wind_bearing, ws: e.a.wind_speed }) : null;
        }
        if (hi === nh) {
          const a = wx.attributes || {};
          return pick({ cond: wx.state, temp: a.temperature, hum: a.humidity, uv: a.uv_index, wb: a.wind_bearing, ws: a.wind_speed });
        }
        const f = fcByHour[hi];
        return f ? pick({ cond: f.condition, temp: f.temperature, hum: f.humidity, uv: f.uv_index, wb: f.wind_bearing, ws: f.wind_speed }) : null;
      };
      const step = W < 470 ? 3 : 2;
      m.slots = [];
      for (let s = 0; s < 24; s += step) {
        const center = s + step / 2;
        const hi = Math.min(23, Math.floor(center));
        const d = at(hi);
        if (!d || !d.cond) continue;
        m.slots.push({
          h: center, cond: d.cond, night: isNight(hi + 0.5),
          temp: d.temp !== null ? `${Math.round(d.temp)}°` : null,
          uv: d.uv !== null && d.uv >= 1 ? `UV ${Math.round(d.uv)}` : null,
          hum: d.hum, wdeg: d.wdeg, wspd: d.wspd,
        });
      }
      const a = wx.attributes || {};
      m.cur = {
        cond: wx.state,
        condText: hass.formatEntityState ? hass.formatEntityState(wx) : wx.state,
        temp: num(a.temperature), tUnit: a.temperature_unit || "°",
        hum: num(a.humidity),
        ws: num(a.wind_speed), wsUnit: a.wind_speed_unit || "km/h", wb: bearingDeg(a.wind_bearing),
        night: isNight(nowH),
      };
    }

    // rain lane
    if (c.show_rain !== false && (wx || c.rain_entity)) {
      const rainHours = c.rain_entity ? hoursOf(c.rain_entity, lengthMm) : null;
      const pf = LENGTH_F[wx?.attributes?.precipitation_unit] ?? 1;
      const mm = Array(24).fill(null), prob = Array(24).fill(null);
      let any = false;
      for (let h = 0; h < 24; h++) {
        if (rainHours && h <= nh && rainHours[h] != null) { mm[h] = rainHours[h]; any = true; }
        const f = fcByHour[h];
        if (f && h >= nh) {
          if (!(rainHours && h <= nh) && num(f.precipitation) !== null) { mm[h] = num(f.precipitation) * pf; any = true; }
          if (num(f.precipitation_probability) !== null) { prob[h] = num(f.precipitation_probability); any = true; }
        }
      }
      if (any || wx) { m.rainMm = mm; m.rainProb = prob; }
    }

    // tariff + rates
    const stdRate = num(c.standard_rate);
    if (this._tariff.length) {
      const segs = tariffSegments(this._tariff, stdRate);
      if (c.show_tariff !== false) m.tariff = segs;
      m.rateAt = (h) => { const s = segs.find((x) => h >= x.a && h < x.b); return s && s.rate != null ? s.rate : stdRate; };
    } else if (c.import_rate_entity) {
      const st = S(c.import_rate_entity);
      const unit = String(st?.attributes?.unit_of_measurement || "");
      const fct = /^(p|c|¢|cent)/i.test(unit) ? 0.01 : 1;
      const raw = this._histDay === ds ? this._hist[c.import_rate_entity] || [] : [];
      const liveR = num(st?.state);
      m.rateAt = (h) => {
        const t = ds + h * HOUR;
        if (h >= nh && liveR !== null) return liveR * fct;
        let r = null;
        for (const [ts, v] of raw) { if (ts <= t) r = v; else break; }
        return r !== null ? r * fct : liveR !== null ? liveR * fct : null;
      };
    } else if (stdRate !== null) {
      m.rateAt = () => stdRate;
    }

    // tile numbers
    m.solarNow = powerKW(S(c.solar_power_entity));
    m.homeNow = powerKW(S(c.home_power_entity));
    m.gridNow = powerKW(S(c.grid_power_entity), !!c.grid_power_invert);
    m.battNow = powerKW(S(c.battery_power_entity), !!c.battery_power_invert);
    if (m.solar) { m.solarToday = sum(m.solar, nh); m.solarBest = argmax(m.solar, nh); }
    if (m.solarFc) {
      m.fcToday = sum(m.solarFc);
      m.fcLeft = m.solarFc[nh] * (1 - frac) + sum(m.solarFc.slice(nh + 1));
    }
    if (m.home) { m.homeToday = sum(m.home, nh); m.homeBusiest = argmax(m.home, nh); }
    if (m.imp) m.impToday = sum(m.imp, nh);
    if (m.exp) m.expToday = sum(m.exp, nh);
    if (m.imp && m.rateAt) {
      let ci = 0, ok = false;
      for (let h = 0; h <= nh; h++) {
        const r = m.rateAt(h + 0.5);
        if (r != null && m.imp[h] != null) { ci += m.imp[h] * r; ok = true; }
      }
      const er = num(c.export_rate);
      const ce = m.exp && er !== null ? m.expToday * er : null;
      if (ok) m.cost = { imp: ci, exp: ce, net: ci - (ce || 0) };
    }
    if (m.home && m.imp && m.homeToday > 0) {
      let fromGrid = 0;
      for (let h = 0; h <= nh; h++) fromGrid += Math.min(m.imp[h] || 0, m.home[h] || 0);
      m.selfPowered = Math.max(0, 1 - fromGrid / m.homeToday);
    }
    return m;
  }
  [/OLD] */
  // v1.1.0: the timeline is a sliding window centred on now. Hours are counted from today's midnight
  // (negative = yesterday, 24 and up = tomorrow); window arrays start at hour k0. Tiles stay "today".
  _model(W) {
    const hass = this._hass, c = this._config;
    const tz = this._tz(), now = Date.now(), ds = dayStart(now, tz);
    const kNow = (now - ds) / HOUR, nh = Math.floor(kNow), frac = kNow - nh;
    const span = this._span(), wStart = kNow - span / 2, wEnd = kNow + span / 2;
    const k0 = Math.floor(wStart) - 1, k1 = Math.ceil(wEnd); // one spare hour each side, clipped when drawn
    const n = k1 - k0 + 1, jNow = nh - k0;
    const inWin = (h) => h >= wStart && h <= wEnd;
    const S = (id) => (id ? hass.states[id] : undefined);
    const statsReady = this._statsDay === ds;
    const fsK = this._fsK || 0, fs = ds + fsK * HOUR, nI = nh - fsK; // fetched range: hour fsK .. nh
    const iwM = Math.max(60, W - 30 - (c.battery_soc_entity ? 40 : 14)); // plot width, same as chartSvg
    const pph = iwM / span; // pixels per hour

    // energy flows over the fetched range (statistics → history → integrated power), as in v1.0.3
    const flowNotes = [];
    const flowOf = (key) => {
      const f = this._flowDefs().find((x) => x.key === key);
      if (!f || (!f.energy && !f.power) || !statsReady) return null;
      let arr = null, src = "", why = "";
      const est = f.energy ? S(f.energy) : null;
      if (f.energy && !est) why = `${f.energy} not found`;
      if (f.energy && this._stats[f.energy]) {
        arr = this._stats[f.energy].slice();
        const b = this._base[f.energy] || { change: 0, state: null };
        const live = f.conv(est);
        let part = b.change || 0;
        /* [OLD 2026-10-10 v1.5.0->v1.5.1] A daily meter that reset at midnight read lower than its value at the hour start, so the running hour counted nothing: just after midnight, grid import read 0 and self-powered showed 100 %.
        if (b.state != null && live != null && live >= b.state) part += live - b.state;
        [/OLD] */
        // v1.5.1: a meter that reset since the hour began (a daily meter just after midnight) counts from zero;
        // a dip of under 10 % is meter noise and adds nothing
        if (b.state != null && live != null) part += live >= b.state ? live - b.state : live < b.state * 0.9 ? live : 0;
        arr[nI] = part;
        src = `statistics of ${f.energy}`;
      } else if (f.energy && this._series[f.energy]?.length) {
        arr = cumulativeHours(this._series[f.energy], f.conv(est), fs, now, nI);
        const sc = est?.attributes?.state_class;
        src = `recorder history of ${f.energy} (it has no long-term statistics; state_class is ${sc ? `"${sc}"` : "not set"})`;
      } else if (f.energy && est) {
        why = `${f.energy} has no statistics and no history for today`;
      }
      if (f.power && this._series[f.power]?.length && (!arr || sum(arr) < 0.01)) {
        const pst = S(f.power);
        const live = pst ? [Math.max(toMs(pst.last_updated) || now, 0), powerKW(pst)] : null;
        const p = integratePower(this._series[f.power], live, f.sign, fs, now, nI);
        if (!arr || sum(p) > 0.05) {
          if (arr) why = `${f.energy} shows no change today`;
          src = `${f.power}, integrated over time${why ? ` (${why})` : ""}`;
          arr = p;
        }
      }
      /* [OLD 2026-10-10 v1.3.0->v1.4.0] No check for impossible hours.
      const diag = arr ? `${f.label} from ${src}` : `${f.label}: no data${why ? ` — ${why}` : ""}`;
      if (this._flowDiag[key] !== diag) {
        this._flowDiag[key] = diag;
        (arr ? console.info : console.warn)(`${CARD_TAG} v${CARD_VERSION}: ${diag}`);
      }
      [/OLD] */
      // v1.4.0: hours a home can't produce are corrected or left out (saneFlow), and the console says so
      let fix = "";
      if (arr && key !== "rain") {
        const fromMeter = src.startsWith("statistics") || src.startsWith("recorder"); // else integrated from power (kW)
        const unitKnown = !fromMeter || ENERGY_F[est?.attributes?.unit_of_measurement] != null;
        const r = saneFlow(arr, nI, (i) => this._fmtWhen(fs + i * HOUR), unitKnown);
        arr = r.arr;
        fix = r.note;
      }
      const diag = arr ? `${f.label} from ${src}${fix ? ` — ${fix}` : ""}` : `${f.label}: no data${why ? ` — ${why}` : ""}`;
      if (this._flowDiag[key] !== diag) {
        this._flowDiag[key] = diag;
        (arr && !fix ? console.info : console.warn)(`${CARD_TAG} v${CARD_VERSION}: ${diag}`);
      }
      if (!arr) flowNotes.push(f.label);
      return arr;
    };
    // fetched-range array → window array (actuals only up to the running hour)
    const win = (arr) => {
      if (!arr) return null;
      const out = Array(n).fill(null);
      for (let j = 0; j < n; j++) {
        const k = k0 + j, i = k - fsK;
        if (k <= nh && i >= 0 && i < arr.length) out[j] = arr[i];
      }
      return out;
    };
    // fetched-range array → today's hours 0..nh
    const today = (arr) => (arr ? arr.slice(-fsK, nI + 1) : null);

    const m = {
      uid: this._uid, span, wStart, k0, jNow, frac, now: kNow, nh,
      showHum: c.show_humidity !== false,
      nowLabel: `Now ${this._fmtHM(now)}`,
      rateLabel: (s) => {
        const r = this._rateText(s.rate);
        if (s.plain) return r; // added 2026-10-09 v1.2.0: price-entity segments show the price only
        if (s.label) return r ? `${r} ${s.label}` : s.label;
        if (s.type === "off_peak") return r ? `${r} off-peak` : "off-peak";
        if (s.type === "peak") return r ? `${r} peak` : "peak";
        return r;
      },
    };

    // day boundaries (two days either side covers a 48-hour window), hour ticks
    const dayStarts = [];
    for (let d = -2; d <= 3; d++) dayStarts.push(dayStart(ds + d * 24 * HOUR + 12 * HOUR, tz));
    m.days = dayStarts.map((t) => (t - ds) / HOUR).filter((h) => h > wStart && h < wEnd);
    const tickStep = [2, 3, 4, 6, 8, 12].find((s) => s * pph >= 72) || 12;
    m.ticks = [];
    for (let k = Math.ceil(wStart); k <= Math.floor(wEnd); k++) {
      const t = ds + k * HOUR, p = tzParts(t, tz);
      if (p.h % tickStep) continue;
      m.ticks.push({ h: k, day: p.h === 0, label: p.h === 0 ? this._fmt("wd", { weekday: "short" }).format(t) : this._hourLabel(p.h) });
    }

    // sun: nights between each sunset and the next sunrise, and every sunrise/sunset in view
    m.nights = [];
    m.sunMarks = [];
    const lat = num(hass.config?.latitude), lon = num(hass.config?.longitude);
    if (lat !== null && lon !== null) {
      const suns = dayStarts.map((t) => sunTimes(t, lat, lon));
      for (let i = 0; i < suns.length - 1; i++)
        if (suns[i] && suns[i + 1]) m.nights.push([(suns[i].set - ds) / HOUR, (suns[i + 1].rise - ds) / HOUR]);
      for (const st of suns) {
        if (!st) continue;
        const a = (st.rise - ds) / HOUR, b = (st.set - ds) / HOUR;
        if (inWin(a)) m.sunMarks.push({ h: a, kind: "rise", label: this._fmtHM(st.rise) });
        if (inWin(b)) m.sunMarks.push({ h: b, kind: "set", label: this._fmtHM(st.set) });
      }
    }
    const isNight = (h) => m.nights.some(([a, b]) => h > a && h < b);

    // energy
    const solarF = flowOf("solar"), homeF = flowOf("home"), impF = flowOf("imp"), expF = flowOf("exp");
    m.solar = win(solarF);
    m.home = win(homeF);
    m.imp = win(impF);
    m.exp = win(expF);
    m.flowNotes = flowNotes;
    const dSolar = today(solarF), dHome = today(homeF), dImp = today(impF), dExp = today(expF);

    // solar forecast: every hour the sources hold, so yesterday and tomorrow show where available
    const sf = this._solarForecast(ds);
    if (sf.byHour) {
      const fcw = Array(n).fill(null);
      let any = false;
      for (let j = 0; j < n; j++) { const v = sf.byHour[k0 + j]; if (v != null) { fcw[j] = v; any = true; } }
      m.solarFc = any ? fcw : null;
    }
    m.tomorrow = sf.tomorrow;
    m.fcTotalOnly = sf.total;
    if (sf.hours) {
      m.fcToday = sum(sf.hours);
      m.fcLeft = (sf.hours[nh] || 0) * (1 - frac) + sum(sf.hours.slice(nh + 1));
    } else if (m.solarFc) { m.fcToday = 0; m.fcLeft = 0; }

    // battery
    if (c.battery_soc_entity) {
      const live = num(S(c.battery_soc_entity)?.state);
      m.socNow = live;
      const raw = this._histDay === ds ? this._hist[c.battery_soc_entity] || [] : [];
      const pts = [];
      let lastBucket = null, before = null;
      for (const [t, v] of raw) {
        const h = (t - ds) / HOUR;
        if (h < k0) { before = v; continue; } // the value carried into the window
        if (h > kNow) continue;
        const bk = Math.floor(h * 10); // 6-minute buckets
        if (bk === lastBucket) pts[pts.length - 1] = [h, v];
        else { pts.push([h, v]); lastBucket = bk; }
      }
      if (before !== null && (!pts.length || pts[0][0] > k0)) pts.unshift([k0, before]);
      if (live !== null) pts.push([kNow, live]);
      m.soc = pts;
      const resEnt = num(S(c.battery_reserve_entity)?.state);
      m.reserve = resEnt !== null ? resEnt : num(c.battery_reserve);
      // when did it last become full?
      const series = raw.concat(live !== null ? [[now, live]] : []);
      if (series.length && series[series.length - 1][1] >= 99.5) {
        let i = series.length - 1;
        while (i > 0 && series[i - 1][1] >= 99.5) i--;
        m.fullSince = i > 0 ? series[i][0] : null;
      }
    }
    // added 2026-10-10 v1.5.0: each battery's own charge, main first, then expansions; without a total entity their mean stands in
    const unitIds = unitSocIds(c);
    if (unitIds.length) {
      m.units = unitIds.map((id, i) => ({ name: i === 0 ? "Main" : unitIds.length > 2 ? `Expansion ${i}` : "Expansion", soc: num(S(id)?.state) }));
      const known = m.units.filter((u) => u.soc !== null);
      if (m.socNow == null && known.length) m.socNow = known.reduce((a, u) => a + u.soc, 0) / known.length;
      if (m.reserve == null) { const resEnt = num(S(c.battery_reserve_entity)?.state); m.reserve = resEnt !== null ? resEnt : num(c.battery_reserve); }
    }

    // weather: history before the running hour, the live state for it, the hourly forecast after it
    const wx = S(c.weather_entity);
    const fcByHour = {};
    for (const f of this._forecast || []) {
      const i = Math.floor((toMs(f.datetime) - ds) / HOUR);
      if (i >= nh && i <= k1 && !(i in fcByHour)) fcByHour[i] = f;
    }
    const histAt = (t) => {
      let r = null;
      for (const e of this._wxHist) { if (e.t <= t) r = e; else break; }
      return r;
    };
    if (wx) {
      const pick = (src) => src && { cond: src.cond, temp: num(src.temp), hum: num(src.hum), uv: num(src.uv) };
      const at = (hi) => {
        if (hi < nh) {
          const e = histAt(ds + (hi + 0.5) * HOUR);
          return e ? pick({ cond: e.s, temp: e.a.temperature, hum: e.a.humidity, uv: e.a.uv_index }) : null;
        }
        if (hi === nh) {
          const a = wx.attributes || {};
          return pick({ cond: wx.state, temp: a.temperature, hum: a.humidity, uv: a.uv_index });
        }
        const f = fcByHour[hi];
        return f ? pick({ cond: f.condition, temp: f.temperature, hum: f.humidity, uv: f.uv_index }) : null;
      };
      const step = [1, 2, 3, 4, 6].find((s) => s * pph >= 38) || 6;
      m.slots = [];
      for (let k = Math.floor(wStart) - step; k <= wEnd; k++) {
        if (tzParts(ds + k * HOUR, tz).h % step) continue;
        const center = k + step / 2;
        if (center < wStart + 0.25 || center > wEnd - 0.25) continue;
        const hi = Math.floor(center);
        const d = at(hi);
        if (!d || !d.cond) continue;
        m.slots.push({
          h: center, cond: d.cond, night: isNight(hi + 0.5),
          temp: d.temp !== null ? `${Math.round(d.temp)}°` : null,
          uv: d.uv !== null && d.uv >= 1 ? `UV ${Math.round(d.uv)}` : null,
          hum: d.hum,
        });
      }
      const a = wx.attributes || {};
      m.cur = {
        cond: wx.state,
        condText: hass.formatEntityState ? hass.formatEntityState(wx) : wx.state,
        temp: num(a.temperature), tUnit: a.temperature_unit || "°",
        hum: num(a.humidity),
        ws: num(a.wind_speed), wsUnit: a.wind_speed_unit || "km/h", wb: bearingDeg(a.wind_bearing),
        night: isNight(kNow),
      };
      if (c.show_storm_alert !== false) m.storm = this._storm(wx, now, ds);
    }

    // rain lane: gauge for past hours, forecast for the rest
    if (c.show_rain !== false && (wx || c.rain_entity)) {
      const rainW = c.rain_entity ? win(flowOf("rain")) : null;
      const pf = LENGTH_F[wx?.attributes?.precipitation_unit] ?? 1;
      const mm = Array(n).fill(null), prob = Array(n).fill(null);
      for (let j = 0; j < n; j++) {
        const k = k0 + j;
        if (rainW && k <= nh && rainW[j] != null) mm[j] = rainW[j];
        const f = fcByHour[k];
        if (f) {
          if (!(rainW && k <= nh) && num(f.precipitation) !== null) mm[j] = num(f.precipitation) * pf;
          if (num(f.precipitation_probability) !== null) prob[j] = num(f.precipitation_probability);
        }
      }
      m.rainMm = mm;
      m.rainProb = prob;
    }

    // tariffs: the daily schedule repeated over every day in view; neighbours with the same rate merge.
    // Clock times are placed by local time, so a 23- or 25-hour day (clock change) stays right.
    const atClock = (dsd, hod) => {
      if (hod >= 24) return (dayStart(dsd + 36 * HOUR, tz) - ds) / HOUR;
      const t = dsd + hod * HOUR;
      return (t - (tzOffset(t, tz) - tzOffset(dsd, tz)) - ds) / HOUR;
    };
    const clockOf = (k) => { const p = tzParts(ds + k * HOUR, tz); return p.h + p.mi / 60; }; // hour of day at hour k
    const spread = (segs) => {
      const out = [];
      for (const t of dayStarts) {
        for (const s of segs) {
          const a = atClock(t, s.a), b = atClock(t, s.b);
          if (b <= wStart || a >= wEnd) continue;
          const prev = out[out.length - 1];
          if (prev && Math.abs(prev.b - a) < 0.01 && prev.type === s.type && prev.rate === s.rate && prev.label === s.label) prev.b = b;
          else out.push({ ...s, a, b });
        }
      }
      return out;
    };
    const stdRate = num(c.standard_rate);
    if (this._tariff.length) {
      const segs = tariffSegments(this._tariff, stdRate);
      if (c.show_tariff !== false) m.tariff = spread(segs);
      m.rateAt = (k) => { const h = clockOf(k), s = segs.find((x) => h >= x.a && h < x.b); return s && s.rate != null ? s.rate : stdRate; };
    /* [OLD 2026-10-10 v1.3.0->v1.4.0] The import price entity only priced the cost tile; no Buy band was drawn for it (or for a flat rate).
    } else if (c.import_rate_entity) {
      const st = S(c.import_rate_entity);
      const unit = String(st?.attributes?.unit_of_measurement || "");
      const fct = /^(p|c|¢|cent)/i.test(unit) ? 0.01 : 1;
      const raw = this._histDay === ds ? this._hist[c.import_rate_entity] || [] : [];
      const liveR = num(st?.state);
      m.rateAt = (h) => {
        const t = ds + h * HOUR;
        if (h >= nh && liveR !== null) return liveR * fct;
        let r = null;
        for (const [ts, v] of raw) { if (ts <= t) r = v; else break; }
        return r !== null ? r * fct : liveR !== null ? liveR * fct : null;
      };
    } else if (stdRate !== null) {
      m.rateAt = () => stdRate;
    }
    [/OLD] */
    } else if (c.import_rate_entity) {
      // v1.4.0: read like the export price entity (rate list, recorded history, live state), and drawn as the Buy band
      const src = this._rateSource(c.import_rate_entity, ds, now, "import");
      const at = (k) => src.at(ds + k * HOUR);
      m.rateAt = (k) => {
        const a = at(k - 0.25), b = at(k + 0.25);
        const v = a !== null && b !== null ? (a + b) / 2 : a !== null ? a : b;
        return v !== null ? v : stdRate;
      };
      if (c.show_tariff !== false) m.tariff = this._rateBand(at, wStart, wEnd);
    } else if (stdRate !== null) {
      m.rateAt = () => stdRate;
      if (c.show_tariff !== false) m.tariff = [{ a: wStart, b: wEnd, rate: stdRate, type: "standard", plain: true, label: null }]; // added 2026-10-10 v1.4.0: a flat rate still gets its Buy band
    }
    /* [OLD 2026-10-09 v1.1.0->v1.2.0] Export rate came only from the export tariff periods or the flat rate.
    const expRate = num(c.export_rate);
    if (this._expTariff.length) {
      const segs = tariffSegments(this._expTariff, expRate);
      if (c.show_tariff !== false) m.expTariff = spread(segs);
      m.expRateAt = (k) => { const h = clockOf(k), s = segs.find((x) => h >= x.a && h < x.b); return s && s.rate != null ? s.rate : expRate; };
    } else if (expRate !== null) {
      m.expRateAt = () => expRate;
    }
    [/OLD] */
    // v1.2.0: an export price entity wins over the export tariff periods, which win over the flat rate
    const expRate = num(c.export_rate);
    if (c.export_rate_entity) {
      const src = this._rateSource(c.export_rate_entity, ds, now);
      const at = (k) => src.at(ds + k * HOUR);
      // an hour's rate is the mean of its two half hours, so half-hourly prices are priced right
      m.expRateAt = (k) => {
        const a = at(k - 0.25), b = at(k + 0.25);
        const v = a !== null && b !== null ? (a + b) / 2 : a !== null ? a : b;
        return v !== null ? v : expRate;
      };
      if (c.show_tariff !== false) m.expTariff = this._rateBand(at, wStart, wEnd);
    } else if (this._expTariff.length) {
      const segs = tariffSegments(this._expTariff, expRate);
      if (c.show_tariff !== false) m.expTariff = spread(segs);
      m.expRateAt = (k) => { const h = clockOf(k), s = segs.find((x) => h >= x.a && h < x.b); return s && s.rate != null ? s.rate : expRate; };
    } else if (expRate !== null) {
      m.expRateAt = () => expRate;
    }

    // tile numbers (today, midnight to now)
    m.solarNow = powerKW(S(c.solar_power_entity));
    m.homeNow = powerKW(S(c.home_power_entity));
    m.gridNow = powerKW(S(c.grid_power_entity), !!c.grid_power_invert);
    m.battNow = powerKW(S(c.battery_power_entity), !!c.battery_power_invert);
    if (dSolar) { m.solarToday = sum(dSolar); m.solarBest = argmax(dSolar); m.solarBestKwh = m.solarBest >= 0 ? dSolar[m.solarBest] : 0; }
    if (dHome) { m.homeToday = sum(dHome); m.homeBusiest = argmax(dHome); m.homeBusiestKwh = m.homeBusiest >= 0 ? dHome[m.homeBusiest] : 0; }
    if (dImp) m.impToday = sum(dImp);
    if (dExp) m.expToday = sum(dExp);
    if ((dImp && m.rateAt) || (dExp && m.expRateAt)) {
      let ci = 0, ce = 0, okI = false, okE = false;
      for (let h = 0; h <= nh; h++) {
        const r = dImp && m.rateAt ? m.rateAt(h + 0.5) : null;
        if (r != null && dImp[h] != null) { ci += dImp[h] * r; okI = true; }
        const er = dExp && m.expRateAt ? m.expRateAt(h + 0.5) : null;
        if (er != null && dExp[h] != null) { ce += dExp[h] * er; okE = true; }
      }
      if (okI || okE) m.cost = { imp: okI ? ci : null, exp: okE ? ce : null, net: ci - ce };
    }
    if (dHome && dImp && m.homeToday > 0) {
      let fromGrid = 0;
      for (let h = 0; h <= nh; h++) fromGrid += Math.min(dImp[h] || 0, dHome[h] || 0);
      m.selfPowered = Math.max(0, 1 - fromGrid / m.homeToday);
    }
    return m;
  }

  // added 2026-10-09 v1.2.0: a price entity as a rate source. at(ms) gives currency per kWh, or null when unknown:
  // the schedule in its attributes first, then its recorded history (past), then its live state (now, and
  // up to the end of the current rate period when the entity says when that is). One console line per outcome.
  /* [OLD 2026-10-10 v1.3.0->v1.4.0] No kind; only the export price used it.
  _rateSource(id, ds, now) {
  [/OLD] */
  _rateSource(id, ds, now, kind = "export") { // v1.4.0: kind names the price in the console line
    const st = this._hass.states[id];
    if (!st) {
      this._rateDiagLog(id, `${id} not found`, true);
      return { at: () => null };
    }
    const a = st.attributes || {};
    const f = rateFactor(a.unit_of_measurement);
    const live = strictNum(st.state);
    const liveV = live !== null ? live * f : null;
    const sched = readRateSchedule(a);
    let sf = f;
    if (sched.entries.length) {
      const cur = sched.entries.find((e) => e.t0 <= now && now < e.t1);
      if (cur && liveV && cur.v > 0) {
        // the scale that makes the schedule agree with the live price (pounds vs pence, per kWh vs per MWh)
        let best = null;
        for (const c of [f, 1, 0.01, 0.001, 0.00001]) {
          const d = Math.abs(Math.log((cur.v * c) / liveV));
          if (best === null || d < best.d) best = { c, d };
        }
        sf = best.c;
      } else if (!a.unit_of_measurement) {
        const vals = sched.entries.map((e) => e.v).sort((x, y) => x - y);
        sf = vals[Math.floor(vals.length / 2)] > 2 ? 0.01 : 1; // e.g. 15.3 is pence, 0.153 is pounds
      }
    }
    const raw = live !== null && this._histDay === ds ? (this._hist[id] || []).filter((p) => Number.isFinite(p[1])) : [];
    const liveEnd = toMs(a.end ?? a.valid_to ?? a.end_time ?? a.until);
    const hourEnd = Math.floor(now / HOUR) * HOUR + HOUR;
    const at = (t) => {
      for (const e of sched.entries) { if (e.t0 <= t && t < e.t1) return e.v * sf; if (e.t0 > t) break; }
      if (t <= now) {
        let r = null;
        for (const [ts, v] of raw) { if (ts <= t) r = v; else break; }
        if (r !== null) return r * f;
      }
      if (liveV !== null && t >= now - HOUR && t < (Number.isFinite(liveEnd) && liveEnd > now ? liveEnd : hourEnd)) return liveV;
      return null;
    };
    const parts = [];
    if (sched.entries.length) parts.push(`rate list in ${sched.names.join(" + ")} (${sched.entries.length} entries, ×${sf} to ${this._currency()}/kWh)`);
    if (raw.length) parts.push(`recorded history (${raw.length} values)`);
    if (liveV !== null) parts.push(`live state ${st.state} ${a.unit_of_measurement || ""}`.trim());
    /* [OLD 2026-10-10 v1.3.0->v1.4.0] Always said export.
    this._rateDiagLog(id, parts.length ? `export price from ${id}: ${parts.join(", ")}${sched.entries.length ? "" : "; no rate list in its attributes, so hours after the current one are blank"}` : `${id} has no usable price (state "${st.state}", no rate list in its attributes)`, !parts.length);
    [/OLD] */
    this._rateDiagLog(id, parts.length ? `${kind} price from ${id}: ${parts.join(", ")}${sched.entries.length ? "" : "; no rate list in its attributes, so hours after the current one are blank"}` : `${id} has no usable price (state "${st.state}", no rate list in its attributes)`, !parts.length);
    return { at };
  }
  _rateDiagLog(id, msg, warn) {
    this._rateDiag = this._rateDiag || {};
    if (this._rateDiag[id] === msg) return;
    this._rateDiag[id] = msg;
    (warn ? console.warn : console.info)(`${CARD_TAG} v${CARD_VERSION}: ${msg}`);
  }
  // added 2026-10-09 v1.2.0: band segments from a rate function (half-hour steps), coloured by level within the view
  _rateBand(at, wStart, wEnd) {
    const segs = [];
    for (let h = Math.floor(wStart * 2) / 2; h < wEnd; h += 0.5) {
      const v = at(h + 0.25);
      if (v === null) continue;
      const prev = segs[segs.length - 1];
      if (prev && Math.abs(prev.b - h) < 0.01 && Math.abs(prev.rate - v) < 1e-6) prev.b = h + 0.5;
      else segs.push({ a: h, b: h + 0.5, rate: v, plain: true, label: null });
    }
    if (!segs.length) return null;
    // time-weighted median: the rate in force for most of the view counts as standard
    const byRate = segs.map((x) => [x.rate, x.b - x.a]).sort((x, y) => x[0] - y[0]);
    const total = byRate.reduce((t, x) => t + x[1], 0);
    let acc = 0, mid = byRate[0][0];
    for (const [r, d] of byRate) { acc += d; if (acc >= total / 2) { mid = r; break; } }
    for (const x of segs) x.type = mid > 0 && x.rate >= mid * 1.15 ? "peak" : mid > 0 && x.rate <= mid * 0.85 ? "off_peak" : "standard";
    return segs;
  }

  // added 2026-10-09 v1.1.0: storms in the next STORM_AHEAD_H hours of the hourly forecast (and right now)
  _storm(wx, now, ds) {
    const a = wx.attributes || {};
    const unit = a.wind_speed_unit || "km/h", toKmh = WIND_KMH[unit] ?? 1;
    const hits = [];
    let maxGust = null;
    const check = (t, cond, gust, wind) => {
      const kinds = [];
      if (cond === "lightning" || cond === "lightning-rainy") kinds.push("Thunderstorm");
      if (cond === "hail") kinds.push("Hail");
      if (cond === "exceptional") kinds.push("Severe weather");
      const g = num(gust), w = num(wind);
      if ((g !== null && g * toKmh >= STORM_GUST_KMH) || (w !== null && w * toKmh >= STORM_WIND_KMH)) {
        kinds.push("Storm-force wind");
        const v = g !== null ? g : w;
        if (maxGust === null || v > maxGust) maxGust = v;
      }
      if (kinds.length) hits.push({ t, kinds });
    };
    check(now, wx.state, a.wind_gust_speed, a.wind_speed);
    for (const f of this._forecast || []) {
      const t = toMs(f.datetime);
      if (!(t > now - HOUR && t <= now + STORM_AHEAD_H * HOUR)) continue;
      check(Math.max(t, now), f.condition, f.wind_gust_speed, f.wind_speed);
    }
    if (!hits.length) return null;
    hits.sort((x, y) => x.t - y.t);
    const kinds = [...new Set(hits.flatMap((h) => h.kinds))];
    let title = kinds.map((k, i) => (i ? k.toLowerCase() : k)).join(", ");
    if (maxGust !== null) title += ` · gusts ${Math.round(maxGust)} ${unit}`;
    const t0 = hits[0].t, t1 = Math.floor(hits[hits.length - 1].t / HOUR) * HOUR + HOUR;
    const when = t0 <= now + 5 * 60000 ? `now until ${this._fmtWhen(t1)}` : `${this._fmtWhen(t0)} – ${this._fmtWhen(t1)}`;
    // hour spans for the red strip on the timeline
    const spans = [];
    for (const h of hits) {
      const a0 = (h.t - ds) / HOUR, b0 = Math.floor(a0) + 1;
      const last = spans[spans.length - 1];
      if (last && a0 <= last[1] + 0.01) last[1] = Math.max(last[1], b0);
      else spans.push([a0, b0]);
    }
    return { title, when, spans };
  }

  /* ---------- rendering ---------- */

  _chartWidth() {
    const w = this._card ? this._card.clientWidth - 40 : 0;
    return w > 0 ? w : 598;
  }

  _scheduleRender() {
    if (this._raf) return;
    const run = () => { this._raf = null; this._render(); };
    this._raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 16);
  }

  _render() {
    if (!this._root || !this._hass || !this._config) return;
    const W = this._chartWidth();
    this._width = W;
    if (this._card) this._card.classList.toggle("light", this._hass.themes?.darkMode === false);
    this._fitOpts = null; // added 2026-10-09 v1.3.0: lay out in full first, then fit
    try {
      this._root.innerHTML = this._buildHtml(W);
      this._fitHeight(W); // added 2026-10-09 v1.3.0
    } catch (e) {
      console.error(`${CARD_TAG}: render failed`, e);
      this._root.innerHTML = `<div class="note err">Card error: ${esc(e.message)}</div>`;
    }
    this._clockEls = {
      day: this.shadowRoot.querySelector(".day"), dm: this.shadowRoot.querySelector(".dm"),
      hm: this.shadowRoot.querySelector(".hm"), sec: this.shadowRoot.querySelector(".sec"), ap: this.shadowRoot.querySelector(".ap"),
    };
  }

  // added 2026-10-09 v1.3.0: fit the card into the height it is given (a sections grid with rows set).
  // The plot grows or shrinks to take up the difference; when it would get too small, the humidity row,
  // rain lane, tariff bands, tiles and weather icons are left out, in that order. With no fixed height
  // (masonry view, or no rows) the card is exactly as tall as its content and nothing changes.
  _fitHeight(W) {
    const card = this._card, m = this._lastModel;
    if (!card || !m || !card.isConnected) return;
    const avail = card.clientHeight;
    const kids = [...this._root.children];
    if (!avail || !kids.length) return;
    const cs = getComputedStyle(card);
    const gap = parseFloat(cs.rowGap) || 12;
    // content height: from the card's top edge to the bottom of the last element, plus the bottom padding
    const used = kids[kids.length - 1].getBoundingClientRect().bottom - card.getBoundingClientRect().top + (parseFloat(cs.paddingBottom) || 0);
    if (Math.abs(avail - used) < 3) return;
    const BASE = 156, MIN = 64, MAX = 420, k = m.plotScale || 1; // k: chart pixels per pixel of plot height
    let posH = BASE + (avail - used) / k;
    const opts = {};
    if (posH < MIN) {
      let need = (MIN - posH) * k;
      const hasWx = !!(m.slots && m.slots.length);
      const tiles = this._root.querySelector(".tiles");
      const steps = [];
      if (hasWx && m.showHum) steps.push(["noHum", 16]);
      if (m.rainMm) steps.push(["noRain", 28]);
      if (m.tariff || m.expTariff) steps.push(["noBands", 20 * ((m.tariff ? 1 : 0) + (m.expTariff ? 1 : 0))]);
      if (tiles) steps.push(["noTiles", tiles.offsetHeight + gap]);
      if (hasWx) steps.push(["noWx", 62]);
      for (const [key, h] of steps) {
        if (need <= 0) break;
        opts[key] = true;
        need -= h;
      }
      posH = MIN + Math.max(0, -need) / k;
    }
    opts.posH = Math.round(Math.min(MAX, posH));
    this._fitOpts = opts;
    this._root.innerHTML = this._buildHtml(W);
  }

  _updateClock() {
    const el = this._clockEls;
    if (!el || !el.hm) return;
    const p = this._clockParts(Date.now());
    if (el.hm.textContent !== p.hm) el.hm.textContent = p.hm;
    if (el.sec && el.sec.textContent !== p.sec) el.sec.textContent = p.sec;
    if (el.ap && el.ap.textContent !== p.ap) el.ap.textContent = p.ap;
    if (el.day && el.day.textContent !== p.day) el.day.textContent = p.day;
    if (el.dm && el.dm.textContent !== p.dm) el.dm.textContent = p.dm;
  }

  _buildHtml(W) {
    const c = this._config;
    const m = this._model(W);
    // added 2026-10-09 v1.3.0: what the height fit asked for (plot height, rows to leave out)
    const fo = this._fitOpts || {};
    if (fo.posH) m.posH = fo.posH;
    if (fo.noHum) m.showHum = false;
    if (fo.noRain) m.rainMm = null;
    if (fo.noBands) { m.tariff = null; m.expTariff = null; }
    if (fo.noWx) m.slots = null;
    this._lastModel = m;
    const out = [this._clockHtml(m)];
    const w = this._warning();
    if (w) out.push(this._warningHtml(w));
    if (m.storm) out.push(this._stormHtml(m.storm)); // added 2026-10-09 v1.1.0

    const anyData = m.solar || m.solarFc || m.home || m.imp || m.exp || m.soc || m.slots;
    if (anyData) out.push(`<div class="chart">${chartSvg(W, m).svg}</div>`);
    else if (!this._entityIds().length) out.push(`<div class="note">Open the card editor to choose your weather and energy entities.</div>`);

    if (m.flowNotes && m.flowNotes.length)
      out.push(`<div class="note">No data today for ${esc(m.flowNotes.join(", "))} — the browser console (F12) says why.</div>`); // added 2026-10-09 v1.0.3
    if (this._error) out.push(`<div class="note err">${esc(this._error)}</div>`);
    else if (this._fetching && this._statsDay === null && this._entityIds().length) out.push(`<div class="note">Loading today's history…</div>`);

    /* [OLD 2026-10-09 v1.2.0->v1.3.0] Tiles were always shown.
    if (c.show_tiles !== false) out.push(this._tilesHtml(m));
    [/OLD] */
    if (c.show_tiles !== false && !fo.noTiles) out.push(this._tilesHtml(m));
    return out.join("");
  }

  _clockHtml(m) {
    const p = this._clockParts(Date.now());
    const sec = this._config.show_seconds !== false ? `<span class="sec">${p.sec}</span>` : "";
    const ap = p.ap ? `<span class="ap">${p.ap}</span>` : "";
    let cond = "";
    if (m.cur) {
      const bits = [esc(m.cur.condText)];
      if (m.cur.hum !== null) bits.push(`${Math.round(m.cur.hum)}% RH`);
      if (m.cur.ws !== null) bits.push(`${Math.round(m.cur.ws)} ${esc(m.cur.wsUnit)}${m.cur.wb !== null ? ` ${compass(m.cur.wb)}` : ""}`);
      const temp = m.cur.temp !== null ? `<span class="t">${r1(m.cur.temp)}°</span>` : "";
      cond = `<div class="cond">${iconSvg(m.cur.cond, m.cur.night, 24)}${temp}<span>${bits.join(" · ")}</span></div>`;
    }
    return `<div class="clock">
      <div class="clock-row">
        <div class="date"><span class="day">${esc(p.day)}</span><span class="dm">${esc(p.dm)}</span></div>
        <div class="time"><span class="hm">${p.hm}</span>${sec}${ap}</div>
      </div>${cond}</div>`;
  }

  _warning() {
    const c = this._config, hass = this._hass;
    if (c.show_warning === false || !c.warning_entity) return null;
    const st = hass.states[c.warning_entity];
    if (!st) return null;
    const attrs = st.attributes || {};
    const list = Array.isArray(attrs.warnings) ? attrs.warnings.filter(Boolean) : [];
    const s = String(st.state).toLowerCase().trim();
    const n = num(st.state);
    const inactive = ["off", "unavailable", "unknown", "none", "", "no warnings", "no_warnings", "clear", "false", "ok"];
    if (!list.length && (inactive.includes(s) || (n !== null && n <= 0))) return null;
    const a = list.length && typeof list[0] === "object" ? { ...attrs, ...list[0] } : attrs;
    const title = a.headline || a.title || a.event || a.warning_type || a.type || (n === null && s !== "on" ? st.state : null) || attrs.friendly_name || "Weather warning";
    const lvl = String(a.awareness_level || a.severity || a.level || a.colour || a.color || title).toLowerCase();
    const level = /red|extreme/.test(lvl) ? "red" : /amber|orange|severe/.test(lvl) ? "amber" : "yellow";
    const t0 = toMs(a.onset || a.effective || a.start || a.valid_from || a.starts);
    const t1 = toMs(a.expires || a.ends || a.end || a.valid_to || a.until);
    let when = "";
    if (Number.isFinite(t0) && Number.isFinite(t1)) {
      const sameDay = dayStart(t0, this._tz()) === dayStart(t1, this._tz());
      when = sameDay ? `${this._fmtWhen(t0)} – ${this._fmtHM(t1)}` : `${this._fmtWhen(t0)} – ${this._fmtWhen(t1)}`;
    } else if (Number.isFinite(t1)) when = `until ${this._fmtWhen(t1)}`;
    const src = a.attribution && String(a.attribution).length <= 40 ? String(a.attribution) : "";
    return { title: String(title), level, when, src, extra: list.length > 1 ? list.length - 1 : 0 };
  }

  _warningHtml(w) {
    return `<div class="warn ${w.level}" role="status">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8,1.8L15,14H1Z"/><path d="M8,6.2V9.4M8,11.6V11.7"/></svg>
      <span class="w-title">${esc(w.title)}</span>
      ${w.when ? `<span>${esc(w.when)}</span>` : ""}
      ${w.extra ? `<span>+${w.extra} more</span>` : ""}
      ${w.src ? `<span class="w-src">${esc(w.src)}</span>` : ""}
    </div>`;
  }

  // added 2026-10-09 v1.1.0: red storm alert label
  _stormHtml(st) {
    return `<div class="storm" role="alert">
      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M8.5,0.5L1.5,9h4.2l-1.6,6.5L12.5,6.5H8.2l1.8-6z"/></svg>
      <span class="s-title">${esc(st.title)}</span><span>${esc(st.when)}</span>
    </div>`;
  }

  /* [OLD 2026-10-10 v1.3.0->v1.4.0] Plain-text first line only.
  _tile(sw, label, value, s1, s2, valueHtml) {
    return `<div class="tile">
      <div class="tl">${sw}<span>${esc(label)}</span></div>
      ${valueHtml || `<div class="tv">${esc(value)}</div>`}
      <div class="ts">${esc(s1 || "")}&nbsp;</div>
      <div class="ts">${esc(s2 || "")}&nbsp;</div>
    </div>`;
  }
  [/OLD] */
  _tile(sw, label, value, s1, s2, valueHtml, s1Html) { // v1.4.0: s1Html (already escaped) for coloured dots
    return `<div class="tile">
      <div class="tl">${sw}<span>${esc(label)}</span></div>
      ${valueHtml || `<div class="tv">${esc(value)}</div>`}
      <div class="ts">${s1Html || esc(s1 || "")}&nbsp;</div>
      <div class="ts">${esc(s2 || "")}&nbsp;</div>
    </div>`;
  }

  _tilesHtml(m) {
    const c = this._config;
    const t = [];
    const at = (h) => this._hourLabel(h);
    if (m.solar) {
      t.push(this._tile(SW.solar, "Solar", this._kwh(m.solarToday),
        m.solarNow !== null ? `${this._power(m.solarNow)} now` : "",
        /* [OLD 2026-10-09 v1.0.4->v1.1.0] m.solar is now the timeline window, not today's hours.
        m.solarBest >= 0 && m.solar[m.solarBest] > 0 ? `Best hour ${at(m.solarBest)} · ${m.solar[m.solarBest].toFixed(1)} kWh` : ""));
        [/OLD] */
        /* [OLD 2026-10-09 v1.2.0->v1.3.0] Always kWh.
        m.solarBest >= 0 && m.solarBestKwh > 0 ? `Best hour ${at(m.solarBest)} · ${m.solarBestKwh.toFixed(1)} kWh` : ""));
        [/OLD] */
        m.solarBest >= 0 && m.solarBestKwh > 0 ? `Best hour ${at(m.solarBest)} · ${this._kwh(m.solarBestKwh)}` : ""));
    }
    /* [OLD 2026-10-09] Showed an unexplained "—" when there was no hourly forecast for today.
    if (m.solarFc || m.tomorrow != null) {
      t.push(this._tile(SW.fc, "Solar forecast", m.solarFc ? this._kwh(m.fcToday) : "—",
        m.solarFc ? `${m.fcLeft.toFixed(1)} kWh still to come` : "",
        m.tomorrow != null ? `Tomorrow ${m.tomorrow.toFixed(1)} kWh` : ""));
    }
    [/OLD] */
    if (m.solarFc || m.tomorrow != null || m.fcTotalOnly != null) {
      const value = m.solarFc ? this._kwh(m.fcToday) : m.fcTotalOnly != null ? this._kwh(m.fcTotalOnly) : "—";
      /* [OLD 2026-10-09 v1.0.1->v1.0.2] Gave no hint why hourly data was missing.
      const s1 = m.solarFc ? `${m.fcLeft.toFixed(1)} kWh still to come` : m.fcTotalOnly != null ? "No hourly data" : "No forecast for today";
      [/OLD] */
      /* [OLD 2026-10-09 v1.2.0->v1.3.0] Always kWh.
      const s1 = m.solarFc ? `${m.fcLeft.toFixed(1)} kWh still to come` : m.fcTotalOnly != null ? "No hourly data — see browser console" : "No forecast for today";
      t.push(this._tile(SW.fc, "Solar forecast", value, s1,
        m.tomorrow != null ? `Tomorrow ${m.tomorrow.toFixed(1)} kWh` : ""));
      [/OLD] */
      const s1 = m.solarFc ? `${this._kwh(m.fcLeft)} still to come` : m.fcTotalOnly != null ? "No hourly data — see browser console" : "No forecast for today";
      t.push(this._tile(SW.fc, "Solar forecast", value, s1,
        m.tomorrow != null ? `Tomorrow ${this._kwh(m.tomorrow)}` : ""));
    }
    if (m.home || m.homeNow !== null) {
      t.push(this._tile(SW.home, "Home", m.home ? this._kwh(m.homeToday) : "—",
        m.homeNow !== null ? `${this._power(m.homeNow)} now` : "",
        /* [OLD 2026-10-09 v1.0.4->v1.1.0] m.home is now the timeline window, not today's hours.
        m.home && m.homeBusiest >= 0 && m.home[m.homeBusiest] > 0 ? `Busiest hour ${at(m.homeBusiest)}` : ""));
        [/OLD] */
        m.home && m.homeBusiest >= 0 && m.homeBusiestKwh > 0 ? `Busiest hour ${at(m.homeBusiest)}` : ""));
    }
    if (m.imp || m.exp || m.gridNow !== null) {
      let now = "";
      if (m.gridNow !== null) now = m.gridNow > 0.02 ? `Importing ${this._power(m.gridNow)}` : m.gridNow < -0.02 ? `Exporting ${this._power(m.gridNow)}` : "0 W now";
      /* [OLD 2026-10-09 v1.2.0->v1.3.0] Always kWh.
      t.push(this._tile(`${SW.grid}${m.exp ? SW.exp : ""}`, "Grid", m.imp ? `${m.impToday.toFixed(1)} kWh in` : "—",
        m.exp ? `${m.expToday.toFixed(1)} kWh exported` : "", now));
      [/OLD] */
      t.push(this._tile(`${SW.grid}${m.exp ? SW.exp : ""}`, "Grid", m.imp ? `${this._kwh(m.impToday)} in` : "—",
        m.exp ? `${this._kwh(m.expToday)} exported` : "", now));
    }
    /* [OLD 2026-10-09 v1.0.4->v1.1.0] Battery tile gave only 'Full ≈' / 'reserve ≈' clock times while charging or discharging; cost tile showed 'in · out' without saying which was income.
    if (m.socNow != null) {
      const soc = Math.max(0, Math.min(100, m.socNow));
      const res = m.reserve;
      const cap = num(c.battery_capacity);
      const bp = m.battNow;
      let status = "", est = res != null ? `Reserve ${Math.round(res)}%` : "";
      const eta = (hours) => (hours > 48 ? "in 2+ days" : this._fmtWhen(Date.now() + hours * HOUR));
      if (soc >= 99.5 && (bp === null || Math.abs(bp) < 0.25)) {
        status = m.fullSince ? `Full since ${this._fmtWhen(m.fullSince)}` : "Full";
      } else if (bp !== null && bp < -0.1) {
        status = `Charging ${this._power(bp)}`;
        if (cap) est = `Full ≈ ${eta((((100 - soc) / 100) * cap) / Math.abs(bp))}`;
      } else if (bp !== null && bp > 0.1) {
        status = `Discharging ${this._power(bp)}`;
        if (cap && res != null && soc > res) est = `${Math.round(res)}% reserve ≈ ${eta((((soc - res) / 100) * cap) / bp)}`;
      } else status = bp !== null ? "Idle" : "";
      const valueHtml = `<div class="row"><span class="tv">${Math.round(soc)}%</span>
        <div class="bar"><div class="fill" style="width:${soc}%"></div>${res != null ? `<div class="tick" style="left:${Math.max(0, Math.min(100, res))}%"></div>` : ""}</div></div>`;
      t.push(this._tile(SW.soc, c.battery_name || "Battery", "", status, est, valueHtml));
    }
    if (m.cost) {
      const s1 = m.cost.exp != null ? `${this._money(m.cost.imp)} in · ${this._money(m.cost.exp)} out` : `${this._money(m.cost.imp)} import`;
      t.push(this._tile(SW.cost, "Today's cost", this._money(m.cost.net), s1,
        m.selfPowered != null ? `${Math.round(m.selfPowered * 100)}% self-powered` : ""));
    } else if (m.selfPowered != null) {
      t.push(this._tile(SW.cost, "Self-powered", `${Math.round(m.selfPowered * 100)}%`, "of home use from solar and battery", ""));
    }
    [/OLD] */
    // v1.1.0: the battery tile shows the time left — to the reserve while discharging, to full while charging,
    // and at the current home use while idle or full; the money tile splits import cost and export income
    if (m.socNow != null) {
      const soc = Math.max(0, Math.min(100, m.socNow));
      const res = m.reserve;
      const floor = res != null ? res : 0;
      const cap = num(c.battery_capacity);
      const bp = m.battNow;
      const flow = bp !== null && Math.abs(bp) > 0.1 ? bp : 0;
      let status = "", est = res != null ? `Reserve ${Math.round(res)}%` : "";
      const left = (hours) => this._dur(hours);
      const clock = (hours) => this._fmtWhen(Date.now() + hours * HOUR);
      if (soc >= 99.5 && (bp === null || Math.abs(bp) < 0.25)) status = m.fullSince ? `Full since ${this._fmtWhen(m.fullSince)}` : "Full";
      else if (flow < 0) status = `Charging ${this._power(bp)}`;
      else if (flow > 0) status = `Discharging ${this._power(bp)}`;
      else status = bp !== null ? "Idle" : "";
      if (cap) {
        if (flow < 0 && soc < 99.5) {
          const h = (((100 - soc) / 100) * cap) / -flow;
          est = h >= 48 ? "Full in 2+ days" : `Full in ${left(h)} · ${clock(h)}`;
        } else if (flow > 0 && soc > floor) {
          const h = (((soc - floor) / 100) * cap) / flow;
          est = h >= 48 ? "2+ days left" : `${left(h)} left · ${clock(h)}`;
        } else if (flow === 0 && m.homeNow !== null && m.homeNow > 0.05 && soc > floor) {
          const h = (((soc - floor) / 100) * cap) / m.homeNow;
          est = h >= 48 ? "Lasts 2+ days at current use" : `Lasts ${left(h)} at current use`;
        }
      }
      /* [OLD 2026-10-10 v1.4.0->v1.5.0] One green bar with a reserve tick; no per-battery charge.
      const valueHtml = `<div class="row"><span class="tv">${Math.round(soc)}%</span>
        <div class="bar"><div class="fill" style="width:${soc}%"></div>${res != null ? `<div class="tick" style="left:${Math.max(0, Math.min(100, res))}%"></div>` : ""}</div></div>`;
      t.push(this._tile(SW.soc, c.battery_name || "Battery", "", status, est, valueHtml));
      [/OLD] */
      // v1.5.0: the total charge as the bar, each battery (main first) as a thin line under it with its percentage, all on
      // one colour scale — red up to the backup reserve, yellow to 60 %, green to 100 % — and the reserve mark through all
      const clamp = (v) => Math.max(0, Math.min(100, v));
      const rr = res != null ? clamp(res) : 0;
      const fill = (v) => `<div class="fill g" style="clip-path:inset(0 ${r1(100 - clamp(v))}% 0 0 round 3px)"></div>`;
      const units = (m.units || []).filter((u) => u.soc !== null);
      const lines = units.map((u) => `<div class="uline">${fill(u.soc)}<span class="up">${Math.round(u.soc)}%</span></div>`).join("");
      const tip = units.map((u) => `${u.name} ${Math.round(u.soc)}%`).join(" · ");
      const valueHtml = `<div class="row"><span class="tv">${Math.round(soc)}%</span><div class="bars"${tip ? ` title="${esc(tip)}"` : ""}>`
        + `<div class="trk${units.length ? " u" : ""}" style="--r:${r1(rr)}%;--r2:${r1(Math.min(60, rr + 8))}%"><div class="bar">${fill(soc)}</div>${lines}`
        + `${res != null ? `<div class="rmark" style="left:${r1(rr)}%"></div>` : ""}</div></div></div>`;
      t.push(this._tile(SW.soc, c.battery_name || "Battery", "", status, est, valueHtml));
    }
    /* [OLD 2026-10-10 v1.3.0->v1.4.0] Said cost twice (title and first line) and income once.
    if (m.cost) {
      const earn = m.cost.net < -0.005;
      const parts = [];
      if (m.cost.imp != null) parts.push(`${this._money(m.cost.imp)} cost`);
      if (m.cost.exp != null) parts.push(`${this._money(m.cost.exp)} income`);
      const valueHtml = `<div class="tv${earn ? " earn" : ""}">${esc(this._money(Math.abs(m.cost.net)))}</div>`;
      t.push(this._tile(SW.cost, earn ? "Today's earnings" : "Today's cost", "", parts.join(" · "),
        m.selfPowered != null ? `${Math.round(m.selfPowered * 100)}% self-powered` : "", valueHtml));
    } else if (m.selfPowered != null) {
    [/OLD] */
    // v1.4.0: the money tile names each figure once — net in the title, then bought (import) and sold (export)
    // in the timeline's colours, with a bar splitting the two
    if (m.cost) {
      const imp = m.cost.imp, exp = m.cost.exp, both = imp != null && exp != null;
      const earn = both ? m.cost.net < -0.005 : imp == null;
      const label = both ? (earn ? "Net earnings" : "Net cost") : imp != null ? "Grid cost" : "Export income";
      const val = both ? Math.abs(m.cost.net) : imp != null ? imp : exp;
      const tot = (imp || 0) + (exp || 0);
      const bar = both && tot > 0
        ? `<div class="bar split"><div class="fill b" style="width:${r1((imp / tot) * 100)}%"></div><div class="fill s" style="width:${r1((exp / tot) * 100)}%"></div></div>`
        : "";
      const valueHtml = `<div class="row"><span class="tv${earn ? " earn" : ""}">${esc(this._money(val))}</span>${bar}</div>`;
      const dot = (cls, text) => `<span class="dot ${cls}"></span>${esc(text)}`;
      const s1Html = both
        ? `${dot("b", `${this._money(imp)} bought`)}<span class="gap"></span>${dot("s", `${this._money(exp)} sold`)}`
        : imp != null ? dot("b", m.impToday != null ? `${this._kwh(m.impToday)} bought` : "bought")
        : dot("s", m.expToday != null ? `${this._kwh(m.expToday)} sold` : "sold");
      t.push(this._tile(SW.cost, label, "", "", m.selfPowered != null ? `${Math.round(m.selfPowered * 100)}% self-powered` : "", valueHtml, s1Html));
    } else if (m.selfPowered != null) {
      t.push(this._tile(SW.cost, "Self-powered", `${Math.round(m.selfPowered * 100)}%`, "of home use from solar and battery", ""));
    }
    return t.length ? `<div class="tiles">${t.join("")}</div>` : "";
  }
}

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, EnergyWeatherTimelineCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "Energy & Weather Timeline",
    /* [OLD 2026-10-09 v1.0.1->v1.0.2] Description had no version.
    description: "Clock, hourly weather and today's solar, home, grid and battery on one 24-hour timeline.",
    [/OLD] */
    /* [OLD 2026-10-09 v1.0.4->v1.1.0] Described the old fixed 24-hour day.
    description: `Clock, hourly weather and today's solar, home, grid and battery on one 24-hour timeline. v${CARD_VERSION}`,
    [/OLD] */
    description: `Clock, hourly weather, solar, home, grid and battery on one sliding timeline with now in the centre. v${CARD_VERSION}`,
    preview: true,
  });
}

console.info(`%c ENERGY-WEATHER-TIMELINE-CARD %c v${CARD_VERSION} `, "color:#fff;background:#2F64B0;font-weight:600", "color:#2F64B0;background:transparent");

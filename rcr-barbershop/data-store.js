// ============================================================
// Data store (tarjeta hecha a mano · RCR)
//
// Carga data.default.json y, si el cliente ya editó desde mi-cuenta,
// mezcla overrides del Worker:
//   GET /card-links/:slug     → links[] (portal)
//   GET /card-services/:slug  → services[] (precios)
//
// Sin Firebase. Si el Worker está caído o no hay override, se queda
// el JSON local — la tarjeta se ve exactamente como se diseñó.
// ============================================================

const CACHE_KEY = "rcr:enlaces:data";
const CACHE_TS_KEY = "rcr:enlaces:data:ts";
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 min (overrides cambian en vivo)

function portalMeta() {
  const api = (document.querySelector('meta[name="mitp-portal-api"]')?.getAttribute("content") || "")
    .trim()
    .replace(/\/$/, "");
  const slug = (document.querySelector('meta[name="mitp-slug"]')?.getAttribute("content") || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!api || api.includes("REPLACE") || !slug) return null;
  return { api, slug };
}

async function loadDefaults() {
  const url = new URL("./data.default.json", import.meta.url);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load data.default.json");
  return res.json();
}

function mergeWithDefaults(defaults, remote) {
  if (!remote || typeof remote !== "object") return defaults;
  return {
    business: { ...defaults.business, ...(remote.business || {}) },
    links: { ...defaults.links, ...(remote.links || {}) },
    hours: { ...defaults.hours, ...(remote.hours || {}) },
    services: Array.isArray(remote.services) ? remote.services : defaults.services,
    gallery: Array.isArray(remote.gallery) ? remote.gallery : defaults.gallery,
  };
}

/** Aplica el array de links del portal sobre el objeto `links` del kit. */
function applyLinksOverride(defaults, portalLinks) {
  if (!Array.isArray(portalLinks) || !portalLinks.length) return defaults.links;

  const links = { ...defaults.links };
  const byStyle = {};
  const byLabelHint = {};
  for (const l of portalLinks) {
    if (!l || !l.url) continue;
    const style = String(l.style || "").trim().toLowerCase();
    if (style) byStyle[style] = l;
    const label = String(l.label || "").toLowerCase();
    if (/instagram|insta/.test(label)) byLabelHint.instagram = l;
    else if (/facebook|face/.test(label)) byLabelHint.facebook = l;
    else if (/web|sitio|página|pagina/.test(label)) byLabelHint.website = l;
    else if (/ubicaci|maps|mapa|llegar/.test(label)) byLabelHint.location = l;
    else if (/agendar|cita|whatsapp|wa\b/.test(label)) byLabelHint.appointment = l;
  }

  // Mapeo estilo portal → claves del kit (slots fijos del diseño).
  const map = [
    ["instagram", "instagram"],
    ["facebook", "facebook"],
    ["website", "website"],
    ["location", "maps"],
    ["appointment", "bookingCta"],
    ["whatsapp", "bookingCta"],
  ];

  for (const [style, key] of map) {
    const hit = byStyle[style] || byLabelHint[style];
    if (!hit) continue;
    if (key === "bookingCta") {
      links._bookingCtaUrl = hit.url;
      if (hit.subtitle) links.whatsappBookingMessage = hit.subtitle;
    } else {
      links[key] = hit.url;
      if (key === "instagram" && hit.subtitle) links.instagramHandle = hit.subtitle;
      if (key === "website" && hit.subtitle) links.websiteLabel = hit.subtitle;
    }
  }

  links._portalLinks = portalLinks;
  return links;
}

async function fetchPortalOverrides(meta) {
  if (!meta) return { links: null, services: null };
  const { api, slug } = meta;
  const [linksRes, servicesRes] = await Promise.all([
    fetch(`${api}/card-links/${encodeURIComponent(slug)}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(`${api}/card-services/${encodeURIComponent(slug)}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  return {
    links: linksRes?.links || null,
    services: servicesRes?.services || null,
  };
}

/**
 * Suscribe a datos. Llama onData(data, source) con defaults/cache al
 * instante, y otra vez cuando llegan overrides del portal.
 * Devuelve una función unsubscribe (no-op hoy; API estable).
 */
export async function subscribeData(onData) {
  let unsubscribed = false;

  const cached = readCache();
  if (cached) onData(cached, "cache");

  let defaults;
  try {
    defaults = await loadDefaults();
  } catch {
    defaults = { business: {}, links: {}, hours: {}, services: [], gallery: [] };
  }
  if (!cached && !unsubscribed) onData(defaults, "defaults");

  const meta = portalMeta();
  try {
    const overrides = await fetchPortalOverrides(meta);
    if (unsubscribed) return () => {};

    let merged = defaults;
    if (overrides.links) {
      merged = {
        ...merged,
        links: applyLinksOverride(defaults, overrides.links),
      };
    }
    if (overrides.services) {
      merged = { ...merged, services: overrides.services };
    }

    if (overrides.links || overrides.services) {
      writeCache(merged);
      onData(merged, "portal");
    }
  } catch (err) {
    console.warn("[rcr] portal overrides failed:", err.message);
  }

  return () => {
    unsubscribed = true;
  };
}

export async function fetchData() {
  const defaults = await loadDefaults();
  const overrides = await fetchPortalOverrides(portalMeta());
  let data = defaults;
  if (overrides.links) data = { ...data, links: applyLinksOverride(defaults, overrides.links) };
  if (overrides.services) data = { ...data, services: overrides.services };
  return { data, fromRemote: !!(overrides.links || overrides.services) };
}

export async function getDefaults() {
  return loadDefaults();
}

function readCache() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || "0", 10);
    if (!ts || Date.now() - ts > CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch {
    /* private mode, quota, etc. */
  }
}

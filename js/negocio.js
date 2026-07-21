// ============================================================
// Mi Tarjeta Pro · JSON-driven business card renderer
// Public card: /<slug>/ (slug read from the URL path)
// Internal preview: /negocio/?n=<slug> (query param, still supported)
// Either way it fetches /negocio/_data/<slug>.json → renders
//
// Builder preview: if window.MTP_PREVIEW_DATA is set before this script
// runs (see js/mi-tarjeta.js, loaded inside an iframe srcdoc), it renders
// that data directly instead of fetching — same engine, same CSS, no
// network call. Nothing here changes for the real /<slug>/ bootstrap path.
// ============================================================

(function () {
  const app = document.getElementById('bizApp');
  if (!app) return;

  // ---------- helpers ----------
  function cleanSlug(value) {
    return (value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  function slugFromPath() {
    const RESERVED = new Set(['negocio', 'mi-cuenta', 'rcr-barbershop', 'images', 'js', 'workers', 'emails']);
    const first = window.location.pathname.split('/').filter(Boolean)[0] || '';
    const s = cleanSlug(first);
    return RESERVED.has(s) ? '' : s;
  }

  const params = new URLSearchParams(window.location.search);
  const slug = cleanSlug(params.get('n')) || slugFromPath();

  const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const CARD_I18N = {
    'es-MX': {
      days: { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' },
      gallery: 'GALERÍA',
      hours: 'HORARIOS',
      designed: 'Diseñado por',
      closedTemp: 'Cerrado temporalmente',
      closedOpens: (day, time) => `Cerrado · abre ${day} a las ${time}`,
      closedOpensToday: (time) => `Cerrado · abre hoy a las ${time}`,
      openUntil: (time) => `Abierto · cierra a las ${time}`,
      hourClosed: 'Cerrado',
      vcardBtn: 'Guardar contacto',
    },
    'en-US': {
      days: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' },
      gallery: 'GALLERY',
      hours: 'HOURS',
      designed: 'Designed by',
      closedTemp: 'Temporarily closed',
      closedOpens: (day, time) => `Closed · opens ${day} at ${time}`,
      closedOpensToday: (time) => `Closed · opens today at ${time}`,
      openUntil: (time) => `Open · closes at ${time}`,
      hourClosed: 'Closed',
      vcardBtn: 'Save contact',
    },
    'fr-CA': {
      days: { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' },
      gallery: 'GALERIE',
      hours: 'HEURES',
      designed: 'Conçu par',
      closedTemp: 'Fermé temporairement',
      closedOpens: (day, time) => `Fermé · ouvre ${day} à ${time}`,
      closedOpensToday: (time) => `Fermé · ouvre aujourd’hui à ${time}`,
      openUntil: (time) => `Ouvert · ferme à ${time}`,
      hourClosed: 'Fermé',
      vcardBtn: 'Enregistrer le contact',
    },
  };

  const ICON_LIB = {
    'calendar2-check': 'bi-calendar2-check',
    calendar: 'bi-calendar2',
    whatsapp: 'bi-whatsapp', wa: 'bi-whatsapp',
    instagram: 'bi-instagram', ig: 'bi-instagram',
    facebook: 'bi-facebook', fb: 'bi-facebook',
    tiktok: 'bi-tiktok', tt: 'bi-tiktok',
    twitter: 'bi-twitter-x', x: 'bi-twitter-x',
    'geo-alt-fill': 'bi-geo-alt-fill', map: 'bi-geo-alt-fill', ubicacion: 'bi-geo-alt-fill',
    globe2: 'bi-globe2', web: 'bi-globe2',
    menu: 'bi-card-list', carta: 'bi-card-list',
    star: 'bi-star-fill',
    email: 'bi-envelope-fill',
    phone: 'bi-telephone-fill',
    shop: 'bi-shop',
    'link-45deg': 'bi-link-45deg',
    link: 'bi-link-45deg',
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function iconClass(key) {
    return ICON_LIB[(key || '').toLowerCase()] || 'bi-arrow-right-circle';
  }

  function withUtm(url) {
    if (!url) return '#';
    if (/^(wa\.me|https?:\/\/wa\.me|https?:\/\/(www\.)?google\.com\/maps|https?:\/\/maps\.google\.com|https?:\/\/maps\.app\.goo\.gl)/.test(url)) return url;
    if (url.startsWith('mailto:') || url.startsWith('tel:')) return url;
    try {
      const u = new URL(url);
      if (!u.searchParams.has('utm_source')) {
        u.searchParams.set('utm_source', 'mitarjetapro');
        u.searchParams.set('utm_medium', 'qr');
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  function safeCssUrl(url) {
    return (url || '').replace(/'/g, '%27').replace(/"/g, '%22');
  }

  function cardLang(data) {
    const l = data && data.language;
    if (l === 'en-US' || l === 'fr-CA') return l;
    return 'es-MX';
  }

  // ---------- status computation ----------
  function mexicoNowParts() {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const wd = parts.find((p) => p.type === 'weekday').value.toLowerCase();
    const h = parseInt(parts.find((p) => p.type === 'hour').value, 10);
    const m = parseInt(parts.find((p) => p.type === 'minute').value, 10);
    return { dayKey: wd, minutes: h * 60 + m };
  }

  function parseHourRange(range) {
    if (!range || range === 'closed') return null;
    const m = range.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return {
      from: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
      to: parseInt(m[3], 10) * 60 + parseInt(m[4], 10),
      label: `${m[1]}:${m[2]} – ${m[3]}:${m[4]}`,
    };
  }

  function formatTime12(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  function computeStatus(hours, S) {
    if (!hours) return null;
    const now = mexicoNowParts();
    const today = parseHourRange(hours[now.dayKey]);
    const DAYS = S.days;

    if (today && now.minutes >= today.from && now.minutes < today.to) {
      return { open: true, text: S.openUntil(formatTime12(today.to)) };
    }

    if (today && now.minutes < today.from) {
      return { open: false, text: S.closedOpensToday(formatTime12(today.from)) };
    }

    const todayIdx = DAY_ORDER.indexOf(now.dayKey);
    for (let i = 1; i <= 7; i++) {
      const nextKey = DAY_ORDER[(todayIdx + i) % 7];
      const next = parseHourRange(hours[nextKey]);
      if (next) {
        return { open: false, text: S.closedOpens(DAYS[nextKey], formatTime12(next.from)) };
      }
    }
    return { open: false, text: S.closedTemp };
  }

  // ---------- vCard ----------
  function vcardEscape(s) {
    return String(s ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function buildVcf(data) {
    const name = data.business?.name || 'Contact';
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardEscape(name)}`, `ORG:${vcardEscape(name)}`];
    if (data.business?.tagline) lines.push(`TITLE:${vcardEscape(data.business.tagline)}`);
    if (data.business?.city) {
      lines.push(`ADR;TYPE=WORK:;;${vcardEscape('')};${vcardEscape(data.business.city)};;${vcardEscape('')};México`);
    }

    const primary = data.primaryCta?.url || '';
    if (primary.startsWith('tel:')) {
      lines.push(`TEL;TYPE=CELL:${vcardEscape(primary.replace(/^tel:/i, ''))}`);
    }
    if (primary.startsWith('mailto:')) {
      lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(primary.replace(/^mailto:/i, ''))}`);
    }
    if (primary && (primary.includes('wa.me') || primary.includes('whatsapp'))) {
      lines.push(`URL;TYPE=WORK:${vcardEscape(withUtm(primary))}`);
    }

    (data.links || []).forEach((link) => {
      if (link && link.url) {
        const u = link.url;
        if (u.startsWith('tel:')) lines.push(`TEL;TYPE=CELL:${vcardEscape(u.replace(/^tel:/i, ''))}`);
        else if (u.startsWith('mailto:')) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(u.replace(/^mailto:/i, ''))}`);
        else lines.push(`URL;TYPE=WORK:${vcardEscape(withUtm(u))}`);
      }
    });

    lines.push('END:VCARD');
    return lines.join('\r\n');
  }

  function triggerVcardDownload(data) {
    const blob = new Blob([buildVcf(data)], { type: 'text/vcard;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(data.slug || 'contacto').replace(/[^a-z0-9-]/gi, '-')}.vcf`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  // ---------- error states ----------
  const ERROR_COPY = {
    missing: {
      title: 'Esta tarjeta no existe',
      body: 'El link puede estar mal escrito o la tarjeta aún no se publica.',
    },
    malformed: {
      title: 'Tarjeta en mantenimiento',
      body: 'Vuelve en un momento. Estamos actualizando esta tarjeta.',
    },
    offline: {
      title: 'Sin conexión',
      body: 'Revisa tu conexión a internet e intenta de nuevo.',
    },
  };

  function renderBizError(code) {
    const c = ERROR_COPY[code] || ERROR_COPY.missing;
    app.dataset.state = 'notfound';
    app.innerHTML = `
      <div class="biz-wrap">
        <div class="biz-notfound">
          <h1>${escapeHtml(c.title)}</h1>
          <p>${escapeHtml(c.body)}</p>
          <a class="cta" href="../index.html">Conoce Mi Tarjeta Pro →</a>
        </div>
        <a class="gaban-credit" href="../index.html">
          <i class="bi bi-stars"></i>
          <span>Diseñado por <strong>mimarca</strong></span>
        </a>
      </div>
    `;
  }

  function renderLink(link) {
    const styleClass = link.style ? ` ${escapeHtml(link.style)}` : '';
    const popular = link.popular ? '<span class="biz-pill-pop">POPULAR</span>' : '';
    const subtitle = link.subtitle ? `<div class="t2">${escapeHtml(link.subtitle)}</div>` : '';
    return `
      <a href="${escapeHtml(withUtm(link.url))}" target="_blank" rel="noopener" class="biz-link${styleClass}">
        <div class="ico-wrap"><i class="bi ${iconClass(link.icon || link.style)}"></i></div>
        <div>
          <div class="t1">${escapeHtml(link.label)} ${popular}</div>
          ${subtitle}
        </div>
        <div class="arr">›</div>
      </a>
    `;
  }

  function renderService(s) {
    const desc = s.desc ? `<div class="desc">${escapeHtml(s.desc)}</div>` : '';
    const price = s.price ? `<div class="price">${escapeHtml(s.price)}</div>` : '';
    const thumb = s.img ? `<img class="service-thumb" src="${escapeHtml(s.img)}" alt="" loading="lazy">` : '';
    return `
      <div class="biz-service">
        ${thumb}
        <div class="info">
          <div class="name">${escapeHtml(s.name)}</div>
          ${desc}
        </div>
        ${price}
      </div>
    `;
  }

  function renderHours(hours, todayKey, S) {
    if (!hours) return '';
    const rows = DAY_ORDER.map((k) => {
      const range = hours[k];
      const parsed = parseHourRange(range);
      const isToday = k === todayKey ? ' today' : '';
      const display = parsed ? parsed.label : S.hourClosed;
      const closedCls = parsed ? '' : ' closed';
      return `<div class="row-h"><span class="day${isToday}">${escapeHtml(S.days[k])}</span><span class="hour${closedCls}">${escapeHtml(display)}</span></div>`;
    }).join('');
    return `<div class="biz-hours">${rows}</div>`;
  }

  function renderGallery(items) {
    if (!items || !items.length) return '';
    return items.slice(0, 9).map((src) => {
      if (src) {
        return `<div class="cell"><img src="${escapeHtml(src)}" alt="" loading="lazy"></div>`;
      }
      return '<div class="cell"><i class="bi bi-image"></i></div>';
    }).join('');
  }

  function render(data) {
    app.dataset.state = 'ready';

    const theme = data.theme || 'dark-gold';
    document.body.setAttribute('data-theme', theme);

    const title = `${data.business?.name || 'Tarjeta digital'} · Mi Tarjeta Pro`;
    document.title = title;

    const S = CARD_I18N[cardLang(data)];
    const status = data.status?.hours ? computeStatus(data.status.hours, S) : null;
    const todayKey = mexicoNowParts().dayKey;

    const showRating = typeof data.business?.rating === 'number';
    const showEst = !!data.business?.established;

    const statusHtml = status
      ? `<span><span class="dot ${status.open ? 'open' : 'closed'}"></span>${escapeHtml(status.text)}</span>`
      : '';
    const sepIfMore = (statusHtml && (showRating || showEst)) ? '<span class="sep"></span>' : '';
    const ratingHtml = showRating ? `<span><i class="bi bi-star-fill"></i>${data.business.rating.toFixed(1)}</span>` : '';
    const sepRatingEst = (showRating && showEst) ? '<span class="sep"></span>' : '';
    const estHtml = showEst ? `<span><i class="bi bi-calendar-check"></i>Est. ${escapeHtml(String(data.business.established))}</span>` : '';

    const logoHtml = data.business?.logoUrl
      ? `<img src="${escapeHtml(data.business.logoUrl)}" alt="${escapeHtml(data.business?.name || 'Logo')}">`
      : (function () {
        const initials = (data.business?.name || 'MN').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" aria-hidden="true">
            <text x="50" y="62" text-anchor="middle" font-family="Cormorant Garamond, serif" font-size="38" font-weight="700" fill="currentColor">${escapeHtml(initials)}</text>
          </svg>`;
      })();

    const primary = data.primaryCta;
    const primaryHtml = primary?.url
      ? `<a href="${escapeHtml(withUtm(primary.url))}" target="_blank" rel="noopener" class="biz-cta-primary">
           <div class="row-cta">
             <div class="ico"><i class="bi ${iconClass(primary.icon)}"></i></div>
             <div>
               <div class="t1 serif">${escapeHtml((primary.label || 'AGENDAR').toUpperCase())}</div>
               ${primary.subtitle ? `<div class="t2">${escapeHtml(primary.subtitle)}</div>` : ''}
             </div>
             <div class="arr">→</div>
           </div>
         </a>`
      : '';

    const vcardBtn = `<button type="button" class="biz-vcard-btn" id="bizVcardBtn" aria-label="${escapeHtml(S.vcardBtn)}">
      <span class="biz-vcard-ico" aria-hidden="true">📇</span>
      <span>${escapeHtml(S.vcardBtn)}</span>
    </button>`;

    const linksHtml = (data.links || []).map(renderLink).join('');

    const servicesLayout = data.servicesLayout === 'menu' ? 'menu' : 'list';
    const servicesBlock = (data.services && data.services.length)
      ? `
        <div class="biz-section-title">
          <div class="line"></div>
          <h2>${escapeHtml(data.servicesTitle || 'SERVICIOS Y PRECIOS')}</h2>
          <div class="line"></div>
        </div>
        <div class="biz-services layout-${servicesLayout}">
          ${data.services.map(renderService).join('')}
        </div>
        ${data.servicesDisclaimer ? `<div class="biz-disclaimer">${escapeHtml(data.servicesDisclaimer)}</div>` : ''}
      `
      : '';

    const galleryLayout = data.galleryLayout === 'feed' ? 'feed' : 'grid';
    const galleryItems = renderGallery(data.gallery);
    const galleryBlock = galleryItems
      ? `
        <div class="biz-section-title">
          <div class="line"></div>
          <h2>${escapeHtml(S.gallery)}</h2>
          <div class="line"></div>
        </div>
        <div class="biz-gallery layout-${galleryLayout}">${galleryItems}</div>
      `
      : '';

    const brandBlock = data.brandCardCopy
      ? `
        <div class="biz-brand-card">
          <div class="mini-logo">${logoHtml}</div>
          <div>
            <div class="t1">${escapeHtml(data.business?.name || '')}</div>
            <div class="t2">${escapeHtml(data.brandCardCopy)}</div>
          </div>
        </div>
        <div class="biz-symbol"><i class="bi bi-stars"></i></div>
      `
      : '';

    const hoursBlock = data.status?.hours
      ? `
        <div class="biz-section-title">
          <div class="line"></div>
          <h2>${escapeHtml(S.hours)}</h2>
          <div class="line"></div>
        </div>
        ${renderHours(data.status.hours, todayKey, S)}
      `
      : '';

    const heroBgUrl = data.business?.heroBackgroundUrl;
    const heroClass = heroBgUrl ? ' biz-hero--photo' : '';
    const heroStyle = heroBgUrl ? ` style="--hero-bg-image:url('${escapeHtml(safeCssUrl(heroBgUrl))}')"` : '';

    app.innerHTML = `
      <div class="biz-wrap">
        <section class="biz-hero${heroClass}"${heroStyle}>
          <div class="biz-logo">${logoHtml}</div>
          <h1 class="biz-name serif">${escapeHtml(data.business?.name || '')}</h1>
          ${data.business?.subname ? `<div class="biz-sub serif">${escapeHtml(data.business.subname)} ${data.business.verified ? '<span class="biz-verified">✓</span>' : ''}</div>` : ''}
          ${data.business?.tagline ? `<p class="biz-tag">${escapeHtml(data.business.tagline)}</p>` : ''}
          ${(statusHtml || ratingHtml || estHtml)
        ? `<div class="biz-status">${statusHtml}${sepIfMore}${ratingHtml}${sepRatingEst}${estHtml}</div>`
        : ''}
        </section>

        ${primaryHtml}
        ${vcardBtn}
        ${linksHtml}
        ${servicesBlock}
        ${galleryBlock}
        ${brandBlock}
        ${hoursBlock}

        ${data.copyright ? `<div class="biz-copy">${escapeHtml(data.copyright)}</div>` : ''}

        <a class="gaban-credit" href="../index.html">
          <i class="bi bi-stars"></i>
          <span>${escapeHtml(S.designed)} <strong>mimarca</strong></span>
        </a>
      </div>
    `;

    const vbtn = document.getElementById('bizVcardBtn');
    if (vbtn) {
      vbtn.addEventListener('click', () => triggerVcardDownload(data));
    }
  }

  // ---------- links autoeditados por el cliente (mi-cuenta) ----------
  // Best-effort y en paralelo con el fetch de datos de abajo: si el
  // cliente ya editó sus links desde mi-cuenta, esto pisa los del JSON
  // estático. Si falla o no hay override, se usan los del JSON tal cual —
  // el sitio sigue siendo estático de verdad, esto es puro extra.
  function portalApiBase() {
    const meta = document.querySelector('meta[name="mitp-portal-api"]');
    const url = meta && meta.getAttribute('content') && meta.getAttribute('content').trim();
    if (!url || url.indexOf('REPLACE') !== -1) return null;
    return url.replace(/\/$/, '');
  }

  function fetchLinksOverride(forSlug) {
    const apiBase = portalApiBase();
    if (!apiBase) return Promise.resolve(null);
    return fetch(`${apiBase}/card-links/${encodeURIComponent(forSlug)}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => (body && Array.isArray(body.links) ? body.links : null))
      .catch(() => null);
  }

  // ---------- bootstrap ----------
  if (window.MTP_PREVIEW_DATA) {
    render(window.MTP_PREVIEW_DATA);
    return;
  }

  if (!slug) {
    renderBizError('missing');
    return;
  }

  Promise.all([
    fetch(`/negocio/_data/${slug}.json`, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) {
          const err = new Error('http');
          err.status = r.status;
          throw err;
        }
        return r.text();
      })
      .then((text) => {
        try {
          return JSON.parse(text);
        } catch {
          throw new Error('parse');
        }
      }),
    fetchLinksOverride(slug),
  ])
    .then(([data, linksOverride]) => {
      render(linksOverride ? { ...data, links: linksOverride } : data);
    })
    .catch((err) => {
      if (err && err.message === 'parse') renderBizError('malformed');
      else if (err && err.name === 'TypeError') renderBizError('offline');
      else if (err && err.status === 404) renderBizError('missing');
      else if (err && err.message === 'http') renderBizError('malformed');
      else renderBizError('offline');
    });
})();

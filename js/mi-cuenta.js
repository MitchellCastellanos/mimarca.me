// ============================================================
// Mi Tarjeta Pro · Panel cliente (token-gated, sin backend)
// URL: /mi-cuenta/?token=<token>&n=<slug>
// ============================================================

(function () {
  const app = document.getElementById('mcApp');
  if (!app) return;

  const params = new URLSearchParams(window.location.search);
  const slug = (params.get('n') || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const token = (params.get('token') || '').trim();

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pickNumericStats(obj) {
    if (obj == null) return null;
    if (typeof obj.pageviews === 'number') return obj.pageviews;
    if (obj.pageviews && typeof obj.pageviews.value === 'number') return obj.pageviews.value;
    if (typeof obj.total === 'number') return obj.total;
    if (obj.stats) return pickNumericStats(obj.stats);
    return null;
  }

  async function loadVisitStats(slug) {
    const meta = document.querySelector('meta[name="mitp-umami-share-url"]');
    const baseUrl = meta && meta.getAttribute('content') && meta.getAttribute('content').trim();
    if (!baseUrl || baseUrl.indexOf('REPLACE') !== -1) return null;
    const u = baseUrl.indexOf('{slug}') !== -1
      ? baseUrl.split('{slug}').join(encodeURIComponent(slug))
      : baseUrl;
    try {
      const r = await fetch(u, { credentials: 'omit', cache: 'no-cache' });
      if (!r.ok) return null;
      const j = await r.json();
      return pickNumericStats(j);
    } catch {
      return null;
    }
  }

  function renderLocked(message) {
    app.innerHTML = `
      <div class="mc-locked">
        <div>
          <div class="display-1 mb-3">🔒</div>
          <h1 class="h4 fw-bold">${escapeHtml(message || 'Token inválido')}</h1>
          <p class="text-muted">Si crees que es un error, contáctanos.</p>
          <a href="../contact.html" class="btn btn-dark">Contactar a GABAN</a>
        </div>
      </div>
    `;
  }

  function qrServerUrl(target, px, margin, format) {
    const fmt = format === 'svg' ? '&format=svg' : '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=${margin}&ecc=H&color=111111&bgcolor=FFFFFF${fmt}&data=${encodeURIComponent(target)}`;
  }

  function renderDashboard(data) {
    const publicUrl = `${window.location.origin}/negocio/?n=${encodeURIComponent(data.slug)}`;
    const qrUrl = qrServerUrl(publicUrl, 440, 6);
    const qrDownloadPng = qrServerUrl(publicUrl, 2000, 24);
    const qrDownloadSvg = qrServerUrl(publicUrl, 2000, 24, 'svg');
    const changeUrl = data.changeRequestUrl || '../contact.html';
    const logoUrl = (data.business && data.business.logoUrl) ? escapeHtml(data.business.logoUrl) : '';
    const logoLayerClass = logoUrl ? 'mt-qr-center-logo' : 'mt-qr-center-logo d-none';

    app.innerHTML = `
      <header class="hero hero-mt bg-dark text-white py-5">
        <div class="container">
          <div class="d-flex align-items-center gap-2 mb-2">
            <span class="badge text-bg-warning fw-semibold">Mi Tarjeta Pro</span>
            <span class="badge text-bg-success">En vivo</span>
          </div>
          <h1 class="display-6 fw-bold mb-1">Hola, ${escapeHtml(data.business?.name || 'tu negocio')}</h1>
          <p class="text-white-50 mb-0">Tu tarjeta digital está activa. Aquí puedes ver tu link, descargar tu QR y pedir cambios.</p>
        </div>
      </header>

      <section class="section">
        <div class="container">
          <div class="row g-4">

            <div class="col-lg-5 text-center">
              <div class="mc-preview mx-auto">
                <iframe src="../negocio/?n=${encodeURIComponent(data.slug)}" title="Preview de tu tarjeta"></iframe>
              </div>
              <a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener" class="btn btn-outline-dark mt-3">
                <i class="bi bi-box-arrow-up-right me-1"></i> Abrir en nueva pestaña
              </a>
            </div>

            <div class="col-lg-7">
              <div class="row g-3">

                <div class="col-md-12">
                  <div class="card mc-card border-0 shadow-sm">
                    <div class="card-body p-4">
                      <h2 class="h6 fw-bold text-uppercase mb-3"><i class="bi bi-link-45deg me-1"></i>Tu link público</h2>
                      <div class="input-group">
                        <input id="mcLinkInput" type="text" class="form-control" readonly value="${escapeHtml(publicUrl)}">
                        <button id="mcCopyBtn" class="btn btn-dark" type="button"><i class="bi bi-clipboard me-1"></i>Copiar</button>
                      </div>
                      <div class="d-flex flex-wrap gap-2 mt-3">
                        <button id="mcWaShareBtn" type="button" class="btn btn-success">
                          <i class="bi bi-whatsapp me-1"></i> Compartir link por WhatsApp
                        </button>
                      </div>
                      <div class="form-text small mt-2">Comparte este link en bio de Instagram, WhatsApp Business, recibos, etc.</div>
                    </div>
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="card mc-card border-0 shadow-sm h-100">
                    <div class="card-body p-4 text-center">
                      <h2 class="h6 fw-bold text-uppercase mb-3"><i class="bi bi-qr-code me-1"></i>Tu QR</h2>
                      <div class="mc-qr-box">
                        <div class="mt-qr-logo-wrap" style="--mt-qr-display:200px">
                          <img id="mcQrBase" class="mt-qr-base" src="${qrUrl}" alt="QR de tu tarjeta digital">
                          <img id="mcQrLogoLayer" class="${logoLayerClass}" src="${logoUrl}" alt="" aria-hidden="true" width="1" height="1">
                        </div>
                      </div>
                      <div class="mt-3 d-flex flex-column gap-2">
                        <a href="${qrDownloadPng}" download="qr-${escapeHtml(data.slug)}.png" class="btn btn-dark btn-sm">
                          <i class="bi bi-download me-1"></i> Descargar PNG (2000 px)
                        </a>
                        <a href="${qrDownloadSvg}" download="qr-${escapeHtml(data.slug)}.svg" class="btn btn-outline-dark btn-sm">
                          <i class="bi bi-vector-pen me-1"></i> Descargar SVG (imprenta)
                        </a>
                        <a href="${qrDownloadPng}" target="_blank" rel="noopener" class="btn btn-outline-secondary btn-sm">
                          <i class="bi bi-printer me-1"></i> Abrir PNG en pestaña
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="card mc-card border-0 shadow-sm h-100" style="background:linear-gradient(135deg,#fff8e1 0%,#fff 100%);border:1px solid #f0d98a !important;">
                    <div class="card-body p-4">
                      <h2 class="h6 fw-bold text-uppercase mb-2"><i class="bi bi-pencil-square me-1"></i>Pedir cambios</h2>
                      <p class="small text-muted mb-3">Cambios chiquitos (texto, links, colores de la paleta) por solo <strong>$25 MXN</strong> por orden. <a href="../index.html#politica">Ver qué entra</a>.</p>
                      <a href="${escapeHtml(changeUrl)}" target="_blank" rel="noopener" class="btn btn-warning w-100 mb-2">
                        <i class="bi bi-credit-card me-1"></i> Pagar $25 MXN
                      </a>
                      <a href="https://wa.me/15142580648?text=Hola%2C%20quiero%20pedir%20cambios%20en%20${encodeURIComponent(data.slug)}" target="_blank" rel="noopener" class="btn btn-outline-dark w-100 btn-sm">
                        <i class="bi bi-whatsapp me-1"></i> Mandar lista por WhatsApp
                      </a>
                    </div>
                  </div>
                </div>

                <div class="col-md-12">
                  <div class="card mc-card border-0 shadow-sm">
                    <div class="card-body p-4">
                      <h2 class="h6 fw-bold text-uppercase mb-2"><i class="bi bi-graph-up-arrow me-1"></i>Estadísticas</h2>
                      <p class="small text-muted mb-2">Visitas a tu tarjeta (Umami). Configura <code>mitp-umami-share-url</code> en esta página y el tracker en <code>negocio/index.html</code> — ver <a href="../AUTOMATION.md">AUTOMATION.md</a>.</p>
                      <div class="d-flex align-items-baseline gap-2 flex-wrap">
                        <span class="display-6 fw-bold mb-0" id="mcStatsValue">—</span>
                        <span class="text-muted small">visitas (total sitio o ruta según tu enlace compartido)</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>

          <div class="text-center mt-5">
            <div class="text-muted small">¿Algo raro o necesitas ayuda?</div>
            <a href="https://wa.me/15142580648" target="_blank" rel="noopener" class="btn btn-outline-dark mt-2">
              <i class="bi bi-whatsapp me-1"></i> Soporte WhatsApp
            </a>
          </div>
        </div>
      </section>
    `;

    const btn = document.getElementById('mcCopyBtn');
    const input = document.getElementById('mcLinkInput');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>¡Copiado!';
      btn.classList.add('copy-btn-flash');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copy-btn-flash'); }, 1500);
    });

    const waShare = document.getElementById('mcWaShareBtn');
    if (waShare) {
      waShare.addEventListener('click', () => {
        const name = data.business?.name || 'nuestro negocio';
        const text = `Conoce ${name}: ${publicUrl}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      });
    }

    loadVisitStats(data.slug).then((n) => {
      const el = document.getElementById('mcStatsValue');
      if (!el) return;
      if (n == null || Number.isNaN(n)) {
        el.textContent = '—';
      } else {
        el.textContent = String(n);
      }
    });
  }

  if (!slug || !token) {
    renderLocked('Falta token o tarjeta en el link');
    return;
  }

  fetch(`../negocio/_data/${slug}.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('not found');
      return r.json();
    })
    .then((data) => {
      if (!data.ownerToken || data.ownerToken !== token) {
        renderLocked('Token inválido');
        return;
      }
      renderDashboard(data);
    })
    .catch(() => renderLocked('Esta tarjeta no existe'));
})();

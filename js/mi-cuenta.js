// ============================================================
// Mi Tarjeta Pro · Panel por tarjeta
// URL preferida: /mi-cuenta/?n=<slug>  (con sesión de cuenta en
// localStorage, desde el Dashboard). El ?token=<ownerToken> del
// magic link sigue funcionando como fallback.
// ============================================================

(function () {
  const app = document.getElementById('mcApp');
  if (!app) return;

  const SESSION_KEY = 'mitp_account_session';
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get('n') || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const token = (params.get('token') || '').trim();

  function getAccountSession() {
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; }
  }

  const accountSession = getAccountSession();

  /** Credenciales para el Worker: ownerToken y/o sesión de cuenta. */
  function authFields() {
    const out = {};
    if (token) out.token = token;
    if (accountSession) out.sessionToken = accountSession;
    return out;
  }

  function hasAuth() {
    return !!(token || accountSession);
  }

  const ORDER_STAGES = [
    { key: 'paid', label: 'Pago confirmado', icon: 'bi-credit-card' },
    { key: 'designing', label: 'En diseño', icon: 'bi-palette' },
    { key: 'review', label: 'Tu revisión', icon: 'bi-eye' },
    { key: 'published', label: 'Publicada', icon: 'bi-rocket-takeoff' },
  ];

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function portalApiBase() {
    const meta = document.querySelector('meta[name="mitp-portal-api"]');
    const url = meta && meta.getAttribute('content') && meta.getAttribute('content').trim();
    if (!url || url.indexOf('REPLACE') !== -1) return null;
    return url.replace(/\/$/, '');
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

  // ---------- sin sesión: manda a Mi cuenta o magic link ----------
  function renderAccessRequest(opts) {
    const message = (opts && opts.message) || '';
    const prefillSlug = (opts && opts.slug) || '';
    const apiBase = portalApiBase();

    app.innerHTML = `
      <div class="mc-locked">
        <div style="max-width:420px;width:100%;">
          <div class="display-1 mb-3">👤</div>
          <h1 class="h4 fw-bold mb-2">Entra a tu panel</h1>
          <p class="text-muted mb-4">${message ? escapeHtml(message) + ' ' : ''}Inicia sesión en <strong>Mi cuenta</strong> y abre el panel desde tus pedidos. No necesitas un link con token.</p>

          <a href="./cuenta.html" class="btn btn-dark w-100 mb-3">
            <i class="bi bi-box-arrow-in-right me-1"></i> Ir a Mi cuenta
          </a>

          <details class="text-start mb-3">
            <summary class="small text-muted" style="cursor:pointer;">¿Prefieres el acceso por correo?</summary>
            <form id="mcAccessForm" class="mt-3">
              <div class="mb-2">
                <label class="form-label small fw-semibold" for="mcAccessSlug">Tu link (mimarca.me/<strong>tu-marca</strong>)</label>
                <div class="input-group">
                  <span class="input-group-text">mimarca.me/</span>
                  <input id="mcAccessSlug" type="text" class="form-control" placeholder="tu-marca" value="${escapeHtml(prefillSlug)}" required>
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label small fw-semibold" for="mcAccessEmail">Tu correo</label>
                <input id="mcAccessEmail" type="email" class="form-control" placeholder="tucorreo@ejemplo.com" required>
              </div>
              <button type="submit" class="btn btn-outline-dark w-100" id="mcAccessSubmit" ${apiBase ? '' : 'disabled'}>
                <i class="bi bi-envelope me-1"></i> Enviarme mi acceso
              </button>
              <div id="mcAccessNote" class="form-text small mt-2"></div>
            </form>
          </details>

          <a href="../contact.html" class="btn btn-link btn-sm">Contactar soporte</a>
        </div>
      </div>
    `;

    const form = document.getElementById('mcAccessForm');
    if (!form) return;
    const note = document.getElementById('mcAccessNote');
    const submitBtn = document.getElementById('mcAccessSubmit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = document.getElementById('mcAccessSlug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      const email = document.getElementById('mcAccessEmail').value.trim();
      if (!s || !email) return;
      if (!apiBase) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = 'El envío automático no está disponible. Usa Mi cuenta o escríbenos por WhatsApp.';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enviando…';
      try {
        await fetch(`${apiBase}/access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: s, email }),
        });
        note.className = 'form-text small mt-2 text-success';
        note.textContent = 'Si ese correo está registrado, te mandamos el acceso en unos segundos. Revisa spam.';
      } catch {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = 'No se pudo enviar. Intenta de nuevo o entra por Mi cuenta.';
      }
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="bi bi-envelope me-1"></i> Enviarme mi acceso';
    });
  }

  function renderLocked(message) {
    app.innerHTML = `
      <div class="mc-locked">
        <div>
          <div class="display-1 mb-3">🔒</div>
          <h1 class="h4 fw-bold">${escapeHtml(message || 'Sin acceso')}</h1>
          <p class="text-muted">Inicia sesión en Mi cuenta o pide el acceso por correo.</p>
          <div class="d-flex gap-2 justify-content-center flex-wrap">
            <a href="./cuenta.html" class="btn btn-dark">Ir a Mi cuenta</a>
            <button type="button" id="mcRetryAccess" class="btn btn-outline-dark">Pedir acceso por correo</button>
          </div>
        </div>
      </div>
    `;
    const retry = document.getElementById('mcRetryAccess');
    if (retry) {
      retry.addEventListener('click', () => renderAccessRequest({ slug }));
    }
  }

  function qrServerUrl(target, px, margin, format) {
    const fmt = format === 'svg' ? '&format=svg' : '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=${margin}&ecc=H&color=111111&bgcolor=FFFFFF${fmt}&data=${encodeURIComponent(target)}`;
  }

  // ---------- estatus de la orden ----------
  function stageStepperHtml(currentStage) {
    const idx = ORDER_STAGES.findIndex((s) => s.key === currentStage);
    if (idx === -1) return '';
    return `
      <div class="card mc-card border-0 shadow-sm">
        <div class="card-body p-4">
          <h2 class="h6 fw-bold text-uppercase mb-3"><i class="bi bi-signpost-split me-1"></i>Estatus de tu pedido</h2>
          <div class="mc-stepper">
            ${ORDER_STAGES.map((s, i) => {
              const state = i < idx ? 'done' : (i === idx ? 'active' : 'pending');
              return `
                <div class="mc-step mc-step--${state}">
                  <div class="mc-step-dot"><i class="bi ${i < idx ? 'bi-check-lg' : s.icon}"></i></div>
                  <div class="mc-step-label">${escapeHtml(s.label)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ---------- aprobar diseño / pedir ajuste (solo en 'review') ----------
  function reviewBlockHtml(data) {
    if (data.orderStage !== 'review') return '';
    const name = escapeHtml(data.business?.name || 'mi negocio');
    const waAdjust = `https://wa.me/15142580648?text=${encodeURIComponent(`Hola, vi el diseño de ${data.business?.name || 'mi tarjeta'} y quiero pedir un ajuste antes de publicarla: `)}`;
    return `
      <div class="col-md-12">
        <div class="card mc-card border-0 shadow-sm" style="border:1px solid #d4b86a !important;">
          <div class="card-body p-4">
            <h2 class="h6 fw-bold text-uppercase mb-2"><i class="bi bi-stars me-1"></i>Tu diseño está listo para revisión</h2>
            <p class="small text-muted mb-3">Revisa la vista previa de arriba. Si te encanta, apruébalo y lo publicamos. Si algo no cuadra, mándanos el ajuste antes de que salga en vivo — es gratis mientras siga en revisión.</p>
            <div class="d-flex flex-wrap gap-2">
              <button type="button" id="mcApproveBtn" class="btn btn-success">
                <i class="bi bi-hand-thumbs-up me-1"></i> Me encanta, publíquenla
              </button>
              <a href="${waAdjust}" target="_blank" rel="noopener" class="btn btn-outline-dark">
                <i class="bi bi-pencil me-1"></i> Pedir un ajuste
              </a>
            </div>
            <div id="mcApproveNote" class="form-text small mt-2"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- tus links (autoedición dentro del cupo de tu tier) ----------
  const PACKAGE_LABELS = { lanzamiento: 'Lanzamiento', personalizado: 'Personalizado', premium: 'Premium' };

  function linksEditorBlockHtml(data) {
    if (data.orderStage !== 'published') return '';
    return `
      <div class="col-md-12">
        <div class="card mc-card border-0 shadow-sm">
          <div class="card-body p-4">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
              <h2 class="h6 fw-bold text-uppercase mb-0"><i class="bi bi-link-45deg me-1"></i>Tus links</h2>
              <span class="badge text-bg-light border" id="mcLinksCounter"></span>
            </div>
            <p class="small text-muted mb-3">Edita, agrega o quita los links de tu tarjeta cuando quieras — gratis y al instante, sin esperar a nuestro equipo, hasta el cupo de tu paquete.</p>
            <div id="mcLinksRows"></div>
            <div class="d-flex flex-wrap gap-2 mt-2">
              <button type="button" id="mcLinksAddBtn" class="btn btn-outline-dark btn-sm"><i class="bi bi-plus-lg me-1"></i> Agregar link</button>
              <button type="button" id="mcLinksSaveBtn" class="btn btn-dark btn-sm"><i class="bi bi-check-lg me-1"></i> Guardar cambios</button>
            </div>
            <div id="mcLinksNote" class="form-text small mt-2"></div>
          </div>
        </div>
      </div>
    `;
  }

  function servicesEditorBlockHtml(data) {
    if (data.orderStage !== 'published') return '';
    if (!data.canEditServices && !(Array.isArray(data.services) && data.services.length)) return '';
    const quota = Number(data.servicesQuota) || 0;
    if (quota <= 0 && !(data.services && data.services.length)) return '';
    return `
      <div class="col-md-12">
        <div class="card mc-card border-0 shadow-sm">
          <div class="card-body p-4">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
              <h2 class="h6 fw-bold text-uppercase mb-0"><i class="bi bi-cash-coin me-1"></i>Tus precios</h2>
              <span class="badge text-bg-light border" id="mcServicesCounter"></span>
            </div>
            <p class="small text-muted mb-3">Actualiza nombres, descripciones y precios de tu menú — se reflejan al instante en tu tarjeta.</p>
            <div id="mcServicesRows"></div>
            <div class="d-flex flex-wrap gap-2 mt-2">
              <button type="button" id="mcServicesAddBtn" class="btn btn-outline-dark btn-sm"><i class="bi bi-plus-lg me-1"></i> Agregar servicio</button>
              <button type="button" id="mcServicesSaveBtn" class="btn btn-dark btn-sm"><i class="bi bi-check-lg me-1"></i> Guardar precios</button>
            </div>
            <div id="mcServicesNote" class="form-text small mt-2"></div>
          </div>
        </div>
      </div>
    `;
  }

  function linksRowHtml(link, i) {
    return `
      <div class="row g-2 align-items-center mb-2 mc-links-row" data-idx="${i}">
        <div class="col-5">
          <input type="text" class="form-control form-control-sm mc-link-label" placeholder="Nombre (ej. Instagram)" value="${escapeHtml(link.label || '')}">
        </div>
        <div class="col-6">
          <input type="url" class="form-control form-control-sm mc-link-url" placeholder="https://..." value="${escapeHtml(link.url || '')}">
        </div>
        <div class="col-1 text-end">
          <button type="button" class="btn btn-outline-danger btn-sm mc-link-remove" title="Quitar"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `;
  }

  function wireLinksEditor(data) {
    const linksRowsEl = document.getElementById('mcLinksRows');
    if (!linksRowsEl) return;

    let linksState = (Array.isArray(data.links) ? data.links : []).map((l) => ({ ...l }));
    const quota = Number(data.linksQuota) || Math.max(linksState.length, 1);
    const counterEl = document.getElementById('mcLinksCounter');
    const addBtn = document.getElementById('mcLinksAddBtn');
    const saveBtn = document.getElementById('mcLinksSaveBtn');
    const note = document.getElementById('mcLinksNote');

    function renderRows() {
      linksRowsEl.innerHTML = linksState.length
        ? linksState.map(linksRowHtml).join('')
        : '<p class="small text-muted fst-italic mb-2">Todavía no tienes links — agrega el primero.</p>';
      counterEl.textContent = `${linksState.length}/${quota} usados`;
      counterEl.className = linksState.length >= quota ? 'badge text-bg-warning' : 'badge text-bg-light border';

      linksRowsEl.querySelectorAll('.mc-links-row').forEach((row) => {
        const idx = Number(row.dataset.idx);
        row.querySelector('.mc-link-label').addEventListener('input', (e) => { linksState[idx].label = e.target.value; });
        row.querySelector('.mc-link-url').addEventListener('input', (e) => { linksState[idx].url = e.target.value; });
        row.querySelector('.mc-link-remove').addEventListener('click', () => {
          linksState.splice(idx, 1);
          renderRows();
        });
      });
    }
    renderRows();

    addBtn.addEventListener('click', () => {
      if (linksState.length >= quota) {
        const pkgLabel = PACKAGE_LABELS[data.package] || 'tu paquete actual';
        const waText = encodeURIComponent(`Hola, ya usé mis ${quota} links de ${data.slug} y quiero subir de paquete para tener más.`);
        note.className = 'form-text small mt-2 text-warning';
        note.innerHTML = `Ya usaste los ${quota} links incluidos en <strong>${escapeHtml(pkgLabel)}</strong>. Para agregar más, <a href="https://wa.me/15142580648?text=${waText}" target="_blank" rel="noopener">sube de paquete</a>.`;
        return;
      }
      linksState.push({ label: '', url: '', subtitle: '', icon: 'link-45deg', style: '' });
      note.textContent = '';
      renderRows();
    });

    saveBtn.addEventListener('click', async () => {
      const cleaned = linksState.map((l) => ({ ...l, label: (l.label || '').trim(), url: (l.url || '').trim() }));
      if (cleaned.some((l) => !l.label || !l.url)) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = 'Cada link necesita un nombre y una URL.';
        return;
      }

      const apiBase = portalApiBase();
      if (!apiBase) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = 'El guardado automático no está disponible todavía. Escríbenos por WhatsApp mientras tanto.';
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando…';
      note.className = 'form-text small mt-2';
      note.textContent = '';

      try {
        const res = await fetch(`${apiBase}/card-links/${encodeURIComponent(data.slug)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...authFields(), links: cleaned }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'no se pudo guardar');
        linksState = body.links || cleaned;
        renderRows();
        note.className = 'form-text small mt-2 text-success';
        note.textContent = '¡Listo! Tu tarjeta ya muestra los links actualizados.';
      } catch (err) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = err.message && err.message !== 'no se pudo guardar' ? err.message : 'No se pudo guardar. Intenta de nuevo.';
      }
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Guardar cambios';
    });
  }

  function servicesRowHtml(svc, i) {
    const priceVal = svc.price == null || svc.price === '' ? '' : String(svc.price).replace(/[^0-9.]/g, '');
    const desc = svc.description || svc.desc || '';
    return `
      <div class="border rounded p-2 mb-2 mc-services-row" data-idx="${i}">
        <div class="row g-2 align-items-center">
          <div class="col-md-5">
            <input type="text" class="form-control form-control-sm mc-svc-name" placeholder="Servicio" value="${escapeHtml(svc.name || '')}">
          </div>
          <div class="col-md-3">
            <div class="input-group input-group-sm">
              <span class="input-group-text">$</span>
              <input type="number" min="0" step="1" class="form-control mc-svc-price" placeholder="0" value="${escapeHtml(priceVal)}">
            </div>
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm mc-svc-desc" placeholder="Descripción (opcional)" value="${escapeHtml(desc)}">
          </div>
          <div class="col-md-1 text-end">
            <button type="button" class="btn btn-outline-danger btn-sm mc-svc-remove" title="Quitar"><i class="bi bi-trash"></i></button>
          </div>
        </div>
      </div>
    `;
  }

  function wireServicesEditor(data) {
    const rowsEl = document.getElementById('mcServicesRows');
    if (!rowsEl) return;

    let servicesState = (Array.isArray(data.services) ? data.services : []).map((s, i) => ({
      id: s.id || `svc-${i + 1}`,
      name: s.name || '',
      description: s.description || s.desc || '',
      price: s.price,
      note: s.note || '',
      order: s.order != null ? s.order : i,
      active: s.active !== false,
    }));
    const quota = Number(data.servicesQuota) || Math.max(servicesState.length, 8);
    const counterEl = document.getElementById('mcServicesCounter');
    const addBtn = document.getElementById('mcServicesAddBtn');
    const saveBtn = document.getElementById('mcServicesSaveBtn');
    const note = document.getElementById('mcServicesNote');

    function renderRows() {
      rowsEl.innerHTML = servicesState.length
        ? servicesState.map(servicesRowHtml).join('')
        : '<p class="small text-muted fst-italic mb-2">Todavía no tienes servicios — agrega el primero.</p>';
      if (counterEl) {
        counterEl.textContent = `${servicesState.length}/${quota} usados`;
        counterEl.className = servicesState.length >= quota ? 'badge text-bg-warning' : 'badge text-bg-light border';
      }

      rowsEl.querySelectorAll('.mc-services-row').forEach((row) => {
        const idx = Number(row.dataset.idx);
        row.querySelector('.mc-svc-name').addEventListener('input', (e) => { servicesState[idx].name = e.target.value; });
        row.querySelector('.mc-svc-price').addEventListener('input', (e) => {
          const v = e.target.value;
          servicesState[idx].price = v === '' ? null : Number(v);
        });
        row.querySelector('.mc-svc-desc').addEventListener('input', (e) => { servicesState[idx].description = e.target.value; });
        row.querySelector('.mc-svc-remove').addEventListener('click', () => {
          servicesState.splice(idx, 1);
          renderRows();
        });
      });
    }
    renderRows();

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (servicesState.length >= quota) {
          const pkgLabel = PACKAGE_LABELS[data.package] || 'tu paquete actual';
          const waText = encodeURIComponent(`Hola, ya usé mis ${quota} servicios de ${data.slug} y quiero subir de paquete.`);
          note.className = 'form-text small mt-2 text-warning';
          note.innerHTML = `Ya usaste los ${quota} servicios de <strong>${escapeHtml(pkgLabel)}</strong>. Para agregar más, <a href="https://wa.me/15142580648?text=${waText}" target="_blank" rel="noopener">sube de paquete</a>.`;
          return;
        }
        servicesState.push({
          id: `svc-${Date.now()}`,
          name: '',
          description: '',
          price: null,
          note: '',
          order: servicesState.length,
          active: true,
        });
        note.textContent = '';
        renderRows();
      });
    }

    if (!saveBtn) return;
    saveBtn.addEventListener('click', async () => {
      const cleaned = servicesState.map((s, i) => ({
        ...s,
        name: (s.name || '').trim(),
        description: (s.description || '').trim(),
        order: i,
      }));
      if (cleaned.some((s) => !s.name)) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = 'Cada servicio necesita un nombre.';
        return;
      }

      const apiBase = portalApiBase();
      if (!apiBase) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = 'El guardado automático no está disponible todavía. Escríbenos por WhatsApp mientras tanto.';
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando…';
      note.className = 'form-text small mt-2';
      note.textContent = '';

      try {
        const res = await fetch(`${apiBase}/card-services/${encodeURIComponent(data.slug)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...authFields(), services: cleaned }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'no se pudo guardar');
        servicesState = body.services || cleaned;
        renderRows();
        note.className = 'form-text small mt-2 text-success';
        note.textContent = '¡Listo! Tu tarjeta ya muestra los precios actualizados.';
      } catch (err) {
        note.className = 'form-text small mt-2 text-danger';
        note.textContent = err.message && err.message !== 'no se pudo guardar' ? err.message : 'No se pudo guardar. Intenta de nuevo.';
      }
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Guardar precios';
    });
  }

  // ---------- referidos ----------
  function referralBlockHtml(data, refUrl) {
    const code = data.referralCode ? String(data.referralCode) : '';
    const codeLine = code
      ? `<p class="small mb-2">Tu código: <strong>${escapeHtml(code)}</strong></p>`
      : '';
    return `
      <div class="col-md-12">
        <div class="card mc-card border-0 shadow-sm">
          <div class="card-body p-4">
            <h2 class="h6 fw-bold text-uppercase mb-2"><i class="bi bi-gift me-1"></i>Comparte y gana</h2>
            <p class="small text-muted mb-3">Comparte tu link. Cuando alguien compre con él, te avisamos por correo y te damos un cambio gratis en tu próxima orden.</p>
            ${codeLine}
            <div class="input-group mb-2">
              <input id="mcRefInput" type="text" class="form-control" readonly value="${escapeHtml(refUrl)}">
              <button id="mcRefCopyBtn" class="btn btn-dark" type="button"><i class="bi bi-clipboard me-1"></i>Copiar</button>
            </div>
            <button type="button" id="mcRefWaBtn" class="btn btn-success btn-sm">
              <i class="bi bi-whatsapp me-1"></i> Compartir con un negocio amigo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- subir logo / fotos ----------
  function uploadBlockHtml() {
    return `
      <div class="col-md-12">
        <div class="card mc-card border-0 shadow-sm">
          <div class="card-body p-4">
            <h2 class="h6 fw-bold text-uppercase mb-2"><i class="bi bi-cloud-arrow-up me-1"></i>Subir logo o fotos</h2>
            <p class="small text-muted mb-3">Sube tu logo o fotos para tu galería. Nuestro equipo las aplica a tu tarjeta en menos de 1 día hábil (esto no cuenta como cambio de pago).</p>
            <form id="mcUploadForm" class="d-flex flex-column flex-sm-row gap-2">
              <input type="file" id="mcUploadFile" class="form-control" accept="image/png,image/jpeg,image/webp,image/svg+xml" required>
              <button type="submit" class="btn btn-dark text-nowrap" id="mcUploadSubmit">
                <i class="bi bi-upload me-1"></i> Subir
              </button>
            </form>
            <div id="mcUploadNote" class="form-text small mt-2"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderDashboard(data) {
    const publicUrl = `${window.location.origin}/${encodeURIComponent(data.slug)}/`;
    const refCode = (data.referralCode || data.slug || '').toString().toUpperCase();
    const refUrl = `${window.location.origin}/?ref=${encodeURIComponent(refCode)}`;
    const qrUrl = qrServerUrl(publicUrl, 440, 6);
    const qrDownloadPng = qrServerUrl(publicUrl, 2000, 24);
    const qrDownloadSvg = qrServerUrl(publicUrl, 2000, 24, 'svg');
    const changeUrl = data.changeRequestUrl || '../contact.html';
    const logoUrl = (data.business && data.business.logoUrl) ? escapeHtml(data.business.logoUrl) : '';
    const logoLayerClass = logoUrl ? 'mt-qr-center-logo' : 'mt-qr-center-logo d-none';
    const stepper = stageStepperHtml(data.orderStage);

    app.innerHTML = `
      <header class="hero hero-mt bg-dark text-white py-5">
        <div class="container">
            <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
            <span class="badge text-bg-warning fw-semibold">Mi Tarjeta Pro</span>
            <span class="badge text-bg-success">En vivo</span>
            ${accountSession ? '<a href="./cuenta.html" class="btn btn-sm btn-outline-light ms-auto">← Mis pedidos</a>' : ''}
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
                <iframe src="../${encodeURIComponent(data.slug)}/" title="Preview de tu tarjeta"></iframe>
              </div>
              <a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener" class="btn btn-outline-dark mt-3">
                <i class="bi bi-box-arrow-up-right me-1"></i> Abrir en nueva pestaña
              </a>
            </div>

            <div class="col-lg-7">
              <div class="row g-3">

                ${stepper ? `<div class="col-md-12">${stepper}</div>` : ''}

                ${reviewBlockHtml(data)}

                ${linksEditorBlockHtml(data)}

                ${servicesEditorBlockHtml(data)}

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
                      <p class="small text-muted mb-3">Cambios de texto, colores o diseño por solo <strong>$25 MXN</strong> por orden. (Links y precios ya los editas gratis arriba.) <a href="../index.html#politica">Ver qué entra</a>.</p>
                      <a href="${escapeHtml(changeUrl)}" target="_blank" rel="noopener" class="btn btn-warning w-100 mb-2">
                        <i class="bi bi-credit-card me-1"></i> Pagar $25 MXN
                      </a>
                      <a href="https://wa.me/15142580648?text=Hola%2C%20quiero%20pedir%20cambios%20en%20${encodeURIComponent(data.slug)}" target="_blank" rel="noopener" class="btn btn-outline-dark w-100 btn-sm">
                        <i class="bi bi-whatsapp me-1"></i> Mandar lista por WhatsApp
                      </a>
                    </div>
                  </div>
                </div>

                ${uploadBlockHtml()}

                ${referralBlockHtml(data, refUrl)}

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

    wireDashboardEvents(data, { publicUrl, refUrl });
  }

  function wireDashboardEvents(data, { publicUrl, refUrl }) {
    wireLinksEditor(data);
    wireServicesEditor(data);

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

    // ----- aprobar diseño -----
    const approveBtn = document.getElementById('mcApproveBtn');
    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        const note = document.getElementById('mcApproveNote');
        approveBtn.disabled = true;
        approveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enviando…';
        const apiBase = portalApiBase();
        const waText = encodeURIComponent(`¡Apruebo el diseño de ${data.business?.name || 'mi tarjeta'}! Ya pueden publicarla.`);
        try {
          if (apiBase) {
            await fetch(`${apiBase}/notify/approved`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug: data.slug, ...authFields() }),
            });
          }
        } catch {
          // seguimos con el fallback de WhatsApp de cualquier forma
        }
        note.className = 'form-text small mt-2 text-success';
        note.innerHTML = '¡Gracias! Le avisamos a nuestro equipo. Si quieres confirmarlo también por WhatsApp: ' +
          `<a href="https://wa.me/15142580648?text=${waText}" target="_blank" rel="noopener">mándanos un mensaje</a>.`;
        approveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i> ¡Aprobado!';
      });
    }

    // ----- referidos -----
    const refInput = document.getElementById('mcRefInput');
    const refCopyBtn = document.getElementById('mcRefCopyBtn');
    if (refCopyBtn) {
      refCopyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(refInput.value);
        } catch {
          refInput.select();
          document.execCommand('copy');
        }
        const orig = refCopyBtn.innerHTML;
        refCopyBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>¡Copiado!';
        refCopyBtn.classList.add('copy-btn-flash');
        setTimeout(() => { refCopyBtn.innerHTML = orig; refCopyBtn.classList.remove('copy-btn-flash'); }, 1500);
      });
    }
    const refWaBtn = document.getElementById('mcRefWaBtn');
    if (refWaBtn) {
      refWaBtn.addEventListener('click', () => {
        const text = `Yo pedí mi tarjeta digital con Mi Tarjeta Pro (mimarca) y me encantó. Si quieres la tuya, usa mi link: ${refUrl}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      });
    }

    // ----- subir logo/fotos -----
    const uploadForm = document.getElementById('mcUploadForm');
    if (uploadForm) {
      uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const note = document.getElementById('mcUploadNote');
        const fileInput = document.getElementById('mcUploadFile');
        const submitBtn = document.getElementById('mcUploadSubmit');
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          note.className = 'form-text small mt-2 text-danger';
          note.textContent = 'El archivo es muy pesado (máx 8MB).';
          return;
        }

        const apiBase = portalApiBase();
        if (!apiBase) {
          note.className = 'form-text small mt-2 text-danger';
          note.innerHTML = 'La subida directa no está disponible todavía. ' +
            `<a href="https://wa.me/15142580648" target="_blank" rel="noopener">Mándanoslo por WhatsApp</a> mientras tanto.`;
          return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Subiendo…';
        note.className = 'form-text small mt-2';
        note.textContent = '';

        try {
          const form = new FormData();
          form.append('slug', data.slug);
          if (token) form.append('token', token);
          if (accountSession) form.append('sessionToken', accountSession);
          form.append('file', file);
          const res = await fetch(`${apiBase}/upload`, { method: 'POST', body: form });
          if (!res.ok) throw new Error('upload failed');
          note.className = 'form-text small mt-2 text-success';
          note.textContent = 'Listo, lo recibimos. Lo aplicamos a tu tarjeta en menos de 1 día hábil.';
          uploadForm.reset();
        } catch {
          note.className = 'form-text small mt-2 text-danger';
          note.innerHTML = 'No se pudo subir. ' +
            `<a href="https://wa.me/15142580648" target="_blank" rel="noopener">Mándanoslo por WhatsApp</a>.`;
        }
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-upload me-1"></i> Subir';
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

  async function openSession(forSlug) {
    const apiBase = portalApiBase();
    if (apiBase) {
      const res = await fetch(`${apiBase}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: forSlug, ...authFields() }),
      });
      if (res.status === 403) {
        renderLocked(accountSession && !token
          ? 'Esta tarjeta no está en tu cuenta'
          : 'Acceso inválido');
        return;
      }
      if (!res.ok) throw new Error('session failed');
      const body = await res.json();
      if (!body || !body.data) throw new Error('bad session');
      renderDashboard(body.data);
      return;
    }

    // Fallback legacy (API aún no configurada): JSON público con ownerToken.
    if (!token) {
      renderAccessRequest({ slug: forSlug });
      return;
    }
    const r = await fetch(`../negocio/_data/${forSlug}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('not found');
    const data = await r.json();
    if (!data.ownerToken || data.ownerToken !== token) {
      renderLocked('Acceso inválido');
      return;
    }
    renderDashboard(data);
  }

  if (!slug) {
    if (accountSession) {
      window.location.replace('./cuenta.html');
      return;
    }
    renderAccessRequest({});
  } else if (!hasAuth()) {
    renderAccessRequest({ slug });
  } else {
    openSession(slug).catch(() => renderLocked('Esta tarjeta no existe'));
  }
})();

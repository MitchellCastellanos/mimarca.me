// ============================================================
// Mi Tarjeta Pro · Cuenta de cliente (Dashboard)
// Login/registro con correo+contraseña, "olvidé mi contraseña", y el
// Dashboard que agrupa los pedidos de un mismo correo (ver
// workers/stripe-webhook/src/account.js). Sesión en localStorage — no
// cookies (el sitio y el Worker viven en dominios distintos).
//
// Desde aquí, "Ver panel" abre /mi-cuenta/?n=<slug> usando la misma
// sesión de cuenta (sin ownerToken en la URL).
// ============================================================

(function () {
  const app = document.getElementById("cuentaApp");
  if (!app) return;

  const SESSION_KEY = "mitp_account_session";

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function portalApiBase() {
    const meta = document.querySelector('meta[name="mitp-portal-api"]');
    const url = meta && meta.getAttribute("content") && meta.getAttribute("content").trim();
    if (!url || url.indexOf("REPLACE") !== -1) return null;
    return url.replace(/\/$/, "");
  }

  function getSession() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch { return ""; }
  }
  function setSession(token) {
    try { localStorage.setItem(SESSION_KEY, token); } catch { /* sin storage, sesión no persiste */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  async function apiPost(path, body) {
    const apiBase = portalApiBase();
    if (!apiBase) return { ok: false, error: "no-api" };
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, ...json };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  async function apiPut(path, body) {
    const apiBase = portalApiBase();
    if (!apiBase) return { ok: false, error: "no-api" };
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, ...json };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  // ---------- estado sin sesión: login / registro ----------
  function renderAuth(opts) {
    const mode = (opts && opts.mode) || "login"; // login | register | forgot
    const message = (opts && opts.message) || "";
    const noApi = !portalApiBase();

    app.innerHTML = `
      <div class="mc-locked">
        <div style="max-width:400px;width:100%;">
          <div class="display-1 mb-3">👤</div>
          <h1 class="h4 fw-bold mb-2">${mode === "register" ? "Crea tu cuenta" : "Entra a tu cuenta"}</h1>
          <p class="text-muted mb-4">Ve el estatus de tus pedidos y tus tarjetas desde un solo lugar.</p>

          ${noApi ? '<div class="alert alert-warning small text-start">El servicio de cuentas no está disponible todavía. Escríbenos por WhatsApp mientras tanto.</div>' : ""}

          ${mode === "forgot" ? `
            <form id="cForgotForm" class="text-start mb-3">
              <div class="mb-3">
                <label class="form-label small fw-semibold" for="cForgotEmail">Tu correo</label>
                <input id="cForgotEmail" type="email" class="form-control" placeholder="tucorreo@ejemplo.com" required>
              </div>
              <button type="submit" class="btn btn-dark w-100" id="cForgotSubmit">Mandarme el link de recuperación</button>
              <div id="cForgotNote" class="form-text small mt-2"></div>
            </form>
            <button type="button" class="btn btn-link btn-sm p-0" id="cBackToLogin">← Regresar a iniciar sesión</button>
          ` : `
            <form id="cAuthForm" class="text-start mb-3">
              <div class="mb-3">
                <label class="form-label small fw-semibold" for="cEmail">Correo</label>
                <input id="cEmail" type="email" class="form-control" placeholder="tucorreo@ejemplo.com" required>
              </div>
              <div class="mb-2">
                <label class="form-label small fw-semibold" for="cPassword">Contraseña</label>
                <input id="cPassword" type="password" class="form-control" placeholder="Mínimo 8 caracteres" minlength="8" required>
              </div>
              ${mode === "login" ? '<div class="text-end mb-3"><button type="button" class="btn btn-link btn-sm p-0" id="cForgotLink">¿Olvidaste tu contraseña?</button></div>' : '<div class="mb-3"></div>'}
              <button type="submit" class="btn btn-dark w-100" id="cAuthSubmit">${mode === "register" ? "Crear cuenta" : "Iniciar sesión"}</button>
              <div id="cAuthNote" class="form-text small mt-2"></div>
            </form>
            <div class="small text-muted">
              ${mode === "register"
                ? '¿Ya tienes cuenta? <button type="button" class="btn btn-link btn-sm p-0" id="cSwitchMode">Inicia sesión</button>'
                : '¿Primera vez? <button type="button" class="btn btn-link btn-sm p-0" id="cSwitchMode">Crea tu cuenta</button>'}
            </div>
          `}

          ${message ? `<div class="alert alert-info small mt-3">${escapeHtml(message)}</div>` : ""}

          <a href="../contact.html" class="btn btn-outline-dark btn-sm mt-4">Contactar soporte</a>
        </div>
      </div>
    `;

    const switchBtn = document.getElementById("cSwitchMode");
    if (switchBtn) {
      switchBtn.addEventListener("click", () => renderAuth({ mode: mode === "register" ? "login" : "register" }));
    }

    const forgotLink = document.getElementById("cForgotLink");
    if (forgotLink) {
      forgotLink.addEventListener("click", () => renderAuth({ mode: "forgot" }));
    }

    const backToLogin = document.getElementById("cBackToLogin");
    if (backToLogin) {
      backToLogin.addEventListener("click", () => renderAuth({ mode: "login" }));
    }

    const forgotForm = document.getElementById("cForgotForm");
    if (forgotForm) {
      forgotForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("cForgotEmail").value.trim();
        const submitBtn = document.getElementById("cForgotSubmit");
        const note = document.getElementById("cForgotNote");
        submitBtn.disabled = true;
        submitBtn.textContent = "Enviando…";
        await apiPost("/account/request-reset", { email });
        submitBtn.disabled = false;
        submitBtn.textContent = "Mandarme el link de recuperación";
        note.className = "form-text small mt-2 text-success";
        note.textContent = "Si ese correo tiene cuenta, te mandamos un link para elegir nueva contraseña. Revisa tu bandeja (y spam).";
        forgotForm.reset();
      });
    }

    const authForm = document.getElementById("cAuthForm");
    if (authForm) {
      authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("cEmail").value.trim();
        const password = document.getElementById("cPassword").value;
        const submitBtn = document.getElementById("cAuthSubmit");
        const note = document.getElementById("cAuthNote");

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Un momento…';
        note.className = "form-text small mt-2";
        note.textContent = "";

        const path = mode === "register" ? "/account/register" : "/account/login";
        const res = await apiPost(path, { email, password });

        if (res.ok && res.sessionToken) {
          setSession(res.sessionToken);
          loadDashboard();
          return;
        }

        submitBtn.disabled = false;
        submitBtn.textContent = mode === "register" ? "Crear cuenta" : "Iniciar sesión";
        note.className = "form-text small mt-2 text-danger";
        note.textContent = res.error || "Algo salió mal, intenta de nuevo.";
      });
    }
  }

  // ---------- nueva contraseña (desde el link del correo) ----------
  function renderResetForm(token) {
    app.innerHTML = `
      <div class="mc-locked">
        <div style="max-width:400px;width:100%;">
          <div class="display-1 mb-3">🔑</div>
          <h1 class="h4 fw-bold mb-2">Elige tu nueva contraseña</h1>
          <form id="cResetForm" class="text-start mb-3">
            <div class="mb-3">
              <label class="form-label small fw-semibold" for="cNewPassword">Nueva contraseña</label>
              <input id="cNewPassword" type="password" class="form-control" placeholder="Mínimo 8 caracteres" minlength="8" required>
            </div>
            <button type="submit" class="btn btn-dark w-100" id="cResetSubmit">Guardar y entrar</button>
            <div id="cResetNote" class="form-text small mt-2"></div>
          </form>
        </div>
      </div>
    `;

    document.getElementById("cResetForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = document.getElementById("cNewPassword").value;
      const submitBtn = document.getElementById("cResetSubmit");
      const note = document.getElementById("cResetNote");
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando…';

      const res = await apiPost("/account/reset-password", { token, password });
      if (res.ok) {
        note.className = "form-text small mt-2 text-success";
        note.textContent = "¡Listo! Ya puedes iniciar sesión con tu nueva contraseña.";
        setTimeout(() => renderAuth({ mode: "login", message: "Contraseña actualizada — inicia sesión." }), 1200);
        return;
      }
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar y entrar";
      note.className = "form-text small mt-2 text-danger";
      note.textContent = res.error || "El link ya no es válido, pide uno nuevo.";
    });
  }

  // ---------- Dashboard ----------
  function orderStatusLabel(order) {
    if (order.slug) return { text: "Publicada", cls: "text-bg-success" };
    return { text: "En proceso", cls: "text-bg-warning" };
  }

  // El borrador es lo único editable mientras el pedido no tiene `slug` —
  // esto es la info que usa el equipo para diseñar (reemplaza/complementa
  // Tally) y, cuando exista autoedición completa, la que alimente la
  // tarjeta en vivo. El logo no se edita aquí (no hay endpoint de subida
  // sin slug todavía) — solo se muestra.
  function draftFormHtml(order) {
    if (order.slug || !order.draft) return "";
    const d = order.draft.data || {};
    const id = escapeHtml(order.draftId);
    return `
      <div class="mt-3 pt-3 border-top" data-draft-id="${id}">
        <div class="small fw-semibold text-uppercase text-muted mb-2">Info de tu negocio (edítala si hace falta)</div>
        <div class="row g-2">
          <div class="col-md-6">
            <input type="text" class="form-control form-control-sm mc-draft-field" data-field="businessName" placeholder="Nombre del negocio" value="${escapeHtml(d.businessName || "")}">
          </div>
          <div class="col-md-6">
            <input type="text" class="form-control form-control-sm mc-draft-field" data-field="tagline" placeholder="Frase corta" value="${escapeHtml(d.tagline || "")}">
          </div>
          <div class="col-md-4">
            <input type="text" class="form-control form-control-sm mc-draft-field" data-field="whatsapp" placeholder="WhatsApp (link wa.me)" value="${escapeHtml(d.whatsapp || "")}">
          </div>
          <div class="col-md-4">
            <input type="text" class="form-control form-control-sm mc-draft-field" data-field="instagram" placeholder="Instagram" value="${escapeHtml(d.instagram || "")}">
          </div>
          <div class="col-md-4">
            <input type="text" class="form-control form-control-sm mc-draft-field" data-field="maps" placeholder="Link de Google Maps" value="${escapeHtml(d.maps || "")}">
          </div>
        </div>
        ${d.logoDataUrl ? `<div class="mt-2 d-flex align-items-center gap-2"><img src="${escapeHtml(d.logoDataUrl)}" alt="Logo" style="height:36px;border-radius:8px;object-fit:cover;"><span class="small text-muted">Logo recibido — para cambiarlo, escríbenos por WhatsApp.</span></div>` : ""}
        <div class="mt-2 d-flex align-items-center gap-2 flex-wrap">
          <button type="button" class="btn btn-dark btn-sm mc-draft-save">
            <i class="bi bi-check-lg me-1"></i> Guardar info
          </button>
          <span class="form-text small mb-0 mc-draft-note"></span>
        </div>
      </div>
    `;
  }

  function renderDashboard(email, orders) {
    const hasOrders = Array.isArray(orders) && orders.length > 0;

    const rows = hasOrders
      ? orders.slice().reverse().map((o) => {
          const status = orderStatusLabel(o);
          const date = o.at ? new Date(o.at).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" }) : "";
          const link = o.slug
            ? `<a href="./?n=${encodeURIComponent(o.slug)}" class="btn btn-dark btn-sm">Abrir panel</a>`
            : `<span class="text-muted small">Te avisamos por correo cuando esté lista</span>`;
          return `
            <div class="card mc-card border-0 shadow-sm mb-3">
              <div class="card-body p-4">
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                      <span class="badge ${status.cls}">${status.text}</span>
                      <span class="fw-semibold">${escapeHtml(o.packageName || "Mi Tarjeta Pro")}</span>
                    </div>
                    <div class="text-muted small">${escapeHtml(date)}</div>
                  </div>
                  ${link}
                </div>
                ${draftFormHtml(o)}
              </div>
            </div>
          `;
        }).join("")
      : `
        <div class="text-center py-5">
          <div class="display-1 mb-3">📇</div>
          <h2 class="h5 fw-bold mb-2">Aún no tienes tarjetas</h2>
          <p class="text-muted mb-4">Cuando compres tu primera tarjeta, aquí vas a ver su estatus.</p>
          <a href="../index.html#precios" class="btn btn-warning btn-lg">
            <i class="bi bi-plus-lg me-1"></i> Comprar mi primera tarjeta
          </a>
        </div>
      `;

    app.innerHTML = `
      <header class="hero hero-mt bg-dark text-white py-5">
        <div class="container d-flex justify-content-between align-items-center flex-wrap gap-3">
          <div>
            <span class="badge text-bg-warning fw-semibold mb-2">Mi Cuenta</span>
            <h1 class="display-6 fw-bold mb-0">Hola 👋</h1>
            <p class="text-white-50 mb-0">${escapeHtml(email)}</p>
          </div>
          <button type="button" id="cLogoutBtn" class="btn btn-outline-light btn-sm">Cerrar sesión</button>
        </div>
      </header>

      <section class="section">
        <div class="container" style="max-width:760px;">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h2 class="h6 fw-bold text-uppercase mb-0">Tus pedidos</h2>
            ${hasOrders ? '<a href="../index.html#precios" class="btn btn-warning btn-sm"><i class="bi bi-plus-lg me-1"></i>Nueva tarjeta</a>' : ""}
          </div>
          ${rows}
        </div>
      </section>
    `;

    document.getElementById("cLogoutBtn").addEventListener("click", async () => {
      await apiPost("/account/logout", { sessionToken: getSession() });
      clearSession();
      renderAuth({ mode: "login", message: "Sesión cerrada." });
    });

    document.querySelectorAll(".mc-draft-save").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const wrap = btn.closest("[data-draft-id]");
        const draftId = wrap.dataset.draftId;
        const order = orders.find((o) => o.draftId === draftId);
        const note = wrap.querySelector(".mc-draft-note");
        if (!order || !order.draft) return;

        const data = { ...(order.draft.data || {}) };
        wrap.querySelectorAll(".mc-draft-field").forEach((input) => {
          data[input.dataset.field] = input.value.trim();
        });

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando…';
        note.className = "form-text small mb-0 mc-draft-note";
        note.textContent = "";

        const res = await apiPut(`/draft/${encodeURIComponent(draftId)}`, { sessionToken: getSession(), data });

        if (res.ok) {
          order.draft.data = data;
          note.className = "form-text small mb-0 mc-draft-note text-success";
          note.textContent = "¡Guardado!";
        } else {
          note.className = "form-text small mb-0 mc-draft-note text-danger";
          note.textContent = res.error === "no-api" ? "El guardado automático no está disponible todavía." : "No se pudo guardar. Intenta de nuevo.";
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Guardar info';
      });
    });
  }

  async function loadDashboard() {
    const token = getSession();
    const abrir = (new URLSearchParams(window.location.search).get("abrir") || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");

    if (!token) {
      renderAuth({ mode: "login", message: abrir ? "Inicia sesión para abrir el panel de tu tarjeta." : "" });
      return;
    }
    const res = await apiPost("/account/me", { sessionToken: token });
    if (!res.ok) {
      clearSession();
      renderAuth({ mode: "login", message: res.error === "no-api" ? "" : "Tu sesión expiró, inicia sesión de nuevo." });
      return;
    }
    if (abrir) {
      window.location.replace(`./?n=${encodeURIComponent(abrir)}`);
      return;
    }
    renderDashboard(res.email, res.orders || []);
  }

  // ---------- bootstrap ----------
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset");
  if (resetToken) {
    renderResetForm(resetToken);
  } else {
    loadDashboard();
  }
})();

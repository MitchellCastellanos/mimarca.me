function renderNavbar(activePage = "", basePath = "./") {
  return `
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
    <div class="container">
      <a class="navbar-brand fw-bold d-flex align-items-center gap-2" href="${basePath}index.html">
        <img src="${basePath}images/logo-mimarca-sinfondo.png" alt="mimarca" class="navbar-brand-logo" height="32">
        Mi <span class="text-warning">Tarjeta</span> Pro
      </a>

      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain" aria-controls="navMain" aria-expanded="false" aria-label="Abrir menú">
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="collapse navbar-collapse" id="navMain">
        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
          <li class="nav-item">
            <a class="nav-link ${activePage === "home" ? "active" : ""}" href="${basePath}index.html#builder">Probar mockup</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${activePage === "precios" ? "active" : ""}" href="${basePath}index.html#precios">Precios</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${activePage === "demo" ? "active" : ""}" href="${basePath}rcr-barbershop/">Demo en vivo</a>
          </li>
        </ul>

        <a class="btn btn-warning ms-lg-3" href="${basePath}index.html?ref=nav-cta#precios">Pedir mi tarjeta</a>
      </div>
    </div>
  </nav>
  `;
}

function renderFooter(basePath = "./") {
  return `
  <footer class="py-4 border-top">
    <div class="container d-flex flex-column flex-md-row align-items-center justify-content-between gap-2">
      <div class="small text-muted d-flex align-items-center gap-2">
        <img src="${basePath}images/logo-mimarca-sinfondo.png" alt="" aria-hidden="true" class="footer-brand-logo" height="18">
        <span>© <span id="year"></span> Mi Tarjeta Pro · mimarca</span>
      </div>
      <div class="small">
        <a class="text-decoration-none me-3" href="${basePath}index.html#precios">Precios</a>
        <a class="text-decoration-none me-3" href="${basePath}index.html#politica">Política de cambios</a>
        <a class="text-decoration-none me-3" href="${basePath}rcr-barbershop/">Demo</a>
        <a class="text-decoration-none me-3" href="${basePath}onboarding.html">Onboarding</a>
        <a class="text-decoration-none me-3" href="${basePath}terminos.html">Términos y condiciones</a>
        <a class="text-decoration-none" href="${basePath}contact.html">Contacto</a>
      </div>
    </div>
  </footer>
  `;
}

function mountSharedLayout(activePage = "", basePath = "./") {
  const navbarHost = document.getElementById("site-navbar");
  const footerHost = document.getElementById("site-footer");

  if (navbarHost) navbarHost.innerHTML = renderNavbar(activePage, basePath);

  if (footerHost) {
    footerHost.innerHTML = renderFooter(basePath);
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }
}

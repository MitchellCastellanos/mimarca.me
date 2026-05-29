function renderNavbar(activePage = "") {
  return `
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
    <div class="container">
      <a class="navbar-brand fw-bold" href="./index.html">
        Mi <span class="text-warning">Tarjeta</span> Pro
      </a>

      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain" aria-controls="navMain" aria-expanded="false" aria-label="Abrir menú">
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="collapse navbar-collapse" id="navMain">
        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
          <li class="nav-item">
            <a class="nav-link ${activePage === "home" ? "active" : ""}" href="./index.html#builder">Probar mockup</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${activePage === "precios" ? "active" : ""}" href="./index.html#precios">Precios</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${activePage === "demo" ? "active" : ""}" href="./rcr-barbershop/">Demo en vivo</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${activePage === "contact" ? "active" : ""}" href="./contact.html">Contacto</a>
          </li>
        </ul>

        <a class="btn btn-warning ms-lg-3" href="./contact.html?ref=nav-cta">Pedir mi tarjeta</a>
      </div>
    </div>
  </nav>
  `;
}

function renderFooter() {
  return `
  <footer class="py-4 border-top">
    <div class="container d-flex flex-column flex-md-row align-items-center justify-content-between gap-2">
      <div class="small text-muted">© <span id="year"></span> Mi Tarjeta Pro · GABAN Solutions</div>
      <div class="small">
        <a class="text-decoration-none me-3" href="./index.html#precios">Precios</a>
        <a class="text-decoration-none me-3" href="./index.html#politica">Política de cambios</a>
        <a class="text-decoration-none me-3" href="./rcr-barbershop/">Demo</a>
        <a class="text-decoration-none me-3" href="./onboarding.html">Onboarding</a>
        <a class="text-decoration-none" href="./contact.html">Contacto</a>
      </div>
    </div>
  </footer>
  `;
}

function mountSharedLayout(activePage = "") {
  const navbarHost = document.getElementById("site-navbar");
  const footerHost = document.getElementById("site-footer");

  if (navbarHost) navbarHost.innerHTML = renderNavbar(activePage);

  if (footerHost) {
    footerHost.innerHTML = renderFooter();
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }
}

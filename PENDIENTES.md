# Pendientes — mini-portal de cliente y slug directo

Contexto: ya se implementó (1) el slug público directo `mimarca.me/<slug>`
(antes `/negocio/<slug>`) y (2) el mini-portal de cliente en `mi-cuenta/`
(estatus de pedido, aprobar diseño, referidos, subir logo/fotos, acceso sin
password). Todo el código está en `main`. Este documento es la lista de lo
que falta para que quede 100% funcionando en producción, dividida en dos
partes.

## Parte 1 — Requiere acceso a plugins/servicios externos (Cloudflare, Resend, Stripe)

### Estado del deploy (cerrado 2026-07-20)

Worker: `https://mimarca-stripe-webhook.mimarca.workers.dev`

1. **Resend**: [x] API key cargada. Dominio verificado:
   `updates.mimarca.me`. `FROM_EMAIL` =
   `mimarca <pedidos@updates.mimarca.me>` (smoke + alerta de pago OK).
   - [ ] Opcional: verificar `mimarca.me` raíz y volver a
     `pedidos@mimarca.me`.
2. **Cloudflare Worker**:
   - [x] `wrangler login`
   - [x] `STRIPE_WEBHOOK_SECRET` (live `whsec_…`, 2026-07-20)
   - [x] `RESEND_API_KEY`
   - [x] `ADMIN_SECRET` (local: `workers/stripe-webhook/.admin_secret.tmp`,
     no commitear)
   - [x] Bucket `mimarca-portal-uploads` + binding `PORTAL_UPLOADS`
   - [x] Dominio público `uploads.mimarca.me` conectado al bucket
     (SSL/ownership pueden tardar unos minutos en quedar `active`)
   - [x] `npx wrangler deploy`
3. **Stripe**: [x] Webhook live apuntando a la URL del worker,
   `checkout.session.completed`. Webhook test también existía de la sesión
   anterior.
4. **`mi-cuenta/index.html`**: [x] meta `mitp-portal-api` → URL del worker.
5. **(Opcional) Umami**: sin cambios.
6. **Clientes**: `lulu` / `test-client` ya tienen `ownerEmail` + `orderStage`
   en el repo.
7. **`.nojekyll`**: [x] añadido para que GitHub Pages sirva
   `negocio/_data/*.json` (Jekyll ocultaba las carpetas `_…`).

### Pruebas (2026-07-20)

| Ruta / flujo | Resultado |
|--------------|-----------|
| Stripe `trigger` test → Resend | OK — alerta a `contacto@mimarca.me` |
| Resend smoke `pedidos@updates.mimarca.me` | OK delivered |
| `POST /access` | 200 `{ok:true}` |
| Portal end-to-end con JSON live | Requiere Pages con `.nojekyll` publicado |

Detalle de deploy/curl: `workers/stripe-webhook/README.md`.

## Parte 2 — Trabajo de producto/código para después (no depende de infraestructura)

Nada de esto es urgente ni bloquea lo anterior. En orden sugerido de valor:

1. **Referidos con tracking real**: hoy el premio por referido se aplica a
   mano (honor system: el cliente nuevo dice "me recomendó fulano"). Si el
   volumen crece, vale la pena un código de referido único por cliente (no
   solo reusar el slug) y registrar el redimido en algún lado (KV/D1) para
   no depender de que alguien se acuerde de avisar.
2. **Seguridad del panel**: `negocio/_data/<slug>.json` es público (así lo
   lee la tarjeta en el navegador), y ahora incluye `ownerToken` y
   `ownerEmail`. Es "seguridad por no compartir el link", razonable para el
   volumen actual, pero si esto escala vale la pena mover `ownerToken` /
   `ownerEmail` fuera del JSON público hacia el propio Worker (Cloudflare KV
   o D1), y que la tarjeta pública siga siendo un JSON sin esos dos campos.
3. **Rate limiting en `/access`**: ahora mismo cualquiera puede llamar el
   endpoint repetidamente (no filtra info, pero podría gastar cuota de
   Resend si alguien lo golpea mucho). Agregar un rate limit simple (por IP,
   vía Cloudflare o una cola en KV) antes de que sea un problema real.
4. **Panel de admin mínimo**: `/notify/published` y `/notify/change-received`
   hoy se disparan a mano con `curl`/Postman + el `ADMIN_SECRET`. Si el
   equipo crece más allá de una persona, conviene una páginita interna
   (protegida) con botones en vez de la terminal.
5. **Fase 2 del portal** (autoedición limitada): si algún día quieren que el
   cliente edite directamente ciertos campos seguros (horarios, links,
   fotos) sin pasar por el equipo, mover los datos de JSON estático a
   Cloudflare D1/KV con un formulario validado contra
   `negocio/_schema/card.schema.json` — dejando el diseño/colores/layout
   siempre como cambio pagado hecho por una persona (eso no cambia).
6. **Galería de ejemplos con marca equivocada**: las imágenes de "Un poco de
   nuestro trabajo" en `index.html` (`images/mi-tarjeta/mockups/*.png`)
   muestran mockups con el pie de foto `gabansolutions.ca/negocio/...`
   (marca hermana, no mimarca.me). No se tocaron en este trabajo porque son
   imágenes rasterizadas, no texto editable, y no están relacionadas al
   cambio de slug/portal — pero conviene reemplazarlas por mockups nuevos
   con la marca correcta cuando haya tiempo de diseño.
7. **`site.webmanifest`** referencia iconos que no existen en el repo
   (`/Images/android-chrome-192x192.png`, etc. — nota la `I` mayúscula,
   además la carpeta real es `images/` en minúscula). Es un bug preexistente
   no relacionado a este trabajo; hay que generar esos íconos o corregir las
   rutas.

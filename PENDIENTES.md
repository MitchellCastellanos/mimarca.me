# Pendientes — mini-portal de cliente y slug directo

Contexto: ya se implementó (1) el slug público directo `mimarca.me/<slug>`
(antes `/negocio/<slug>`) y (2) el mini-portal de cliente en `mi-cuenta/`
(estatus de pedido, aprobar diseño, referidos, subir logo/fotos, acceso sin
password). Todo el código está en `main`. Este documento es la lista de lo
que falta para que quede 100% funcionando en producción, dividida en dos
partes.

## Parte 1 — Requiere acceso a plugins/servicios externos (Cloudflare, Resend, Stripe)

Nada de esto se puede hacer solo con el repo; necesita credenciales/cuentas
reales. Mientras no se haga, el sitio sigue funcionando igual que antes (todo
cae a un fallback de WhatsApp, nada se rompe).

1. **Resend**: crear cuenta, verificar el dominio `mimarca.me` (DNS: SPF/DKIM),
   y generar `RESEND_API_KEY`.
2. **Cloudflare Worker**:
   - `cd workers/stripe-webhook && npx wrangler login`
   - `npx wrangler secret put STRIPE_WEBHOOK_SECRET`
   - `npx wrangler secret put RESEND_API_KEY`
   - `npx wrangler secret put ADMIN_SECRET` (generar con `openssl rand -hex 24`;
     protege `/notify/published` y `/notify/change-received`)
   - `npx wrangler r2 bucket create mimarca-portal-uploads`
   - Habilitar acceso público al bucket (o colgarle un dominio propio, p. ej.
     `uploads.mimarca.me`) desde el dashboard de Cloudflare → R2 → el bucket
     → Settings, y poner esa URL en `R2_PUBLIC_BASE_URL` (`wrangler.toml`).
   - `npx wrangler deploy` → imprime la URL pública del worker.
3. **Stripe Dashboard**: crear el endpoint de webhook apuntando a la raíz de
   esa URL (sin path extra), suscrito solo a `checkout.session.completed`, y
   copiar su `whsec_...` al secret `STRIPE_WEBHOOK_SECRET` de arriba.
4. **Actualizar `mi-cuenta/index.html`**: reemplazar el meta
   `<meta name="mitp-portal-api" content="REPLACE-PORTAL_API_BASE_URL">`
   con la URL real del worker deployado. Esto activa el magic link, la
   subida de logo/fotos y "aprobar diseño" (ahora mismo muestran el
   fallback de WhatsApp).
5. **(Opcional) Umami**: si se quiere activar analytics por tarjeta, ver
   `AUTOMATION.md` — configurar `mitp-umami-config` en cada
   `negocio/index.html`/`/<slug>/index.html` y `mitp-umami-share-url` en
   `mi-cuenta/index.html`.
6. **Por cada cliente (nuevo o existente)**: llenar `ownerEmail` y
   `orderStage` en su `negocio/_data/<slug>.json` (ver
   `negocio/_schema/card.schema.json` y `negocio/_data/_example.json`).
   Sin `ownerEmail`, el magic link (`/access`) no encuentra a ese cliente.
   Sin `orderStage`, el stepper de estatus no se muestra para esa tarjeta
   (no rompe nada, solo no aparece el bloque).

Todos los pasos de deploy están también en `workers/stripe-webhook/README.md`
con más detalle y ejemplos de `curl` para probar cada ruta.

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

## Qué NO se pudo probar en este entorno

El código del worker (`workers/stripe-webhook/src/index.js`) se validó con
`node --check` (sintaxis) y `node --test` (la lógica pura de armado de
variables/plantillas, 9/9 tests). No se pudo probar en un Cloudflare real
(sin cuenta/credenciales en este entorno): ni `wrangler dev` contra R2 de
verdad, ni el envío real de correos vía Resend, ni el flujo completo
`/upload` con un bucket real. Recomendado probar cada ruta con los `curl` de
ejemplo del README apenas esté deployado, antes de darlo por bueno.

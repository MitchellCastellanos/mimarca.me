# Self-serve orders — Mi Tarjeta Pro

Cómo queda armado el flujo de compra self-serve después de dejar Lemon Squeezy,
y qué falta por conectar del lado de Stripe (a propósito dejado como cableado
pendiente — ver nota al final).

## 1. Flujo completo, de punta a punta

1. Cliente entra a `index.html`, prueba el mockup interactivo, y da clic en
   **"Pedir mi tarjeta"** (navbar, CTA de resultado del mockup, o CTA final).
   Todos apuntan directo a `#precios` — ya no pasan por `contact.html`.
2. En `#precios` elige uno de los 3 paquetes (Lanzamiento / Personalizado /
   Premium) y dala clic en el botón, que lo lleva a un **Stripe Payment
   Link**.
3. Stripe procesa el pago (tarjeta), manda automáticamente:
   - Recibo de pago al cliente (si está activado en Stripe Dashboard →
     Settings → Emails), y/o el correo de confirmación con marca propia (ver
     sección 3).
   - Redirige al cliente a `gracias.html?package=<tier>&session_id={CHECKOUT_SESSION_ID}`.
4. En `gracias.html`, el cliente llena el formulario de onboarding (Tally)
   con logo, links, servicios y fotos — o manda todo por WhatsApp.
5. Webhook de Stripe (`checkout.session.completed`) dispara:
   - El correo de confirmación de marca al cliente (`emails/order-confirmation.html`).
   - La alerta de pago al owner (`emails/payment-alert.html`).
6. Equipo humano diseña la tarjeta (24 horas), agrega
   `negocio/_data/<slug>.json` y publica la página pública en `/<slug>/`
   (copia de `negocio/index.html` con el `<link>` de `negocio.css` en
   ruta absoluta — el motor en `js/negocio.js` lee el slug de la URL).
7. Cliente recibe su link + QR. A partir de ahí puede entrar a `mi-cuenta/`
   (sin password: pide su acceso con su slug+correo, o usa el link directo
   con su `ownerToken`) para ver el estatus de su pedido, aprobar su diseño
   en revisión, ver su tarjeta, descargar el QR, subir logo/fotos, compartir
   su link de referido y pedir cambios ($25 MXN por orden vía otro Stripe
   Payment Link). Ver sección 7.

## 2. Productos y Payment Links en Stripe — ✅ creados (LIVE)

Los 4 productos y sus Payment Links ya existen en **modo live** en la cuenta
de Stripe de Mimarca.me (`acct_1Tu10QJGvovZxLEx`). Cada link tiene su
metadata `package` / `package_name` y su redirect de éxito a
`gracias.html?package=<tier>&session_id={CHECKOUT_SESSION_ID}`:

| Producto | Precio | Payment Link (live) | Ya conectado en |
|---|---|---|---|
| Lanzamiento | $199 MXN | `https://buy.stripe.com/eVqcN67HF1xkdP7gQjgjC00` | `index.html` #precios |
| Personalizado | $249 MXN | `https://buy.stripe.com/4gM28s6DB0tgh1j1VpgjC01` | `index.html` #precios |
| Premium | $299 MXN | `https://buy.stripe.com/5kQcN64vt5NA7qJ7fJgjC02` | `index.html` #precios |
| Cambios post-entrega | $25 MXN | `https://buy.stripe.com/cNieVee63b7U26p0RlgjC03` | `negocio/_data/*.json` (`changeRequestUrl`) |

Cada tarjeta real futura debe llevar el mismo link de Cambios en su
`changeRequestUrl` (la plantilla `negocio/_data/_example.json` ya lo trae),
o crear uno por cliente si se quiere separar la contabilidad.

**Pendiente manual en el Stripe Dashboard** (no tiene API):
- Settings → **Emails → Successful payments**: activar recibo automático.
- Settings → **Notifications**: activar alerta de pago al owner (respaldo
  del correo de marca que ya manda el webhook).

Para pruebas sin cobrar de verdad, existe la misma configuración en el
sandbox "Mimarca.me sandbox" (`acct_1Tu10vR5M14IEE7l`), con links
`buy.stripe.com/test_...` y la tarjeta `4242 4242 4242 4242`.

## 3. Correos de marca (`emails/`)

Siete plantillas HTML listas para usar, con variables `{{en_llaves}}`:

- `emails/order-confirmation.html` — al cliente, justo después del pago.
- `emails/payment-alert.html` — al owner, con los datos del pedido y link
  directo al pago en el Stripe Dashboard.
- `emails/access-link.html` — magic link a `mi-cuenta` (sin password).
- `emails/card-published.html` — al cliente, cuando su tarjeta sale en vivo.
- `emails/change-request-received.html` — al cliente, confirma que se
  recibió su solicitud de cambios ($25 MXN).
- `emails/asset-uploaded.html` — al owner, cuando un cliente sube logo/fotos
  desde `mi-cuenta`.
- `emails/design-approved-alert.html` — al owner, cuando un cliente aprueba
  su diseño en revisión desde `mi-cuenta`.

Cada archivo trae en un comentario al inicio: el trigger, las variables
esperadas, y el asunto sugerido.

## 4. Worker de backend — ✅ construido (`workers/stripe-webhook/`)

Cloudflare Worker (el sitio sigue 100% estático en GitHub Pages; el Worker
vive aparte). Atiende el webhook de Stripe **y** las rutas del portal de
cliente (`/access`, `/upload`, `/notify/*`) — ver sección 7 y
`workers/stripe-webhook/README.md` para el detalle de cada ruta, deploy,
pruebas locales y variables de entorno (`workers/stripe-webhook/.env.example`).

**Pendiente para dejarlo en producción:**
1. Cuenta de Resend con el dominio `mimarca.me` verificado → `RESEND_API_KEY`.
2. `npx wrangler r2 bucket create mimarca-portal-uploads` + habilitar acceso
   público (o dominio propio) → `R2_PUBLIC_BASE_URL` (solo afecta la subida
   de logo/fotos; sin esto el resto del Worker funciona igual).
3. `npx wrangler deploy` (requiere cuenta de Cloudflare).
4. Crear el endpoint de webhook en el Stripe Dashboard apuntando a la raíz
   de la URL del Worker y cargar su `whsec_...` como secret.
5. Poner la URL del Worker en el meta `mitp-portal-api` de
   `mi-cuenta/index.html` (hoy tiene el placeholder
   `REPLACE-PORTAL_API_BASE_URL` — mientras siga así, el magic link, la
   subida de archivos y "aprobar diseño" muestran un fallback por WhatsApp
   en vez de fallar).

## 5. Entrega y seguimiento

- El estatus de "en qué va mi pedido" lo comunica `gracias.html` (pasos 1–4)
  justo después del pago, y luego el stepper de `mi-cuenta` (sección 7) una
  vez que el equipo le pone `orderStage` a la tarjeta.
- Una vez publicada, `mi-cuenta/?n=<slug>&token=<ownerToken>` (o pedir acceso
  con slug+correo) es el panel self-serve del cliente.

## 6. Políticas

`terminos.html` documenta precios, proceso de entrega (24 horas),
política de cambios, cancelaciones/reembolsos y propiedad del diseño por
paquete. Enlazado desde el footer de todo el sitio.

## 7. Mini-portal de cliente (`mi-cuenta/`) — ✅ construido

Panel sin password (magic link por correo, no hay cuentas/contraseñas que
resetear). Con `js/mi-cuenta.js` + el Worker:

- **Estatus del pedido**: stepper (pagado → en diseño → en revisión →
  publicada) según `orderStage` en el JSON del cliente.
- **Aprobar diseño**: cuando `orderStage` es `"review"`, el cliente puede
  aprobar (avisa al owner por correo) o pedir un ajuste (WhatsApp
  prellenado) antes de publicar.
- **Link + QR**: igual que antes, ahora con `mimarca.me/<slug>/`.
- **Subir logo/fotos**: el cliente sube el archivo, cae a R2, y el owner
  recibe el link por correo para aplicarlo a mano — el cliente nunca edita
  el JSON directo (así seguimos cobrando por cambios de diseño reales).
- **Referidos**: link `?ref=<slug>` + botón de compartir por WhatsApp. El
  premio (un cambio gratis) se aplica a mano por ahora — no hay tracking
  automático de quién compró por referido todavía.
- **Acceso**: sin slug/token en el link, `mi-cuenta` muestra un formulario
  de "pedir acceso" (slug + correo) que dispara el magic link. El
  `ownerToken` sigue siendo el único credential real — el magic link solo
  reenvía el mismo link permanente, no crea sesiones nuevas.

**Por cada cliente nuevo**, además de `ownerToken`, el equipo debe llenar
`ownerEmail` y `orderStage` en su `negocio/_data/<slug>.json` (ver
`negocio/_schema/card.schema.json` y `negocio/_data/_example.json`) — sin
esto el magic link y el stepper no funcionan para esa tarjeta.

**Limitación conocida**: `negocio/_data/<slug>.json` es público (así es como
lo lee la tarjeta en el navegador), lo que incluye `ownerToken` y ahora
`ownerEmail`. El "login" de `mi-cuenta` es honestidad basada en no compartir
el link, no un secreto criptográfico — suficiente para el volumen actual de
clientes, pero si esto crece vale la pena mover `ownerToken`/`ownerEmail`
fuera del JSON público hacia el propio Worker (KV/D1).

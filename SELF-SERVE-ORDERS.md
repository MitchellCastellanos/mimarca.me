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
6. Equipo humano diseña la tarjeta (3–5 días hábiles) y publica en
   `negocio/<slug>`.
7. Cliente recibe su link + QR. A partir de ahí puede entrar a `mi-cuenta/`
   (con su `ownerToken`) para ver su tarjeta, descargar el QR y pedir
   cambios ($25 MXN por orden vía otro Stripe Payment Link).

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

Dos plantillas HTML listas para usar, con variables `{{en_llaves}}`:

- `emails/order-confirmation.html` — al cliente, justo después del pago.
- `emails/payment-alert.html` — al owner, con los datos del pedido y link
  directo al pago en el Stripe Dashboard.

Cada archivo trae en un comentario al inicio: el trigger (evento de
webhook), las variables esperadas, y el asunto sugerido.

## 4. Webhook — ✅ construido (`workers/stripe-webhook/`)

Cloudflare Worker (el sitio sigue 100% estático en GitHub Pages; el Worker
vive aparte). Recibe `checkout.session.completed`, valida la firma con
`STRIPE_WEBHOOK_SECRET`, y manda los dos correos de `emails/` vía Resend:

- `emails/order-confirmation.html` → al cliente (`customer_details.email`).
- `emails/payment-alert.html` → al owner (`OWNER_ALERT_EMAIL`).

Ver `workers/stripe-webhook/README.md` para deploy, pruebas locales y
variables de entorno (documentadas en `workers/stripe-webhook/.env.example`).

**Pendiente para dejarlo en producción:**
1. Cuenta de Resend con el dominio `mimarca.me` verificado → `RESEND_API_KEY`.
2. `npx wrangler deploy` (requiere cuenta de Cloudflare).
3. Crear el endpoint de webhook en el Stripe Dashboard apuntando a la URL
   del Worker y cargar su `whsec_...` como secret.

## 5. Entrega y seguimiento (sin backend nuevo)

No requiere nada adicional — ya funciona con lo que hay en el repo:

- El estatus de "en qué va mi pedido" lo comunica `gracias.html` (pasos 1–4)
  justo después del pago, y por correo/WhatsApp durante el diseño.
- Una vez publicada la tarjeta, `mi-cuenta/?n=<slug>&token=<ownerToken>` es
  el panel self-serve del cliente: link público, QR descargable, y botón
  para pedir cambios ($25 MXN).

## 6. Políticas

`terminos.html` documenta precios, proceso de entrega (3–5 días hábiles),
política de cambios, cancelaciones/reembolsos y propiedad del diseño por
paquete. Enlazado desde el footer de todo el sitio.

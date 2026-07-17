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

## 2. Qué crear en Stripe (dashboard, sin código)

Para cada uno de los 4 productos, crear un **Payment Link**:

| Producto | Precio | Placeholder en el código a reemplazar |
|---|---|---|
| Lanzamiento | $199 MXN | `index.html` → `REPLACE-STRIPE-LANZAMIENTO` |
| Personalizado | $249 MXN | `index.html` → `REPLACE-STRIPE-PERSONALIZADO` |
| Premium | $299 MXN | `index.html` → `REPLACE-STRIPE-PREMIUM` |
| Cambios post-entrega | $25 MXN | `negocio/_data/*.json` → `REPLACE-STRIPE-CHANGES-25MXN` (uno por cliente, o reusar el mismo link para todos) |

Para cada Payment Link, en **"After payment" → "Redirect to a website"**,
configurar la URL de éxito con el paquete y el session id:

```
https://mimarca.me/gracias.html?package=lanzamiento&session_id={CHECKOUT_SESSION_ID}
https://mimarca.me/gracias.html?package=personalizado&session_id={CHECKOUT_SESSION_ID}
https://mimarca.me/gracias.html?package=premium&session_id={CHECKOUT_SESSION_ID}
```

Activar también (sin código, en Stripe Dashboard → Settings):
- **Emails → Successful payments**: recibo automático al cliente.
- **Notifications**: alerta por correo al owner en cada pago (respaldo
  simple mientras se conecta el webhook con el correo de marca).

## 3. Correos de marca (`emails/`)

Dos plantillas HTML listas para usar, con variables `{{en_llaves}}`:

- `emails/order-confirmation.html` — al cliente, justo después del pago.
- `emails/payment-alert.html` — al owner, con los datos del pedido y link
  directo al pago en el Stripe Dashboard.

Cada archivo trae en un comentario al inicio: el trigger (evento de
webhook), las variables esperadas, y el asunto sugerido.

## 4. Lo que falta conectar (a propósito, pendiente)

El cableado real de Stripe (crear los Payment Links, el webhook que dispare
`emails/*.html` vía Resend/SendGrid, y las variables de entorno) se deja
pendiente a propósito — se va a resolver después con el plugin de Stripe en
Cursor. Lo que necesita ese trabajo:

- Los 4 Payment Links de la sección 2 (o Price IDs si se arma un Checkout
  Session dinámico en vez de Payment Links).
- Un endpoint/función que reciba el webhook `checkout.session.completed` de
  Stripe, valide la firma, y dispare los dos correos de `emails/` con los
  datos de la sesión.
- Dónde hostear esa función (Vercel/Netlify/Cloudflare Workers — el sitio
  hoy es 100% estático en GitHub Pages, así que esto implica agregar un
  runtime).
- Variables de entorno típicas: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  proveedor de correo (`RESEND_API_KEY` o similar), `OWNER_ALERT_EMAIL`.

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

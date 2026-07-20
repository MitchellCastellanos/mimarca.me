# Automatización opcional — Mi Tarjeta Pro

Dos piezas opcionales, referenciadas desde varios `<meta>` tags en el sitio.
Ninguna es necesaria para que el sitio funcione — mientras no se configuren,
cada pieza cae a un estado vacío o a un fallback, sin romper nada.

## 1. Analytics (Umami)

Cada tarjeta pública (`negocio/index.html` y cada `/<slug>/index.html`) trae
un meta vacío:

```html
<meta name="mitp-umami-config" content="">
```

Para activar el tracker en una tarjeta, pon ahí un JSON con el script y el
website ID de tu instancia de Umami, por ejemplo:

```html
<meta name="mitp-umami-config" content='{"src":"https://tu-umami.com/script.js","websiteId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}'>
```

`js/negocio.js` lee ese meta y solo inyecta el script si el JSON es válido y
no contiene la palabra `REPLACE`.

Para que el panel `mi-cuenta` muestre el conteo de visitas, configura además
en `mi-cuenta/index.html`:

```html
<meta name="mitp-umami-share-url" content="https://tu-umami.com/api/share/xxxxx">
```

(la URL pública de un "share link" de Umami — puede incluir `{slug}` como
placeholder si quieres reusar el mismo meta para todos los clientes y que
`js/mi-cuenta.js` arme la URL final por cliente). Mientras el meta diga
`REPLACE-UMAMI_SHARE_STATS_URL`, el panel muestra `—` en vez de un número.

## 2. Portal de cliente (worker de backend)

El magic link, la subida de logo/fotos y "aprobar diseño" en `mi-cuenta/`
necesitan la URL del worker desplegado en Cloudflare. Se configura en
`mi-cuenta/index.html`:

```html
<meta name="mitp-portal-api" content="https://mimarca-stripe-webhook.<subdominio>.workers.dev">
```

Mientras ese meta diga `REPLACE-PORTAL_API_BASE_URL`, esas tres funciones
muestran un mensaje pidiendo escribir por WhatsApp en su lugar — no fallan
silenciosamente.

Ver `workers/stripe-webhook/README.md` para el deploy completo del worker
(rutas, secrets, bucket R2) y `SELF-SERVE-ORDERS.md` sección 7 para el flujo
completo del portal.

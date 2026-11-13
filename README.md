# Reel Management

App de planificación de reels de Crillón (Anita y Nico). Corre en Railway con Bun.
La página es `page.html`; el servidor `index.tsx` la sirve y guarda los datos
compartidos (guiones, comentarios, equipo, notas de calendario) en SQLite sobre
un volumen en `/data`. Avisa por correo (Brevo) cuando alguien edita.

## Variables (en Railway)
- `ACCESS_CODE`: clave compartida de acceso (opcional pero recomendado).
- `NOTIFY_TO`: correos que reciben el aviso, separados por coma.
- `MAIL_FROM`: remitente verificado en Brevo.
- `BREVO_API_KEY`: API key de Brevo (secreto). Sin ella, no se envían correos.
- `NOTIFY_DELAY_SECONDS`: espera antes de agrupar y enviar (600 = 10 min).
- `SITE_URL`: URL pública, para el enlace del correo.

## Actualizar el diseño
Reemplaza `page.html` y haz push; Railway vuelve a desplegar.

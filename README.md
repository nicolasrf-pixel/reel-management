# Reel Management (Cloudflare Worker)

Planificación de reels de Crillón para Anita y Nico. La página está en `public/`
y los datos compartidos viven en un Durable Object con SQLite (`src/worker.js`).

## Subir
```
npm install
npx wrangler login
npx wrangler deploy
```
Al terminar, Wrangler muestra la URL `https://reel-management.<tu-subdominio>.workers.dev`.

## Clave de acceso (recomendado)
```
npx wrangler secret put ACCESS_CODE
```
Escribe la clave que usarán Anita y Nico. Sin este secreto, cualquiera con el link puede editar.
También se puede crear en el panel: Workers > reel-management > Settings > Variables and Secrets.

## Probar en local
```
npx wrangler dev
```

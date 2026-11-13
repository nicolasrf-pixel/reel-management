import { DurableObject } from "cloudflare:workers";

// Reel Management: guarda los datos compartidos (guiones, comentarios, equipo, notas de día)
// en un Durable Object con SQLite. Lo que escribe Anita lo ve Nico y al revés.
// La página y las fuentes las sirve Cloudflare desde ./public.

const PATH = /^(guiones|comentarios|equipo|dias)\/[A-Za-z0-9_.:-]{1,80}$/;
const MAX_BODY = 200 * 1024;

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, body TEXT NOT NULL, updated INTEGER NOT NULL)");
  }
  all() {
    const docs = {};
    for (const row of this.sql.exec("SELECT path, body FROM docs")) docs[row.path] = JSON.parse(row.body);
    return docs;
  }
  put(path, body) {
    this.sql.exec(
      "INSERT INTO docs (path, body, updated) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET body = excluded.body, updated = excluded.updated",
      path, body, Date.now()
    );
  }
  remove(path) {
    this.sql.exec("DELETE FROM docs WHERE path = ?", path);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Logos de marca: se piden a sus sitios oficiales una vez y quedan en caché 24 horas.
const LOGOS = {
  "/img/disperso-logo.webp": "https://estudiodisperso.com/img/logo-720.webp",
  "/img/crillon.png": "https://www.crillon.cl/design-system-assets/logos/crillon-white.png",
};

async function logo(request, ctx, upstream) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  let up;
  try { up = await fetch(upstream); } catch (e) { return new Response("logo no disponible", { status: 502 }); }
  const type = up.headers.get("content-type") || "";
  if (!up.ok || !type.startsWith("image/")) return new Response("logo no disponible", { status: 502 });
  const res = new Response(up.body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && LOGOS[url.pathname]) return logo(request, ctx, LOGOS[url.pathname]);
    if (url.pathname !== "/api/docs") return new Response("No encontrado", { status: 404 });

    // Clave de acceso opcional: si existe el secreto ACCESS_CODE, la API la exige.
    // El GET sin clave responde 200 con {locked:true} para no ensuciar la consola del navegador.
    if (env.ACCESS_CODE && request.headers.get("x-access-code") !== env.ACCESS_CODE) {
      return request.method === "GET" ? json({ locked: true }) : json({ error: "clave" }, 401);
    }

    const store = env.STORE.get(env.STORE.idFromName("principal"));
    if (request.method === "GET") return json({ docs: await store.all() });

    const path = url.searchParams.get("path") || "";
    if (!PATH.test(path)) return json({ error: "path" }, 400);

    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "muy grande" }, 413);
      let body;
      try { body = JSON.parse(text); } catch (e) { return json({ error: "json" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "json" }, 400);
      await store.put(path, JSON.stringify(body));
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await store.remove(path);
      return json({ ok: true });
    }
    return json({ error: "metodo" }, 405);
  },
};

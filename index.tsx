// Reel Management: sirve page.html y guarda los datos compartidos en SQLite (volumen en /data).
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const DIR = Bun.env.DATA_DIR || "/data";
try { mkdirSync(DIR, { recursive: true }); } catch (e) {}
const db = new Database(DIR + "/reel-management.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, body TEXT NOT NULL, updated INTEGER NOT NULL)");

const PATH = /^(guiones|comentarios|equipo|dias)\/[A-Za-z0-9_.:-]{1,80}$/;
const MAX_BODY = 200 * 1024;

const qAll = db.query("SELECT path, body FROM docs");
const qPut = db.query("INSERT INTO docs (path, body, updated) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET body = excluded.body, updated = excluded.updated");
const qDel = db.query("DELETE FROM docs WHERE path = ?");

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const PAGE = await Bun.file(new URL("./page.html", import.meta.url)).text();

Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname !== "/api/docs") return new Response("No encontrado", { status: 404 });
    if (Bun.env.ACCESS_CODE && request.headers.get("x-access-code") !== Bun.env.ACCESS_CODE) return json({ error: "clave" }, 401);
    if (request.method === "GET") { const docs = {}; for (const row of qAll.all()) docs[row.path] = JSON.parse(row.body); return json({ docs }); }
    const path = url.searchParams.get("path") || "";
    if (!PATH.test(path)) return json({ error: "path" }, 400);
    if (request.method === "PUT") {
      const t = await request.text();
      if (t.length > MAX_BODY) return json({ error: "muy grande" }, 413);
      let body; try { body = JSON.parse(t); } catch (e) { return json({ error: "json" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "json" }, 400);
      qPut.run(path, JSON.stringify(body), Date.now()); return json({ ok: true });
    }
    if (request.method === "DELETE") { qDel.run(path); return json({ ok: true }); }
    return json({ error: "metodo" }, 405);
  },
});
console.log("Reel Management escuchando en puerto " + (Bun.env.PORT || 3000));

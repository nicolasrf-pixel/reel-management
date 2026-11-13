// Reel Management: sirve page.html y guarda los datos compartidos en SQLite (volumen en /data).
// Avisa por correo (Brevo) cuando alguien edita.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const DIR = Bun.env.DATA_DIR || "/data";
try { mkdirSync(DIR, { recursive: true }); } catch (e) {}
const db = new Database(DIR + "/reel-management.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, body TEXT NOT NULL, updated INTEGER NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS cambios (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT NOT NULL, label TEXT NOT NULL, campo TEXT NOT NULL, detalle TEXT NOT NULL, origin TEXT NOT NULL)");

const PATH = /^(guiones|comentarios|equipo|dias)\/[A-Za-z0-9_.:-]{1,80}$/;
const MAX_BODY = 200 * 1024;
const CAMPOS = { titulo:"titulo",formato:"formato",estado:"estado",jornada:"jornada",grab:"fecha de grabacion",pub:"fecha de publicacion",dur:"duracion",resp:"responsable",talento:"quien sale en camara",loc:"locacion",proyecto:"proyecto",gancho:"gancho",escenas:"guion",pantalla:"texto en pantalla",audio:"audio",cta:"CTA y caption",prod:"produccion",ojo:"alertas",archivado:"archivado" };
const CON_VALOR = ["estado","grab","pub","resp","jornada","titulo"];
const esc = (s) => String(s).replace(/[&<>"]/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" })[c]);

const qAll = db.query("SELECT path, body FROM docs");
const qOne = db.query("SELECT body FROM docs WHERE path = ?");
const qPut = db.query("INSERT INTO docs (path, body, updated) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET body = excluded.body, updated = excluded.updated");
const qDel = db.query("DELETE FROM docs WHERE path = ?");
const qLog = db.query("INSERT INTO cambios (ts, who, label, campo, detalle, origin) VALUES (?, ?, ?, ?, ?, ?)");
const qCambios = db.query("SELECT id, who, label, campo, detalle, origin FROM cambios ORDER BY id");
const qClear = db.query("DELETE FROM cambios WHERE id <= ?");

let timer = null;
function schedule(ms){ if(timer) clearTimeout(timer); timer=setTimeout(()=>{ flush().catch((e)=>{ console.error("aviso por correo fallo:",e); schedule(5*60*1000); }); }, ms ?? Number(Bun.env.NOTIFY_DELAY_SECONDS||600)*1000); }
function log(meta,campo,detalle){ qLog.run(Date.now(),meta.who||"Alguien",meta.label||"",campo,detalle,meta.origin||""); schedule(); }
function previous(path){ const row=qOne.get(path); return row?JSON.parse(row.body):null; }
function put(path,body,meta){
  const before=previous(path);
  qPut.run(path,JSON.stringify(body),Date.now());
  const kind=path.split("/")[0];
  if(kind==="guiones"){
    for(const k of Object.keys(CAMPOS)){
      const a=(before&&before[k])||"", b=body[k]||"";
      if(a===b||(!before&&!b)) continue;
      if(k==="archivado") log(meta,k,b==="1"?"archivo el reel":"desarchivo el reel");
      else if(CON_VALOR.includes(k)) log(meta,k,"cambio "+CAMPOS[k]+" a: "+(b||"sin definir"));
      else log(meta,k,"edito "+CAMPOS[k]);
    }
  } else if(kind==="comentarios"&&!before){ log(meta,path,"comento: "+String(body.texto||"").slice(0,400)); }
  else if(kind==="equipo"&&!before){ log(meta,path,"agrego al equipo a "+(body.nombre||"")+(body.rol?" ("+body.rol+")":"")); }
  else if(kind==="dias"){ log(meta,path,"dejo una nota: "+String(body.nota||"").slice(0,200)); }
}
function remove(path,meta){
  const before=previous(path); qDel.run(path); if(!before) return;
  const kind=path.split("/")[0];
  if(kind==="guiones") log(meta,path,"volvio el reel a la sugerencia inicial");
  else if(kind==="comentarios") log(meta,path,"borro un comentario de "+(before.autor||"alguien"));
  else if(kind==="equipo") log(meta,path,"quito del equipo a "+(before.nombre||""));
  else if(kind==="dias") log(meta,path,"borro la nota del dia");
}
async function flush(){
  const rows=qCambios.all(); if(!rows.length) return;
  const lastId=rows[rows.length-1].id;
  const to=String(Bun.env.NOTIFY_TO||"").split(",").map((s)=>s.trim()).filter(Boolean);
  if(Bun.env.BREVO_API_KEY&&Bun.env.MAIL_FROM&&to.length){
    const groups=new Map();
    for(const r of rows){ const key=r.who+"\u0000"+r.label; if(!groups.has(key)) groups.set(key,{who:r.who,label:r.label,items:new Map()}); groups.get(key).items.set(r.campo,r.detalle); }
    const who=[...new Set(rows.map((r)=>r.who))];
    const origin=Bun.env.SITE_URL||rows[rows.length-1].origin;
    let html="<p>Hubo cambios en Reel Management:</p>", text="Hubo cambios en Reel Management:\n";
    for(const g of groups.values()){
      html+="<p><b>"+esc(g.who)+"</b> en <b>"+esc(g.label)+"</b></p><ul>"; text+="\n"+g.who+" en "+g.label+"\n";
      for(const d of g.items.values()){ html+="<li>"+esc(d)+"</li>"; text+="- "+d+"\n"; }
      html+="</ul>";
    }
    if(origin){ html+='<p><a href="'+esc(origin)+'">Abrir Reel Management</a></p>'; text+="\n"+origin+"\n"; }
    const res=await fetch(Bun.env.MAIL_API_URL||"https://api.brevo.com/v3/smtp/email",{ method:"POST", headers:{ "api-key":Bun.env.BREVO_API_KEY,"content-type":"application/json",accept:"application/json" }, body:JSON.stringify({ sender:{name:"Reel Management",email:Bun.env.MAIL_FROM}, to:to.map((email)=>({email})), subject:"Reel Management: cambios de "+who.join(" y "), htmlContent:html, textContent:text }) });
    if(!res.ok) throw new Error("Correo no enviado: "+res.status+" "+(await res.text()).slice(0,300));
  }
  qClear.run(lastId);
}
if(qCambios.all().length) schedule(30*1000);

const json=(data,status=200)=>new Response(JSON.stringify(data),{ status, headers:{ "content-type":"application/json; charset=utf-8","cache-control":"no-store" } });
const PAGE = await Bun.file(new URL("./page.html", import.meta.url)).text();

Bun.serve({
  port: Number(Bun.env.PORT||3000),
  async fetch(request){
    const url=new URL(request.url);
    const proto=request.headers.get("x-forwarded-proto")||url.protocol.replace(":","");
    const origin=proto+"://"+(request.headers.get("x-forwarded-host")||url.host);
    if(url.pathname==="/"||url.pathname==="/index.html") return new Response(PAGE,{ headers:{ "content-type":"text/html; charset=utf-8","cache-control":"no-cache" } });
    if(url.pathname==="/health") return new Response("ok");
    if(url.pathname!=="/api/docs") return new Response("No encontrado",{status:404});
    if(Bun.env.ACCESS_CODE&&request.headers.get("x-access-code")!==Bun.env.ACCESS_CODE) return json({error:"clave"},401);
    if(request.method==="GET"){ const docs={}; for(const row of qAll.all()) docs[row.path]=JSON.parse(row.body); return json({docs}); }
    const path=url.searchParams.get("path")||"";
    if(!PATH.test(path)) return json({error:"path"},400);
    const header=(n)=>{ try{ return decodeURIComponent(request.headers.get(n)||"").slice(0,200); }catch(e){ return ""; } };
    const meta={ who:header("x-user"), label:header("x-label"), origin };
    if(request.method==="PUT"){
      const t=await request.text();
      if(t.length>MAX_BODY) return json({error:"muy grande"},413);
      let body; try{ body=JSON.parse(t); }catch(e){ return json({error:"json"},400); }
      if(!body||typeof body!=="object"||Array.isArray(body)) return json({error:"json"},400);
      put(path,body,meta); return json({ok:true});
    }
    if(request.method==="DELETE"){ remove(path,meta); return json({ok:true}); }
    return json({error:"metodo"},405);
  },
});
console.log("Reel Management escuchando en puerto "+(Bun.env.PORT||3000));

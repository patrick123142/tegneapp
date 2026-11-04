'use strict';
// LAGER: serialisering, database (IndexedDB), automatisk gem, galleri og dialoger.

// ======================================================================
// Bid 6: lagring (flere lærreder), galleri og automatisk gem
// ======================================================================
// Hvert lærred gemmes i browserens database (IndexedDB) på tabletten:
//   "meta":  id, navn, tidspunkter, miniature (til galleriet)
//   "data":  selve tegningen (træet af niveauer med streger)
// Alt, der læses fra databasen, kontrolleres, før det bruges.

const FORMAT_NAVN = 'uendeligt-laerred';
const FORMAT_VERSION = 1;
const MAX_NODER = 20000;
const MAX_STROEGER = 300000;
const MAX_PUNKTER_PR_STREG = 1000000;
const MAX_PUNKTER_I_ALT = 30000000;
const STREG_TYPER = ['spids', 'blod', 'fyldepen', 'tusse', 'visk'];
const MAX_NAVN = 80;
const GEM_FORSINKELSE = 1500;   // ms efter sidste ændring, før der gemmes

let aktivtId = null;            // det lærred, der er åbent (null = ikke gemt noget sted)
let galleriAaben = true;
let optaget = false;
let aendringsNr = 0;
let gemtNr = 0;
let gemTimer = null, gemmer = false, gemIgen = false;
let sidstGemtKamera = null;

const galleriEl = document.getElementById('galleri');
const galleriGitter = document.getElementById('galleriGitter');
const galleriBesked = document.getElementById('galleriBesked');
const nytLaerredKnap = document.getElementById('nytLaerredKnap');
const importKnap = document.getElementById('importKnap');
const importInput = document.getElementById('importInput');
const knapGalleri = document.getElementById('knapGalleri');
const gemStatus = document.getElementById('gemStatus');
const dialogEl = document.getElementById('dialog');
const dialogTitel = document.getElementById('dialogTitel');
const dialogTekst = document.getElementById('dialogTekst');
const dialogInput = document.getElementById('dialogInput');
const dialogOk = document.getElementById('dialogOk');
const dialogAnnuller = document.getElementById('dialogAnnuller');

// ---------- serialisering ----------

function stregTilData(s) {
  if (!s._tp || s._tpN !== s.p.length) { s._tp = Float64Array.from(s.p); s._tpN = s.p.length; }
  let pr = null;
  if (s.pr) {
    if (!s._tr || s._trN !== s.pr.length) { s._tr = Float32Array.from(s.pr); s._trN = s.pr.length; }
    pr = s._tr;
  }
  return { id: s.id, t: s.t, c: s.c || null, m: !!s.m, a: typeof s.a === 'number' ? s.a : 1, w: s.w, p: s._tp, pr };
}

function tilData() {
  let top = start;
  while (top.parent) top = top.parent;
  // Behold kun niveauer med indhold, samt dem kameraet og startvisningen står i
  const behold = new Map();
  (function maal(n) {
    let ja = n === kamera.node || n === start || n.strokes.length > 0;
    for (const c of n.children) if (maal(c)) ja = true;
    behold.set(n, ja);
    return ja;
  })(top);
  const noder = [];
  const indeks = new Map();
  (function skriv(n, foraeldre) {
    indeks.set(n, noder.length);
    if (!n.nid) n.nid = nytId();   // fast id pr. niveau (bruges senere til deling og sammenfletning)
    noder.push({ parent: foraeldre, nid: n.nid, ox: n.ox, oy: n.oy, niveau: n.niveau, strokes: n.strokes.map(stregTilData) });
    for (const c of n.children) if (behold.get(c)) skriv(c, indeks.get(n));
  })(top, -1);
  return {
    format: FORMAT_NAVN,
    version: FORMAT_VERSION,
    naesteId,
    startIndex: indeks.get(start),
    kamera: { nodeIndex: indeks.get(kamera.node), x: kamera.x, y: kamera.y, zoom: kamera.zoom },
    noder
  };
}

function tomData() {
  return {
    format: FORMAT_NAVN, version: FORMAT_VERSION, naesteId: 1, startIndex: 0,
    kamera: { nodeIndex: 0, x: 0, y: 0, zoom: 1 },
    noder: [{ parent: -1, ox: 0, oy: 0, niveau: 0, strokes: [] }]
  };
}

function erTalVaerdi(x) { return typeof x === 'number' && isFinite(x); }
function erFelt(a) { return Array.isArray(a) || (ArrayBuffer.isView(a) && !(a instanceof DataView)); }

// Kontrollerer data og bygger et nyt træ. Kaster en fejl, hvis noget er forkert.
// Rører ikke ved det åbne lærred.
function byggFraData(d, gemtFlag) {
  const fejl = tekst => { throw new Error(tekst); };
  if (!d || typeof d !== 'object') fejl('Ingen data');
  if (d.format !== FORMAT_NAVN) fejl('Ukendt filformat');
  if (d.version !== FORMAT_VERSION) fejl('Ukendt version (' + String(d.version).slice(0, 10) + ')');
  if (!Array.isArray(d.noder) || d.noder.length < 1 || d.noder.length > MAX_NODER) fejl('Ugyldigt antal niveauer');
  if (!Number.isInteger(d.startIndex) || d.startIndex < 0 || d.startIndex >= d.noder.length) fejl('Ugyldig start');
  const kam = d.kamera;
  if (!kam || !Number.isInteger(kam.nodeIndex) || kam.nodeIndex < 0 || kam.nodeIndex >= d.noder.length) fejl('Ugyldig kamera');

  const noder = [];
  let strokeTotal = 0, punktTotal = 0, hoejesteId = 0;
  for (let i = 0; i < d.noder.length; i++) {
    const nd = d.noder[i];
    if (!nd || typeof nd !== 'object') fejl('Ugyldigt niveau');
    if (i === 0 ? nd.parent !== -1 : !(Number.isInteger(nd.parent) && nd.parent >= 0 && nd.parent < i)) fejl('Ugyldig forælder');
    if (!erTalVaerdi(nd.ox) || !erTalVaerdi(nd.oy) || !Number.isInteger(nd.niveau) || Math.abs(nd.niveau) > 100000) fejl('Ugyldigt niveau');
    if (!Array.isArray(nd.strokes)) fejl('Ugyldige streger');
    const node = nyNode(i === 0 ? null : noder[nd.parent], i === 0 ? 0 : nd.ox, i === 0 ? 0 : nd.oy, nd.niveau);
    if (i > 0) node.parent.children.push(node);
    if (typeof nd.nid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(nd.nid)) node.nid = nd.nid;
    noder.push(node);
  }
  for (let i = 0; i < d.noder.length; i++) {
    const nd = d.noder[i], node = noder[i];
    strokeTotal += nd.strokes.length;
    if (strokeTotal > MAX_STROEGER) fejl('For mange streger');
    for (const sd of nd.strokes) {
      if (!sd || typeof sd !== 'object') fejl('Ugyldig streg');
      if (!STREG_TYPER.includes(sd.t)) fejl('Ukendt penseltype');
      if (!Number.isInteger(sd.id) || sd.id < 1 || sd.id > 1e12) fejl('Ugyldigt streg-id');
      if (sd.c !== null && sd.c !== undefined && !erHex(sd.c)) fejl('Ugyldig farve');
      if (!(erTalVaerdi(sd.a) && sd.a >= 0.05 && sd.a <= 1)) fejl('Ugyldig styrke');
      if (!(erTalVaerdi(sd.w) && sd.w > 0)) fejl('Ugyldig bredde');
      if (!erFelt(sd.p) || sd.p.length < 2 || sd.p.length % 2 !== 0 || sd.p.length > MAX_PUNKTER_PR_STREG * 2) fejl('Ugyldige punkter');
      punktTotal += sd.p.length / 2;
      if (punktTotal > MAX_PUNKTER_I_ALT) fejl('For mange punkter');
      for (let k = 0; k < sd.p.length; k++) if (!erTalVaerdi(sd.p[k])) fejl('Ugyldigt punkt');
      let pr = null;
      if (sd.pr !== null && sd.pr !== undefined) {
        if (!erFelt(sd.pr) || sd.pr.length !== sd.p.length / 2) fejl('Ugyldigt tryk');
        for (let k = 0; k < sd.pr.length; k++) if (!(erTalVaerdi(sd.pr[k]) && sd.pr[k] >= 0 && sd.pr[k] <= 1)) fejl('Ugyldigt tryk');
        pr = Array.from(sd.pr);
      }
      const p = Array.from(sd.p);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        if (p[k] < minX) minX = p[k];
        if (p[k] > maxX) maxX = p[k];
        if (p[k + 1] < minY) minY = p[k + 1];
        if (p[k + 1] > maxY) maxY = p[k + 1];
      }
      const streg = {
        id: sd.id, t: sd.t, c: sd.t === 'visk' ? null : (sd.c ? sd.c.toLowerCase() : '#000000'),
        m: !!sd.m, a: sd.a, p, pr, w: sd.w, minX, maxX, minY, maxY,
        _lagret: !!gemtFlag    // ligger allerede i databasen (bruges af det trinvise gem)
      };
      node.strokes.push(streg);
      if (sd.id > hoejesteId) hoejesteId = sd.id;
      udvidBox(node, minX - sd.w / 2, maxX + sd.w / 2, minY - sd.w / 2, maxY + sd.w / 2);
    }
  }
  let zoom = kam.zoom, kx = kam.x, ky = kam.y;
  if (!(erTalVaerdi(zoom) && zoom > 0)) zoom = 1;
  if (!erTalVaerdi(kx) || !erTalVaerdi(ky)) { kx = 0; ky = 0; }
  return {
    start: noder[d.startIndex], kameraNode: noder[kam.nodeIndex], kx, ky, zoom,
    antal: strokeTotal, naesteId: hoejesteId + 1
  };
}

// Sæt et bygget lærred ind i editoren
function indlaes(b) {
  start = b.start;
  kamera.node = b.kameraNode;
  kamera.x = b.kx; kamera.y = b.ky; kamera.zoom = b.zoom;
  antalStreger = b.antal;
  naesteId = b.naesteId;
  fortrydStak.length = 0;
  gentagStak.length = 0;
  tegnerNu = null; tegnerNode = null;
  sletAktiv = false; sletItems = [];
  pegere.clear();
  bevaegelse = null; hoejreTraek = null;
  baseGyldig = false;
  baseKamera = null; forrigeKamera = null;
  tomAlleFliser();
  afventSlet.clear();
  skiftNiveau();
  sidstGemtKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  aendringsNr = 0; gemtNr = 0;
  opdaterKnapper();
  snavs = true;
}

// ---------- database ----------

function renMeta(m) {
  if (!m || typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.id)) return null;
  const mini = typeof m.miniature === 'string' && m.miniature.startsWith('data:image/png;base64,') &&
               m.miniature.length < 2000000 && /^[A-Za-z0-9+/=,:;]*$/.test(m.miniature.slice(0, 100)) ? m.miniature : null;
  return {
    id: m.id,
    navn: typeof m.navn === 'string' ? m.navn.slice(0, MAX_NAVN) : 'Lærred',
    oprettet: erTalVaerdi(m.oprettet) ? m.oprettet : 0,
    aendret: erTalVaerdi(m.aendret) ? m.aendret : 0,
    antal: Number.isInteger(m.antal) && m.antal >= 0 ? m.antal : 0,
    miniature: mini
  };
}

// Et lærred ligger i databasen som:
//   "struktur": niveauerne (uden streger), kameraet og tællere (lille)
//   "streger": én post pr. streg, med nøglen "<lærred>|<id>"
// Så gemmes kun nye streger, og gem koster det samme, uanset hvor stor tegningen er.
// (Ældre lærreder, gemt som én stor post i "data", flyttes til det nye format første gang de gemmes.)

function stregNoegle(laerredId, id) { return laerredId + '|' + String(id).padStart(12, '0'); }
function stregInterval(laerredId) { return IDBKeyRange.bound(laerredId + '|', laerredId + '|\uffff'); }
const RAEKKE_STOERRELSE = 4000;   // streger pr. læsning, så skærmen kan vise fremdrift

// Fra den samlede datastruktur (som i eksportfiler) til struktur + streg-poster
function dataTilPoster(id, data) {
  const nider = data.noder.map(n => (typeof n.nid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(n.nid)) ? n.nid : null);
  const set = new Set();
  for (let i = 0; i < nider.length; i++) {
    if (!nider[i] || set.has(nider[i])) nider[i] = nytId();
    set.add(nider[i]);
  }
  const struktur = {
    id, format: data.format, version: data.version, naesteId: data.naesteId,
    startNid: nider[data.startIndex],
    kamera: { nodeNid: nider[data.kamera.nodeIndex], x: data.kamera.x, y: data.kamera.y, zoom: data.kamera.zoom },
    noder: data.noder.map((n, i) => ({ nid: nider[i], parentNid: n.parent < 0 ? null : nider[n.parent], ox: n.ox, oy: n.oy, niveau: n.niveau }))
  };
  const streger = [];
  data.noder.forEach((n, i) => {
    for (const s of n.strokes) {
      streger.push({ k: stregNoegle(id, s.id), laerredId: id, nid: nider[i], id: s.id, t: s.t, c: s.c, m: s.m, a: s.a, w: s.w, p: s.p, pr: s.pr });
    }
  });
  return { struktur, streger };
}

// Modsat: saml struktur og streg-poster til den samlede datastruktur. Kontrolleres bagefter af byggFraData.
function posterTilData(st, streger) {
  if (!st || typeof st !== 'object' || !Array.isArray(st.noder) || st.noder.length < 1 || st.noder.length > MAX_NODER) throw new Error('Ugyldig struktur');
  const idx = new Map();
  st.noder.forEach((n, i) => {
    if (!n || typeof n.nid !== 'string' || idx.has(n.nid)) throw new Error('Ugyldigt niveau-id');
    idx.set(n.nid, i);
  });
  const noder = st.noder.map((n, i) => {
    let parent = -1;
    if (i > 0) { parent = idx.get(n.parentNid); if (parent === undefined) throw new Error('Ugyldig forælder'); }
    return { parent, nid: n.nid, ox: n.ox, oy: n.oy, niveau: n.niveau, strokes: [] };
  });
  for (const r of streger) {
    const i = r && idx.get(r.nid);
    if (i === undefined) throw new Error('En streg hører ikke til noget niveau');
    noder[i].strokes.push({ id: r.id, t: r.t, c: r.c, m: r.m, a: r.a, w: r.w, p: r.p, pr: r.pr });
  }
  const kam = st.kamera || {};
  return {
    format: st.format, version: st.version, naesteId: st.naesteId,
    startIndex: idx.get(st.startNid),
    kamera: { nodeIndex: idx.get(kam.nodeNid), x: kam.x, y: kam.y, zoom: kam.zoom },
    noder
  };
}

const lager = {
  db: null,
  init() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB mangler')); return; }
      const r = indexedDB.open('tegneapp', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('data')) d.createObjectStore('data', { keyPath: 'id' });       // ældre format
        if (!d.objectStoreNames.contains('struktur')) d.createObjectStore('struktur', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('streger')) d.createObjectStore('streger', { keyPath: 'k' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error || new Error('Kunne ikke åbne databasen'));
      r.onblocked = () => rej(new Error('Databasen er blokeret af en anden fane'));
    });
  },
  tx(lagre, tilstand, arbejde) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(lagre, tilstand);
      let svar;
      t.oncomplete = () => res(svar);
      t.onerror = () => rej(t.error || new Error('Databasefejl'));
      t.onabort = () => rej(t.error || new Error('Databasen afbrød handlingen'));
      arbejde(t, v => { svar = v; });
    });
  },
  alleMeta() {
    return this.tx(['meta'], 'readonly', (t, saet) => {
      const rq = t.objectStore('meta').getAll();
      rq.onsuccess = () => saet((rq.result || []).map(renMeta).filter(Boolean).sort((a, b) => b.aendret - a.aendret));
    });
  },
  // Henter et lærred som samlet datastruktur. nyFormat: false for lærreder gemt i det ældre format.
  async hentLaerred(id, fremskridt) {
    const st = await this.tx(['struktur'], 'readonly', (t, saet) => {
      const rq = t.objectStore('struktur').get(id);
      rq.onsuccess = () => saet(rq.result || null);
    });
    if (!st) {
      const gammel = await this.tx(['data'], 'readonly', (t, saet) => {
        const rq = t.objectStore('data').get(id);
        rq.onsuccess = () => saet(rq.result ? rq.result.data : null);
      });
      return gammel ? { data: gammel, nyFormat: false } : null;
    }
    const streger = [];
    let efter = null;
    for (;;) {
      const raekke = await this.tx(['streger'], 'readonly', (t, saet) => {
        const interval = efter === null ? stregInterval(id) : IDBKeyRange.bound(efter, id + '|\uffff', true, false);
        const rq = t.objectStore('streger').getAll(interval, RAEKKE_STOERRELSE);
        rq.onsuccess = () => saet(rq.result || []);
      });
      for (const r of raekke) streger.push(r);
      if (fremskridt) fremskridt(streger.length);
      if (raekke.length < RAEKKE_STOERRELSE) break;
      efter = raekke[raekke.length - 1].k;
    }
    return { data: posterTilData(st, streger), nyFormat: true };
  },
  async hentData(id) {
    const r = await this.hentLaerred(id);
    return r ? r.data : null;
  },
  opret(id, navn, data, antal, miniature) {
    const nu = Date.now();
    const { struktur, streger } = dataTilPoster(id, data);
    return this.tx(['meta', 'struktur', 'streger'], 'readwrite', t => {
      t.objectStore('meta').put({ id, navn, oprettet: nu, aendret: nu, miniature: miniature || null, antal: antal || 0 });
      t.objectStore('struktur').put(struktur);
      const st = t.objectStore('streger');
      for (const r of streger) st.put(r);
    });
  },
  // Trinvist gem: struktur, nye streger og fjernede streger i én handling
  gem(id, struktur, nye, slettede, miniature, antal) {
    return this.tx(['meta', 'struktur', 'streger', 'data'], 'readwrite', t => {
      const meta = t.objectStore('meta'), st = t.objectStore('streger');
      t.objectStore('struktur').put(struktur);
      t.objectStore('data').delete(id);                       // et ældre, samlet gem er nu overflødigt
      for (const sid of slettede) st.delete(stregNoegle(id, sid));
      for (const r of nye) st.put(r);
      const rq = meta.get(id);
      rq.onsuccess = () => {
        const gl = rq.result || { id, navn: 'Lærred', oprettet: Date.now() };
        meta.put({ id, navn: gl.navn, oprettet: gl.oprettet, aendret: Date.now(), miniature: miniature || gl.miniature || null, antal });
      };
    });
  },
  omdoeb(id, navn) {
    return this.tx(['meta'], 'readwrite', t => {
      const meta = t.objectStore('meta');
      const rq = meta.get(id);
      rq.onsuccess = () => { if (rq.result) { rq.result.navn = navn; meta.put(rq.result); } };
    });
  },
  slet(id) {
    return this.tx(['meta', 'data', 'struktur', 'streger'], 'readwrite', t => {
      t.objectStore('meta').delete(id);
      t.objectStore('data').delete(id);
      t.objectStore('struktur').delete(id);
      t.objectStore('streger').delete(stregInterval(id));
    });
  },
  async dupliker(id, nytId_, nytNavn) {
    const metaListe = await this.alleMeta();
    const m = metaListe.find(x => x.id === id);
    const r = await this.hentLaerred(id);
    if (!m || !r) throw new Error('Lærredet findes ikke mere');
    await this.opret(nytId_, nytNavn, r.data, m.antal, m.miniature);
  }
};

// ---------- trinvist gem: hvad er ændret siden sidst? ----------

const afventSlet = new Set();   // id'er på gemte streger, der er fjernet siden sidste gem

function stregFjernet(s) {
  s._fjernet = true;
  if (s._lagret) { afventSlet.add(s.id); s._lagret = false; }
}
function stregTilfoejet(s) { s._fjernet = false; }

// Saml det, der skal gemmes: strukturen og de streger, der ikke ligger i databasen endnu
function indsamlGem(laerredId) {
  let top = start;
  while (top.parent) top = top.parent;
  const behold = new Map();
  (function maal(n) {
    let ja = n === kamera.node || n === start || n.strokes.length > 0;
    for (const c of n.children) if (maal(c)) ja = true;
    behold.set(n, ja);
    return ja;
  })(top);
  const noder = [], nye = [], refs = [];
  (function skriv(n, foraeldreNid) {
    if (!n.nid) n.nid = nytId();
    noder.push({ nid: n.nid, parentNid: foraeldreNid, ox: n.ox, oy: n.oy, niveau: n.niveau });
    for (const s of n.strokes) {
      if (s._lagret || s === tegnerNu) continue;             // en streg under tegning gemmes først, når den er færdig
      const d = stregTilData(s);
      nye.push({ k: stregNoegle(laerredId, d.id), laerredId, nid: n.nid, id: d.id, t: d.t, c: d.c, m: d.m, a: d.a, w: d.w, p: d.p, pr: d.pr });
      refs.push(s);
    }
    for (const c of n.children) if (behold.get(c)) skriv(c, n.nid);
  })(top, null);
  const struktur = {
    id: laerredId, format: FORMAT_NAVN, version: FORMAT_VERSION, naesteId,
    startNid: start.nid,
    kamera: { nodeNid: kamera.node.nid, x: kamera.x, y: kamera.y, zoom: kamera.zoom },
    noder
  };
  return { struktur, nye, refs, slettede: Array.from(afventSlet) };
}

function nytId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* brug reserve */ }
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function renseNavn(t) {
  return String(t).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAVN);
}

// ---------- automatisk gem ----------

function markerAendret() {
  aendringsNr++;
  if (!aktivtId) return;
  gemStatus.textContent = 'Ikke gemt endnu';
  planlaegGem();
}

// Gem et øjeblik efter sidste ændring, men aldrig midt i en streg (så tegningen ikke hakker)
function planlaegGem() {
  if (gemTimer) clearTimeout(gemTimer);
  gemTimer = setTimeout(() => {
    gemTimer = null;
    if (tegnerNu || sletAktiv || pegere.size > 0) { planlaegGem(); return; }
    gemNu(false);
  }, GEM_FORSINKELSE);
}

function kameraAendretSidenGem() {
  return !sidstGemtKamera || sidstGemtKamera.node !== kamera.node || sidstGemtKamera.x !== kamera.x ||
         sidstGemtKamera.y !== kamera.y || sidstGemtKamera.zoom !== kamera.zoom;
}

function lavMiniature(tving) {
  try {
    if (brugFliser) {
      const kilde = tving ? sidsteBilledeTilMiniature(300) : kompSenest;
      if (!kilde) return null;
      const w = 240;
      const h = Math.max(1, Math.round(w * kilde.height / kilde.width));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, w, h);
      x.drawImage(kilde, 0, 0, w, h);
      return c.toDataURL('image/png');
    }
    sikrBase();
    if (!baseGyldig || !kameraLigBase()) {
      if (!tving) return null;
      tegnAltTilBase();
    }
    const w = 240;
    const h = Math.max(1, Math.round(w * baseCanvas.height / baseCanvas.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.drawImage(baseCanvas, 0, 0, w, h);
    return c.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

async function gemNu(medMiniature) {
  if (!aktivtId) return;
  if (gemTimer) { clearTimeout(gemTimer); gemTimer = null; }
  // Når man forlader lærredet (medMiniature), laves der altid en frisk miniature
  if (aendringsNr === gemtNr && !kameraAendretSidenGem() && !medMiniature) { return; }
  if (gemmer) { gemIgen = true; return; }
  gemmer = true;
  try {
    do {
      gemIgen = false;
      const id = aktivtId;
      const nr = aendringsNr;
      gemStatus.textContent = 'Gemmer…';
      const snap = indsamlGem(id);
      const kamKopi = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
      const mini = lavMiniature(medMiniature);
      await lager.gem(id, snap.struktur, snap.nye, snap.slettede, mini, antalStreger);
      if (id === aktivtId) {
        gemtNr = nr;
        sidstGemtKamera = kamKopi;
        for (const s of snap.refs) {
          if (s._fjernet) afventSlet.add(s.id);      // blev fjernet, mens der blev gemt: skal slettes ved næste gem
          else s._lagret = true;
        }
        for (const x of snap.slettede) afventSlet.delete(x);
      }
      gemStatus.textContent = 'Gemt';
    } while (gemIgen);
  } catch (e) {
    gemStatus.textContent = 'KUNNE IKKE GEMME' + (e && e.name === 'QuotaExceededError' ? ' (lageret er fuldt)' : '');
  } finally {
    gemmer = false;
  }
}

// ---------- dialog ----------

function visDialog(opt) {
  return new Promise(res => {
    dialogTitel.textContent = opt.titel;
    dialogTekst.textContent = opt.tekst || '';
    dialogInput.classList.toggle('skjult', opt.input === undefined);
    if (opt.input !== undefined) dialogInput.value = opt.input;
    dialogOk.textContent = opt.okTekst || 'OK';
    dialogEl.classList.remove('skjult');
    const luk = v => {
      dialogEl.classList.add('skjult');
      dialogOk.onclick = null;
      dialogAnnuller.onclick = null;
      dialogInput.onkeydown = null;
      res(v);
    };
    dialogOk.onclick = () => luk(opt.input !== undefined ? dialogInput.value : true);
    dialogAnnuller.onclick = () => luk(null);
    dialogInput.onkeydown = e => {
      if (e.key === 'Enter') dialogOk.onclick();
      else if (e.key === 'Escape') dialogAnnuller.onclick();
    };
    if (opt.input !== undefined) { dialogInput.focus(); dialogInput.select(); }
  });
}

// ---------- galleri ----------

function formaterDato(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
}

function visGalleriSkaerm(vis) {
  galleriAaben = vis;
  galleriEl.classList.toggle('skjult', !vis);
}

function knap(tekst, fn, klasse) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = tekst;
  if (klasse) b.className = klasse;
  b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  return b;
}

function byggKort(m) {
  const kort = document.createElement('div');
  kort.className = 'kort';
  const aabn = document.createElement('button');
  aabn.type = 'button';
  aabn.className = 'kortAabn';
  const bille = document.createElement('div');
  bille.className = 'miniature';
  if (m.miniature) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = m.miniature;
    bille.appendChild(img);
  }
  const navn = document.createElement('div');
  navn.className = 'kortNavn';
  navn.textContent = m.navn;
  const dato = document.createElement('div');
  dato.className = 'kortDato';
  dato.textContent = formaterDato(m.aendret) + (m.antal ? ' · ' + m.antal + ' streger' : ' · tomt');
  aabn.appendChild(bille);
  aabn.appendChild(navn);
  aabn.appendChild(dato);
  aabn.addEventListener('click', () => aabnLaerred(m.id));
  const raekke = document.createElement('div');
  raekke.className = 'raekke';
  raekke.appendChild(knap('Omdøb', () => omdoebLaerred(m)));
  raekke.appendChild(knap('Dupliker', () => duplikerLaerred(m)));
  raekke.appendChild(knap('Slet', () => sletLaerred(m)));
  const raekke2 = document.createElement('div');
  raekke2.className = 'raekke';
  raekke2.appendChild(knap('Gem som fil', () => eksporterLaerred(m)));
  kort.appendChild(aabn);
  kort.appendChild(raekke);
  kort.appendChild(raekke2);
  return kort;
}

async function opdaterGalleri() {
  try {
    const liste = await lager.alleMeta();
    while (galleriGitter.firstChild) galleriGitter.removeChild(galleriGitter.firstChild);
    for (const m of liste) galleriGitter.appendChild(byggKort(m));
    galleriBesked.textContent = liste.length ? '' : 'Du har ingen lærreder endnu. Tryk på "+ Nyt lærred" for at begynde.';
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke læse dine lærreder: ' + (e && e.message ? e.message : 'ukendt fejl');
  }
}

async function nytLaerred() {
  if (optaget) return;
  optaget = true;
  try {
    const liste = await lager.alleMeta();
    let n = liste.length + 1;
    const navne = new Set(liste.map(m => m.navn));
    while (navne.has('Lærred ' + n)) n++;
    const id = nytId();
    await lager.opret(id, 'Lærred ' + n, tomData());
    optaget = false;
    await aabnLaerred(id);
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke oprette lærredet: ' + (e && e.message ? e.message : 'ukendt fejl');
  } finally {
    optaget = false;
  }
}

async function aabnLaerred(id) {
  if (optaget) return;
  optaget = true;
  galleriBesked.textContent = 'Åbner…';
  try {
    const r = await lager.hentLaerred(id, n => { galleriBesked.textContent = 'Åbner… ' + n + ' streger indlæst'; });
    if (!r) throw new Error('Lærredet findes ikke mere');
    galleriBesked.textContent = 'Åbner…';
    const bygget = byggFraData(r.data, r.nyFormat);
    aktivtId = id;
    indlaes(bygget);
    if (!r.nyFormat) markerAendret();                 // ældre lærred: flyttes til det nye format ved næste gem
    else gemStatus.textContent = 'Gemt';
    galleriBesked.textContent = '';
    visGalleriSkaerm(false);
    skaler();
  } catch (e) {
    galleriBesked.textContent = 'Lærredet kunne ikke åbnes (' + (e && e.message ? e.message : 'ukendt fejl') + ').';
  } finally {
    optaget = false;
  }
}

async function aabnUdenLagring() {
  aktivtId = null;
  indlaes(byggFraData(tomData(), false));
  gemStatus.textContent = 'Gemmes ikke';
  visGalleriSkaerm(false);
  skaler();
}

async function tilGalleri() {
  if (optaget) return;
  optaget = true;
  try {
    afbrydStreg();
    afslutSlet();
    pegere.clear();
    bevaegelse = null;
    if (aktivtId) await gemNu(true);
    // vent, hvis et gem stadig kører
    while (gemmer) await new Promise(r => setTimeout(r, 20));
    aktivtId = null;
    visGalleriSkaerm(true);
    await opdaterGalleri();
  } finally {
    optaget = false;
  }
}

async function omdoebLaerred(m) {
  const v = await visDialog({ titel: 'Omdøb lærred', input: m.navn, okTekst: 'Gem' });
  if (v === null) return;
  const navn = renseNavn(v);
  if (!navn) return;
  try { await lager.omdoeb(m.id, navn); } catch (e) { galleriBesked.textContent = 'Kunne ikke omdøbe.'; }
  await opdaterGalleri();
}

async function duplikerLaerred(m) {
  try {
    await lager.dupliker(m.id, nytId(), renseNavn(m.navn + ' (kopi)'));
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke duplikere: ' + (e && e.message ? e.message : 'ukendt fejl');
  }
  await opdaterGalleri();
}

async function sletLaerred(m) {
  const ok = await visDialog({ titel: 'Slet lærred?', tekst: '"' + m.navn + '" slettes for altid. Det kan ikke fortrydes.', okTekst: 'Slet' });
  if (!ok) return;
  try { await lager.slet(m.id); } catch (e) { galleriBesked.textContent = 'Kunne ikke slette.'; }
  await opdaterGalleri();
}



// ---------- eksport og import (filer) ----------
// En fil er ren tekst (JSON). Selve punkterne er pakket som base64 for at fylde mindre.
// Alt, der læses ind fra en fil, kontrolleres i to trin: først strukturen (afkodData),
// derefter alle værdier (byggFraData), før det kommer i databasen.

const FIL_FORMAT = 'uendeligt-laerred-fil';
const FIL_VERSION = 1;
const MAX_FILSTOERRELSE = 150 * 1024 * 1024;   // 150 MB

function enhedErLittleEndian() { return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1; }

function tilBase64(felt) {
  const bytes = new Uint8Array(felt.buffer, felt.byteOffset, felt.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fraBase64(tekst, Type, maxElementer) {
  if (typeof tekst !== 'string') throw new Error('Ugyldigt talfelt');
  if (tekst.length > Math.ceil(maxElementer * Type.BYTES_PER_ELEMENT * 4 / 3) + 8) throw new Error('Et talfelt er for stort');
  let bin;
  try { bin = atob(tekst); } catch (e) { throw new Error('Ugyldigt talfelt'); }
  if (bin.length === 0 || bin.length % Type.BYTES_PER_ELEMENT !== 0) throw new Error('Ugyldig længde på talfelt');
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(buf);
}

// Gør data klar til at skrive i en fil
function kodData(d) {
  if (!enhedErLittleEndian()) throw new Error('Denne enhed understøttes ikke til eksport');
  return {
    format: d.format, version: d.version, naesteId: d.naesteId, startIndex: d.startIndex, kamera: d.kamera,
    noder: d.noder.map(n => ({
      parent: n.parent, nid: n.nid, ox: n.ox, oy: n.oy, niveau: n.niveau,
      strokes: n.strokes.map(s => ({
        id: s.id, t: s.t, c: s.c, m: s.m, a: s.a, w: s.w,
        p: tilBase64(Float64Array.from(s.p)),
        pr: s.pr ? tilBase64(Float32Array.from(s.pr)) : null
      }))
    }))
  };
}

// Modsat af kodData. Kontrollerer strukturen og pakker talfelterne ud.
function afkodData(d) {
  if (!enhedErLittleEndian()) throw new Error('Denne enhed understøttes ikke til import');
  if (!d || typeof d !== 'object' || !Array.isArray(d.noder)) throw new Error('Ugyldig tegning i filen');
  if (d.noder.length < 1 || d.noder.length > MAX_NODER) throw new Error('Ugyldigt antal niveauer');
  let total = 0;
  const noder = d.noder.map(n => {
    if (!n || typeof n !== 'object' || !Array.isArray(n.strokes)) throw new Error('Ugyldigt niveau i filen');
    total += n.strokes.length;
    if (total > MAX_STROEGER) throw new Error('For mange streger');
    return {
      parent: n.parent, nid: n.nid, ox: n.ox, oy: n.oy, niveau: n.niveau,
      strokes: n.strokes.map(s => {
        if (!s || typeof s !== 'object') throw new Error('Ugyldig streg i filen');
        return {
          id: s.id, t: s.t, c: s.c, m: s.m, a: s.a, w: s.w,
          p: fraBase64(s.p, Float64Array, MAX_PUNKTER_PR_STREG * 2),
          pr: s.pr === null || s.pr === undefined ? null : fraBase64(s.pr, Float32Array, MAX_PUNKTER_PR_STREG)
        };
      })
    };
  });
  return { format: d.format, version: d.version, naesteId: d.naesteId, startIndex: d.startIndex, kamera: d.kamera, noder };
}

function filnavnFra(navn) {
  const rent = renseNavn(navn).replace(/[^A-Za-z0-9æøåÆØÅ _.-]/g, '_').slice(0, 60).trim();
  return (rent || 'laerred') + '.laerred.json';
}

function gemBlobSomFil(blob, filnavn) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filnavn;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function eksporterLaerred(m) {
  try {
    galleriBesked.textContent = 'Gør filen klar…';
    const data = await lager.hentData(m.id);
    if (!data) throw new Error('Lærredet findes ikke mere');
    const fil = { format: FIL_FORMAT, filVersion: FIL_VERSION, navn: m.navn, eksporteret: new Date().toISOString(), data: kodData(data) };
    gemBlobSomFil(new Blob([JSON.stringify(fil)], { type: 'application/json' }), filnavnFra(m.navn));
    galleriBesked.textContent = 'Gemte »' + m.navn + '« som fil (se mappen Downloads).';
  } catch (e) {
    galleriBesked.textContent = 'Kunne ikke gemme som fil: ' + (e && e.message ? e.message : 'ukendt fejl');
  }
}

async function importerFil(fil) {
  if (!fil) return;
  if (fil.size > MAX_FILSTOERRELSE) { galleriBesked.textContent = 'Filen er for stor (over 150 MB).'; return; }
  try {
    galleriBesked.textContent = 'Læser filen…';
    const tekst = await fil.text();
    let j;
    try { j = JSON.parse(tekst); } catch (e) { throw new Error('Filen er ikke en gyldig tegnefil'); }
    if (!j || typeof j !== 'object' || j.format !== FIL_FORMAT) throw new Error('Det er ikke en fil fra denne app');
    if (j.filVersion !== FIL_VERSION) throw new Error('Ukendt filversion');
    const data = afkodData(j.data);
    const bygget = byggFraData(data);     // kontrol af alle værdier
    const navn = renseNavn(typeof j.navn === 'string' ? j.navn : '') || 'Importeret lærred';
    await lager.opret(nytId(), navn, data, bygget.antal);
    await opdaterGalleri();
    galleriBesked.textContent = 'Importerede »' + navn + '« (' + bygget.antal + ' streger).';
  } catch (e) {
    galleriBesked.textContent = 'Filen kunne ikke bruges (' + (e && e.message ? e.message : 'ukendt fejl') + ').';
  }
}

async function startApp() {
  visGalleriSkaerm(true);
  gemStatus.textContent = '';
  try {
    await lager.init();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ikke vigtigt */ }
    await opdaterGalleri();
  } catch (e) {
    galleriBesked.textContent = 'Lagring er ikke tilgængelig her, så tegninger kan ikke gemmes. ';
    galleriBesked.appendChild(knap('Tegn alligevel uden at gemme', aabnUdenLagring));
    nytLaerredKnap.disabled = true;
  }
}


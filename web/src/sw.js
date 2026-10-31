// Service worker : le site s'ouvre sans réseau (cahier des charges §10).
// Les données des pharmacies et des gardes sont gardées par l'application
// elle-même (localStorage) ; ici on garde seulement les fichiers du site.
const VERSION = '%VERSION%';
const FICHIERS = '%FICHIERS%';
const CACHE = `pharmacies-gabon-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c.startsWith('pharmacies-gabon-') && c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  const url = new URL(requete.url);
  // Seulement les fichiers du site : Supabase, cartes et CDN passent sans détour.
  if (requete.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages : réseau d'abord (nouvelle version tout de suite), cache si hors ligne.
  if (requete.mode === 'navigate') {
    e.respondWith(
      fetch(requete)
        .then((r) => { const copie = r.clone(); caches.open(CACHE).then((c) => c.put('/', copie)); return r; })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Fichiers à empreinte : le cache suffit, ils ne changent jamais.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(requete).then((r) => r ?? fetch(requete)));
    return;
  }

  // Le reste (icônes, modèles) : cache, puis mise à jour en arrière-plan.
  e.respondWith(
    caches.match(requete).then((enCache) => {
      const reseau = fetch(requete).then((r) => {
        if (r.ok) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(requete, copie)); }
        return r;
      }).catch(() => enCache);
      return enCache ?? reseau;
    }),
  );
});

// Leaflet (cartes OpenStreetMap), chargé seulement quand une carte s'affiche.
const BASE = 'https://unpkg.com/leaflet@1.9.4/dist/';
export const LIBREVILLE = [0.4162, 9.4673];
let chargement;

export function chargerLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  chargement ??= new Promise((ok, ko) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${BASE}leaflet.css`;
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    css.crossOrigin = '';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `${BASE}leaflet.js`;
    js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    js.crossOrigin = '';
    js.onload = () => ok(window.L);
    js.onerror = () => { chargement = null; ko(new Error('Carte indisponible')); };
    document.head.append(js);
  });
  return chargement;
}

export function fondDeCarte(L) {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© contributeurs OpenStreetMap',
  });
}

import { useEffect, useRef, useState } from 'react';

// Carte OpenStreetMap (Leaflet, chargé à la demande) pour placer une pharmacie.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
const LIBREVILLE = [0.4162, 9.4673];
let chargement;

function chargerLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  chargement ??= new Promise((ok, ko) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${LEAFLET}leaflet.css`;
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `${LEAFLET}leaflet.js`;
    js.onload = () => ok(window.L);
    js.onerror = () => { chargement = null; ko(new Error('Carte indisponible')); };
    document.head.append(js);
  });
  return chargement;
}

export default function Carte({ latitude, longitude, onChoisir }) {
  const boite = useRef();
  const carte = useRef();
  const repere = useRef();
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let detruit = false;
    chargerLeaflet().then((L) => {
      if (detruit || carte.current) return;
      const position = latitude != null && longitude != null ? [latitude, longitude] : LIBREVILLE;
      carte.current = L.map(boite.current).setView(position, latitude != null ? 16 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© contributeurs OpenStreetMap',
      }).addTo(carte.current);
      if (latitude != null) repere.current = L.marker(position).addTo(carte.current);
      carte.current.on('click', (e) => {
        const { lat, lng } = e.latlng;
        if (repere.current) repere.current.setLatLng(e.latlng);
        else repere.current = L.marker(e.latlng).addTo(carte.current);
        onChoisir(Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6);
      });
    }).catch((e) => setErreur(e.message));
    return () => { detruit = true; carte.current?.remove(); carte.current = null; repere.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!carte.current || latitude == null || longitude == null || !window.L) return;
    if (repere.current) repere.current.setLatLng([latitude, longitude]);
    else repere.current = window.L.marker([latitude, longitude]).addTo(carte.current);
  }, [latitude, longitude]);

  if (erreur) return <p className="discret">Carte indisponible (connexion ?). Saisissez la latitude et la longitude.</p>;
  return <div className="carte" ref={boite} aria-label="Carte : cliquez à l'emplacement de la pharmacie" />;
}

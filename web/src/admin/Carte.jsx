import { useEffect, useRef, useState } from 'react';
// Carte OpenStreetMap pour placer une pharmacie.
import { chargerLeaflet, fondDeCarte, LIBREVILLE } from '../lib/leaflet.js';

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
      fondDeCarte(L).addTo(carte.current);
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

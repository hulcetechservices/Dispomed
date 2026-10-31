import { useEffect, useRef, useState } from 'react';
import { chargerLeaflet, fondDeCarte, LIBREVILLE } from '../lib/leaflet.js';
import { echapperHtml } from '../lib/html.js';

// Carte des pharmacies affichées. Pastille verte : ouverte ; bleu nuit : de garde ;
// grise : fermée. Un clic ouvre une bulle avec un lien vers la fiche.
export default function CartePharmacies({ pharmacies, position, onOuvrir }) {
  const boite = useRef();
  const carte = useRef();
  const calque = useRef();
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let detruit = false;
    chargerLeaflet().then((L) => {
      if (detruit) return;
      carte.current = L.map(boite.current, { zoomControl: true }).setView(LIBREVILLE, 12);
      fondDeCarte(L).addTo(carte.current);
      calque.current = L.layerGroup().addTo(carte.current);
      dessiner(L);
    }).catch((e) => setErreur(e.message));
    return () => { detruit = true; carte.current?.remove(); carte.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (window.L && carte.current) dessiner(window.L); });

  function dessiner(L) {
    calque.current.clearLayers();
    const points = [];
    for (const p of pharmacies) {
      if (p.latitude == null) continue;
      const couleur = { garde: '#263a85', ouverte: '#1f7a45', fermee: '#7a8584' }[p.etat.statut];
      const m = L.circleMarker([p.latitude, p.longitude], {
        radius: 9, color: '#fff', weight: 2, fillColor: couleur, fillOpacity: 1,
      }).addTo(calque.current);
      const bulle = document.createElement('div');
      bulle.innerHTML = `<strong>${echapperHtml(p.nom)}</strong><br>${echapperHtml(p.etat.libelle)}<br>`;
      const lien = document.createElement('a');
      lien.href = `/pharmacie/${p.id}`;
      lien.textContent = 'Voir la fiche';
      lien.addEventListener('click', (e) => { e.preventDefault(); onOuvrir(p.id); });
      bulle.append(lien);
      m.bindPopup(bulle);
      points.push([p.latitude, p.longitude]);
    }
    if (position) {
      L.circleMarker([position.latitude, position.longitude], {
        radius: 7, color: '#1b6fd1', weight: 3, fillColor: '#fff', fillOpacity: 1,
      }).addTo(calque.current).bindTooltip('Vous êtes ici');
      points.push([position.latitude, position.longitude]);
    }
    if (points.length) carte.current.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
  }

  const sansPosition = pharmacies.filter((p) => p.latitude == null).length;
  if (erreur) return <p className="discret">La carte n'a pas pu se charger (connexion faible ?). La liste reste disponible.</p>;
  return (
    <div className="pile">
      <div className="carte carte-patient" ref={boite} role="region" aria-label="Carte des pharmacies" />
      <p className="legende discret">
        <span className="point garde" /> De garde <span className="point ouverte" /> Ouverte <span className="point fermee" /> Fermée
        {sansPosition > 0 && `. ${sansPosition} pharmacie${sansPosition > 1 ? 's' : ''} sans position, visibles dans la liste.`}
      </p>
    </div>
  );
}

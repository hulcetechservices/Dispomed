import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etatPharmacie, distanceKm, libelleDistance, quartiersDepuis, preparerListe, lienTelephone, lienItineraire,
} from '../src/lib/ouverture.js';

// Instants exprimés en UTC ; Libreville = UTC+1. Le 2 novembre 2026 est un lundi.
const LUNDI_10H = new Date('2026-11-02T09:00:00Z');
const LUNDI_22H = new Date('2026-11-02T21:00:00Z');
const LUNDI_13H = new Date('2026-11-02T12:00:00Z');
const SAMEDI_21H = new Date('2026-11-07T20:00:00Z');

const SEMAINE = [1, 2, 3, 4, 5, 6].flatMap((jour) => [
  { jour, ouverture: '08:00', fermeture: '12:30' },
  { jour, ouverture: '15:00', fermeture: '20:00' },
]);

test('ouverte pendant une plage, avec l’heure de fermeture', () => {
  const e = etatPharmacie({ horaires: SEMAINE }, LUNDI_10H);
  assert.equal(e.statut, 'ouverte');
  assert.equal(e.libelle, "Ouverte jusqu'à 12 h 30");
});

test('pause de midi : fermée, rouvre l’après-midi', () => {
  assert.equal(etatPharmacie({ horaires: SEMAINE }, LUNDI_13H).libelle, 'Fermée, ouvre à 15 h');
});

test('le soir : fermée, ouvre demain ; samedi soir : ouvre lundi', () => {
  assert.equal(etatPharmacie({ horaires: SEMAINE }, LUNDI_22H).libelle, 'Fermée, ouvre demain à 8 h');
  assert.equal(etatPharmacie({ horaires: SEMAINE }, SAMEDI_21H).libelle, 'Fermée, ouvre lundi à 8 h');
});

test('de garde la nuit : ouverte même hors horaires (RG-07)', () => {
  const gardes = [{ debut: '2026-11-02T19:00:00Z', fin: '2026-11-03T07:00:00Z' }];
  const e = etatPharmacie({ horaires: SEMAINE, gardes }, LUNDI_22H);
  assert.equal(e.statut, 'garde');
  assert.equal(e.ouverte, true);
  assert.equal(e.libelle, "De garde jusqu'à 8 h");
});

test('garde plus tard dans la journée : annoncée', () => {
  const gardes = [{ debut: '2026-11-02T19:00:00Z', fin: '2026-11-03T07:00:00Z' }];
  const e = etatPharmacie({ horaires: SEMAINE, gardes }, LUNDI_10H);
  assert.equal(e.gardeAujourdhui, true);
  assert.equal(e.libelle, "Ouverte jusqu'à 12 h 30, de garde dès 20 h");
});

test('24 h/24, fermeture à minuit, horaires inconnus', () => {
  const tout = [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour, ouverture: '00:00', fermeture: '00:00' }));
  assert.equal(etatPharmacie({ horaires: tout }, LUNDI_22H).libelle, 'Ouverte 24 h/24');
  assert.equal(etatPharmacie({ horaires: [{ jour: 1, ouverture: '18:00', fermeture: '00:00' }] }, LUNDI_22H).libelle, "Ouverte jusqu'à minuit");
  assert.equal(etatPharmacie({}, LUNDI_22H).libelle, 'Horaires non renseignés');
});

test('distances', () => {
  // Glass → Angondjé : environ 18 km
  const d = distanceKm({ latitude: 0.3924, longitude: 9.4536 }, { latitude: 0.5312, longitude: 9.3301 });
  assert.ok(d > 17 && d < 22, `distance ${d}`);
  assert.equal(distanceKm(null, { latitude: 0, longitude: 9 }), null);
  assert.equal(libelleDistance(0.42), '400 m');
  assert.equal(libelleDistance(2.34), '2,3 km');
  assert.equal(libelleDistance(18.6), '19 km');
});

test('quartiers déduits des pharmacies, sans coordonnées inventées', () => {
  const q = quartiersDepuis([
    { commune: 'libreville', quartier: 'Glass', latitude: 0.39, longitude: 9.45 },
    { commune: 'libreville', quartier: 'glass ', latitude: 0.41, longitude: 9.47 },
    { commune: 'akanda', quartier: 'Angondjé', latitude: 0.53, longitude: 9.33 },
    { commune: 'owendo', quartier: 'Port', latitude: null, longitude: null },
  ]);
  assert.deepEqual(q.map((x) => x.quartier), ['Angondjé', 'Glass']);
  assert.ok(Math.abs(q[1].latitude - 0.40) < 1e-9);
});

test('liste : gardes du jour, CNAMGS, ouvertes puis les plus proches', () => {
  const donnees = {
    pharmacies: [
      { id: 'a', nom: 'Loin ouverte', commune: 'libreville', accepte_cnamgs: true, latitude: 0.50, longitude: 9.40 },
      { id: 'b', nom: 'Près fermée', commune: 'libreville', accepte_cnamgs: true, latitude: 0.40, longitude: 9.45 },
      { id: 'c', nom: 'Près ouverte sans CNAMGS', commune: 'libreville', accepte_cnamgs: false, latitude: 0.401, longitude: 9.451 },
    ],
    horaires: [
      { pharmacie_id: 'a', jour: 1, ouverture: '00:00', fermeture: '00:00' },
      { pharmacie_id: 'c', jour: 1, ouverture: '00:00', fermeture: '00:00' },
    ],
    gardes: [{ pharmacie_id: 'b', debut: '2026-11-02T19:00:00Z', fin: '2026-11-03T07:00:00Z' }],
  };
  const pos = { latitude: 0.40, longitude: 9.45 };
  assert.deepEqual(preparerListe(donnees, { position: pos, maintenant: LUNDI_10H }).map((p) => p.id), ['c', 'a', 'b']);
  assert.deepEqual(preparerListe(donnees, { position: pos, cnamgs: true, maintenant: LUNDI_10H }).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(preparerListe(donnees, { gardeSeulement: true, maintenant: LUNDI_10H }).map((p) => p.id), ['b']);
});

test('liens appel et itinéraire', () => {
  assert.equal(lienTelephone('+241 01 72 00 01'), 'tel:+24101720001');
  assert.match(lienItineraire({ latitude: 0.39, longitude: 9.45 }), /destination=0\.39,9\.45$/);
  assert.match(lienItineraire({ nom: 'Pharmacie du Port', commune: 'owendo' }), /query=Pharmacie%20du%20Port%2C%20owendo%2C%20Gabon$/);
});

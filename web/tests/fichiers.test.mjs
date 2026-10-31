import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyserCsv, versObjets, lireDate, lireHeure, periodeGarde, normaliser,
} from '../src/lib/fichiers.js';
import {
  versInstant, enLibreville, lundiDe, libelleJour, libelleHeure, dateLibreville,
} from '../src/lib/temps.js';

const CHAMPS = {
  pharmacie: { alias: ['pharmacie', 'nom'], obligatoire: true, libelle: 'pharmacie' },
  commune: { alias: ['commune'], libelle: 'commune' },
};

test('CSV point-virgule, guillemets et BOM', () => {
  assert.deepEqual(analyserCsv('﻿nom;commune\r\n"Pharmacie ""du Port""";Owendo\r\n'),
    [['nom', 'commune'], ['Pharmacie "du Port"', 'Owendo']]);
});

test('colonnes reconnues malgré accents et casse, colonne obligatoire manquante signalée', () => {
  const ok = versObjets([['Nom', 'COMMUNE'], ['Pharmacie A', 'Akanda'], ['', '']], CHAMPS);
  assert.deepEqual(ok.lignes, [{ ligne: 2, pharmacie: 'Pharmacie A', commune: 'Akanda' }]);
  assert.deepEqual(versObjets([['commune'], ['x']], CHAMPS).manquantes, ['pharmacie']);
  assert.equal(normaliser("  Pharmacie de l'Estuaire "), 'pharmacie de l estuaire');
});

test('dates : format français jour/mois, ISO, Excel, et dates impossibles refusées', () => {
  assert.equal(lireDate('02/11/2026'), '2026-11-02');
  assert.equal(lireDate('2/11/26'), '2026-11-02');
  assert.equal(lireDate('2026-11-02'), '2026-11-02');
  assert.equal(lireDate(new Date(2026, 10, 2)), '2026-11-02');
  assert.equal(lireDate('31/02/2026'), null);
  assert.equal(lireDate('demain'), null);
});

test('heures : 20:00, 20h, 8 h 30, fraction Excel, 24:00', () => {
  assert.equal(lireHeure('20:00'), '20:00');
  assert.equal(lireHeure('20h'), '20:00');
  assert.equal(lireHeure('8 h 30'), '08:30');
  assert.equal(lireHeure(0.8333333), '20:00');
  assert.equal(lireHeure('24:00'), '24:00');
  assert.equal(lireHeure('25h'), null);
});

test('garde de nuit sans date de fin : se termine le lendemain', () => {
  assert.deepEqual(periodeGarde({ date_debut: '02/11/2026', heure_debut: '20h', date_fin: '', heure_fin: '8h' }),
    { debut: '2026-11-02T20:00', fin: '2026-11-03T08:00' });
  assert.deepEqual(periodeGarde({ date_debut: '30/11/2026', heure_debut: '08:00', date_fin: '', heure_fin: '20:00' }),
    { debut: '2026-11-30T08:00', fin: '2026-11-30T20:00' });
  assert.deepEqual(periodeGarde({ date_debut: '31/12/2026', heure_debut: '20:00', date_fin: '', heure_fin: '24:00' }),
    { debut: '2026-12-31T20:00', fin: '2027-01-01T00:00' });
  assert.equal(periodeGarde({ date_debut: '02/11/2026', heure_debut: 'soir', date_fin: '', heure_fin: '8h' }), null);
});

test('heure de Libreville (UTC+1)', () => {
  assert.equal(versInstant('2026-11-02T20:00'), '2026-11-02T19:00:00.000Z');
  assert.equal(enLibreville('2026-11-02T23:30:00Z').jour, 3);
  assert.equal(libelleHeure('2026-11-02T19:00:00Z'), '20 h');
  assert.equal(libelleHeure('2026-11-02T07:30:00Z'), '8 h 30');
  assert.equal(dateLibreville(new Date('2026-10-31T23:30:00Z')), '2026-11-01');
});

test('semaines', () => {
  assert.equal(lundiDe('2026-11-01'), '2026-10-26'); // dimanche → lundi précédent
  assert.equal(lundiDe('2026-11-02'), '2026-11-02');
  assert.equal(libelleJour('2026-11-02'), 'lundi 2 nov.');
});

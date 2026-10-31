import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyserCsv, detecterSeparateur, correspondreColonnes, versLignesImport, normaliserEntete,
} from '../src/csv.js';
import { depuis, html, brut, echapper } from '../src/format.js';

test('séparateur point-virgule détecté (export Excel français)', () => {
  assert.equal(detecterSeparateur('Code;Désignation;Qté\nA;B;1'), ';');
  assert.equal(detecterSeparateur('code,nom,quantite\n'), ',');
  assert.equal(detecterSeparateur('code\tnom\tqte'), '\t');
});

test('guillemets, "" et retours à la ligne CRLF', () => {
  const t = '﻿code;nom;qte\r\nP1;"Sirop ""enfant"" 125 ml";4\r\nP2;"Gel; 2%";10\r\n';
  assert.deepEqual(analyserCsv(t), [
    ['code', 'nom', 'qte'],
    ['P1', 'Sirop "enfant" 125 ml', '4'],
    ['P2', 'Gel; 2%', '10'],
  ]);
});

test('guillemet au milieu d\'un champ non protégé : gardé tel quel', () => {
  assert.deepEqual(analyserCsv('code;nom\nP1;Crème 5" tube\n'), [['code', 'nom'], ['P1', 'Crème 5" tube']]);
});

test('en-têtes reconnus malgré accents, casse et underscores', () => {
  assert.equal(normaliserEntete('  Quantité_En-Stock '), 'quantite en stock');
  const { colonnes, manquantes } = correspondreColonnes(['Code CIP', 'Désignation', 'Qté', 'Prix de vente']);
  assert.deepEqual(colonnes, { code: 0, nom: 1, quantite: 2, prix: 3 });
  assert.deepEqual(manquantes, []);
});

test('colonne obligatoire manquante signalée', () => {
  const r = versLignesImport([['nom', 'prix'], ['X', '1']]);
  assert.deepEqual(r.manquantes, ['code', 'quantite']);
  assert.equal(r.lignes.length, 0);
});

test('lignes vides ignorées, numéros de ligne du fichier conservés', () => {
  const r = versLignesImport(analyserCsv('code;nom;quantite;prix\nP1;Para;12;1500\n;;;\nP2;Amox; 3 ;\n'));
  assert.deepEqual(r.lignes, [
    { ligne: 2, code: 'P1', nom: 'Para', quantite: '12', prix: '1500' },
    { ligne: 4, code: 'P2', nom: 'Amox', quantite: '3', prix: '' },
  ]);
});

test('colonne prix absente : prix vide', () => {
  const r = versLignesImport([['code', 'qte'], ['P1', '5']]);
  assert.equal(r.lignes[0].prix, '');
  assert.equal(r.lignes[0].nom, '');
});

test('durées relatives', () => {
  const m = new Date('2026-10-31T12:00:00Z');
  assert.equal(depuis('2026-10-31T11:59:40Z', m), "à l'instant");
  assert.equal(depuis('2026-10-31T11:35:00Z', m), 'il y a 25 min');
  assert.equal(depuis('2026-10-31T09:00:00Z', m), 'il y a 3 h');
  assert.equal(depuis('2026-10-28T12:00:00Z', m), 'il y a 3 j');
});

test('gabarit html : valeurs échappées, fragments bruts conservés', () => {
  const nom = '<img src=x onerror=alert(1)>';
  assert.equal(html`<td>${nom}</td>`, '<td>&lt;img src=x onerror=alert(1)&gt;</td>');
  assert.equal(html`<p>${brut('<b>ok</b>')}</p>`, '<p><b>ok</b></p>');
  assert.equal(html`<ul>${['<a>', brut('<li>')]}</ul>`, '<ul>&lt;a&gt;<li></ul>');
  assert.equal(echapper(`"'`), '&quot;&#39;');
});

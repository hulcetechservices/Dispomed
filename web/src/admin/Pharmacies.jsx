import { useMemo, useState } from 'react';
import { supabase, rpc, messageErreur } from '../lib/supabase.js';
import { COMMUNES, libelleCommune } from '../lib/config.js';
import { normaliser } from '../lib/fichiers.js';
import { pluriel } from '../lib/temps.js';
import { Panneau, Statut, useChargement, useNotifier } from './ui.jsx';
import Import from './Import.jsx';
import Carte from './Carte.jsx';
import Horaires, { HORAIRES_VIDES, depuisLignes, versPlages, erreursHoraires } from './Horaires.jsx';

const VIDE = {
  nom: '', commune: 'libreville', quartier: '', adresse: '', telephone: '',
  numero_autorisation: '', titulaire: '', latitude: null, longitude: null,
  accepte_cnamgs: false, mutuelles: [], services: [],
};

const CHAMPS_IMPORT = {
  nom: { alias: ['nom', 'pharmacie', 'nom pharmacie', 'nom de la pharmacie', 'officine'], obligatoire: true, libelle: 'nom' },
  commune: { alias: ['commune', 'ville'], obligatoire: true, libelle: 'commune' },
  quartier: { alias: ['quartier'], libelle: 'quartier' },
  adresse: { alias: ['adresse', 'localisation', 'repere'], libelle: 'adresse' },
  telephone: { alias: ['telephone', 'tel', 'contact', 'numero'], libelle: 'téléphone' },
  latitude: { alias: ['latitude', 'lat'], libelle: 'latitude' },
  longitude: { alias: ['longitude', 'lng', 'lon', 'long'], libelle: 'longitude' },
  numero_autorisation: { alias: ['numero autorisation', 'n autorisation', 'no autorisation', 'autorisation', 'agrement'], libelle: 'numéro d’autorisation' },
  titulaire: { alias: ['titulaire', 'pharmacien', 'responsable'], libelle: 'titulaire' },
  cnamgs: { alias: ['cnamgs', 'accepte cnamgs'], libelle: 'CNAMGS' },
};

export default function Pharmacies() {
  const notifier = useNotifier();
  const liste = useChargement(() => rpc('pharmacies_admin', {}), []);
  const [filtres, setFiltres] = useState({ texte: '', commune: '', statut: '' });
  const [fiche, setFiche] = useState(null); // null | 'nouvelle' | pharmacie
  const [importOuvert, setImportOuvert] = useState(false);
  const [activer, setActiver] = useState(true);

  const pharmacies = liste.donnees ?? [];
  const visibles = useMemo(() => {
    const q = normaliser(filtres.texte);
    return pharmacies.filter((p) =>
      (!q || normaliser(`${p.nom} ${p.quartier ?? ''} ${p.titulaire ?? ''}`).includes(q))
      && (!filtres.commune || p.commune === filtres.commune)
      && (!filtres.statut || p.statut === filtres.statut));
  }, [pharmacies, filtres]);

  const compte = (s) => pharmacies.filter((p) => p.statut === s).length;
  const enAttente = pharmacies.filter((p) => p.statut === 'en_attente');

  const changerStatut = async (p, nouveau) => {
    try {
      await rpc('changer_statut_pharmacie', { pharmacie: p.id, nouveau });
      notifier(`${p.nom} : ${{ active: 'validée', suspendue: 'suspendue', en_attente: 'remise en attente' }[nouveau]}.`);
      liste.recharger();
    } catch (e) { notifier(e.message, { erreur: true }); }
  };

  const validerTout = async () => {
    try {
      for (const p of enAttente) await rpc('changer_statut_pharmacie', { pharmacie: p.id, nouveau: 'active' });
      notifier(enAttente.length > 1 ? `${enAttente.length} pharmacies validées.` : 'Pharmacie validée.');
    } catch (e) { notifier(e.message, { erreur: true }); }
    liste.recharger();
  };

  return (
    <>
      <div className="ligne">
        <h2>Pharmacies</h2>
        <div className="ligne pousse">
          <button type="button" className="secondaire" onClick={() => setImportOuvert(true)}>Importer un fichier</button>
          <button type="button" onClick={() => setFiche('nouvelle')}>Nouvelle pharmacie</button>
        </div>
      </div>

      <div className="resume">
        <span><strong>{pharmacies.length}</strong> au total</span>
        <span><strong>{compte('active')}</strong> {compte('active') > 1 ? 'actives' : 'active'}</span>
        <span><strong>{compte('en_attente')}</strong> en attente</span>
        <span><strong>{compte('suspendue')}</strong> {compte('suspendue') > 1 ? 'suspendues' : 'suspendue'}</span>
        <span><strong>{pharmacies.filter((p) => p.latitude == null).length}</strong> sans position</span>
      </div>

      <div className="ligne">
        <input type="search" placeholder="Nom, quartier ou titulaire" aria-label="Rechercher une pharmacie"
          value={filtres.texte} onChange={(e) => setFiltres({ ...filtres, texte: e.target.value })} style={{ flex: '1 1 16rem' }} />
        <select aria-label="Commune" value={filtres.commune} onChange={(e) => setFiltres({ ...filtres, commune: e.target.value })}>
          <option value="">Toutes les communes</option>
          {COMMUNES.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
        <select aria-label="Statut" value={filtres.statut} onChange={(e) => setFiltres({ ...filtres, statut: e.target.value })}>
          <option value="">Tous les statuts</option>
          <option value="active">Actives</option>
          <option value="en_attente">En attente</option>
          <option value="suspendue">Suspendues</option>
        </select>
        {enAttente.length > 0 && (
          <button type="button" className="secondaire" onClick={validerTout}>{enAttente.length > 1 ? `Valider les ${enAttente.length} en attente` : 'Valider celle en attente'}</button>
        )}
      </div>

      {liste.erreur && <p className="erreur">{liste.erreur}</p>}
      {liste.chargement && !liste.donnees && <p className="chargement">Chargement…</p>}

      {liste.donnees && pharmacies.length === 0 && (
        <div className="section">
          <h3>Aucune pharmacie pour l'instant</h3>
          <p>Ajoutez-les une par une, ou importez la liste depuis un fichier Excel ou CSV : c'est le plus rapide pour démarrer une zone.</p>
          <div className="ligne">
            <button type="button" onClick={() => setImportOuvert(true)}>Importer un fichier</button>
            <button type="button" className="secondaire" onClick={() => setFiche('nouvelle')}>Ajouter une pharmacie</button>
          </div>
        </div>
      )}

      {pharmacies.length > 0 && (
        <div className="tableau-boite">
          <table className="tableau">
            <thead>
              <tr><th>Pharmacie</th><th>Téléphone</th><th>CNAMGS</th><th>Position</th><th>Statut</th><th><span className="visuellement-cache">Actions</span></th></tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="nom">{p.nom}</div>
                    <div className="sous">{[p.quartier, libelleCommune(p.commune)].filter(Boolean).join(', ')}</div>
                  </td>
                  <td>{p.telephone || <span className="manquant">à compléter</span>}</td>
                  <td>{p.accepte_cnamgs ? 'Oui' : 'Non'}</td>
                  <td>{p.latitude != null ? 'Placée' : <span className="manquant">à placer</span>}</td>
                  <td><Statut valeur={p.statut} /></td>
                  <td className="actions">
                    {p.statut !== 'active' && <button type="button" className="secondaire petit" onClick={() => changerStatut(p, 'active')}>{p.statut === 'suspendue' ? 'Réactiver' : 'Valider'}</button>}
                    {' '}
                    <button type="button" className="discret-btn" onClick={() => setFiche(p)}>Modifier</button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={6} className="discret">Aucune pharmacie ne correspond aux filtres.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {fiche && (
        <FichePharmacie pharmacie={fiche === 'nouvelle' ? null : fiche} onFermer={() => setFiche(null)}
          onEnregistree={() => { setFiche(null); liste.recharger(); }} onStatut={changerStatut} />
      )}

      {importOuvert && (
        <Panneau titre="Importer des pharmacies" onFermer={() => setImportOuvert(false)}>
          <p>Colonnes : nom et commune (obligatoires), quartier, adresse, téléphone, latitude, longitude, numéro d'autorisation, titulaire, CNAMGS (oui/non). Une pharmacie déjà présente (même nom, même commune) est complétée, pas dupliquée.</p>
          <Import champs={CHAMPS_IMPORT} modele="/modeles/pharmacies.csv" fonction="importer_pharmacies"
            options={{ activer }} libelleObjet="pharmacies" Bilan={BilanPharmacies}
            onImporte={(r) => { notifier(`${pluriel(r.nb_valides, 'pharmacie')} importée${r.nb_valides > 1 ? 's' : ''}.`); liste.recharger(); }}>
            <label className="case">
              <input type="checkbox" checked={activer} onChange={(e) => setActiver(e.target.checked)} />
              Rendre les nouvelles pharmacies visibles tout de suite (déjà vérifiées par l'équipe)
            </label>
          </Import>
        </Panneau>
      )}
    </>
  );
}

function BilanPharmacies({ rapport, final }) {
  return (
    <div className="bilan">
      <div><strong>{rapport.nouvelles}</strong><span>{final ? 'créées' : 'à créer'}</span></div>
      <div><strong>{rapport.mises_a_jour}</strong><span>{final ? 'complétées' : 'déjà présentes, à compléter'}</span></div>
      <div className={rapport.nb_erreurs ? 'ko' : ''}><strong>{rapport.nb_erreurs}</strong><span>en erreur</span></div>
    </div>
  );
}

// ---------------------------------------------------------------- Fiche

function FichePharmacie({ pharmacie, onFermer, onEnregistree, onStatut }) {
  const notifier = useNotifier();
  const [f, setF] = useState(() => (pharmacie ? { ...VIDE, ...pharmacie } : { ...VIDE }));
  const [texteListes, setTexteListes] = useState({
    mutuelles: (pharmacie?.mutuelles ?? []).join(', '),
    services: (pharmacie?.services ?? []).join(', '),
  });
  const horairesCharges = useChargement(async () => {
    if (!pharmacie) return HORAIRES_VIDES();
    const { data, error } = await supabase.from('horaires').select('jour, ouverture, fermeture').eq('pharmacie_id', pharmacie.id);
    if (error) throw new Error(messageErreur(error));
    return depuisLignes(data);
  }, [pharmacie?.id]);
  const [horaires, setHoraires] = useState(null);
  const [carte, setCarte] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const valeurHoraires = horaires ?? horairesCharges.donnees ?? HORAIRES_VIDES();
  const maj = (champ) => (e) => setF({ ...f, [champ]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const nombre = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

  const enregistrer = async (e) => {
    e.preventDefault();
    const lat = nombre(f.latitude);
    const lng = nombre(f.longitude);
    const problemes = [];
    if (f.nom.trim().length < 2) problemes.push('le nom est obligatoire');
    if ((lat == null) !== (lng == null)) problemes.push('latitude et longitude vont ensemble');
    if (lat != null && !(lat >= -5 && lat <= 5 && lng >= 5 && lng <= 15)) problemes.push('position hors du Gabon (latitude et longitude inversées ?)');
    problemes.push(...erreursHoraires(valeurHoraires));
    if (problemes.length) { setErreur(problemes.join(' ; ')); return; }

    setErreur(''); setEnvoi(true);
    const liste = (t) => t.split(',').map((x) => x.trim()).filter(Boolean);
    try {
      const id = await rpc('enregistrer_pharmacie', {
        fiche: {
          id: pharmacie?.id, nom: f.nom, commune: f.commune, quartier: f.quartier, adresse: f.adresse,
          telephone: f.telephone, numero_autorisation: f.numero_autorisation, titulaire: f.titulaire,
          latitude: lat, longitude: lng, accepte_cnamgs: f.accepte_cnamgs,
          mutuelles: liste(texteListes.mutuelles), services: liste(texteListes.services),
        },
      });
      if (horaires || !pharmacie) await rpc('definir_horaires', { pharmacie: id, plages: versPlages(valeurHoraires) });
      notifier(pharmacie ? `${f.nom} : fiche enregistrée.` : `${f.nom} ajoutée, en attente de validation.`);
      onEnregistree();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Panneau titre={pharmacie ? pharmacie.nom : 'Nouvelle pharmacie'} onFermer={onFermer}
      pied={(
        <>
          <button type="submit" form="fiche-pharmacie" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer la fiche'}</button>
          {pharmacie?.statut === 'active' && (
            <button type="button" className="danger pousse" onClick={() => { onStatut(pharmacie, 'suspendue'); onFermer(); }}>Suspendre</button>
          )}
          {pharmacie && pharmacie.statut !== 'active' && (
            <button type="button" className="secondaire pousse" onClick={() => { onStatut(pharmacie, 'active'); onFermer(); }}>
              {pharmacie.statut === 'suspendue' ? 'Réactiver' : 'Valider'}
            </button>
          )}
        </>
      )}>
      <form id="fiche-pharmacie" className="pile" onSubmit={enregistrer} noValidate>
        {pharmacie && <p><Statut valeur={pharmacie.statut} /></p>}
        <div className="section">
          <h3>Identité</h3>
          <div className="grille-champs">
            <label className="champ">Nom *<input value={f.nom} onChange={maj('nom')} required /></label>
            <label className="champ">Commune *
              <select value={f.commune} onChange={maj('commune')}>
                {COMMUNES.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            </label>
            <label className="champ">Quartier<input value={f.quartier ?? ''} onChange={maj('quartier')} /></label>
            <label className="champ">Téléphone<input type="tel" value={f.telephone ?? ''} onChange={maj('telephone')} placeholder="+241 …" /></label>
            <label className="champ">Numéro d'autorisation<input value={f.numero_autorisation ?? ''} onChange={maj('numero_autorisation')} /></label>
            <label className="champ">Titulaire<input value={f.titulaire ?? ''} onChange={maj('titulaire')} /></label>
          </div>
          <label className="champ">Adresse ou repère<input value={f.adresse ?? ''} onChange={maj('adresse')} placeholder="Ex. face au rond-point de la Démocratie" /></label>
        </div>

        <div className="section">
          <h3>Position</h3>
          <div className="grille-champs">
            <label className="champ">Latitude<input inputMode="decimal" value={f.latitude ?? ''} onChange={maj('latitude')} placeholder="0.4162" /></label>
            <label className="champ">Longitude<input inputMode="decimal" value={f.longitude ?? ''} onChange={maj('longitude')} placeholder="9.4673" /></label>
          </div>
          {carte
            ? <Carte latitude={nombre(f.latitude)} longitude={nombre(f.longitude)} onChoisir={(lat, lng) => setF((x) => ({ ...x, latitude: lat, longitude: lng }))} />
            : <div><button type="button" className="secondaire petit" onClick={() => setCarte(true)}>Placer sur la carte</button></div>}
          <p className="discret">La position sert à proposer les pharmacies les plus proches du patient.</p>
        </div>

        <div className="section">
          <h3>Assurances et services</h3>
          <label className="case"><input type="checkbox" checked={f.accepte_cnamgs} onChange={maj('accepte_cnamgs')} /> Accepte la CNAMGS</label>
          <label className="champ">Mutuelles acceptées<span className="aide">Séparées par des virgules</span>
            <input value={texteListes.mutuelles} onChange={(e) => setTexteListes({ ...texteListes, mutuelles: e.target.value })} />
          </label>
          <label className="champ">Services<span className="aide">Ex. vaccination, tests rapides, parapharmacie</span>
            <input value={texteListes.services} onChange={(e) => setTexteListes({ ...texteListes, services: e.target.value })} />
          </label>
        </div>

        <div className="section">
          <h3>Horaires habituels</h3>
          {horairesCharges.chargement && !horairesCharges.donnees
            ? <p className="discret">Chargement…</p>
            : <Horaires valeur={valeurHoraires} onChange={setHoraires} />}
        </div>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </form>
    </Panneau>
  );
}

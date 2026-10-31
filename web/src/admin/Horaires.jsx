import { NOMS_JOURS } from '../lib/temps.js';

// Éditeur des horaires : plusieurs plages par jour, jour fermé, copie rapide.
// Valeur : tableau de 7 listes de plages { ouverture: '08:00', fermeture: '20:00' }.

export const HORAIRES_VIDES = () => Array.from({ length: 7 }, () => []);

export function depuisLignes(lignes) {
  const jours = HORAIRES_VIDES();
  for (const l of [...lignes].sort((a, b) => a.ouverture.localeCompare(b.ouverture))) {
    jours[l.jour - 1].push({ ouverture: l.ouverture.slice(0, 5), fermeture: l.fermeture.slice(0, 5) });
  }
  return jours;
}

export function versPlages(jours) {
  return jours.flatMap((plages, i) => plages.map((p) => ({ jour: i + 1, ...p })));
}

/** Erreurs de saisie, par jour. */
export function erreursHoraires(jours) {
  const erreurs = [];
  jours.forEach((plages, i) => {
    plages.forEach((p) => {
      if (!p.ouverture || !p.fermeture) erreurs.push(`${NOMS_JOURS[i]} : heure manquante`);
      else if (p.fermeture !== '00:00' && p.fermeture <= p.ouverture) {
        erreurs.push(`${NOMS_JOURS[i]} : la fermeture doit suivre l'ouverture (minuit = 00:00)`);
      }
    });
  });
  return erreurs;
}

export default function Horaires({ valeur, onChange }) {
  const modifier = (jour, fn) => onChange(valeur.map((plages, i) => (i === jour ? fn(plages) : plages)));
  const copierLundi = () => onChange(valeur.map((plages, i) => (i > 0 && i < 6 ? valeur[0].map((p) => ({ ...p })) : plages)));
  // 00:00 → 00:00 : ouvert toute la journée.
  const touteLaSemaine = () => onChange(valeur.map(() => [{ ouverture: '00:00', fermeture: '00:00' }]));

  return (
    <div className="pile">
      <div className="ligne">
        <button type="button" className="secondaire petit" onClick={copierLundi} disabled={!valeur[0].length}>
          Copier le lundi du mardi au samedi
        </button>
        <button type="button" className="secondaire petit" onClick={touteLaSemaine}>Ouvert 24 h/24, 7 j/7</button>
      </div>
      <div className="horaires">
        {valeur.map((plages, i) => (
          <div className="horaire-jour" key={i}>
            <span className="jour">{NOMS_JOURS[i]}</span>
            <div className="horaire-plages">
              {plages.length === 0 && <span className="discret">Fermé</span>}
              {plages.map((p, j) => (
                <span className="plage" key={j}>
                  <input type="time" aria-label={`${NOMS_JOURS[i]} ouverture ${j + 1}`} value={p.ouverture}
                    onChange={(e) => modifier(i, (ps) => ps.map((x, k) => (k === j ? { ...x, ouverture: e.target.value } : x)))} />
                  –
                  <input type="time" aria-label={`${NOMS_JOURS[i]} fermeture ${j + 1}`} value={p.fermeture}
                    onChange={(e) => modifier(i, (ps) => ps.map((x, k) => (k === j ? { ...x, fermeture: e.target.value } : x)))} />
                  <button type="button" className="discret-btn" aria-label={`Retirer la plage ${j + 1} du ${NOMS_JOURS[i]}`}
                    onClick={() => modifier(i, (ps) => ps.filter((_, k) => k !== j))}>Retirer</button>
                </span>
              ))}
              <button type="button" className="discret-btn"
                onClick={() => modifier(i, (ps) => [...ps, ps.length ? { ouverture: '15:00', fermeture: '20:00' } : { ouverture: '08:00', fermeture: '20:00' }])}>
                Ajouter une plage
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="discret">Une fermeture à minuit se saisit 00:00. Les gardes de nuit se gèrent dans l'onglet Gardes.</p>
    </div>
  );
}

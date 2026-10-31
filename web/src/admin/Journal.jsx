import { supabase, messageErreur } from '../lib/supabase.js';
import { depuis } from '../lib/temps.js';
import { useChargement } from './ui.jsx';

const ACTIONS = {
  statut_pharmacie: (d) => `${d.nom} : ${libelleStatut(d.avant)} → ${libelleStatut(d.apres)}`,
  import_pharmacies: (d) => `Import de pharmacies : ${d.importees} sur ${d.lignes} lignes`,
  import_gardes: (d) => `Import de gardes : ${d.importees} sur ${d.lignes} lignes`,
  fusion_medicaments: (d) => `Doublon fusionné : ${d.nom_commercial}${d.dosage ? ` ${d.dosage}` : ''}`,
  suppression_pharmacies: (d) => `Pharmacie supprimée : ${d.nom}`,
  suppression_medicaments: (d) => `Médicament supprimé : ${d.nom_commercial}`,
};
const libelleStatut = (s) => ({ active: 'active', en_attente: 'en attente', suspendue: 'suspendue' }[s] ?? s);

export default function Journal() {
  const journal = useChargement(async () => {
    const { data, error } = await supabase.from('journal').select('id, action, cible, details, date').order('date', { ascending: false }).limit(200);
    if (error) throw new Error(messageErreur(error));
    return data;
  }, []);

  return (
    <>
      <h2>Journal</h2>
      <p className="discret">Actions sensibles : validations, suspensions, imports, fusions et suppressions. Les 200 plus récentes.</p>
      {journal.erreur && <p className="erreur">{journal.erreur}</p>}
      {journal.donnees?.length === 0 && <p className="discret">Rien pour l'instant.</p>}
      {journal.donnees?.length > 0 && (
        <div className="tableau-boite">
          <table className="tableau">
            <thead><tr><th>Quand</th><th>Action</th></tr></thead>
            <tbody>
              {journal.donnees.map((j) => (
                <tr key={j.id}>
                  <td className="sous" title={new Date(j.date).toLocaleString('fr-FR', { timeZone: 'Africa/Libreville' })}>{depuis(j.date)}</td>
                  <td>{(ACTIONS[j.action] ?? (() => j.action))(j.details ?? {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

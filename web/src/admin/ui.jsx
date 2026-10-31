import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------- Notifications

const ContexteNotif = createContext(() => {});
export const useNotifier = () => useContext(ContexteNotif);

export function FournisseurNotif({ children }) {
  const [notif, setNotif] = useState(null);
  const minuterie = useRef();
  const notifier = useCallback((message, { erreur = false } = {}) => {
    setNotif({ message, erreur });
    clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => setNotif(null), erreur ? 7000 : 3500);
  }, []);
  return (
    <ContexteNotif.Provider value={notifier}>
      {children}
      <div role="status" aria-live="polite">
        {notif && <div className={`notification${notif.erreur ? ' erreur' : ''}`}>{notif.message}</div>}
      </div>
    </ContexteNotif.Provider>
  );
}

// ---------------------------------------------------------------- Panneau latéral

export function Panneau({ titre, onFermer, children, pied }) {
  const ref = useRef();
  useEffect(() => {
    const precedent = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const touche = (e) => { if (e.key === 'Escape') onFermer(); };
    document.addEventListener('keydown', touche);
    return () => { document.removeEventListener('keydown', touche); precedent?.focus?.(); };
  }, [onFermer]);
  return (
    <>
      <div className="voile" onClick={onFermer} />
      <section className="panneau" role="dialog" aria-modal="true" aria-label={titre} ref={ref}>
        <header>
          <h2>{titre}</h2>
          <button type="button" className="secondaire petit" onClick={onFermer}>Fermer</button>
        </header>
        <div className="corps">{children}</div>
        {pied && <footer>{pied}</footer>}
      </section>
    </>
  );
}

export function Statut({ valeur }) {
  const libelles = { active: 'Active', en_attente: 'En attente', suspendue: 'Suspendue' };
  return <span className={`statut ${valeur}`}>{libelles[valeur] ?? valeur}</span>;
}

/** Chargement asynchrone avec état. */
export function useChargement(charger, deps) {
  const [etat, setEtat] = useState({ chargement: true, donnees: null, erreur: null });
  const recharger = useCallback(async () => {
    setEtat((e) => ({ ...e, chargement: true }));
    try {
      setEtat({ chargement: false, donnees: await charger(), erreur: null });
    } catch (e) {
      setEtat({ chargement: false, donnees: null, erreur: e.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recharger(); }, [recharger]);
  return { ...etat, recharger };
}

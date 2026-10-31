// Page patient provisoire, en attendant le lot 2 (carte, gardes, filtre CNAMGS).
export default function Accueil() {
  return (
    <main className="accueil">
      <div className="marque">
        <Croix /> Pharmacies Gabon
      </div>
      <h1>Trouvez votre médicament sans faire le tour des pharmacies.</h1>
      <p>Bientôt dans le Grand Libreville (Libreville, Akanda, Owendo) :</p>
      <ul>
        <li>demander à plusieurs pharmacies proches si elles ont votre médicament, et voir leurs réponses en direct ;</li>
        <li>trouver la pharmacie de garde la plus proche, de jour comme de nuit ;</li>
        <li>repérer les pharmacies qui acceptent la CNAMGS.</li>
      </ul>
      <p className="discret">Service en préparation par HULCE TECH SERVICES.</p>
    </main>
  );
}

export function Croix({ taille = 30 }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0b4f4a" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#fff" />
    </svg>
  );
}

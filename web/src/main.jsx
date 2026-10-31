import './styles.css';
import './patient.css';
import { createRoot } from 'react-dom/client';

// Deux applications, chargées séparément : le site patient ne télécharge pas le
// code du back-office (page initiale légère, cahier des charges §10).
const racine = createRoot(document.getElementById('racine'));
const module = location.pathname.startsWith('/admin')
  ? import('./admin/App.jsx')
  : import('./patient/App.jsx');
module.then(({ default: App }) => racine.render(<App />));

// Application installable et consultable hors ligne (service worker en production).
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

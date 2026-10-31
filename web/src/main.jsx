import './styles.css';
import { createRoot } from 'react-dom/client';
import AdminApp from './admin/App.jsx';
import Accueil from './Accueil.jsx';

const racine = createRoot(document.getElementById('racine'));
racine.render(location.pathname.startsWith('/admin') ? <AdminApp /> : <Accueil />);

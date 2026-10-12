import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import '../shared/i18n';
import { Popup } from './Popup';

createRoot(document.getElementById('root')!).render(<Popup />);

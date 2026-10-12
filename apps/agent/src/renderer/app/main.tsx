import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import '../shared/i18n';
import { App } from './App';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

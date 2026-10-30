import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { lang, t } from './i18n';
import './ui/styles/base.css';
import './ui/styles/felt.css';
import './ui/styles/vent.css';

document.documentElement.lang = lang;
document.title = t.appName;

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

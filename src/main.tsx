import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/marcellus/latin-400.css'
import '@fontsource-variable/manrope'
import './index.css'
import App from './App.tsx'

// iPad/iPhone : après la saisie d'un texte (connexion, code de table), le clavier peut laisser
// l'écran décalé vers le haut, la barre du haut (Menu, Stats) hors de portée. On le remet en place.
const fixViewport = () => {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
  // seulement quand l'écran n'a pas à défiler (table, menu en paysage) : un décalage y est forcément parasite
  const fits = document.documentElement.scrollHeight <= window.innerHeight + 2 || !!document.querySelector('.table-screen');
  if (fits && (window.scrollY !== 0 || window.scrollX !== 0)) window.scrollTo(0, 0);
};
document.addEventListener('focusout', () => setTimeout(fixViewport, 100));
window.visualViewport?.addEventListener('resize', () => setTimeout(fixViewport, 100));
window.addEventListener('orientationchange', () => setTimeout(fixViewport, 300));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && setTimeout(fixViewport, 100));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles/app.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Debug/automation handle (used by the e2e smoke test; contains no secrets).
import { engine } from './audio/engine';
import { useStudio } from './state/store';
import * as actions from './state/actions';
import { renderProject } from './audio/render';
import { analyze } from './export/analysis';
(window as any).aims = { engine, useStudio, actions, renderProject, analyze };

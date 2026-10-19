import { AllCommunityModule } from 'ag-grid-community';
import { AgGridProvider } from 'ag-grid-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

// AG Grid Community only: never the Enterprise modules (commercial licence).
const modules = [AllCommunityModule];

// Keep AG Grid's colour scheme in step with the system setting (the page CSS follows the same query).
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => {
  document.documentElement.dataset.agThemeMode = dark.matches ? 'dark' : 'light';
};
applyScheme();
dark.addEventListener('change', applyScheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgGridProvider modules={modules}>
      <App />
    </AgGridProvider>
  </StrictMode>,
);

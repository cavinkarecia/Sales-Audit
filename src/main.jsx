import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuditDataProvider } from './context/AuditDataContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuditDataProvider>
          <App />
        </AuditDataProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

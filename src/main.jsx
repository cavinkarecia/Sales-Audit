import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuditDataProvider } from './context/AuditDataContext';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuditDataProvider>
        <App />
      </AuditDataProvider>
    </BrowserRouter>
  </StrictMode>,
);

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { offlineFetch } from './utils/pwaDb';

// Intercept all API write requests globally for offline support
const originalFetch = window.fetch;
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : (input instanceof URL ? input.href : (input as Request).url);
  const method = init?.method || "GET";

  if (url.includes("/api/") && ["POST", "PUT", "DELETE"].includes(method.toUpperCase())) {
    return offlineFetch(url, init || {});
  }
  return originalFetch(input, init);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { App } from './App.tsx';
import { ThemeProvider } from '@/components/theme-provider.tsx';
import '@repo/ui/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

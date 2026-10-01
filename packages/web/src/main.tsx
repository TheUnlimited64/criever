import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './tokens.css';
import { Workspace } from './Workspace';
import { SessionReview } from './SessionReview';
import { reviewSessionId } from './api';
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5000, retry: 0 } } });
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={qc}>{reviewSessionId ? <SessionReview id={reviewSessionId} /> : <Workspace />}</QueryClientProvider></StrictMode>);

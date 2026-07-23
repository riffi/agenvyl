import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AppRouter } from './router';
import {RuntimeFeaturesProvider} from '../shared/features';

export function App() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  return <QueryClientProvider client={queryClient}><RuntimeFeaturesProvider><AppRouter /></RuntimeFeaturesProvider></QueryClientProvider>;
}

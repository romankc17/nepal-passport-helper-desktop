// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../../src/renderer/src/auth';
import { ToastProvider } from '../../../src/renderer/src/components/Toast';

export { bridgeError, installDesktopMock } from './desktop-mock';

export function renderWithProviders(
  ui: ReactElement,
  options?: { route?: string; withAuth?: boolean },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const content = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options?.route ?? '/']}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return render(options?.withAuth === false ? content : <AuthProvider>{content}</AuthProvider>);
}

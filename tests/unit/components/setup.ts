import '@testing-library/jest-dom/vitest';
import { installDesktopMock } from './desktop-mock';

// Renderer modules touch window.desktop at import time (src/renderer/api.ts),
// so the singleton mock must exist before any test module is evaluated.
// Individual tests refine it via installDesktopMock() + vi.fn overrides.
if (typeof window !== 'undefined') {
  installDesktopMock();
}

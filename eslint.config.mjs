// Minimale ESLint-Konfiguration (Typ B laut ARCHITEKTUR.md): @eslint/js recommended + Globals.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'vendor/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    // Browser-Code: globale Bibliotheken aus vendor/ (qrcode) bzw. nachgeladen (Peer)
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, qrcode: 'readonly', Peer: 'readonly' } },
  },
  {
    files: ['server/**/*.mjs', 'test/**/*.mjs', 'e2e/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Playwright: page.evaluate()-Callbacks laufen im Browser
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
];

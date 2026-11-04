/* Lockin — ESLint flat config.
   Minimal on purpose: catch real mistakes (undefined globals, unused vars,
   unreachable code), stay out of formatting opinions. `npm run lint`. */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    /* Build output, the Android shell and generated assets are not ours to lint. */
    ignores: ['dist/', 'android/', 'node_modules/', '.taste-skill/'],
  },
  js.configs.recommended,
  {
    files: ['app/**/*.js', 'app/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['app/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      /* The codebase signals intent with `catch (_) { /* comment *\/ }`;
         unused caught errors and unused args are noise here. */
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
];

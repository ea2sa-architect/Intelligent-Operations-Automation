// Minimal CI lint (S2.3): catches real bugs only — undefined vars, dupes,
// unreachable code — not style. Starts as errors-only; tighten deliberately.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', 'services/**/tests/**', 'services/*/dist/**'] },
  {
    files: ['services/*/index.js', 'services/*/db.js', 'services/*/swagger.js', 'services/*/src/**/*.js', 'services/*/routes/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
    rules: {
      ...Object.fromEntries(Object.keys(js.configs.recommended.rules).map(r => [r, 'off'])),
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-unsafe-finally': 'error',
      'no-func-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];

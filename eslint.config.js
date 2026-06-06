// eslint.config.js — flat config (ESLint 9)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'build/**', 'lib/**', 'coverage/**', 'node_modules/**', '*.config.js', '*.config.ts', '*.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);

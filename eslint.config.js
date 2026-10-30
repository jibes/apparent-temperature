import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: ['dist/', 'dev-dist/', 'android/', 'coverage/', 'playwright-report/', 'test-results/'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  // config key differs by plugin major; check node_modules/eslint-plugin-react-hooks
  reactHooks.configs.flat['recommended-latest'],
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);

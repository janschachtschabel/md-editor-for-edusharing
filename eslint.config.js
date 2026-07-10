// ESLint flat config: @eslint/js recommended rules for the whole codebase,
// with the correct globals per runtime (server = Node, src/public = browser,
// shared modules = both).
import js from '@eslint/js'
import globals from 'globals'

export default [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'public/*.bundle.js', 'public/md-collab-editor.js', 'Wissen/**'],
  },
  {
    rules: {
      // Deliberate empty catches carry a comment explaining why (poll retries,
      // already-unloaded documents); the pattern itself is allowed.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['server.js', 'server/**/*.js', 'test/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Use jsdom to install `document`/`window` globals for testing DOM code
    files: ['test/annotation-ui.test.mjs', 'test/component.test.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**/*.js', 'public/app-config.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Shared between server (Node) and browser bundles
    files: ['src/extensions.js', 'src/markdown.js', 'src/save-state.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
]

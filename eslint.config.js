import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'data/', 'coverage/'] },
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-constant-condition': ['error', { checkLoops: false }],
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
        },
    },
    { files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'], languageOptions: { globals: globals.node } },
    { files: ['public/**/*.js'], languageOptions: { globals: { ...globals.browser, io: 'readonly' } } },
    { files: ['shared/**/*.js'], languageOptions: { globals: {} } },
    { files: ['e2e/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];

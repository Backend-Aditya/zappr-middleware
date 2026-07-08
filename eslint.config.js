import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
  stylistic: false, // prettier owns formatting
  ignores: ['node_modules', 'coverage', 'src/db/postgres/migrations'],
}, {
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'perfectionist/sort-imports': 'off',
    'perfectionist/sort-named-imports': 'off',
    'test/prefer-lowercase-title': 'off',
    'unused-imports/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
})

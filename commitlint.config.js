/** Conventional Commits enforcement (CI commitlint gate; keeps semantic-release viable). */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'auth',
        'students',
        'parents',
        'classes',
        'belts',
        'billing',
        'notifications',
        'consent',
        'config',
        'prisma',
        'deps',
        'deps-dev',
        'app',
        'common',
        'ops',
        'ci',
        'test',
        'types',
      ],
    ],
  },
};

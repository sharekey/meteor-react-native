// transpile all es6+ code in this project (but not node_modules)
const babelRegister = require('@babel/register');
babelRegister();

module.exports = {
  recursive: true,
  reporter: 'spec',
  retries: 0,
  slow: 20,
  timeout: 2000,
  ui: 'bdd',
  require: ['ts-node/register/transpile-only', 'test/hooks/mockServer.cjs'],
};

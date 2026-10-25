const { packageAcceptance } = require('./package-zcode-acceptance');
packageAcceptance(undefined, 'combined').then(appPath => process.stdout.write(`${appPath}\n`))
  .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

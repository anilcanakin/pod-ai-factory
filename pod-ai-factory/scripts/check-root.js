const fs = require('fs');
const path = require('path');

const cwd = process.cwd();

const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
const hasSrc = fs.existsSync(path.join(cwd, 'src'));
const hasFrontend = fs.existsSync(path.join(cwd, 'frontend'));

if (!hasPackageJson || !hasSrc || !hasFrontend) {
    console.error('\n======================================================');
    console.error('❌ ERROR: You are running this command in the wrong directory!');
    console.error('The current directory is: ' + cwd);
    console.error('Please make sure you are in the root of the "pod-ai-factory" repository.');
    console.error('Expected to find: "package.json", "src/" and "frontend/" folders.');
    console.error('======================================================\n');
    process.exit(1);
}

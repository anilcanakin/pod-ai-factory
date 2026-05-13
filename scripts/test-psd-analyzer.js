const path = require('path');
const { analyze } = require('../src/services/psd-analyzer.service');

const psdPath = process.argv[2];
if (!psdPath) { console.error('Usage: node test-psd-analyzer.js path/to/file.psd'); process.exit(1); }

analyze(path.resolve(psdPath), 'tshirt').then(result => {
    console.log('printArea:', result.printArea);
    console.log('defaultColor:', result.defaultColor);
    console.log('layerMap:', result.layerMap);
    console.log('baseBuffer size:', result.baseBuffer.length);
    console.log('grayBuffer size:', result.grayBuffer.length);
    console.log('shadowBuffer:', result.shadowBuffer ? result.shadowBuffer.length + ' bytes' : 'null (will use preset)');
}).catch(err => console.error('ERROR:', err.message));

const sharp = require('sharp');

module.exports = (input, opts = {}) => sharp(input, { limitInputPixels: false, ...opts });

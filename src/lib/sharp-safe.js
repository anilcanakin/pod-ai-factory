const sharp = require('sharp');

// sharp({ create: ... }) / sharp({ text: ... }) are single-argument calls where
// the object itself IS the options — passing a second options arg alongside them
// makes sharp throw ("Unsupported input... when also providing options"). Merge
// limitInputPixels into that object instead of appending a second argument.
function isDescriptorInput(input) {
    return input && typeof input === 'object' && !Buffer.isBuffer(input) && !Array.isArray(input) &&
        (input.create || input.text || input.join);
}

module.exports = (input, opts = {}) => {
    if (isDescriptorInput(input)) {
        return sharp({ limitInputPixels: false, ...input, ...opts });
    }
    return sharp(input, { limitInputPixels: false, ...opts });
};

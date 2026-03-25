const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.js')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk(srcDir);
let changedCount = 0;

const regex = /new\s+PrismaClient\(\s*\{\s*datasources:\s*\{\s*db:\s*\{\s*url:\s*process\.env\.DATABASE_URL\s*\}\s*\}\s*\}\s*\)/g;

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (regex.test(content)) {
        const newContent = content.replace(regex, 'new PrismaClient()');
        fs.writeFileSync(file, newContent);
        changedCount++;
        console.log(`Updated ${file}`);
    }
});
console.log(`Updated ${changedCount} files.`);

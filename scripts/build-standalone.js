const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const colorUtilsJs = fs.readFileSync(path.join(root, 'color-utils.js'), 'utf8');
const csvUtilsJs = fs.readFileSync(path.join(root, 'csv-utils.js'), 'utf8');
const outfitEngineJs = fs.readFileSync(path.join(root, 'outfit-engine.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// Replace external stylesheet link with inlined <style>
let standalone = indexHtml.replace(
  '<link rel="stylesheet" href="styles.css">',
  `<style>\n${stylesCss}\n</style>`
);

// Replace external script links with inlined <script> blocks
const scriptsInlined = `<script>\n${colorUtilsJs}\n${csvUtilsJs}\n${outfitEngineJs}\n</script>\n<script>\n${appJs}\n</script>`;

standalone = standalone.replace(
  '<script src="color-utils.js"></script>\n<script src="csv-utils.js"></script>\n<script src="outfit-engine.js"></script>\n<script src="app.js"></script>',
  scriptsInlined
);

fs.writeFileSync(path.join(root, 'atelier-standalone.html'), standalone, 'utf8');
console.log('Successfully generated atelier-standalone.html');

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeFrameMap } = require('./codex-pet-player');

// Product identity stays stable across package relocation and asset updates.
const XIAOBAI_ID = 'codex-' + createHash('sha256').update('qiuqiu:official-skin:xiaobai:v1').digest('hex');
let xiaobai;
function getBuiltinPet(id) {
  if (id !== XIAOBAI_ID) return null;
  if (!xiaobai) {
    const root = path.join(__dirname, '../assets/pets/xiaobai');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pet.json'), 'utf8'));
    const frameMap = normalizeFrameMap(manifest.frameMap, 0, manifest.sheets);
    const sheets = Object.fromEntries(Object.entries(manifest.sheets).map(([name, sheet]) => [name, {
      path: path.join(root, sheet.path), rows: sheet.rows, ...(sheet.frameWidth ? { frameWidth: sheet.frameWidth } : {})
    }]));
    xiaobai = { id: XIAOBAI_ID, name: '小白', characterId: 'xiaobai', origin: 'builtin',
      version: 3, rows: sheets.base.rows, spriteScale: 2, frameMap, sheets, spritesheetPath: sheets.base.path };
  }
  return xiaobai;
}
module.exports = { XIAOBAI_ID, getBuiltinPet };

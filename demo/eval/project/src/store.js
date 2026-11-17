const fs = require('fs');
const path = require('path');

function readItem(dir, id, cb) {
  fs.readFile(path.join(dir, id + '.json'), 'utf8', (err, text) => {
    if (err) return cb(err);
    cb(null, JSON.parse(text));
  });
}

function writeItem(dir, item, cb) {
  fs.writeFile(path.join(dir, item.id + '.json'), JSON.stringify(item), cb);
}

module.exports = { readItem, writeItem };

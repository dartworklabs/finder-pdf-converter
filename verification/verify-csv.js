/** CSV parser checks, including seeded round trips and explicit bounded refusals.
 * Run with node --test verification/verify-csv.js; AppKit is covered by native PDF QA separately.
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'csv.js'), 'utf8'), context);

/** Parse inside the JXA-compatible source and return ordinary Node values. */
function parse(source) {
    return JSON.parse(JSON.stringify(context.parseCSV(source)));
}

test('first row, leading zeros, formulas, empty/ragged rows, escaped quotes and multiline values remain literal strings', () => {
    assert.deepEqual(parse('001,=1+1,"한글, 값","a""b"\r\n,3,"두\r\n줄"\r\n\r\n끝,'), {
        kind: 'csv', columns: 4,
        rows: [['001', '=1+1', '한글, 값', 'a"b'], ['', '3', '두\n줄'], [''], ['끝', '']]
    });
    assert.deepEqual(parse(''), {kind: 'csv', columns: 0, rows: []});
    assert.deepEqual(parse('""\n'), {kind: 'csv', columns: 1, rows: [['']]});
    assert.deepEqual(parse('\n\n'), {kind: 'csv', columns: 1, rows: [[''], ['']]});
    assert.deepEqual(parse('"\t spaces "'), {kind: 'csv', columns: 1, rows: [['\t spaces ']]});
});

test('malformed quotes and each work limit produce explicit failures', () => {
    for (const source of ['"not closed', 'before"quote', '"closed"extra', '"closed" ']) {
        assert.equal(parse(source).kind, 'invalid', source);
    }
    for (const source of ['x'.repeat(262145), ','.repeat(1024), 'x\n'.repeat(20001), ('x,'.repeat(999) + 'x\n').repeat(101)]) {
        assert.equal(parse(source).kind, 'invalid');
    }
});

test('500 seeded quoted CSV serializations round-trip every string and source record in order', () => {
    let state = 0x435356;
    /** Produce a reproducible unsigned sample without any external dependency. */
    function sample(limit) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state % limit;
    }
    const symbols = ['a', '한', '0', '"', ',', '\n', '\t', ' ', '=', '+', '@', '😀'];
    for (let trial = 0; trial < 500; trial++) {
        const rows = Array.from({length: sample(8) + 1}, () =>
            Array.from({length: sample(9) + 1}, () =>
                Array.from({length: sample(30)}, () => symbols[sample(symbols.length)]).join('')));
        const csv = rows.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(',')).join('\r\n');
        const result = parse(csv + (sample(2) ? '\r\n' : ''));
        assert.equal(result.kind, 'csv', 'seed 0x435356 trial ' + trial);
        assert.deepEqual(result.rows, rows, 'seed 0x435356 trial ' + trial);
    }
});

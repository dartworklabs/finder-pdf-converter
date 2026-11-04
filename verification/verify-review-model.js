/* Exercise the page grammar, original identity and output order. */
const assert = require('node:assert/strict');
const {parseRange, selection} = require('../review-model');
assert.deepEqual(parseRange('', 4), [1, 2, 3, 4]);
assert.deepEqual(parseRange(' 3, 1-2, 5 ', 5), [3, 1, 2, 5]);
for (const input of ['0', '6', '2-1', '1,1', '1-3,3', '1,,2', '-1', '1-', '1.0', '2x']) assert.throws(() => parseRange(input, 5));
assert.deepEqual(selection([{index:2, included:true, range:'2,1', count:2}, {index:0, included:false, range:'', count:1}, {index:1, included:true, range:'', count:1}]), [{index:2,pages:[2,1]}, {index:1,pages:[1]}]);
assert.throws(() => selection([{index:0,included:false,range:'',count:1}]));
for (let n = 1; n <= 100; n++) {
    const order = Array.from({length:n}, (_, i) => n-i);
    assert.deepEqual(parseRange(order.join(','), n), order);
    assert.throws(() => parseRange(order.join(',') + ',' + n, n));
}
console.log('review model passed');

/** Behavioral checks for the renderer's supported, inert Markdown subset.
 * Run with: node --test verification/verify-markdown.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseMarkdown } = require('../markdown.js');

test('headings, paragraphs, quotes, lists and fenced code preserve readable text', function () {
    const blocks = parseMarkdown('# 제목\n\n본문 한글입니다.\n둘째 줄\n\n작은 제목\n---\n\n> 인용 **강조**\n> 둘째 줄\n\n3. 셋째\n   - 내부\n4. 넷째\n\n```js\nconst x = "<b>";\n```\n\n***');
    assert.deepEqual(blocks.map(function (block) { return block.type; }), ['heading', 'paragraph', 'heading', 'quote', 'list', 'code', 'rule']);
    assert.equal(blocks[0].level, 1);
    assert.equal(blocks[1].text, '본문 한글입니다.\n둘째 줄');
    assert.equal(blocks[2].level, 2);
    assert.equal(blocks[3].text, '인용 강조\n둘째 줄');
    assert.deepEqual(blocks[4].items.map(function (item) { return [item.text, item.depth, item.ordinal]; }), [['셋째', 0, 3], ['내부', 1, null], ['넷째', 0, 4]]);
    assert.equal(blocks[5].text, 'const x = "<b>";');
});

test('inline styles produce display text and exact inert font flags', function () {
    const block = parseMarkdown('**굵게** *기울임* ~~취소~~ `code * literal` ***둘 다*** snake_case \\*literal\\*')[0];
    assert.equal(block.text, '굵게 기울임 취소 code * literal 둘 다 snake_case *literal*');
    assert.ok(block.runs.some(function (run) { return run.text === '굵게' && run.bold; }), 'bold text retains its font flag');
    assert.ok(block.runs.some(function (run) { return run.text === '기울임' && run.italic; }), 'italic text retains its font flag');
    assert.ok(block.runs.some(function (run) { return run.text === '취소' && run.strike; }), 'strike text retains its font flag');
    assert.ok(block.runs.some(function (run) { return run.text === 'code * literal' && run.code; }), 'code text retains its font flag');
    const both = block.runs.find(function (run) { return run.text === '둘 다'; });
    assert.equal(both.bold, true); assert.equal(both.italic, true);
});

test('pipe tables retain separate readable columns, alignment and escaped pipes', function () {
    const block = parseMarkdown('| 이름 | 값 | 비고 |\n| :--- | ---: | :---: |\n| **가** | 42 | a\\|b |\n| 나 | 9 | `x|y` |')[0];
    assert.equal(block.type, 'table');
    assert.deepEqual(block.headers, ['이름', '값', '비고']);
    assert.deepEqual(block.align, ['left', 'right', 'center']);
    assert.deepEqual(block.rows, [['가', '42', 'a|b'], ['나', '9', 'x|y']]);
    assert.equal(block.rowRuns[0][0][0].bold, true);
    assert.throws(function () { parseMarkdown('|a|b|\n|---|---|\n|1|2|3|'); }, /열 수/);
});

test('HTML, executable targets and remote images become inert text only', function () {
    const blocks = parseMarkdown('<script>alert(1)</script>\n\n[이름](javascript:alert(1)) ![사진](https://invalid.test/a.png) [old] then [new](file:///etc/passwd)\n\n[ref][id]\n\n[unfinished');
    assert.equal(blocks[0].text, '<script>alert(1)</script>');
    assert.equal(blocks[1].text, '이름 [이미지: 사진] [old] then new');
    assert.equal(blocks[2].text, '[ref][id]');
    assert.equal(blocks[3].text, '[unfinished');
    assert.equal(JSON.stringify(blocks).includes('https://invalid.test'), false);
    assert.equal(JSON.stringify(blocks).includes('javascript:'), false);
    assert.equal(JSON.stringify(blocks).includes('file:///'), false);
});

test('unclosed fences preserve the remaining code and normalize text encoding markers', function () {
    const blocks = parseMarkdown('\uFEFF# 한글\r\n\r\n~~~\r\n끝\u0000');
    assert.equal(blocks[0].text, '한글');
    assert.equal(blocks[1].text, '끝\uFFFD');
});

test('resource bounds reject oversized documents instead of silently truncating', function () {
    assert.throws(function () { parseMarkdown('x'.repeat(2000001)); }, /크기/);
    assert.throws(function () { parseMarkdown('\n'.repeat(50000)); }, /줄 수/);
    assert.throws(function () { parseMarkdown(42); }, /문자열/);
    const wide = '|' + Array(33).fill('x').join('|') + '|\n|' + Array(33).fill('---').join('|') + '|';
    assert.throws(function () { parseMarkdown(wide); }, /32열/);
});

test('unmatched brackets remain literal at near-limit size with no dropped text', function () {
    const input = '['.repeat(1000000) + '](broken';
    assert.equal(parseMarkdown(input)[0].text, input);
});

test('seeded malformed markup always yields serializable bounded inert blocks', function () {
    let seed = 0x5a17beef;
    const alphabet = ['가', 'a', '\n', '|', '`', '~', '*', '_', '[', ']', '(', ')', '>', '#', '-', '\\', ' ', ':', '0'];
    for (let sample = 0; sample < 5000; sample++) {
        let input = '';
        for (let index = 0; index < 120; index++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            input += alphabet[seed % alphabet.length];
        }
        const blocks = parseMarkdown(input);
        assert.ok(Array.isArray(blocks), 'seed=' + seed);
        assert.doesNotThrow(function () { JSON.stringify(blocks); }, 'seed=' + seed);
        blocks.forEach(function (block) {
            assert.ok(['heading', 'paragraph', 'quote', 'list', 'code', 'rule', 'table'].includes(block.type), 'seed=' + seed);
            assert.equal(typeof block.text, 'string', 'seed=' + seed);
            assert.ok(!Object.prototype.hasOwnProperty.call(block, 'url'), 'seed=' + seed);
        });
    }
});

/** Offline CSV parsing and native PDF layout, concatenated before text.js.
 * Values remain strings, including numeric prefixes and formula-like content.
 * No field is interpreted as a header, URL, expression, or executable content.
 */
var CSV_MAX_ROWS = 20000;
var CSV_MAX_COLUMNS = 1024;
var CSV_MAX_CELLS = 100000;
var CSV_MAX_FIELD_CHARACTERS = 262144;
var CSV_MAX_RENDER_CHARACTERS = 4 * 1024 * 1024;

/** Parse comma-separated RFC-style records without coercion or header guessing.
 * CRLF/CR are accepted along with LF, including inside quoted fields. Empty
 * physical records are retained; a final record terminator adds no extra row.
 * Malformed quoting and bounded-work violations return an explicit rejection.
 */
function parseCSV(source) {
    var rows = [], row = [], field = '', state = 'start', cells = 0, columns = 0;
    var ended = true;
    if (source.length === 0) return {kind: 'csv', rows: rows, columns: 0};
    for (var index = 0; index <= source.length; index++) {
        var character = source.charAt(index);
        var eof = index === source.length;
        var newline = character === '\n' || character === '\r';
        if (eof && ended) break;
        if (state === 'quoted') {
            if (eof) return {kind: 'invalid', message: '닫히지 않은 CSV 따옴표가 있습니다.'};
            if (character === '"') state = 'closed';
            else {
                field += newline ? '\n' : character;
                if (character === '\r' && source.charAt(index + 1) === '\n') index++;
            }
        } else if (state === 'closed' && character === '"') {
            field += '"'; state = 'quoted';
        } else if (eof || character === ',' || newline) {
            if (row.length >= CSV_MAX_COLUMNS || cells >= CSV_MAX_CELLS) {
                return {kind: 'invalid', message: 'CSV는 행당 1,024열, 전체 100,000셀까지만 변환할 수 있습니다. 파일을 나눠 주세요.'};
            }
            row.push(field); cells++; field = ''; state = 'start';
            if (character !== ',') {
                if (rows.length >= CSV_MAX_ROWS) return {kind: 'invalid', message: 'CSV는 20,000행까지만 변환할 수 있습니다. 파일을 나눠 주세요.'};
                columns = Math.max(columns, row.length); rows.push(row); row = []; ended = true;
                if (character === '\r' && source.charAt(index + 1) === '\n') index++;
            } else ended = false;
        } else if (state === 'closed') {
            return {kind: 'invalid', message: 'CSV 닫는 따옴표 뒤에는 쉼표나 줄바꿈만 올 수 있습니다.'};
        } else if (character === '"') {
            if (state !== 'start') return {kind: 'invalid', message: 'CSV의 따옴표는 필드의 시작에만 올 수 있습니다.'};
            state = 'quoted'; ended = false;
        } else {
            field += character; state = 'plain'; ended = false;
        }
        if (field.length > CSV_MAX_FIELD_CHARACTERS) {
            return {kind: 'invalid', message: 'CSV 셀 하나는 262,144자까지만 변환할 수 있습니다. 긴 셀을 나눠 주세요.'};
        }
    }
    return {kind: 'csv', rows: rows, columns: columns};
}

/** Make structural whitespace visible without evaluating or dropping content.
 * Empty values and absent ragged-row columns have separate display markers.
 * Source tabs use a visible arrow so they cannot move native table tab stops.
 */
function csvDisplayCell(row, column) {
    if (column >= row.length) return '[없는 열]';
    if (row[column] === '') return '[빈 셀]';
    return row[column].replace(/\t/g, '⇥');
}

/** Render short CSV records in a fixed-font grid with content-based widths.
 * The ordinal uses only its digit count plus padding; data columns share the
 * remaining A4 line width. Long cells wrap without losing text, and native
 * tabs are avoided so source values cannot shift a later column off the page.
 */
function appendCSVGrid(document, parsed) {
    var ordinalWidth = Math.max(2, String(parsed.rows.length).length + 1);
    var maximum = [], widths = [], available = 80 - ordinalWidth - parsed.columns * 3;
    for (var column = 0; column < parsed.columns; column++) {
        maximum.push(4);
    }
    for (var row = 0; row < parsed.rows.length; row++) {
        for (var field = 0; field < parsed.columns; field++) {
            var lines = csvDisplayCell(parsed.rows[row], field).split('\n');
            for (var line = 0; line < lines.length; line++) {
                var length = Array.from(lines[line]).reduce(function (sum, character) { return sum + tableCharacterWidth(character); }, 0);
                maximum[field] = Math.max(maximum[field], Math.min(80, length));
            }
        }
    }
    var allocated = 0;
    for (var initial = 0; initial < maximum.length; initial++) {
        widths.push(Math.min(12, maximum[initial])); allocated += widths[initial];
    }
    while (allocated > available) {
        var widest = 0;
        for (var shrink = 1; shrink < widths.length; shrink++) if (widths[shrink] > widths[widest]) widest = shrink;
        widths[widest]--; allocated--;
    }
    var remaining = available - allocated;
    while (remaining > 0) {
        var best = -1, need = 0;
        for (var candidate = 0; candidate < widths.length; candidate++) {
            var ratio = maximum[candidate] / widths[candidate];
            if (widths[candidate] < maximum[candidate] && ratio > need) { best = candidate; need = ratio; }
        }
        if (best === -1) break;
        widths[best]++; remaining--;
    }
    var tabPositions = [], usedWidth = ordinalWidth;
    for (var stop = 0; stop < widths.length; stop++) {
        tabPositions.push((usedWidth + 1) * 5.84);
        usedWidth += widths[stop] + 3;
    }
    var headers = ['행'];
    for (var header = 0; header < widths.length; header++) {
        var label = '열 ' + String(header + 1);
        headers.push(label);
    }
    appendTextBlock(document, headers.join('\t│ '), null, {size: 9.7, mono: true, bold: true, after: 4, tabPositions: tabPositions});
    for (var record = 0; record < parsed.rows.length; record++) {
        var cells = [], height = 1;
        for (var cell = 0; cell < widths.length; cell++) {
            var wrapped = wrapTableCell(csvDisplayCell(parsed.rows[record], cell), widths[cell]);
            cells.push(wrapped); height = Math.max(height, wrapped.length);
        }
        var rendered = [];
        for (var part = 0; part < height; part++) {
            var ordinal = part === 0 ? String(record + 1) : '';
            var pieces = [ordinal];
            for (var item = 0; item < widths.length; item++) {
                var entry = cells[item][part] || {text: '', width: 0};
                pieces.push(entry.text);
            }
            rendered.push(pieces.join('\t│ '));
        }
        appendTextBlock(document, rendered.join('\n'), null, {size: 9.7, mono: true, after: 3, tabPositions: tabPositions});
    }
}

/** Build a bounded native attributed document containing every source record.
 * Up to five source columns fit a numbered table; wider inputs use labelled
 * records so a horizontal page edge can never silently hide later columns.
 * The first source record is always data, even when it resembles a header.
 */
function buildCSVDocument(source) {
    var parsed = parseCSV(source);
    if (parsed.kind !== 'csv') throw new Error(parsed.message);
    // Bound native attributed-string and layout allocation before constructing
    // it. The input-byte, field, row, cell, and final page caps also apply.
    var estimate = source.length + parsed.rows.length * 64;
    if (parsed.columns <= 5) estimate += parsed.rows.length * parsed.columns * 24;
    else {
        for (var count = 0; count < parsed.rows.length; count++) estimate += parsed.rows[count].length * 32;
    }
    if (estimate > CSV_MAX_RENDER_CHARACTERS) throw new Error('CSV 표시 분량이 4 MiB를 넘습니다. 파일을 나눠 주세요.');
    var document = $.NSMutableAttributedString.alloc.init;
    var hasEmpty = false, hasMissing = false, hasTabs = false;
    for (var record = 0; record < parsed.rows.length; record++) {
        if (parsed.rows[record].length < parsed.columns) hasMissing = true;
        for (var value = 0; value < parsed.rows[record].length; value++) {
            if (parsed.rows[record][value] === '') hasEmpty = true;
            if (parsed.rows[record][value].indexOf('\t') !== -1) hasTabs = true;
        }
    }
    appendTextBlock(document, 'CSV', null, {size: 21, bold: true, after: 9});
    appendTextBlock(document, String(parsed.rows.length) + '행 · 최대 ' + String(parsed.columns) + '열', null,
        {size: 10.5, after: 5});
    var legend = [];
    if (hasEmpty) legend.push('[빈 셀] = 값 없음');
    if (hasMissing && parsed.columns <= 5) legend.push('[없는 열] = 짧은 행에 없는 필드');
    if (hasTabs) legend.push('⇥ = 원본 탭');
    appendTextBlock(document, '첫 행도 데이터로 표시합니다.' + (legend.length ? '\n' + legend.join(' · ') : ''), null,
        {size: 9, quote: true, after: 12});
    if (!parsed.rows.length) {
        appendTextBlock(document, '빈 CSV 파일입니다. 데이터 행이 없습니다.', null, {size: 11.5});
    } else if (parsed.columns <= 5) {
        appendCSVGrid(document, parsed);
    } else {
        appendTextBlock(document, '넓은 표: 모든 열을 행별로 나누어 표시합니다.', null, {size: 10, bold: true, after: 10});
        for (var rowIndex = 0; rowIndex < parsed.rows.length; rowIndex++) {
            var row = parsed.rows[rowIndex];
            appendTextBlock(document, '행 ' + String(rowIndex + 1) + ' · ' + String(row.length) + '개 필드', null,
                {size: 11.5, bold: true, before: 5, after: 5});
            for (var field = 0; field < row.length; field++) {
                appendTextBlock(document, '열 ' + String(field + 1) + ': ' + csvDisplayCell(row, field), null,
                    {size: 10.5, after: 4});
            }
        }
    }
    return document;
}

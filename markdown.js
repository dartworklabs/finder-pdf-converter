/**
 * Pure, bounded Markdown-to-display parser for the native PDF renderer.
 * Public surface: parseMarkdown(source). No HTML engine, URL resolution,
 * image loading, input evaluation, or I/O is involved. This is a readable
 * subset, not a CommonMark implementation: ATX/setext headings, paragraphs,
 * fenced/indented code, quotes, lists, rules, pipe tables, inline emphasis,
 * strike, code, escapes and inline link labels/image descriptions.
 * Unsupported syntax, including raw HTML and reference links, stays literal.
 */
(function (root) {
    'use strict';
    const MAX_CHARACTERS = 2000000;
    const MAX_LINES = 50000;
    const MAX_BLOCKS = 20000;
    const MAX_COLUMNS = 32;
    const MAX_TABLE_ROWS = 5000;

    /** Return text joined from inert style runs without interpreting markup. */
    function runText(runs) {
        return runs.map(function (run) { return run.text; }).join('');
    }

    /** Copy only known style flags so arbitrary input never becomes attributes. */
    function flags(style) {
        const result = {};
        ['bold', 'italic', 'code', 'strike'].forEach(function (name) {
            if (style[name]) result[name] = true;
        });
        return result;
    }

    /** Append display text and coalesce adjacent runs with the same flags. */
    function append(runs, text, style) {
        if (!text) return;
        const last = runs[runs.length - 1];
        const same = last && ['bold', 'italic', 'code', 'strike'].every(function (key) {
            return !!last[key] === !!style[key];
        });
        if (same) last.text += text;
        else {
            const run = flags(style);
            run.text = text;
            runs.push(run);
        }
    }

    /** Locate a closing marker while respecting a preceding escape. */
    function closingMarker(text, marker, start) {
        let offset = start;
        while (offset < text.length) {
            const found = text.indexOf(marker, offset);
            if (found < 0) return -1;
            let slashCount = 0;
            for (let index = found - 1; index >= 0 && text[index] === '\\'; index--) slashCount++;
            if (slashCount % 2 === 0) return found;
            offset = found + marker.length;
        }
        return -1;
    }

    /** Find an inline link's balanced target ending; its contents are discarded. */
    function linkEnd(text, start) {
        let depth = 1;
        for (let index = start; index < text.length; index++) {
            if (text[index] === '\\') { index++; continue; }
            if (text[index] === '(') {
                depth++;
                if (depth > 32) return -1;
            }
            if (text[index] === ')') depth--;
            if (depth === 0) return index;
        }
        return -1;
    }

    /** Parse styles into inert runs, with at most sixteen nested delimiters. */
    function inline(text, style, depth) {
        const runs = [];
        let cursor = 0;
        let plain = '';
        let cachedLabelClose = -2;
        let cachedTargetEnd = -1;
        /** Flush accumulated literal text into the current output style. */
        function flush() { append(runs, plain, style); plain = ''; }
        while (cursor < text.length) {
            const char = text[cursor];
            if (char === '\\' && cursor + 1 < text.length && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(text[cursor + 1])) {
                plain += text[cursor + 1]; cursor += 2; continue;
            }
            if (char === '`') {
                let count = 1;
                while (text[cursor + count] === '`') count++;
                const marker = new Array(count + 1).join('`');
                const end = text.indexOf(marker, cursor + count);
                if (end >= 0) {
                    flush();
                    const codeStyle = flags(style); codeStyle.code = true;
                    let code = text.slice(cursor + count, end).replace(/\n/g, ' ');
                    if (/^ .* $/.test(code) && /[^ ]/.test(code)) code = code.slice(1, -1);
                    append(runs, code, codeStyle); cursor = end + count; continue;
                }
                plain += marker; cursor += count; continue;
            }
            const image = char === '!' && text[cursor + 1] === '[';
            if ((char === '[' || image) && depth < 16) {
                const labelStart = cursor + (image ? 2 : 1);
                // Reuse the next candidate for long runs of unmatched '['.
                if (cachedLabelClose === -2 || (cachedLabelClose >= 0 && cachedLabelClose < labelStart)) {
                    cachedLabelClose = text.indexOf('](', labelStart);
                    cachedTargetEnd = cachedLabelClose >= 0 ? linkEnd(text, cachedLabelClose + 2) : -1;
                }
                const close = cachedLabelClose;
                const end = cachedTargetEnd;
                // Only a simple label ending at its first ']' is supported.
                // A previous reference label must not swallow a later link.
                const nestedOpen = close >= 0 ? text.indexOf('[', labelStart) : -1;
                const simpleLabel = close >= 0 && !(nestedOpen >= 0 && nestedOpen < close) && text.indexOf(']', labelStart) === close;
                if (end >= 0 && simpleLabel) {
                    flush();
                    if (image) append(runs, '[이미지: ', style);
                    inline(text.slice(labelStart, close), style, depth + 1).forEach(function (run) {
                        append(runs, run.text, run);
                    });
                    if (image) append(runs, ']', style);
                    cursor = end + 1; continue;
                }
            }
            let marker = null;
            if (text.slice(cursor, cursor + 3) === '***' || text.slice(cursor, cursor + 3) === '___') marker = text.slice(cursor, cursor + 3);
            else if (text.slice(cursor, cursor + 2) === '**' || text.slice(cursor, cursor + 2) === '__' || text.slice(cursor, cursor + 2) === '~~') marker = text.slice(cursor, cursor + 2);
            else if (char === '*' || char === '_') marker = char;
            // Underscores within identifiers and surrounding whitespace remain literal.
            if (marker && !(char === '_' && /[A-Za-z0-9]/.test(text[cursor - 1] || '')) && depth < 16 && !/\s/.test(text[cursor + marker.length] || ' ')) {
                const end = closingMarker(text, marker, cursor + marker.length);
                if (end > cursor + marker.length && !/\s/.test(text[end - 1])) {
                    flush();
                    const nextStyle = flags(style);
                    if (marker === '~~') nextStyle.strike = true;
                    else {
                        if (marker.length >= 2) nextStyle.bold = true;
                        if (marker.length === 1 || marker.length === 3) nextStyle.italic = true;
                    }
                    inline(text.slice(cursor + marker.length, end), nextStyle, depth + 1).forEach(function (run) {
                        append(runs, run.text, run);
                    });
                    cursor = end + marker.length; continue;
                }
            }
            plain += char; cursor++;
        }
        flush();
        return runs;
    }

    /** Split a pipe row, retaining escaped pipes and pipes in inline code. */
    function cells(line) {
        const result = [];
        let cell = '';
        let codeTicks = 0;
        const trimmed = line.trim();
        for (let index = 0; index < trimmed.length; index++) {
            const char = trimmed[index];
            if (char === '\\' && index + 1 < trimmed.length) { cell += char + trimmed[++index]; continue; }
            if (char === '`') {
                let count = 1;
                while (trimmed[index + count] === '`') count++;
                if (!codeTicks) codeTicks = count;
                else if (codeTicks === count) codeTicks = 0;
                cell += new Array(count + 1).join('`'); index += count - 1; continue;
            }
            if (char === '|' && !codeTicks) { result.push(cell.trim()); cell = ''; }
            else cell += char;
        }
        result.push(cell.trim());
        if (trimmed[0] === '|' && result[0] === '') result.shift();
        if (trimmed[trimmed.length - 1] === '|' && result[result.length - 1] === '') result.pop();
        return result;
    }

    /** Identify a table separator only when every cell has at least three dashes. */
    function tableAlign(line) {
        if (line.indexOf('|') < 0) return null;
        const parts = cells(line);
        if (!parts.length || !parts.every(function (part) { return /^:?-{3,}:?$/.test(part); })) return null;
        return parts.map(function (part) {
            return part[0] === ':' && part[part.length - 1] === ':' ? 'center' : part[part.length - 1] === ':' ? 'right' : 'left';
        });
    }

    /** Return a supported bullet/numbered list marker with bounded indentation. */
    function listMarker(line) {
        const match = /^( *)([-+*]|\d{1,9}[.)])\s+(.*)$/.exec(line);
        if (!match) return null;
        const ordered = /^\d/.test(match[2]);
        return { ordered: ordered, depth: Math.min(16, Math.floor(match[1].length / 2)), ordinal: ordered ? parseInt(match[2], 10) : null, text: match[3] };
    }

    /** Identify block starts without treating ordinary hyphenated prose as a rule. */
    function special(line) {
        return /^ {0,3}(#{1,6})(?:\s|$)/.test(line) || /^ {0,3}(`{3,}|~{3,})/.test(line) || /^ {0,3}>/.test(line) || /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) || !!listMarker(line) || /^( {4}|\t)/.test(line);
    }

    /** Add a styled block and reject excessive output before native layout begins. */
    function pushBlock(blocks, block) {
        if (blocks.length >= MAX_BLOCKS) throw new Error('Markdown 블록 수가 변환 한도(20,000개)를 넘습니다.');
        if (block.type !== 'code' && block.type !== 'table' && block.type !== 'list' && block.type !== 'rule') {
            block.runs = inline(block.text, {}, 0);
            block.text = runText(block.runs);
        }
        blocks.push(block);
    }

    /**
     * Parse a string into inert display blocks; throws for type/resource limits.
     * Input limit: 2,000,000 UTF-16 units, 50,000 lines, 20,000 blocks;
     * each table is limited to 32 columns and 5,000 body rows.
     */
    function parseMarkdown(source) {
        if (typeof source !== 'string') throw new Error('Markdown 입력은 문자열이어야 합니다.');
        if (source.length > MAX_CHARACTERS) throw new Error('Markdown 크기가 변환 한도(2,000,000자)를 넘습니다.');
        const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '\uFFFD').split('\n');
        if (lines.length > MAX_LINES) throw new Error('Markdown 줄 수가 변환 한도(50,000줄)를 넘습니다.');
        const blocks = [];
        let index = 0;
        while (index < lines.length) {
            const line = lines[index];
            if (!line.trim()) { index++; continue; }
            const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
            if (fence) {
                const content = [];
                const marker = fence[1][0];
                index++;
                while (index < lines.length) {
                    const end = /^ {0,3}(`+|~+)\s*$/.exec(lines[index]);
                    if (end && end[1][0] === marker && end[1].length >= fence[1].length) { index++; break; }
                    content.push(lines[index++]);
                }
                pushBlock(blocks, { type: 'code', text: content.join('\n'), language: fence[2].trim() }); continue;
            }
            const heading = /^ {0,3}(#{1,6})(?:\s+(.*)|\s*)$/.exec(line);
            if (heading) {
                pushBlock(blocks, { type: 'heading', level: heading[1].length, text: (heading[2] || '').replace(/\s+#+\s*$/, '') }); index++; continue;
            }
            if (index + 1 < lines.length && /^ {0,3}(=+|-+)\s*$/.test(lines[index + 1]) && !special(line)) {
                pushBlock(blocks, { type: 'heading', level: lines[index + 1].trim()[0] === '=' ? 1 : 2, text: line.trim() }); index += 2; continue;
            }
            if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
                pushBlock(blocks, { type: 'rule', text: '' }); index++; continue;
            }
            const align = index + 1 < lines.length ? tableAlign(lines[index + 1]) : null;
            if (align && line.indexOf('|') >= 0 && cells(line).length === align.length) {
                if (align.length > MAX_COLUMNS) throw new Error('Markdown 표는 32열까지 지원합니다.');
                const headerRuns = cells(line).map(function (cell) { return inline(cell, {}, 0); });
                const headers = headerRuns.map(runText);
                const rows = []; const rowRuns = [];
                index += 2;
                while (index < lines.length && lines[index].trim() && lines[index].indexOf('|') >= 0 && !special(lines[index])) {
                    if (rows.length >= MAX_TABLE_ROWS) throw new Error('Markdown 표는 본문 5,000행까지 지원합니다.');
                    const row = cells(lines[index++]);
                    // Preserve overflow cells rather than silently losing user text.
                    if (row.length > headers.length) throw new Error('Markdown 표의 열 수가 머리글과 다릅니다.');
                    while (row.length < headers.length) row.push('');
                    const runs = row.map(function (cell) { return inline(cell, {}, 0); });
                    rowRuns.push(runs); rows.push(runs.map(runText));
                }
                pushBlock(blocks, { type: 'table', text: [headers.join(' | ')].concat(rows.map(function (row) { return row.join(' | '); })).join('\n'), headers: headers, rows: rows, align: align, headerRuns: headerRuns, rowRuns: rowRuns }); continue;
            }
            if (/^ {0,3}>/.test(line)) {
                const content = [];
                while (index < lines.length && /^ {0,3}>/.test(lines[index])) content.push(lines[index++].replace(/^ {0,3}> ?/, ''));
                pushBlock(blocks, { type: 'quote', text: content.join('\n') }); continue;
            }
            const firstItem = listMarker(line);
            if (firstItem) {
                const items = []; const ordered = firstItem.ordered;
                while (index < lines.length) {
                    const item = listMarker(lines[index]);
                    if (!item || (item.depth === firstItem.depth && item.ordered !== ordered)) break;
                    index++;
                    while (index < lines.length && /^\s+\S/.test(lines[index]) && !special(lines[index])) item.text += '\n' + lines[index++].trim();
                    item.runs = inline(item.text, {}, 0); item.text = runText(item.runs); items.push(item);
                }
                pushBlock(blocks, { type: 'list', text: items.map(function (item) { return item.text; }).join('\n'), ordered: ordered, items: items }); continue;
            }
            if (/^( {4}|\t)/.test(line)) {
                const content = [];
                while (index < lines.length && (/^( {4}|\t)/.test(lines[index]) || !lines[index].trim())) content.push(lines[index++].replace(/^( {4}|\t)/, ''));
                while (content.length && content[content.length - 1] === '') content.pop();
                pushBlock(blocks, { type: 'code', text: content.join('\n'), language: '' }); continue;
            }
            const content = [line.trim()]; index++;
            while (index < lines.length && lines[index].trim() && !special(lines[index]) && !(index + 1 < lines.length && (tableAlign(lines[index + 1]) || /^ {0,3}(=+|-+)\s*$/.test(lines[index + 1])))) content.push(lines[index++].trim());
            pushBlock(blocks, { type: 'paragraph', text: content.join('\n') });
        }
        return blocks;
    }

    root.parseMarkdown = parseMarkdown;
    if (typeof module !== 'undefined' && module.exports) module.exports = { parseMarkdown: parseMarkdown };
}(this));

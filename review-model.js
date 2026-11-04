/* Pure selection rules shared by the review app and Node tests. */
var ReviewModel = (function () {
    /** Parse an ordered, duplicate-free list of 1-based pages. */
    function parseRange(text, count) {
        if (!Number.isSafeInteger(count) || count < 1 || typeof text !== 'string') throw new Error('range');
        if (text.trim() === '') return Array.from({length: count}, function (_, i) { return i + 1; });
        var pages = [], seen = {};
        text.split(',').forEach(function (part) {
            var match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
            if (!match) throw new Error('range');
            var first = Number(match[1]), last = match[2] === undefined ? first : Number(match[2]);
            if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > count) throw new Error('range');
            for (var i = first; i <= last; i++) {
                if (seen[i]) throw new Error('range');
                seen[i] = true; pages.push(i);
            }
        });
        return pages;
    }
    /** Return the selected original indices in the displayed order. */
    function selection(items) {
        var result = [];
        items.forEach(function (item) {
            if (item.included) result.push({index: item.index, pages: parseRange(item.range, item.count)});
        });
        if (!result.length) throw new Error('empty');
        return result;
    }
    return {parseRange: parseRange, selection: selection};
}());
if (typeof module !== 'undefined') module.exports = ReviewModel;

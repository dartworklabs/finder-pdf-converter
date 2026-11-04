/** macOS language selection shared by Finder and command-line result reporting.
 * Public surface: fpdfPreferredLanguage(orderedTags), run(). No region or shell
 * locale is consulted. Missing/unsupported preferences resolve to English.
 */
ObjC.import('Foundation');

/** Match ordered BCP-47/Apple language tags to the two shipped translations. */
function fpdfPreferredLanguage(orderedTags) {
    if (!Array.isArray(orderedTags)) return 'en';
    for (var index = 0; index < orderedTags.length; index++) {
        if (typeof orderedTags[index] !== 'string') continue;
        var language = orderedTags[index].toLowerCase().split(/[-_]/)[0];
        if (language === 'en' || language === 'ko') return language;
    }
    return 'en';
}

/** Read explicit Finder language preferences before the system language list.
 * A Finder override is authoritative even when none of its tags is supported.
 * A process-local AppleLanguages argument may override domains for isolated
 * validation; production callers supply no such argument. Shell LANG and the
 * osascript app's own persistent language preference are never consulted.
 */
function run() {
    var defaults = $.NSUserDefaults.standardUserDefaults;
    var argumentsDomain = defaults.volatileDomainForName('NSArgumentDomain');
    var languages = argumentsDomain && !argumentsDomain.isNil() ? argumentsDomain.objectForKey('AppleLanguages') : null;
    if (!languages || languages.isNil() || Number(languages.count) === 0) {
        var finder = defaults.persistentDomainForName('com.apple.finder');
        languages = finder && !finder.isNil() ? finder.objectForKey('AppleLanguages') : null;
    }
    if (!languages || languages.isNil() || Number(languages.count) === 0) {
        var global = defaults.persistentDomainForName('NSGlobalDomain');
        languages = global && !global.isNil() ? global.objectForKey('AppleLanguages') : null;
    }
    return languages && !languages.isNil() ? fpdfPreferredLanguage(ObjC.deepUnwrap(languages)) : 'en';
}

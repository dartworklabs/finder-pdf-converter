import AppKit
import Foundation
import CoreFoundation

// Resolve the service label and bundle name through Apple's bundle machinery.
// The caller supplies a workflow path and process-only AppleLanguages arguments.
let workflow = URL(fileURLWithPath: CommandLine.arguments[1])
guard let bundle = Bundle(url: workflow),
      let services = bundle.infoDictionary?["NSServices"] as? [[String: Any]],
      let menu = services.first?["NSMenuItem"] as? [String: String],
      let key = menu["default"] else {
    fatalError("Workflow has no service menu declaration")
}
let title = bundle.localizedString(forKey: key, value: key, table: "ServicesMenu")
let displayName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? ""
let result: [String: Any] = [
    "languages": Locale.preferredLanguages,
    "sessionLanguages": CFPreferencesCopyValue("AppleLanguages" as CFString,
        kCFPreferencesAnyApplication, kCFPreferencesCurrentUser,
        kCFPreferencesAnyHost) as? [String] ?? [],
    "localizations": bundle.preferredLocalizations,
    "menuTitle": title,
    "displayName": displayName,
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)

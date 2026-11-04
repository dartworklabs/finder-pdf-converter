import Foundation

// The service menu contract is the inline dictionary; bundle display-name
// localization is a different native operation and does not prove Finder's menu.
let workflow = URL(fileURLWithPath: CommandLine.arguments[1])
guard let bundle = Bundle(url: workflow),
      let services = bundle.infoDictionary?["NSServices"] as? [[String: Any]],
      let menu = services.first?["NSMenuItem"] as? [String: String] else {
    fatalError("Workflow has no service menu declaration")
}
let displayName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? ""
let result: [String: Any] = [
    "languages": Locale.preferredLanguages,
    "localizations": bundle.preferredLocalizations,
    "inlineMenuTitles": menu,
    "displayName": displayName,
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)

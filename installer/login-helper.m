#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <mach-o/dyld.h>
#import <limits.h>
#import <stdlib.h>

/** Exit without reopening an existing manager; otherwise request a background launch
 * of the containing app. No caller-supplied path or arguments are accepted. Return
 * nonzero on lookup, path, launch, or timeout failure; no files are written. */
int main(void) {
    @autoreleasepool {
        NSArray<NSRunningApplication *> *running = NSWorkspace.sharedWorkspace.runningApplications;
        if (!running) return 2;
        for (NSRunningApplication *item in running) {
            if ([item.bundleIdentifier isEqualToString:@"com.wonjun-lab.finder-pdf-converter.installer"]) return 0;
        }
        char raw[PATH_MAX], resolved[PATH_MAX];
        uint32_t length = sizeof(raw);
        if (_NSGetExecutablePath(raw, &length) != 0 || !realpath(raw, resolved)) return 3;
        NSString *path = [NSString stringWithUTF8String:resolved];
        NSString *macOS = path.stringByDeletingLastPathComponent;
        NSString *contents = macOS.stringByDeletingLastPathComponent;
        NSString *app = contents.stringByDeletingLastPathComponent;
        if (![macOS.lastPathComponent isEqualToString:@"MacOS"] ||
            ![contents.lastPathComponent isEqualToString:@"Contents"] ||
            ![app.pathExtension isEqualToString:@"app"]) return 4;
        NSTask *task = [[NSTask alloc] init];
        task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/open"];
        task.arguments = @[@"-g", @"-a", app, @"--args", @"--background"];
        task.environment = @{@"PATH": @"/usr/bin:/bin", @"HOME": NSHomeDirectory()};
        task.standardInput = NSFileHandle.fileHandleWithNullDevice;
        task.standardOutput = NSFileHandle.fileHandleWithNullDevice;
        task.standardError = NSFileHandle.fileHandleWithNullDevice;
        NSError *error = nil;
        if (![task launchAndReturnError:&error]) return 5;
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
        while (task.running && deadline.timeIntervalSinceNow > 0) [NSThread sleepForTimeInterval:0.05];
        if (task.running) { [task terminate]; return 6; }
        return task.terminationStatus == 0 ? 0 : 7;
    }
}

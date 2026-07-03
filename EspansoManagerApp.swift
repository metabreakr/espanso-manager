// Espanso Manager — Copyright (C) 2026 Jonathan Ruzek
// SPDX-License-Identifier: GPL-3.0-only
//
// Native standalone-window wrapper. Hosts the local Espanso Manager web UI in a real
// macOS window (WKWebView) instead of a browser tab. It starts the Node server as a
// child process if it isn't already running, and stops it again when the app quits.
//
// install.sh fills in the two absolute paths below and compiles this with swiftc.

import Cocoa
import WebKit
import Darwin

let APP_DIR = "__APP_DIR__"
let NODE_BIN = "__NODE_BIN__"
let PORT: UInt16 = 8934
let URL_STRING = "http://127.0.0.1:8934"

// Returns true if something is already listening on 127.0.0.1:PORT.
func isServerUp() -> Bool {
    let sock = socket(AF_INET, SOCK_STREAM, 0)
    if sock < 0 { return false }
    defer { close(sock) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = PORT.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    return rc == 0
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        startServerIfNeeded()
        buildWindow()
        loadWhenReady()
    }

    func startServerIfNeeded() {
        if isServerUp() { return } // reuse an already-running server; don't own it.
        let p = Process()
        p.executableURL = URL(fileURLWithPath: NODE_BIN)
        p.arguments = ["server.mjs"]
        p.currentDirectoryURL = URL(fileURLWithPath: APP_DIR)
        var env = ProcessInfo.processInfo.environment
        let nodeDir = (NODE_BIN as NSString).deletingLastPathComponent
        env["PATH"] = nodeDir + ":" + (env["PATH"] ?? "/usr/bin:/bin")
        p.environment = env
        do {
            try p.run()
            serverProcess = p
        } catch {
            NSLog("Espanso Manager: failed to start server: \(error)")
        }
    }

    func buildWindow() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: config)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Espanso Manager"
        window.minSize = NSSize(width: 720, height: 480)
        window.center()
        window.setFrameAutosaveName("EspansoManagerWindow")
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    // Poll until the server answers, then load the UI. Falls through after ~10s.
    func loadWhenReady() {
        DispatchQueue.global(qos: .userInitiated).async {
            for _ in 0..<100 {
                if isServerUp() { break }
                usleep(100_000) // 0.1s
            }
            DispatchQueue.main.async {
                self.webView.load(URLRequest(url: URL(string: URL_STRING)!))
            }
        }
    }

    // Re-focusing the app (or clicking the Dock icon) with no window reopens it.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        serverProcess?.terminate() // only set if we started it
    }
}

// A minimal main menu so standard editing shortcuts (Copy/Paste/Select All/Undo) work
// inside the web UI's text fields, plus Quit and Reload.
func buildMainMenu() -> NSMenu {
    let mainMenu = NSMenu()

    let appItem = NSMenuItem()
    mainMenu.addItem(appItem)
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(withTitle: "Hide Espanso Manager", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(NSMenuItem.separator())
    appMenu.addItem(withTitle: "Quit Espanso Manager", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    let editItem = NSMenuItem()
    mainMenu.addItem(editItem)
    let editMenu = NSMenu(title: "Edit")
    editItem.submenu = editMenu
    editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(NSMenuItem.separator())
    editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

    let viewItem = NSMenuItem()
    mainMenu.addItem(viewItem)
    let viewMenu = NSMenu(title: "View")
    viewItem.submenu = viewMenu
    viewMenu.addItem(withTitle: "Reload", action: #selector(WKWebView.reload(_:)), keyEquivalent: "r")

    return mainMenu
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.mainMenu = buildMainMenu()
app.run()

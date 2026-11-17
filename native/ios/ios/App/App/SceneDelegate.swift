import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // Sign-in handoff, cold start: a bidwitme:// link that launched the app
        // arrives in connectionOptions, before the bridge's WebView exists.
        // Stash any code it carried; the replay below delivers it once the
        // WebView is up.
        for context in connectionOptions.urlContexts {
            if let code = Self.handoffCode(from: context.url) {
                UserDefaults.standard.set(code, forKey: Self.pendingHandoffKey)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.replayPendingHandoff(attempt: 0)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
        // Sign-in handoff return: no plugin is registered in this remote-URL
        // shell to receive appUrlOpen, so the delegate routes the code itself
        // (after the proxy, which stays first and unchanged).
        for context in URLContexts {
            if let code = Self.handoffCode(from: context.url) {
                routeHandoff(code)
            }
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // MARK: - Sign-in handoff (bidwitme://auth?code=…)
    //
    // The browser half of the handoff (…/auth/handoff) finishes by opening
    // bidwitme://auth?code=<one-time code>. The web app redeems a code that
    // arrives as ?handoff=<code> on the game origin, so the native side only
    // translates the scheme URL into that load. Codes are single-use with a
    // 10-minute life server-side, so a stale or replayed code can only ever
    // fail harmlessly in the page.

    private static let pendingHandoffKey = "bwm.pendingHandoffCode"

    private static func handoffCode(from url: URL) -> String? {
        guard url.scheme == "bidwitme" else { return nil }
        let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value
        return (code?.isEmpty == false) ? code : nil
    }

    private func routeHandoff(_ code: String) {
        if let webView = (window?.rootViewController as? CAPBridgeViewController)?.bridge?.webView {
            loadHandoff(code, into: webView)
        } else {
            // Not lost: stashed, and the bounded replay below delivers it.
            UserDefaults.standard.set(code, forKey: Self.pendingHandoffKey)
            replayPendingHandoff(attempt: 0)
        }
    }

    /// Delivers a stashed code once the bridge's WebView exists. The stash is
    /// removed ONLY at the moment a load actually happens — if the WebView is
    /// not up yet (the cold-start case: the 0.5 s replay fires before the
    /// bridge finished standing up), the code stays stashed and the replay
    /// retries on a bounded schedule (attempts at +0.5 s steps, ~3 s total)
    /// instead of dropping a single-use code on the floor.
    private func replayPendingHandoff(attempt: Int) {
        guard let code = UserDefaults.standard.string(forKey: Self.pendingHandoffKey), !code.isEmpty else { return }
        if let webView = (window?.rootViewController as? CAPBridgeViewController)?.bridge?.webView {
            UserDefaults.standard.removeObject(forKey: Self.pendingHandoffKey)
            loadHandoff(code, into: webView)
        } else if attempt < 5 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.replayPendingHandoff(attempt: attempt + 1)
            }
        }
        // Past the last attempt the stash simply stays put: a later launch
        // replays it again, and an expired code fails harmlessly server-side.
    }

    private func loadHandoff(_ code: String, into webView: WKWebView) {
        var components = URLComponents(string: "https://bid-wit-me.pages.dev/")
        components?.queryItems = [URLQueryItem(name: "handoff", value: code)]
        if let url = components?.url {
            webView.load(URLRequest(url: url))
        }
    }
}

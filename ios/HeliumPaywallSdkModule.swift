import ExpoModulesCore
import Helium
import SwiftUI

public class HeliumPaywallSdkModule: Module {
  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('HeliumPaywallSdk')` in JavaScript.
    Name("HeliumPaywallSdk")

    // Sets constant properties on the module. Can take a dictionary or a closure that returns a dictionary.
    Constants([
      "PI": Double.pi
    ])

    // Defines event names that the module can send to JavaScript.
    Events("onHeliumPaywallEvent")

    Function("initialize") { (config: [String : Any]) in
      let userTraitsMap = config["customUserTraits"] as? [String : Any]

      // Create delegate with closure that sends events to JavaScript
      let delegate = InternalDelegate { [weak self] event in
        self?.sendEvent("onHeliumPaywallEvent", event.toDictionary())
      }

      Helium.shared.initialize(
        apiKey: config["apiKey"] as? String ?? "",
        heliumPaywallDelegate: delegate,
        fallbackPaywall: FallbackView(),
        customUserId: config["customUserId"] as? String,
        customAPIEndpoint: config["customAPIEndpoint"] as? String,
        customUserTraits: userTraitsMap != nil ? HeliumUserTraits(userTraitsMap!) : nil,
        revenueCatAppUserId: config["revenueCatAppUserId"] as? String
      )
    }

    Function("presentUpsell") { (trigger: String) in
      Helium.shared.presentUpsell(trigger: trigger);
    }

    Function("hideUpsell") {
      let _ result = Helium.shared.hideUpsell();
    }

    Function("hideAllUpsells") {
      Helium.shared.hideAllUpsells();
    }

    Function("getDownloadStatus") {
      return Helium.shared.getDownloadStatus().rawValue;
    }

    Function("fallbackOpenOrCloseEvent") { (trigger: String?, isOpen: Bool, viewType: String?) in
      HeliumPaywallDelegateWrapper.shared.onFallbackOpenCloseEvent(trigger: trigger, isOpen: isOpen, viewType: viewType)
    }

    // Defines a JavaScript function that always returns a Promise and whose native code
    // is by default dispatched on the different thread than the JavaScript runtime runs on.
//     AsyncFunction("setValueAsync") { (value: String) in
//       // Send an event to JavaScript.
//       self.sendEvent("onHeliumPaywallEvent", [
//         "value": value
//       ])
//     }

    // Enables the module to be used as a native view. Definition components that are accepted as part of the
    // view definition: Prop, Events.
    View(HeliumPaywallSdkView.self) {
      // Defines a setter for the `url` prop.
      Prop("url") { (view: HeliumPaywallSdkView, url: URL) in
        if view.webView.url != url {
          view.webView.load(URLRequest(url: url))
        }
      }

      Events("onLoad")
    }
  }
}

fileprivate class InternalDelegate: HeliumPaywallDelegate {
    private let eventHandler: (HeliumPaywallEvent) -> Void

    init(eventHandler: @escaping (HeliumPaywallEvent) -> Void) {
        self.eventHandler = eventHandler
    }

    public func makePurchase(productId: String) async -> HeliumPaywallTransactionStatus {
        print("make purchase!")
        return .purchased
    }

    public func restorePurchases() async -> Bool {
        print("restore purchase!")
        return true
    }

    public func onHeliumPaywallEvent(event: HeliumPaywallEvent) {
        eventHandler(event)
    }
}

fileprivate struct FallbackView: View {
    @Environment(\.presentationMode) var presentationMode

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("Fallback Paywall")
                .font(.title)
                .fontWeight(.bold)

            Text("Something went wrong loading the paywall")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            Spacer()

            Button(action: {
                presentationMode.wrappedValue.dismiss()
            }) {
                Text("Close")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(10)
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
        .padding()
    }
}

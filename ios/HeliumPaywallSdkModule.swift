import ExpoModulesCore
import Helium
import SwiftUI

// Define purchase error enum
enum PurchaseError: LocalizedError {
    case unknownStatus(status: String)
    case purchaseFailed(errorMsg: String)

    var errorDescription: String? {
        switch self {
        case let .unknownStatus(status):
            return "Purchased not successful due to unknown status - \(status)."
        case let .purchaseFailed(errorMsg):
            return errorMsg
        }
    }
}

struct PaywallInfoResult: Record {
  @Field
  var errorMsg: String? = nil

  @Field
  var templateName: String? = nil

  @Field
  var shouldShow: Bool? = nil
}

struct HasEntitlementResult: Record {
  @Field
  var hasEntitlement: Bool? = nil
}

public class HeliumPaywallSdkModule: Module {
  // Single continuations for ongoing operations
  private var currentProductId: String? = nil
  private var purchaseContinuation: CheckedContinuation<HeliumPaywallTransactionStatus, Never>? = nil
  private var restoreContinuation: CheckedContinuation<Bool, Never>? = nil

  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('HeliumPaywallSdk')` in JavaScript.
    Name("HeliumPaywallSdk")

    // Sets constant properties on the module. Can take a dictionary or a closure that returns a dictionary.
//     Constants([
//       "PI": Double.pi
//     ])

    // Defines event names that the module can send to JavaScript.
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers")

    // todo use Record here? https://docs.expo.dev/modules/module-api/#records
    Function("initialize") { (config: [String : Any]) in
      let userTraitsMap = convertMarkersToBooleans(config["customUserTraits"] as? [String : Any])
      let fallbackBundleURLString = config["fallbackBundleUrlString"] as? String
      let fallbackBundleString = config["fallbackBundleString"] as? String
      
      let paywallLoadingConfig = convertMarkersToBooleans(config["paywallLoadingConfig"] as? [String: Any])
      let useLoadingState = paywallLoadingConfig?["useLoadingState"] as? Bool ?? true
      let loadingBudget = paywallLoadingConfig?["loadingBudget"] as? TimeInterval ?? 2.0
      
      var perTriggerLoadingConfig: [String: TriggerLoadingConfig]? = nil
      if let perTriggerDict = paywallLoadingConfig?["perTriggerLoadingConfig"] as? [String: [String: Any]] {
        var triggerConfigs: [String: TriggerLoadingConfig] = [:]
        for (trigger, config) in perTriggerDict {
          triggerConfigs[trigger] = TriggerLoadingConfig(
            useLoadingState: config["useLoadingState"] as? Bool,
            loadingBudget: config["loadingBudget"] as? TimeInterval
          )
        }
        perTriggerLoadingConfig = triggerConfigs
      }

      let useDefaultDelegate = config["useDefaultDelegate"] as? Bool ?? false

      let delegateEventHandler: (HeliumEvent) -> Void = { [weak self] event in
          var eventDict = event.toDictionary()
          // Add deprecated fields for backwards compatibility
          if let paywallName = eventDict["paywallName"] {
              eventDict["paywallTemplateName"] = paywallName
          }
          if let error = eventDict["error"] {
              eventDict["errorDescription"] = error
          }
          if let productId = eventDict["productId"] {
              eventDict["productKey"] = productId
          }
          if let buttonName = eventDict["buttonName"] {
              eventDict["ctaName"] = buttonName
          }
          self?.sendEvent("onHeliumPaywallEvent", eventDict)
      }

      // Create delegate with closures that send events to JavaScript
      let internalDelegate = InternalDelegate(
        eventHandler: delegateEventHandler,
        purchaseHandler: { [weak self] productId in
          guard let self else { return .failed(PurchaseError.purchaseFailed(errorMsg: "Module not active!")) }
          // Check if there's already a purchase in progress and cancel it
          if let existingContinuation = self.purchaseContinuation {
            existingContinuation.resume(returning: .cancelled)
            self.purchaseContinuation = nil
            self.currentProductId = nil
          }

          return await withCheckedContinuation { continuation in
            // Store the continuation and product ID
            self.currentProductId = productId
            self.purchaseContinuation = continuation

            // Send event to JavaScript
            self.sendEvent("onDelegateActionEvent", [
              "type": "purchase",
              "productId": productId
            ])
          }
        },
        restoreHandler: { [weak self] in
          guard let self else { return false }
          // Check if there's already a restore in progress and cancel it
          if let existingContinuation = self.restoreContinuation {
            existingContinuation.resume(returning: false)
            self.restoreContinuation = nil
          }

          return await withCheckedContinuation { continuation in
            // Store the continuation
            self.restoreContinuation = continuation

            // Send event to JavaScript
            self.sendEvent("onDelegateActionEvent", [
              "type": "restore"
            ])
          }
        }
      )

      let defaultDelegate = DefaultPurchaseDelegate(eventHandler: delegateEventHandler)

      // Handle fallback bundle - either as URL string or JSON string
      var fallbackBundleURL: URL? = nil
      if let urlString = fallbackBundleURLString {
        fallbackBundleURL = URL(string: urlString)
      } else if let jsonString = fallbackBundleString {
        // write the string to a temp file
        let tempURL = FileManager.default.temporaryDirectory
          .appendingPathComponent("helium-fallback.json")

        if let data = jsonString.data(using: .utf8) {
          try? data.write(to: tempURL)
          fallbackBundleURL = tempURL
        }
      }

      Helium.shared.initialize(
        apiKey: config["apiKey"] as? String ?? "",
        heliumPaywallDelegate: useDefaultDelegate ? defaultDelegate : internalDelegate,
        fallbackConfig: HeliumFallbackConfig.withMultipleFallbacks(
            // As a workaround for required fallback check in iOS, supply empty fallbackPerTrigger
            // since currently iOS requires some type of fallback but RN does not.
            fallbackPerTrigger: [:],
            fallbackBundle: fallbackBundleURL,
            useLoadingState: useLoadingState,
            loadingBudget: loadingBudget,
            perTriggerLoadingConfig: perTriggerLoadingConfig
        ),
        customUserId: config["customUserId"] as? String,
        customAPIEndpoint: config["customAPIEndpoint"] as? String,
        customUserTraits: userTraitsMap != nil ? HeliumUserTraits(userTraitsMap!) : nil,
        revenueCatAppUserId: config["revenueCatAppUserId"] as? String
      )
    }

    // Function for JavaScript to provide purchase result
    Function("handlePurchaseResult") { [weak self] (statusString: String, errorMsg: String?) in
      guard let continuation = self?.purchaseContinuation else {
        return
      }

      // Parse status string
      let lowercasedStatus = statusString.lowercased()
      let status: HeliumPaywallTransactionStatus

      switch lowercasedStatus {
      case "purchased": status = .purchased
      case "cancelled": status = .cancelled
      case "restored":  status = .restored
      case "pending":   status = .pending
      case "failed":    status = .failed(PurchaseError.purchaseFailed(errorMsg: errorMsg ?? "Unexpected error."))
      default:          status = .failed(PurchaseError.unknownStatus(status: lowercasedStatus))
      }

      // Clear the references
      self?.purchaseContinuation = nil
      self?.currentProductId = nil

      // Resume the continuation with the status
      continuation.resume(returning: status)
    }

    // Function for JavaScript to provide restore result
    Function("handleRestoreResult") { [weak self] (success: Bool) in
      guard let continuation = self?.restoreContinuation else {
        return
      }

      self?.restoreContinuation = nil
      continuation.resume(returning: success)
    }

    Function("presentUpsell") { (trigger: String, customPaywallTraits: [String: Any]?) in
        Helium.shared.presentUpsell(
            trigger: trigger,
            eventHandlers: PaywallEventHandlers.withHandlers(
                onOpen: { [weak self] event in
                    self?.sendEvent("paywallEventHandlers", event.toDictionary())
                },
                onClose: { [weak self] event in
                    self?.sendEvent("paywallEventHandlers", event.toDictionary())
                },
                onDismissed: { [weak self] event in
                    self?.sendEvent("paywallEventHandlers", event.toDictionary())
                },
                onPurchaseSucceeded: { [weak self] event in
                    self?.sendEvent("paywallEventHandlers", event.toDictionary())
                },
                onOpenFailed: { [weak self] event in
                  self?.sendEvent("paywallEventHandlers", event.toDictionary())
                },
                onCustomPaywallAction: { [weak self] event in
                  self?.sendEvent("paywallEventHandlers", event.toDictionary())
                }
            ),
            customPaywallTraits: convertMarkersToBooleans(customPaywallTraits)
        )
    }

    Function("hideUpsell") {
      let _ = Helium.shared.hideUpsell()
    }

    Function("hideAllUpsells") {
      Helium.shared.hideAllUpsells()
    }

    Function("getDownloadStatus") {
      return Helium.shared.getDownloadStatus().rawValue
    }

    Function("fallbackOpenOrCloseEvent") { (trigger: String?, isOpen: Bool, viewType: String?) in
      HeliumPaywallDelegateWrapper.shared.onFallbackOpenCloseEvent(trigger: trigger, isOpen: isOpen, viewType: viewType, fallbackReason: .bridgingError)
    }

    Function("getPaywallInfo") { (trigger: String) in
      guard let paywallInfo = Helium.shared.getPaywallInfo(trigger: trigger) else {
        return PaywallInfoResult(
          errorMsg: "Invalid trigger or paywalls not ready.",
          templateName: nil,
          shouldShow: nil
        )
      }

      return PaywallInfoResult(
        errorMsg: nil,
        templateName: paywallInfo.paywallTemplateName,
        shouldShow: paywallInfo.shouldShow
      )
    }

    Function("setRevenueCatAppUserId") { (rcAppUserId: String) in
        Helium.shared.setRevenueCatAppUserId(rcAppUserId)
    }

    Function("setCustomUserId") { (newUserId: String) in
        Helium.shared.overrideUserId(newUserId: newUserId)
    }

    AsyncFunction("hasEntitlementForPaywall") { (trigger: String) in
      let hasEntitlement = await Helium.shared.hasEntitlementForPaywall(trigger: trigger)
      return HasEntitlementResult(hasEntitlement: hasEntitlement)
    }

    AsyncFunction("hasAnyActiveSubscription") {
      return await Helium.shared.hasAnyActiveSubscription()
    }

    AsyncFunction("hasAnyEntitlement") {
      return await Helium.shared.hasAnyEntitlement()
    }

    Function("handleDeepLink") { (urlString: String) in
      guard let url = URL(string: urlString) else {
        return false
      }

      return Helium.shared.handleDeepLink(url)
    }

    Function("getExperimentInfoForTrigger") { (trigger: String) -> [String: Any] in
      guard let experimentInfo = Helium.shared.getExperimentInfoForTrigger(trigger) else {
        return ["getExperimentInfoErrorMsg": "No experiment info found for trigger: \(trigger)"]
      }

      // Convert ExperimentInfo to dictionary using JSONEncoder
      let encoder = JSONEncoder()
      guard let jsonData = try? encoder.encode(experimentInfo),
          var dictionary = try? JSONSerialization.jsonObject(with: jsonData, options: []) as? [String: Any] else {
        return ["getExperimentInfoErrorMsg": "Failed to serialize experiment info"]
      }

      // Return the dictionary directly - it contains all ExperimentInfo fields
      return dictionary
    }

    Function("disableRestoreFailedDialog") {
        Helium.restorePurchaseConfig.disableRestoreFailedDialog()
    }

    Function("setCustomRestoreFailedStrings") { (customTitle: String?, customMessage: String?, customCloseButtonText: String?) in
      Helium.restorePurchaseConfig.setCustomRestoreFailedStrings(
        customTitle: customTitle,
        customMessage: customMessage,
        customCloseButtonText: customCloseButtonText
      )
    }

    Function("resetHelium") {
      Helium.resetHelium()
    }

    Function("setLightDarkModeOverride") { (mode: String) in
      let heliumMode: HeliumLightDarkMode
      switch mode.lowercased() {
      case "light":
        heliumMode = .light
      case "dark":
        heliumMode = .dark
      case "system":
        heliumMode = .system
      default:
        print("[Helium] Invalid mode: \(mode), defaulting to system")
        heliumMode = .system
      }
      Helium.shared.setLightDarkModeOverride(heliumMode)
    }

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

    /// Recursively converts special marker strings back to boolean values to restore
    /// type information that was preserved when passing through native bridge
    ///
    /// Native bridge converts booleans to NSNumber (0/1), so we use
    /// special marker strings to preserve the original intent. This helper converts:
    /// - "__helium_rn_bool_true__" -> true
    /// - "__helium_rn_bool_false__" -> false
    /// - All other values remain unchanged
    private func convertMarkersToBooleans(_ input: [String: Any]?) -> [String: Any]? {
        guard let input = input else { return nil }

        var result: [String: Any] = [:]
        for (key, value) in input {
            result[key] = convertValueMarkersToBooleans(value)
        }
        return result
    }
    /// Helper to recursively convert marker strings in any value type
    private func convertValueMarkersToBooleans(_ value: Any) -> Any {
        if let stringValue = value as? String {
            switch stringValue {
            case "__helium_rn_bool_true__":
                return true
            case "__helium_rn_bool_false__":
                return false
            default:
                return stringValue
            }
        } else if let dictValue = value as? [String: Any] {
            return convertMarkersToBooleans(dictValue) ?? [:]
        } else if let arrayValue = value as? [Any] {
            return arrayValue.map { convertValueMarkersToBooleans($0) }
        }
        return value
    }
}

fileprivate class InternalDelegate: HeliumPaywallDelegate {
    private let eventHandler: (HeliumEvent) -> Void
    private let purchaseHandler: (String) async -> HeliumPaywallTransactionStatus
    private let restoreHandler: () async -> Bool

    init(
        eventHandler: @escaping (HeliumEvent) -> Void,
        purchaseHandler: @escaping (String) async -> HeliumPaywallTransactionStatus,
        restoreHandler: @escaping () async -> Bool
    ) {
        self.eventHandler = eventHandler
        self.purchaseHandler = purchaseHandler
        self.restoreHandler = restoreHandler
    }

    public func makePurchase(productId: String) async -> HeliumPaywallTransactionStatus {
        return await purchaseHandler(productId)
    }

    public func restorePurchases() async -> Bool {
        return await restoreHandler()
    }

    func onPaywallEvent(_ event: any HeliumEvent) {
        eventHandler(event)
    }
}

fileprivate class DefaultPurchaseDelegate: StoreKitDelegate {
    private let eventHandler: (HeliumEvent) -> Void
    init(
        eventHandler: @escaping (HeliumEvent) -> Void,
    ) {
        self.eventHandler = eventHandler
    }

    override func onPaywallEvent(_ event: any HeliumEvent) {
        eventHandler(event)
    }
}

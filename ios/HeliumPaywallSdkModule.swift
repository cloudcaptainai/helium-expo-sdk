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

// Singleton to manage purchase state that survives module deallocation
private class NativeModuleManager {
    static let shared = NativeModuleManager()

    private let maxQueuedEvents = 30
    private let eventExpirationSeconds: TimeInterval = 10.0

    // Always keep reference to the current module
    var currentModule: HeliumPaywallSdkModule?

    // Store active operations
    var activePurchaseContinuation: CheckedContinuation<HeliumPaywallTransactionStatus, Never>?
    var activeRestoreContinuation: CheckedContinuation<Bool, Never>?

    // Log listener token - stored here so it survives module recreation
    var logListenerToken: HeliumLogListenerToken?

    // Event queue for when no module is available or sendEvent fails
    private struct PendingEvent {
        let eventName: String
        let eventData: [String: Any]
        let timestamp: Date
    }
    private var pendingEvents: [PendingEvent] = []
    private let eventLock = NSLock()

    private init() {}

    func clearPurchase() {
        activePurchaseContinuation = nil
    }

    func clearRestore() {
        activeRestoreContinuation = nil
    }

    // Queue an event for later delivery when module becomes available
    private func queueEvent(eventName: String, eventData: [String: Any]) {
        eventLock.lock()
        defer { eventLock.unlock() }

        if pendingEvents.count >= maxQueuedEvents {
            pendingEvents.removeFirst()
            print("[HeliumPaywallSdk] Event queue full, dropping oldest event")
        }
        pendingEvents.append(PendingEvent(eventName: eventName, eventData: eventData, timestamp: Date()))
        print("[HeliumPaywallSdk] Queued event: \(eventName) (queue size: \(pendingEvents.count))")
    }

    // Flush queued events to a module
    func flushEvents(module: HeliumPaywallSdkModule) {
        eventLock.lock()
        guard !pendingEvents.isEmpty else {
            eventLock.unlock()
            return
        }
        let eventsToSend = pendingEvents
        pendingEvents.removeAll()
        eventLock.unlock()

        print("[HeliumPaywallSdk] Flushing \(eventsToSend.count) queued events")

        let now = Date()
        for event in eventsToSend {
            let age = now.timeIntervalSince(event.timestamp)
            if age > eventExpirationSeconds {
                print("[HeliumPaywallSdk] Dropping stale event: \(event.eventName) (age: \(age)s)")
                continue
            }

            let success = ObjCExceptionCatcher.execute {
                module.sendEvent(event.eventName, event.eventData)
            }
            if !success {
                print("[HeliumPaywallSdk] Failed to flush event \(event.eventName)")
            }
        }
    }

    // Safe event sending with exception catching and backup queue
    func safeSendEvent(eventName: String, eventData: [String: Any]) {
        guard let module = currentModule else {
            queueEvent(eventName: eventName, eventData: eventData)
            return
        }

        let success = ObjCExceptionCatcher.execute {
            module.sendEvent(eventName, eventData)
        }

        if !success {
            print("[HeliumPaywallSdk] Failed to send event \(eventName), queueing for retry")
            queueEvent(eventName: eventName, eventData: eventData)
        }
    }
}

public class HeliumPaywallSdkModule: Module {
  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('HeliumPaywallSdk')` in JavaScript.
    Name("HeliumPaywallSdk")

    OnCreate {
        NativeModuleManager.shared.currentModule = self
    }

    // Sets constant properties on the module. Can take a dictionary or a closure that returns a dictionary.
//     Constants([
//       "PI": Double.pi
//     ])

    // Defines event names that the module can send to JavaScript.
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers", "onHeliumLogEvent")

    // todo use Record here? https://docs.expo.dev/modules/module-api/#records
    Function("initialize") { (config: [String : Any]) in
      NativeModuleManager.shared.currentModule = self // extra redundancy to update to latest live module
      NativeModuleManager.shared.flushEvents(module: self) // flush any queued events now that JS listeners are ready

      let userTraitsMap = convertMarkersToBooleans(config["customUserTraits"] as? [String : Any])
      let fallbackBundleURLString = config["fallbackBundleUrlString"] as? String
      let fallbackBundleString = config["fallbackBundleString"] as? String

      let paywallLoadingConfig = convertMarkersToBooleans(config["paywallLoadingConfig"] as? [String: Any])
      let useLoadingState = paywallLoadingConfig?["useLoadingState"] as? Bool ?? true
      let loadingBudget = paywallLoadingConfig?["loadingBudget"] as? TimeInterval
      if !useLoadingState {
        // Setting <= 0 will disable loading state
        Helium.config.defaultLoadingBudget = -1
      } else {
        Helium.config.defaultLoadingBudget = loadingBudget ?? 7.0
      }

      let useDefaultDelegate = config["useDefaultDelegate"] as? Bool ?? false
      let delegateType = config["delegateType"] as? String

      let delegateEventHandler: (HeliumEvent) -> Void = { event in
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
          NativeModuleManager.shared.safeSendEvent(eventName: "onHeliumPaywallEvent", eventData: eventDict)
      }

      // Create delegate with closures that send events to JavaScript
      let internalDelegate = InternalDelegate(
        delegateType: delegateType,
        eventHandler: delegateEventHandler,
        purchaseHandler: { productId in
          // First check singleton for orphaned continuation and clean it up
          if let existingContinuation = NativeModuleManager.shared.activePurchaseContinuation {
            existingContinuation.resume(returning: .cancelled)
            NativeModuleManager.shared.clearPurchase()
          }

          return await withCheckedContinuation { continuation in
            NativeModuleManager.shared.activePurchaseContinuation = continuation

            // Send event to JavaScript
            NativeModuleManager.shared.safeSendEvent(eventName: "onDelegateActionEvent", eventData: [
              "type": "purchase",
              "productId": productId
            ])
          }
        },
        restoreHandler: {
          // Check for orphaned continuation in singleton
          if let existingContinuation = NativeModuleManager.shared.activeRestoreContinuation {
            existingContinuation.resume(returning: false)
            NativeModuleManager.shared.clearRestore()
          }

          return await withCheckedContinuation { continuation in
            NativeModuleManager.shared.activeRestoreContinuation = continuation

            // Send event to JavaScript
            NativeModuleManager.shared.safeSendEvent(eventName: "onDelegateActionEvent", eventData: [
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
          .appendingPathComponent("helium-expo-fallbacks.json")

        if let data = jsonString.data(using: .utf8) {
          try? data.write(to: tempURL)
          fallbackBundleURL = tempURL
        }
      }

      let wrapperSdkVersion = config["wrapperSdkVersion"] as? String ?? "unknown"
      HeliumSdkConfig.shared.setWrapperSdkInfo(sdk: "expo", version: wrapperSdkVersion)

      if let customUserId = config["customUserId"] as? String {
        Helium.identify.userId = customUserId
      }
      if let userTraitsMap {
        Helium.identify.setUserTraits(HeliumUserTraits(userTraitsMap))
      }
      if let rcAppUserId = config["revenueCatAppUserId"] as? String {
        Helium.identify.revenueCatAppUserId = rcAppUserId
      }

      Helium.config.purchaseDelegate = useDefaultDelegate ? defaultDelegate : internalDelegate
      if let fallbackBundleURL {
        Helium.config.customFallbacksURL = fallbackBundleURL
      }
      if let customAPIEndpoint = config["customAPIEndpoint"] as? String {
        Helium.config.customAPIEndpoint = customAPIEndpoint
      }

      // Set up log listener if not already registered
      if NativeModuleManager.shared.logListenerToken == nil {
        NativeModuleManager.shared.logListenerToken = HeliumLogger.addLogListener { event in
          // Drop log events if no module is available - don't queue them.
          // Logs could be high-volume and could evict critical events (purchase/restore).
          guard NativeModuleManager.shared.currentModule != nil else { return }

          let eventData: [String: Any] = [
            "level": event.level.rawValue,
            "category": event.category.rawValue,
            "message": event.message,
            "metadata": event.metadata
          ]
          NativeModuleManager.shared.safeSendEvent(eventName: "onHeliumLogEvent", eventData: eventData)
        }
      }

      Helium.shared.initialize(apiKey: config["apiKey"] as? String ?? "")
    }

    // Function for JavaScript to provide purchase result
    Function("handlePurchaseResult") { (statusString: String, errorMsg: String?) in
      guard let continuation = NativeModuleManager.shared.activePurchaseContinuation else {
        print("WARNING: handlePurchaseResult called with no active continuation")
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

      // Clear singleton state
      NativeModuleManager.shared.clearPurchase()

      // Resume the continuation with the status
      continuation.resume(returning: status)
    }

    // Function for JavaScript to provide restore result
    Function("handleRestoreResult") { (success: Bool) in
      guard let continuation = NativeModuleManager.shared.activeRestoreContinuation else {
        print("WARNING: handleRestoreResult called with no active continuation")
        return
      }

      // Clear singleton state
      NativeModuleManager.shared.clearRestore()

      continuation.resume(returning: success)
    }

    Function("presentUpsell") { (trigger: String, customPaywallTraits: [String: Any]?, dontShowIfAlreadyEntitled: Bool?) in
        NativeModuleManager.shared.currentModule = self // extra redundancy to update to latest live module
        Helium.shared.presentPaywall(
            trigger: trigger,
            config: PaywallPresentationConfig(
                customPaywallTraits: convertMarkersToBooleans(customPaywallTraits),
                dontShowIfAlreadyEntitled: dontShowIfAlreadyEntitled ?? false
            ),
            eventHandlers: PaywallEventHandlers.withHandlers(
                onAnyEvent: { event in
                    NativeModuleManager.shared.safeSendEvent(eventName: "paywallEventHandlers", eventData: event.toDictionary())
                }
            )
        ) { paywallNotShownReason in
            // nothing for now
        }
    }

    Function("hideUpsell") {
      let _ = Helium.shared.hidePaywall()
    }

    Function("hideAllUpsells") {
      Helium.shared.hideAllPaywalls()
    }

    Function("getDownloadStatus") {
      return Helium.shared.getDownloadStatus().rawValue
    }

    Function("fallbackOpenOrCloseEvent") { (trigger: String?, isOpen: Bool, viewType: String?) in
    // Taking this out for now, there is no instance of it firing and method is no longer exposed
    // by native SDK
//       HeliumPaywallDelegateWrapper.shared.onFallbackOpenCloseEvent(trigger: trigger, isOpen: isOpen, viewType: viewType, fallbackReason: .bridgingError)
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
        Helium.identify.revenueCatAppUserId = rcAppUserId
    }

    Function("setCustomUserId") { (newUserId: String) in
        Helium.identify.userId = newUserId
    }

    AsyncFunction("hasEntitlementForPaywall") { (trigger: String) in
      let hasEntitlement = await Helium.entitlements.hasEntitlementForPaywall(trigger: trigger)
      return HasEntitlementResult(hasEntitlement: hasEntitlement)
    }

    AsyncFunction("hasAnyActiveSubscription") {
      return await Helium.entitlements.hasAnyActiveSubscription()
    }

    AsyncFunction("hasAnyEntitlement") {
      return await Helium.entitlements.hasAny()
    }

    Function("handleDeepLink") { (urlString: String) in
      guard let url = URL(string: urlString) else {
        return false
      }

      return Helium.shared.handleDeepLink(url)
    }

    Function("getExperimentInfoForTrigger") { (trigger: String) -> [String: Any] in
      guard let experimentInfo = Helium.experiments.infoForTrigger(trigger) else {
        return ["getExperimentInfoErrorMsg": "No experiment info found for trigger: \(trigger)"]
      }

      // Convert ExperimentInfo to dictionary using JSONEncoder
      let encoder = JSONEncoder()
      guard let jsonData = try? encoder.encode(experimentInfo),
          let dictionary = try? JSONSerialization.jsonObject(with: jsonData, options: []) as? [String: Any] else {
        return ["getExperimentInfoErrorMsg": "Failed to serialize experiment info"]
      }

      // Return the dictionary directly - it contains all ExperimentInfo fields
      return dictionary
    }

    Function("disableRestoreFailedDialog") {
        Helium.config.restorePurchasesDialog.disableRestoreFailedDialog()
    }

    Function("setCustomRestoreFailedStrings") { (customTitle: String?, customMessage: String?, customCloseButtonText: String?) in
      Helium.config.restorePurchasesDialog.setCustomRestoreFailedStrings(
        customTitle: customTitle,
        customMessage: customMessage,
        customCloseButtonText: customCloseButtonText
      )
    }

    Function("resetHelium") {
      // Clean up log listener
      NativeModuleManager.shared.logListenerToken?.remove()
      NativeModuleManager.shared.logListenerToken = nil
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
      Helium.config.lightDarkModeOverride = heliumMode
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
    private let _delegateType: String?
    public var delegateType: String { _delegateType ?? "custom" }

    private let eventHandler: (HeliumEvent) -> Void
    private let purchaseHandler: (String) async -> HeliumPaywallTransactionStatus
    private let restoreHandler: () async -> Bool

    init(
        delegateType: String?,
        eventHandler: @escaping (HeliumEvent) -> Void,
        purchaseHandler: @escaping (String) async -> HeliumPaywallTransactionStatus,
        restoreHandler: @escaping () async -> Bool
    ) {
        self._delegateType = delegateType
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

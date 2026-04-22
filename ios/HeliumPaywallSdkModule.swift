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
            return "Purchase not successful due to unknown status - \(status)."
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

    // Guards the active purchase/restore continuations against cross-thread races between
    // the Expo module thread (handlePurchaseResult) and the Swift-concurrency executor
    // (makePurchase). Without it, both sides can double-resume and CheckedContinuation traps.
    private let continuationLock = NSLock()
    private var _activePurchaseContinuation: CheckedContinuation<HeliumPaywallTransactionStatus, Never>?
    private var _activeRestoreContinuation: CheckedContinuation<Bool, Never>?

    // Transaction result tracking for HeliumDelegateReturnsTransaction
    private var _latestTransactionResult: HeliumTransactionIdResult?
    private let transactionResultLock = NSLock()
    var latestTransactionResult: HeliumTransactionIdResult? {
        get {
            transactionResultLock.lock()
            defer { transactionResultLock.unlock() }
            return _latestTransactionResult
        }
        set {
            transactionResultLock.lock()
            defer { transactionResultLock.unlock() }
            _latestTransactionResult = newValue
        }
    }

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

    func setPurchaseContinuation(_ continuation: CheckedContinuation<HeliumPaywallTransactionStatus, Never>) {
        continuationLock.lock()
        let orphan = _activePurchaseContinuation
        _activePurchaseContinuation = continuation
        continuationLock.unlock()
        orphan?.resume(returning: .cancelled)
    }

    func takePurchaseContinuation() -> CheckedContinuation<HeliumPaywallTransactionStatus, Never>? {
        continuationLock.lock()
        defer { continuationLock.unlock() }
        let continuation = _activePurchaseContinuation
        _activePurchaseContinuation = nil
        return continuation
    }

    func setRestoreContinuation(_ continuation: CheckedContinuation<Bool, Never>) {
        continuationLock.lock()
        let orphan = _activeRestoreContinuation
        _activeRestoreContinuation = continuation
        continuationLock.unlock()
        orphan?.resume(returning: false)
    }

    func takeRestoreContinuation() -> CheckedContinuation<Bool, Never>? {
        continuationLock.lock()
        defer { continuationLock.unlock() }
        let continuation = _activeRestoreContinuation
        _activeRestoreContinuation = nil
        return continuation
    }

    func clearPendingEvents() {
        eventLock.lock()
        pendingEvents.removeAll()
        eventLock.unlock()
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
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers", "onHeliumLogEvent", "onEntitledEvent")

    // todo use Record here? https://docs.expo.dev/modules/module-api/#records
    Function("initialize") { (config: [String : Any]) in
      guard let apiKey = config["apiKey"] as? String, !apiKey.isEmpty else {
        print("[Helium] initialize called with missing/empty apiKey; aborting.")
        return
      }
      performCoreSetup(config)
      Helium.shared.initialize(apiKey: apiKey)
    }

    Function("setupCore") { (config: [String : Any]) in
      performCoreSetup(config)
    }

    // Function for JavaScript to provide purchase result
    Function("handlePurchaseResult") { (statusString: String, errorMsg: String?, transactionId: String?, originalTransactionId: String?, productId: String?) in
      guard let continuation = NativeModuleManager.shared.takePurchaseContinuation() else {
        print("WARNING: handlePurchaseResult called with no active continuation")
        return
      }

      // Parse status string
      let lowercasedStatus = statusString.lowercased()
      let status: HeliumPaywallTransactionStatus

      switch lowercasedStatus {
      case "purchased":
        status = .purchased
        // Store transaction result for HeliumDelegateReturnsTransaction
        if let productId = productId, let transactionId = transactionId {
          NativeModuleManager.shared.latestTransactionResult = HeliumTransactionIdResult(
            productId: productId,
            transactionId: transactionId,
            originalTransactionId: originalTransactionId
          )
        }
      case "cancelled": status = .cancelled
      case "restored":  status = .restored
      case "pending":   status = .pending
      case "failed":    status = .failed(PurchaseError.purchaseFailed(errorMsg: errorMsg ?? "Unexpected error."))
      default:          status = .failed(PurchaseError.unknownStatus(status: lowercasedStatus))
      }

      // Resume the continuation with the status
      continuation.resume(returning: status)
    }

    // Function for JavaScript to provide restore result
    Function("handleRestoreResult") { (success: Bool) in
      guard let continuation = NativeModuleManager.shared.takeRestoreContinuation() else {
        print("WARNING: handleRestoreResult called with no active continuation")
        return
      }

      continuation.resume(returning: success)
    }

    Function("presentUpsell") { (trigger: String, customPaywallTraits: [String: Any]?, dontShowIfAlreadyEntitled: Bool?, _disableSystemBackNavigation: Bool?) in
        NativeModuleManager.shared.currentModule = self // extra redundancy to update to latest live module
        NativeModuleManager.shared.flushEvents(module: self)
        var paywallTraits: HeliumUserTraits? = nil
        if let paywallTraitsMap = convertMarkersToBooleans(customPaywallTraits) {
            paywallTraits = HeliumUserTraits(paywallTraitsMap)
        }
        Helium.shared.presentPaywall(
            trigger: trigger,
            config: PaywallPresentationConfig(
                customPaywallTraits: paywallTraits,
                dontShowIfAlreadyEntitled: dontShowIfAlreadyEntitled ?? false
            ),
            eventHandlers: PaywallEventHandlers.withHandlers(
                onAnyEvent: { event in
                    var eventDict = event.toDictionary()
                    applyEventFieldAliases(&eventDict)
                    NativeModuleManager.shared.safeSendEvent(eventName: "paywallEventHandlers", eventData: eventDict)
                }
            ),
            onEntitled: {
                NativeModuleManager.shared.safeSendEvent(eventName: "onEntitledEvent", eventData: [:])
            }
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

    Function("setThirdPartyAnalyticsAnonymousId") { (anonymousId: String?) in
        Helium.identify.thirdPartyAnalyticsAnonymousId = anonymousId
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

    AsyncFunction("resetHelium") { (clearUserTraits: Bool, clearHeliumEventListeners: Bool, clearExperimentAllocations: Bool) in
      // Clean up log listener so performCoreSetup can re-register on next initialize()
      NativeModuleManager.shared.logListenerToken?.remove()
      NativeModuleManager.shared.logListenerToken = nil
      NativeModuleManager.shared.clearPendingEvents()
      await withUnsafeContinuation { (continuation: UnsafeContinuation<Void, Never>) in
        Helium.resetHelium(
          clearUserTraits: clearUserTraits,
          clearHeliumEventListeners: clearHeliumEventListeners,
          clearExperimentAllocations: clearExperimentAllocations,
          onComplete: {
            continuation.resume()
          }
        )
      }
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

    Function("enableExternalWebCheckout") { (successURL: String, cancelURL: String, paymentProcessors: [String]?) in
      let processors: WebCheckoutProcessors
      if let paymentProcessors {
        var set: WebCheckoutProcessors = []
        for p in paymentProcessors {
          switch p.lowercased() {
          case "paddle": set.insert(.paddle)
          case "stripe": set.insert(.stripe)
          default:
            print("[Helium] enableExternalWebCheckout: unknown payment processor '\(p)', ignoring")
          }
        }
        processors = set
      } else {
        processors = .all
      }
      Helium.config.enableExternalWebCheckout(
        successURL: successURL,
        cancelURL: cancelURL,
        paymentProcessors: processors
      )
    }

    Function("disableExternalWebCheckout") {
      Helium.config.disableExternalWebCheckout()
    }

    Function("setAllowWebCheckoutWithoutUserId") { (allow: Bool) in
      Helium.config.allowWebCheckoutWithoutUserId = allow
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

    private func performCoreSetup(_ config: [String: Any]) {
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
          applyEventFieldAliases(&eventDict)
          NativeModuleManager.shared.safeSendEvent(eventName: "onHeliumPaywallEvent", eventData: eventDict)
      }

      // Delegate that handles expo RevenueCat delegate or custom purchase implementations
      let internalDelegate = InternalDelegate(
        delegateType: delegateType,
        eventHandler: delegateEventHandler
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
      if config["androidConsumableProductIds"] != nil {
        print("[Helium] androidConsumableProductIds is only used on Android and will be ignored on iOS.")
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

private class InternalDelegate: HeliumPaywallDelegate, HeliumDelegateReturnsTransaction {
    private let _delegateType: String?
    public var delegateType: String { _delegateType ?? "custom" }

    private let eventHandler: (HeliumEvent) -> Void

    init(
        delegateType: String?,
        eventHandler: @escaping (HeliumEvent) -> Void
    ) {
        self._delegateType = delegateType
        self.eventHandler = eventHandler
    }

    // MARK: - HeliumPaywallDelegate

    public func makePurchase(productId: String) async -> HeliumPaywallTransactionStatus {
        // Clear previous transaction result
        NativeModuleManager.shared.latestTransactionResult = nil

        return await withCheckedContinuation { continuation in
            NativeModuleManager.shared.setPurchaseContinuation(continuation)

            NativeModuleManager.shared.safeSendEvent(eventName: "onDelegateActionEvent", eventData: [
                "type": "purchase",
                "productId": productId
            ])
        }
    }

    public func restorePurchases() async -> Bool {
        return await withCheckedContinuation { continuation in
            NativeModuleManager.shared.setRestoreContinuation(continuation)

            NativeModuleManager.shared.safeSendEvent(eventName: "onDelegateActionEvent", eventData: [
                "type": "restore"
            ])
        }
    }

    func onPaywallEvent(_ event: any HeliumEvent) {
        eventHandler(event)
    }

    // MARK: - HeliumDelegateReturnsTransaction

    func getLatestCompletedTransactionIdResult() -> HeliumTransactionIdResult? {
        return NativeModuleManager.shared.latestTransactionResult
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

/// Modifies native event dictionary fields to match expected TypeScript types.
/// Free function to avoid capturing `self` in long-lived closures.
private func applyEventFieldAliases(_ eventDict: inout [String: Any]) {
    if eventDict["customPaywallActionName"] == nil, let actionName = eventDict["actionName"] {
        eventDict["customPaywallActionName"] = actionName
    }
    if eventDict["customPaywallActionParams"] == nil, let params = eventDict["params"] {
        eventDict["customPaywallActionParams"] = params
    }
}

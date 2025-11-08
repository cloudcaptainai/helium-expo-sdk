package expo.modules.paywallsdk

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.URL

// Record data classes for type-safe return values
class PaywallInfoResult : Record {
  @Field
  var errorMsg: String? = null

  @Field
  var templateName: String? = null

  @Field
  var shouldShow: Boolean? = null
}

class HasEntitlementResult : Record {
  @Field
  var hasEntitlement: Boolean? = null
}

class HeliumPaywallSdkModule : Module() {
  // Single continuations for ongoing operations
  // TODO: Implement continuation handling similar to iOS for purchase/restore flows
  private var currentProductId: String? = null

  override fun definition() = ModuleDefinition {
    Name("HeliumPaywallSdk")

    // Defines event names that the module can send to JavaScript
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers")

    // Initialize the Helium SDK with configuration
    Function("initialize") { config: Map<String, Any?> ->
      // TODO: Extract configuration parameters:
      // - apiKey: String
      // - customUserTraits: Map<String, Any?>?
      // - fallbackBundleUrlString: String?
      // - fallbackBundleString: String?
      // - paywallLoadingConfig: Map<String, Any?>?
      // - useDefaultDelegate: Boolean
      // - customUserId: String?
      // - customAPIEndpoint: String?
      // - revenueCatAppUserId: String?
      // TODO: Initialize Helium SDK with delegate handlers
      // TODO: Set up event handlers for onHeliumPaywallEvent
      // TODO: Set up purchase/restore handlers that send onDelegateActionEvent
    }

    // Function for JavaScript to provide purchase result
    Function("handlePurchaseResult") { statusString: String, errorMsg: String? ->
      // TODO: Parse statusString (purchased, cancelled, restored, pending, failed)
      // TODO: Resume purchase continuation with appropriate status
      // TODO: Clear purchase state (currentProductId, continuation)
    }

    // Function for JavaScript to provide restore result
    Function("handleRestoreResult") { success: Boolean ->
      // TODO: Resume restore continuation with success boolean
      // TODO: Clear restore continuation
    }

    // Present a paywall with the given trigger
    Function("presentUpsell") { trigger: String, customPaywallTraits: Map<String, Any?>?, dontShowIfAlreadyEntitled: Boolean? ->
      // TODO: Call Helium SDK presentUpsell with:
      // - trigger: String
      // - customPaywallTraits: converted from map
      // - dontShowIfAlreadyEntitled: Boolean (default false)
      // TODO: Set up event handlers that send to paywallEventHandlers:
      // - onOpen, onClose, onDismissed, onPurchaseSucceeded, onOpenFailed, onCustomPaywallAction
    }

    // Hide the current upsell
    Function("hideUpsell") {
      // TODO: Call Helium SDK hideUpsell()
    }

    // Hide all upsells
    Function("hideAllUpsells") {
      // TODO: Call Helium SDK hideAllUpsells()
    }

    // Get download status of paywall assets
    Function("getDownloadStatus") {
      // TODO: Call Helium SDK getDownloadStatus()
      // TODO: Return status as string (e.g., "ready", "downloading", "notStarted")
      return@Function "notStarted"
    }

    // Handle fallback open/close events
    Function("fallbackOpenOrCloseEvent") { trigger: String?, isOpen: Boolean, viewType: String? ->
      // TODO: Call Helium SDK fallback event handler
      // TODO: Pass trigger, isOpen, viewType, and fallbackReason
    }

    // Get paywall info for a specific trigger
    Function("getPaywallInfo") { trigger: String ->
      // TODO: Call Helium SDK getPaywallInfo(trigger)
      // TODO: If paywallInfo is null, return error result
      // TODO: Otherwise, return PaywallInfoResult with templateName and shouldShow
      return@Function PaywallInfoResult().apply {
        errorMsg = "Not implemented"
        templateName = null
        shouldShow = null
      }
    }

    // Set RevenueCat app user ID
    Function("setRevenueCatAppUserId") { rcAppUserId: String ->
      // TODO: Call Helium SDK setRevenueCatAppUserId(rcAppUserId)
    }

    // Set custom user ID
    Function("setCustomUserId") { newUserId: String ->
      // TODO: Call Helium SDK overrideUserId(newUserId)
    }

    // Check if user has entitlement for a specific paywall
    AsyncFunction("hasEntitlementForPaywall") { trigger: String ->
      // TODO: Call Helium SDK hasEntitlementForPaywall(trigger)
      // TODO: Return HasEntitlementResult with boolean value
      return@AsyncFunction HasEntitlementResult().apply {
        hasEntitlement = false
      }
    }

    // Check if user has any active subscription
    AsyncFunction("hasAnyActiveSubscription") {
      // TODO: Call Helium SDK hasAnyActiveSubscription()
      // TODO: Return boolean
      return@AsyncFunction false
    }

    // Check if user has any entitlement
    AsyncFunction("hasAnyEntitlement") {
      // TODO: Call Helium SDK hasAnyEntitlement()
      // TODO: Return boolean
      return@AsyncFunction false
    }

    // Handle deep link
    Function("handleDeepLink") { urlString: String ->
      // TODO: Parse urlString to URL
      // TODO: Call Helium SDK handleDeepLink(url)
      // TODO: Return boolean indicating if deep link was handled
      return@Function false
    }

    // Get experiment info for a trigger
    Function("getExperimentInfoForTrigger") { trigger: String ->
      // TODO: Call Helium SDK getExperimentInfoForTrigger(trigger)
      // TODO: If experimentInfo is null, return error map
      // TODO: Convert experimentInfo to Map<String, Any?> using Gson
      // TODO: Return the map
      return@Function mapOf<String, Any?>(
        "getExperimentInfoErrorMsg" to "Not implemented"
      )
    }

    // Disable restore failed dialog
    Function("disableRestoreFailedDialog") {
      // TODO: Call Helium SDK restore config to disable restore failed dialog
    }

    // Set custom restore failed strings
    Function("setCustomRestoreFailedStrings") { customTitle: String?, customMessage: String?, customCloseButtonText: String? ->
      // TODO: Call Helium SDK restore config to set custom strings
      // TODO: Pass customTitle, customMessage, customCloseButtonText
    }

    // Reset Helium SDK
    Function("resetHelium") {
      // TODO: Call Helium SDK resetHelium()
    }

    // Set light/dark mode override
    Function("setLightDarkModeOverride") { mode: String ->
      // TODO: Parse mode string (light, dark, system)
      // TODO: Call Helium SDK setLightDarkModeOverride with appropriate enum value
    }

    // Enables the module to be used as a native view
    View(HeliumPaywallSdkView::class) {
      // Defines a setter for the `url` prop
      Prop("url") { view: HeliumPaywallSdkView, url: URL ->
        view.webView.loadUrl(url.toString())
      }
      // Defines an event that the view can send to JavaScript
      Events("onLoad")
    }
  }

  // TODO: Helper function to convert marker strings back to booleans
  // Similar to iOS convertMarkersToBooleans function
  // Converts "__helium_rn_bool_true__" -> true
  // Converts "__helium_rn_bool_false__" -> false
  private fun convertMarkersToBooleans(input: Map<String, Any?>?): Map<String, Any?>? {
    // TODO: Implement recursive conversion
    return input
  }

  private fun convertValueMarkersToBooleans(value: Any?): Any? {
    // TODO: Implement value conversion for strings, maps, and arrays
    return value
  }
}

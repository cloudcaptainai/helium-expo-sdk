package expo.modules.paywallsdk

import android.app.Activity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.tryhelium.paywall.core.Helium
import com.tryhelium.paywall.core.HeliumEnvironment
import com.tryhelium.paywall.core.HeliumFallbackConfig
import com.tryhelium.paywall.core.HeliumIdentityManager
import com.tryhelium.paywall.core.HeliumUserTraits
import com.tryhelium.paywall.core.HeliumUserTraitsArgument
import com.tryhelium.paywall.core.HeliumPaywallTransactionStatus
import com.tryhelium.paywall.delegate.HeliumPaywallDelegate
import com.tryhelium.paywall.delegate.PlayStorePaywallDelegate
import com.android.billingclient.api.ProductDetails
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.net.URL
import kotlin.coroutines.resume

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
  // References to Activity and Context
  private var activity: Activity? = null
  private val gson = Gson()

  // Single continuations for ongoing operations
  internal var currentProductId: String? = null
  internal var purchaseContinuation: ((HeliumPaywallTransactionStatus) -> Unit)? = null
  internal var restoreContinuation: ((Boolean) -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("HeliumPaywallSdk")

    // Defines event names that the module can send to JavaScript
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers")

    // Lifecycle events to capture Activity reference
    OnActivityEntersForeground {
      activity = appContext.currentActivity
    }

    OnActivityEntersBackground {
      // Keep activity reference for now
    }

    OnActivityDestroys {
      activity = null
    }

    // Initialize the Helium SDK with configuration
    Function("initialize") { config: Map<String, Any?> ->
      val apiKey = config["apiKey"] as? String ?: ""
      val customUserId = config["customUserId"] as? String
      val customAPIEndpoint = config["customAPIEndpoint"] as? String
      val useDefaultDelegate = config["useDefaultDelegate"] as? Boolean ?: false

      @Suppress("UNCHECKED_CAST")
      val customUserTraitsMap = config["customUserTraits"] as? Map<String, Any?>
      val customUserTraits = convertToHeliumUserTraits(customUserTraitsMap)

      @Suppress("UNCHECKED_CAST")
      val paywallLoadingConfigMap = config["paywallLoadingConfig"] as? Map<String, Any?>
      val fallbackConfig = convertToHeliumFallbackConfig(paywallLoadingConfigMap)

      // Use SANDBOX environment by default
      val environment = HeliumEnvironment.SANDBOX

      // Initialize on a coroutine scope
      CoroutineScope(Dispatchers.Main).launch {
        try {
          val context = appContext.reactContext
            ?: throw Exception("Context not available")

          // Create delegate
          val delegate = if (useDefaultDelegate) {
            val currentActivity = activity
              ?: throw Exception("Activity not available for PlayStorePaywallDelegate")
            PlayStorePaywallDelegate(currentActivity)
          } else {
            CustomPaywallDelegate(this@HeliumPaywallSdkModule)
          }

          Helium.initialize(
            context = context,
            apiKey = apiKey,
            heliumPaywallDelegate = delegate,
            customUserId = customUserId,
            customApiEndpoint = customAPIEndpoint,
            customUserTraits = customUserTraits,
            fallbackConfig = fallbackConfig,
            environment = environment
          )
        } catch (e: Exception) {
          // Log error but don't throw - initialization errors will be handled by SDK
          android.util.Log.e("HeliumPaywallSdk", "Failed to initialize: ${e.message}", e)
        }
      }
    }

    // Function for JavaScript to provide purchase result
    Function("handlePurchaseResult") { statusString: String, errorMsg: String? ->
      val continuation = purchaseContinuation ?: return@Function

      // Parse status string
      val lowercasedStatus = statusString.lowercase()
      val status: HeliumPaywallTransactionStatus = when (lowercasedStatus) {
        "purchased" -> HeliumPaywallTransactionStatus.Purchased
        "cancelled" -> HeliumPaywallTransactionStatus.Cancelled
        "restored" -> HeliumPaywallTransactionStatus.Purchased  // Android SDK has no Restored, map to Purchased
        "pending" -> HeliumPaywallTransactionStatus.Pending
        "failed" -> HeliumPaywallTransactionStatus.Failed(
          Exception(errorMsg ?: "Unexpected error.")
        )
        else -> HeliumPaywallTransactionStatus.Failed(
          Exception("Unknown status: $lowercasedStatus")
        )
      }

      // Clear the references
      purchaseContinuation = null
      currentProductId = null

      // Resume the continuation with the status
      continuation(status)
    }

    // Function for JavaScript to provide restore result
    Function("handleRestoreResult") { success: Boolean ->
      val continuation = restoreContinuation ?: return@Function

      restoreContinuation = null
      continuation(success)
    }

    // Present a paywall with the given trigger
    Function("presentUpsell") { trigger: String, customPaywallTraits: Map<String, Any?>?, dontShowIfAlreadyEntitled: Boolean? ->
      // Convert custom paywall traits
      val convertedTraits = convertToHeliumUserTraits(customPaywallTraits)

      // Helper function to convert event to map
      val convertEventToMap: (Any) -> Map<String, Any?> = { event ->
        try {
          val json = gson.toJson(event)
          val type = object : TypeToken<Map<String, Any?>>() {}.type
          gson.fromJson(json, type) ?: emptyMap()
        } catch (e: Exception) {
          emptyMap()
        }
      }

      Helium.presentUpsell(
        trigger = trigger,
        // TODO add support for these
//        eventHandlers = PaywallEventHandlers.withHandlers(
//          onOpen = { event ->
//            sendEvent("paywallEventHandlers", convertEventToMap(event))
//          },
//          onClose = { event ->
//            sendEvent("paywallEventHandlers", convertEventToMap(event))
//          },
//          onDismissed = { event ->
//            sendEvent("paywallEventHandlers", convertEventToMap(event))
//          },
//          onPurchaseSucceeded = { event ->
//            sendEvent("paywallEventHandlers", convertEventToMap(event))
//          },
//          onOpenFailed = { event ->
//            sendEvent("paywallEventHandlers", convertEventToMap(event))
//          },
//          onCustomPaywallAction = { event ->
//            sendEvent("paywallEventHandlers", convertEventToMap(event))
//          }
//        ),
//        customPaywallTraits = convertedTraits,
//        dontShowIfAlreadyEntitled = dontShowIfAlreadyEntitled ?: false
      )
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
      val status = (Helium.shared.downloadStatus as? kotlinx.coroutines.flow.StateFlow<*>)?.value
      val statusString = when (status?.javaClass?.simpleName) {
        "NotYetDownloaded" -> "NotYetDownloaded"
        "Downloading" -> "Downloading"
        "DownloadFailure" -> "DownloadFailure"
        "DownloadSuccess" -> "DownloadSuccess"
        else -> "NotYetDownloaded"
      }
      return@Function statusString
    }

    // Handle fallback open/close events
    Function("fallbackOpenOrCloseEvent") { trigger: String?, isOpen: Boolean, viewType: String? ->
      // TODO: Call Helium SDK fallback event handler
      // TODO: Pass trigger, isOpen, viewType, and fallbackReason
    }

    // Get paywall info for a specific trigger
    Function("getPaywallInfo") { trigger: String ->
      val paywallInfo = Helium.shared.getPaywallInfo(trigger)

      return@Function if (paywallInfo == null) {
        PaywallInfoResult().apply {
          errorMsg = "Invalid trigger or paywalls not ready."
          templateName = null
          shouldShow = null
        }
      } else {
        PaywallInfoResult().apply {
          errorMsg = null
          templateName = paywallInfo.paywallTemplateName
          shouldShow = paywallInfo.shouldShow
        }
      }
    }

    // Set RevenueCat app user ID
    Function("setRevenueCatAppUserId") { rcAppUserId: String ->
      HeliumIdentityManager.shared.setRevenueCatAppUserId(rcAppUserId)
    }

    // Set custom user ID
    Function("setCustomUserId") { newUserId: String ->
      HeliumIdentityManager.shared.setCustomUserId(newUserId)
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
      val handled = Helium.shared.handleDeepLink(uri = urlString)
      return@Function handled
    }

    // Get experiment info for a trigger
    Function("getExperimentInfoForTrigger") { trigger: String ->
      val experimentInfo = Helium.shared.getExperimentInfoForTrigger(trigger)

      return@Function if (experimentInfo == null) {
        mapOf<String, Any?>(
          "getExperimentInfoErrorMsg" to "No experiment info found for trigger: $trigger"
        )
      } else {
        try {
          val json = gson.toJson(experimentInfo)
          val type = object : TypeToken<Map<String, Any?>>() {}.type
          val map: Map<String, Any?> = gson.fromJson(json, type)
          map
        } catch (e: Exception) {
          mapOf<String, Any?>(
            "getExperimentInfoErrorMsg" to "Failed to serialize experiment info"
          )
        }
      }
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
      Helium.resetHelium()
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

  /**
   * Recursively converts special marker strings back to boolean values to restore
   * type information that was preserved when passing through native bridge.
   *
   * Native bridge converts booleans to numbers, so we use special marker strings
   * to preserve the original intent. This helper converts:
   * - "__helium_rn_bool_true__" -> true
   * - "__helium_rn_bool_false__" -> false
   * - All other values remain unchanged
   */
  private fun convertMarkersToBooleans(input: Map<String, Any?>?): Map<String, Any?>? {
    if (input == null) return null
    return input.mapValues { (_, value) ->
      convertValueMarkersToBooleans(value)
    }
  }

  private fun convertValueMarkersToBooleans(value: Any?): Any? {
    return when (value) {
      "__helium_rn_bool_true__" -> true
      "__helium_rn_bool_false__" -> false
      is String -> value
      is Map<*, *> -> {
        @Suppress("UNCHECKED_CAST")
        convertMarkersToBooleans(value as? Map<String, Any?>)
      }
      is List<*> -> value.map { convertValueMarkersToBooleans(it) }
      else -> value
    }
  }

  private fun convertToHeliumUserTraits(input: Map<String, Any?>?): HeliumUserTraits? {
    if (input == null) return null
    val convertedInput = convertMarkersToBooleans(input) ?: return null
    val traits = convertedInput.mapValues { (_, value) ->
      convertToHeliumUserTraitsArgument(value)
    }.filterValues { it != null }.mapValues { it.value!! }
    return HeliumUserTraits(traits)
  }

  private fun convertToHeliumUserTraitsArgument(value: Any?): HeliumUserTraitsArgument? {
    return when (value) {
      is String -> HeliumUserTraitsArgument.StringParam(value)
      is Int -> HeliumUserTraitsArgument.IntParam(value)
      is Long -> HeliumUserTraitsArgument.LongParam(value)
      is Double -> HeliumUserTraitsArgument.DoubleParam(value.toString())
      is Boolean -> HeliumUserTraitsArgument.BooleanParam(value)
      is List<*> -> {
        val items = value.mapNotNull { convertToHeliumUserTraitsArgument(it) }
        HeliumUserTraitsArgument.Array(items)
      }
      is Map<*, *> -> {
        @Suppress("UNCHECKED_CAST")
        val properties = (value as? Map<String, Any?>)?.mapValues { (_, v) ->
          convertToHeliumUserTraitsArgument(v)
        }?.filterValues { it != null }?.mapValues { it.value!! } ?: emptyMap()
        HeliumUserTraitsArgument.Complex(properties)
      }
      else -> null
    }
  }

  private fun convertToHeliumFallbackConfig(input: Map<String, Any?>?): HeliumFallbackConfig? {
    if (input == null) return null

    val useLoadingState = input["useLoadingState"] as? Boolean ?: true
    val loadingBudget = (input["loadingBudget"] as? Number)?.toLong() ?: 2000L
    val fallbackBundleName = input["fallbackBundleName"] as? String

    // Parse perTriggerLoadingConfig if present
    var perTriggerLoadingConfig: Map<String, HeliumFallbackConfig>? = null
    val perTriggerDict = input["perTriggerLoadingConfig"] as? Map<*, *>
    if (perTriggerDict != null) {
      perTriggerLoadingConfig = perTriggerDict.mapNotNull { (key, value) ->
        if (key is String && value is Map<*, *>) {
          @Suppress("UNCHECKED_CAST")
          val config = value as? Map<String, Any?>
          val triggerUseLoadingState = config?.get("useLoadingState") as? Boolean
          val triggerLoadingBudget = (config?.get("loadingBudget") as? Number)?.toLong()
          key to HeliumFallbackConfig(
            useLoadingState = triggerUseLoadingState ?: true,
            loadingBudgetInMs = triggerLoadingBudget ?: 2000L
          )
        } else {
          null
        }
      }.toMap()
    }

    return HeliumFallbackConfig(
      useLoadingState = useLoadingState,
      loadingBudgetInMs = loadingBudget,
      perTriggerLoadingConfig = perTriggerLoadingConfig,
      fallbackBundleName = fallbackBundleName
    )
  }
}

/**
 * Custom Helium Paywall Delegate that bridges purchase calls to React Native.
 * Similar to the InternalDelegate in iOS implementation.
 */
class CustomPaywallDelegate(
  private val module: HeliumPaywallSdkModule
) : HeliumPaywallDelegate {

  override suspend fun makePurchase(
    productDetails: ProductDetails,
    basePlanId: String?,
    offerId: String?
  ): HeliumPaywallTransactionStatus {
    return suspendCancellableCoroutine { continuation ->
      // Build chained product identifier: productId:basePlanId:offerId
      val chainedProductId = buildString {
        append(productDetails.productId)
        if (basePlanId != null) {
          append(":").append(basePlanId)
        }
        if (offerId != null) {
          append(":").append(offerId)
        }
      }

      // Check if there's already a purchase in progress and cancel it
      module.purchaseContinuation?.let { existingContinuation ->
        existingContinuation(HeliumPaywallTransactionStatus.Cancelled)
      }

      // Store the continuation and product ID
      module.currentProductId = chainedProductId
      module.purchaseContinuation = { status ->
        continuation.resume(status)
      }

      // Send event to JavaScript
      module.sendEvent("onDelegateActionEvent", mapOf(
        "type" to "purchase",
        "productId" to chainedProductId
      ))
    }
  }

  override suspend fun restorePurchases(): Boolean {
    return suspendCancellableCoroutine { continuation ->
      // Check if there's already a restore in progress and cancel it
      module.restoreContinuation?.let { existingContinuation ->
        existingContinuation(false)
      }

      // Store the continuation
      module.restoreContinuation = { success ->
        continuation.resume(success)
      }

      // Send event to JavaScript
      module.sendEvent("onDelegateActionEvent", mapOf(
        "type" to "restore"
      ))
    }
  }
}

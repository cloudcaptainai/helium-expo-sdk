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
import com.tryhelium.paywall.core.event.HeliumEvent
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
import kotlin.reflect.full.memberProperties
import kotlin.reflect.jvm.isAccessible

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

/**
 * Extension function to convert any object (especially HeliumEvent data classes) to a Map.
 * Uses Kotlin reflection to extract all member properties from data classes.
 */
@Suppress("UNCHECKED_CAST")
private fun Any.toMap(): Map<String, Any?> {
  return try {
    val kClass = this::class
    kClass.memberProperties.associate { prop ->
      prop.isAccessible = true
      val value = (prop as kotlin.reflect.KProperty1<Any, *>).get(this)
      prop.name to when (value) {
        is Enum<*> -> value.name
        is List<*> -> value
        is Map<*, *> -> value
        else -> value
      }
    }
  } catch (e: Exception) {
    android.util.Log.e("HeliumPaywallSdk", "Failed to convert to map: ${e.message}", e)
    emptyMap()
  }
}

// Singleton to manage purchase state that survives module recreation in dev mode
private object NativeModuleManager {
  // Always keep reference to the current module
  var currentModule: HeliumPaywallSdkModule? = null

  // Store active operations
  var currentProductId: String? = null
  var purchaseContinuation: ((HeliumPaywallTransactionStatus) -> Unit)? = null
  var restoreContinuation: ((Boolean) -> Unit)? = null

  fun clearPurchase() {
    purchaseContinuation = null
    currentProductId = null
  }

  fun clearRestore() {
    restoreContinuation = null
  }
}

class HeliumPaywallSdkModule : Module() {
  private val gson = Gson()

  override fun definition() = ModuleDefinition {
    Name("HeliumPaywallSdk")

    OnCreate {
      NativeModuleManager.currentModule = this@HeliumPaywallSdkModule
    }

    // Defines event names that the module can send to JavaScript
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers")

    // Initialize the Helium SDK with configuration
    Function("initialize") { config: Map<String, Any?> ->
      NativeModuleManager.currentModule = this@HeliumPaywallSdkModule // extra redundancy to update to latest live module

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
      // todo allow specification
      val environment = HeliumEnvironment.SANDBOX

      // Event handler that converts events and adds backwards compatibility fields
      val delegateEventHandler: (Any) -> Unit = { event ->
        val eventMap = event.toMap().toMutableMap()
        // Add deprecated fields for backwards compatibility
        eventMap["paywallName"]?.let { eventMap["paywallTemplateName"] = it }
        eventMap["error"]?.let { eventMap["errorDescription"] = it }
        eventMap["productId"]?.let { eventMap["productKey"] = it }
        eventMap["buttonName"]?.let { eventMap["ctaName"] = it }
        NativeModuleManager.currentModule?.sendEvent("onHeliumPaywallEvent", eventMap)
      }

      // Initialize on a coroutine scope
      CoroutineScope(Dispatchers.Main).launch {
        try {
          val context = appContext.reactContext
            ?: throw Exception("Context not available")

          // Create delegate
          val delegate = if (useDefaultDelegate) {
            val currentActivity = appContext.currentActivity
              ?: throw Exception("Activity not available for PlayStorePaywallDelegate")
            DefaultPaywallDelegate(currentActivity, delegateEventHandler)
          } else {
            CustomPaywallDelegate(this@HeliumPaywallSdkModule, delegateEventHandler)
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
      val continuation = NativeModuleManager.purchaseContinuation ?: return@Function

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

      // Clear the singleton state
      NativeModuleManager.clearPurchase()

      // Resume the continuation with the status
      continuation(status)
    }

    // Function for JavaScript to provide restore result
    Function("handleRestoreResult") { success: Boolean ->
      val continuation = NativeModuleManager.restoreContinuation ?: return@Function

      // Clear the singleton state
      NativeModuleManager.clearRestore()
      continuation(success)
    }

    // Present a paywall with the given trigger
    Function("presentUpsell") { trigger: String, customPaywallTraits: Map<String, Any?>?, dontShowIfAlreadyEntitled: Boolean? ->
      NativeModuleManager.currentModule = this@HeliumPaywallSdkModule // extra redundancy to update to latest live module

      // Convert custom paywall traits
      val convertedTraits = convertToHeliumUserTraits(customPaywallTraits)

      Helium.presentUpsell(
        trigger = trigger,
        // TODO add support for these
//        eventHandlers = PaywallEventHandlers.withHandlers(
//          onOpen = { event ->
//            sendEvent("paywallEventHandlers", event.toMap())
//          },
//          onClose = { event ->
//            sendEvent("paywallEventHandlers", event.toMap())
//          },
//          onDismissed = { event ->
//            sendEvent("paywallEventHandlers", event.toMap())
//          },
//          onPurchaseSucceeded = { event ->
//            sendEvent("paywallEventHandlers", event.toMap())
//          },
//          onOpenFailed = { event ->
//            sendEvent("paywallEventHandlers", event.toMap())
//          },
//          onCustomPaywallAction = { event ->
//            sendEvent("paywallEventHandlers", event.toMap())
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
        "NotYetDownloaded" -> "notDownloadedYet"
        "Downloading" -> "inProgress"
        "DownloadFailure" -> "downloadFailure"
        "DownloadSuccess" -> "downloadSuccess"
        else -> "notDownloadedYet"
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
      @Suppress("UNCHECKED_CAST")
      perTriggerLoadingConfig = perTriggerDict.mapNotNull { (key, value) ->
        if (key is String && value is Map<*, *>) {
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
      }.toMap() as Map<String, HeliumFallbackConfig>
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
  private val module: HeliumPaywallSdkModule,
  private val eventHandler: (Any) -> Unit
) : HeliumPaywallDelegate {

  override fun onHeliumEvent(event: HeliumEvent) {
    eventHandler(event)
  }

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

      // First check singleton for orphaned continuation and clean it up
      NativeModuleManager.purchaseContinuation?.let { existingContinuation ->
        existingContinuation(HeliumPaywallTransactionStatus.Cancelled)
        NativeModuleManager.clearPurchase()
      }

      val currentModule = NativeModuleManager.currentModule ?: module

      NativeModuleManager.currentProductId = chainedProductId
      NativeModuleManager.purchaseContinuation = { status ->
        continuation.resume(status)
      }

      // Clean up on cancellation to prevent memory leaks and crashes
      continuation.invokeOnCancellation {
        NativeModuleManager.clearPurchase()
      }

      // Send event to JavaScript
      currentModule.sendEvent("onDelegateActionEvent", mapOf(
        "type" to "purchase",
        "productId" to chainedProductId
      ))
    }
  }

  override suspend fun restorePurchases(): Boolean {
    return suspendCancellableCoroutine { continuation ->
      // Check singleton for orphaned continuation and clean it up
      NativeModuleManager.restoreContinuation?.let { existingContinuation ->
        existingContinuation(false)
        NativeModuleManager.clearRestore()
      }

      val currentModule = NativeModuleManager.currentModule ?: module

      NativeModuleManager.restoreContinuation = { success ->
        continuation.resume(success)
      }

      // Clean up on cancellation to prevent memory leaks and crashes
      continuation.invokeOnCancellation {
        NativeModuleManager.clearRestore()
      }

      // Send event to JavaScript
      currentModule.sendEvent("onDelegateActionEvent", mapOf(
        "type" to "restore"
      ))
    }
  }
}

/**
 * Default Paywall Delegate that extends PlayStorePaywallDelegate with event dispatching.
 * Similar to the DefaultPurchaseDelegate in iOS implementation.
 */
class DefaultPaywallDelegate(
  activity: Activity,
  private val eventHandler: (Any) -> Unit
) : PlayStorePaywallDelegate(activity) {

  override fun onHeliumEvent(event: HeliumEvent) {
    eventHandler(event)
  }
}

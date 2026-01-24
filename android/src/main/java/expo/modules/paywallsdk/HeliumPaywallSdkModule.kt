package expo.modules.paywallsdk

import android.app.Activity
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.tryhelium.paywall.core.Helium
import com.tryhelium.paywall.core.HeliumEnvironment
import com.tryhelium.paywall.core.event.HeliumEvent
import com.tryhelium.paywall.core.event.HeliumEventDictionaryMapper
import com.tryhelium.paywall.core.event.PaywallEventHandlers
import com.tryhelium.paywall.core.HeliumFallbackConfig
import com.tryhelium.paywall.core.HeliumIdentityManager
import com.tryhelium.paywall.core.HeliumUserTraits
import com.tryhelium.paywall.core.HeliumUserTraitsArgument
import com.tryhelium.paywall.core.HeliumPaywallTransactionStatus
import com.tryhelium.paywall.core.HeliumLightDarkMode
import com.tryhelium.paywall.delegate.HeliumPaywallDelegate
import com.tryhelium.paywall.delegate.PlayStorePaywallDelegate
import com.android.billingclient.api.ProductDetails
import kotlinx.coroutines.suspendCancellableCoroutine
import java.lang.ref.WeakReference
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

// Singleton to manage purchase state that survives module recreation in dev mode
private object NativeModuleManager {
  private const val MAX_QUEUED_EVENTS = 30
  private const val EVENT_EXPIRATION_MS = 30_000L

  // Always keep reference to the current module
  var currentModule: HeliumPaywallSdkModule? = null

  // Store active operations
  var purchaseContinuation: ((HeliumPaywallTransactionStatus) -> Unit)? = null
  var restoreContinuation: ((Boolean) -> Unit)? = null

  // Event queue for when no module is available in the registry
  private data class PendingEvent(
    val eventName: String,
    val eventData: Map<String, Any?>,
    val timestamp: Long = System.currentTimeMillis()
  )
  private val pendingEvents = mutableListOf<PendingEvent>()

  fun clearPurchase() {
    purchaseContinuation = null
  }

  fun clearRestore() {
    restoreContinuation = null
  }

  // Queue an event for later delivery when module becomes available
  private fun queueEvent(eventName: String, eventData: Map<String, Any?>) {
    synchronized(pendingEvents) {
      if (pendingEvents.size >= MAX_QUEUED_EVENTS) {
        pendingEvents.removeAt(0)
        android.util.Log.w("HeliumPaywallSdk", "Event queue full, dropping oldest event")
      }
      pendingEvents.add(PendingEvent(eventName, eventData))
      android.util.Log.d("HeliumPaywallSdk", "Queued event: $eventName (queue size: ${pendingEvents.size})")
    }
  }

  // Flush queued events to a module
  fun flushEvents(module: HeliumPaywallSdkModule) {
    val eventsToSend: List<PendingEvent>
    synchronized(pendingEvents) {
      if (pendingEvents.isEmpty()) return
      eventsToSend = pendingEvents.toList()
      pendingEvents.clear()
    }

    android.util.Log.d("HeliumPaywallSdk", "Flushing ${eventsToSend.size} queued events")

    val now = System.currentTimeMillis()
    eventsToSend.forEach { event ->
      val age = now - event.timestamp
      if (age > EVENT_EXPIRATION_MS) {
        android.util.Log.w("HeliumPaywallSdk", "Dropping stale event: ${event.eventName} (age: ${age}ms)")
        return@forEach
      }
      try {
        module.sendEvent(event.eventName, event.eventData)
      } catch (e: IllegalArgumentException) {
        android.util.Log.w("HeliumPaywallSdk", "Failed to flush event ${event.eventName}, dropping: ${e.message}")
      }
    }
  }

  // Safe event sending with backup module and queue
  fun safeSendEvent(
    eventName: String,
    eventData: Map<String, Any?>,
    backupModule: HeliumPaywallSdkModule? = null
  ) {
    // Try 1: Use currentModule (most likely to be the correct registered module)
    currentModule?.let { module ->
      try {
        module.sendEvent(eventName, eventData)
        return
      } catch (e: IllegalArgumentException) {
        android.util.Log.w("HeliumPaywallSdk", "currentModule not in registry: ${e.message}")
      }
    }

    // Try 2: Use backup module if provided and different from currentModule
    if (backupModule != null && backupModule !== currentModule) {
      try {
        backupModule.sendEvent(eventName, eventData)
        return
      } catch (e: IllegalArgumentException) {
        android.util.Log.w("HeliumPaywallSdk", "backupModule not in registry: ${e.message}")
      }
    }

    // Try 3: Queue the event for later delivery
    queueEvent(eventName, eventData)
  }
}

class HeliumPaywallSdkModule : Module() {
  companion object {
    private const val DEFAULT_LOADING_BUDGET_MS = 7000L
  }

  private val gson = Gson()
  private var activityRef: WeakReference<Activity>? = null

  private val activity: Activity?
    get() = appContext.currentActivity ?: activityRef?.get()

  override fun definition() = ModuleDefinition {
    Name("HeliumPaywallSdk")

    OnCreate {
      NativeModuleManager.currentModule = this@HeliumPaywallSdkModule
    }

    // Defines event names that the module can send to JavaScript
    Events("onHeliumPaywallEvent", "onDelegateActionEvent", "paywallEventHandlers")

    // Lifecycle event to cache Activity reference for hot reload resilience
    OnActivityEntersForeground {
      activityRef = WeakReference(appContext.currentActivity)
    }

    // Initialize the Helium SDK with configuration
    Function("initialize") { config: Map<String, Any?> ->
      NativeModuleManager.currentModule = this@HeliumPaywallSdkModule // extra redundancy to update to latest live module
      NativeModuleManager.flushEvents(this@HeliumPaywallSdkModule)

      val apiKey = config["apiKey"] as? String ?: ""
      val customUserId = config["customUserId"] as? String
      val customAPIEndpoint = config["customAPIEndpoint"] as? String
      val revenueCatAppUserId = config["revenueCatAppUserId"] as? String
      val useDefaultDelegate = config["useDefaultDelegate"] as? Boolean ?: false

      @Suppress("UNCHECKED_CAST")
      val customUserTraitsMap = config["customUserTraits"] as? Map<String, Any?>
      val customUserTraits = convertToHeliumUserTraits(customUserTraitsMap)

      // Extract fallback bundle fields from top-level config
      val fallbackBundleUrlString = config["fallbackBundleUrlString"] as? String
      val fallbackBundleString = config["fallbackBundleString"] as? String

      @Suppress("UNCHECKED_CAST")
      val paywallLoadingConfigMap = convertMarkersToBooleans(config["paywallLoadingConfig"] as? Map<String, Any?>)
      val fallbackConfig = convertToHeliumFallbackConfig(
        paywallLoadingConfigMap,
        fallbackBundleUrlString,
        fallbackBundleString,
        appContext.reactContext
      )

      // Parse environment parameter, defaulting to PRODUCTION
      val environmentString = config["environment"] as? String
      val environment = when (environmentString?.lowercase()) {
        "sandbox" -> HeliumEnvironment.SANDBOX
        "production" -> HeliumEnvironment.PRODUCTION
        else -> HeliumEnvironment.PRODUCTION
      }

      // Event handler that converts events and adds backwards compatibility fields
      val delegateEventHandler: (HeliumEvent) -> Unit = { event ->
        val eventMap = HeliumEventDictionaryMapper.toDictionary(event).toMutableMap()
        // Add deprecated fields for backwards compatibility
        eventMap["paywallName"]?.let { eventMap["paywallTemplateName"] = it }
        eventMap["error"]?.let { eventMap["errorDescription"] = it }
        eventMap["productId"]?.let { eventMap["productKey"] = it }
        eventMap["buttonName"]?.let { eventMap["ctaName"] = it }

        NativeModuleManager.safeSendEvent("onHeliumPaywallEvent", eventMap)
      }

      try {
        val context = appContext.reactContext
          ?: throw Exceptions.ReactContextLost()

        // Create delegate
        val delegate = if (useDefaultDelegate) {
          val currentActivity = activity
            ?: throw Exceptions.MissingActivity()
          DefaultPaywallDelegate(currentActivity, delegateEventHandler)
        } else {
          CustomPaywallDelegate(delegateEventHandler)
        }

        Helium.initialize(
          context = context,
          apiKey = apiKey,
          heliumPaywallDelegate = delegate,
          customUserId = customUserId,
          customApiEndpoint = customAPIEndpoint,
          customUserTraits = customUserTraits,
          revenueCatAppUserId = revenueCatAppUserId,
          fallbackConfig = fallbackConfig,
          environment = environment
        )
      } catch (e: Exception) {
        // Log error but don't throw - initialization errors will be handled by SDK
        android.util.Log.e("HeliumPaywallSdk", "Failed to initialize: ${e.message}", e)
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

      // Helper to send event to JavaScript
      val sendPaywallEvent: (HeliumEvent) -> Unit = { event ->
        val eventMap = HeliumEventDictionaryMapper.toDictionary(event).toMutableMap()
        NativeModuleManager.safeSendEvent(
          "paywallEventHandlers",
          eventMap,
          this@HeliumPaywallSdkModule
        )
      }

      val eventHandlers = PaywallEventHandlers(
        onOpen = { event -> sendPaywallEvent(event) },
        onClose = { event -> sendPaywallEvent(event) },
        onDismissed = { event -> sendPaywallEvent(event) },
        onPurchaseSucceeded = { event -> sendPaywallEvent(event) },
        onOpenFailed = { event -> sendPaywallEvent(event) },
        onCustomPaywallAction = { event -> sendPaywallEvent(event) }
      )

      Helium.presentUpsell(
        trigger = trigger,
        activityContext = activity,
        dontShowIfAlreadyEntitled = dontShowIfAlreadyEntitled,
        customPaywallTraits = convertedTraits,
        eventListener = eventHandlers
      )
    }

    // Hide the current upsell
    Function("hideUpsell") {
      Helium.hideUpsell()
    }

    // Hide all upsells
    Function("hideAllUpsells") {
      Helium.hideAllUpsells()
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
      Helium.shared.overrideUserId(customUserId = newUserId, customUserTraits = null)
    }

    // Check if user has entitlement for a specific paywall
    AsyncFunction("hasEntitlementForPaywall") Coroutine { trigger: String ->
      val result = Helium.shared.hasEntitlementForPaywall(trigger)
      return@Coroutine HasEntitlementResult().apply {
        hasEntitlement = result
      }
    }

    // Check if user has any active subscription
    AsyncFunction("hasAnyActiveSubscription") Coroutine { ->
      return@Coroutine Helium.shared.hasAnyActiveSubscription()
    }

    // Check if user has any entitlement
    AsyncFunction("hasAnyEntitlement") Coroutine { ->
      return@Coroutine Helium.shared.hasAnyEntitlement()
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
      Helium.shared.disableRestoreFailedDialog()
    }

    // Set custom restore failed strings
    Function("setCustomRestoreFailedStrings") { customTitle: String?, customMessage: String?, customCloseButtonText: String? ->
      Helium.shared.setCustomRestoreFailedStrings(
        customTitle = customTitle,
        customMessage = customMessage,
        customCloseButtonText = customCloseButtonText
      )
    }

    // Reset Helium SDK
    Function("resetHelium") {
      Helium.resetHelium()
    }

    // Set light/dark mode override
    Function("setLightDarkModeOverride") { mode: String ->
      val heliumMode: HeliumLightDarkMode = when (mode.lowercase()) {
        "light" -> HeliumLightDarkMode.LIGHT
        "dark" -> HeliumLightDarkMode.DARK
        "system" -> HeliumLightDarkMode.SYSTEM
        else -> {
          android.util.Log.w("HeliumPaywallSdk", "Invalid light/dark mode: $mode, defaulting to system")
          HeliumLightDarkMode.SYSTEM
        }
      }
      Helium.shared.setLightDarkModeOverride(heliumMode)
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
      is Double -> HeliumUserTraitsArgument.DoubleParam(value)
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

  private fun convertToHeliumFallbackConfig(
    paywallLoadingConfig: Map<String, Any?>?,
    fallbackBundleUrlString: String?,
    fallbackBundleString: String?,
    context: android.content.Context?
  ): HeliumFallbackConfig? {
    // Extract loading config settings
    val useLoadingState = paywallLoadingConfig?.get("useLoadingState") as? Boolean ?: true
    val loadingBudgetSeconds = (paywallLoadingConfig?.get("loadingBudget") as? Number)?.toLong()
    val loadingBudget = loadingBudgetSeconds?.let { it * 1000 } ?: DEFAULT_LOADING_BUDGET_MS

    // Parse perTriggerLoadingConfig if present
    var perTriggerLoadingConfig: Map<String, HeliumFallbackConfig>? = null
    val perTriggerDict = paywallLoadingConfig?.get("perTriggerLoadingConfig") as? Map<*, *>
    if (perTriggerDict != null) {
      @Suppress("UNCHECKED_CAST")
      perTriggerLoadingConfig = perTriggerDict.mapNotNull { (key, value) ->
        if (key is String && value is Map<*, *>) {
          val config = value as? Map<String, Any?>
          val triggerUseLoadingState = config?.get("useLoadingState") as? Boolean
          val triggerLoadingBudgetSeconds = (config?.get("loadingBudget") as? Number)?.toLong()
          val triggerLoadingBudget = triggerLoadingBudgetSeconds?.let { it * 1000 }
          key to HeliumFallbackConfig(
            useLoadingState = triggerUseLoadingState ?: true,
            loadingBudgetInMs = triggerLoadingBudget ?: DEFAULT_LOADING_BUDGET_MS
          )
        } else {
          null
        }
      }.toMap() as? Map<String, HeliumFallbackConfig>
    }

    // Handle fallback bundle - write to helium_local directory where SDK expects it
    var fallbackBundleName: String? = null
    if (context != null && (fallbackBundleUrlString != null || fallbackBundleString != null)) {
      try {
        val heliumLocalDir = context.getDir("helium_local", android.content.Context.MODE_PRIVATE)
        val destinationFile = java.io.File(heliumLocalDir, "helium-fallback.json")

        if (fallbackBundleUrlString != null) {
          // Copy file from Expo's document directory to helium_local
          val sourceFile = java.io.File(java.net.URI.create(fallbackBundleUrlString))
          if (sourceFile.exists()) {
            sourceFile.copyTo(destinationFile, overwrite = true)
            fallbackBundleName = "helium-fallback.json"
          }
        } else if (fallbackBundleString != null) {
          // Write fallback bundle string to file
          destinationFile.writeText(fallbackBundleString)
          fallbackBundleName = "helium-fallback.json"
        }
      } catch (e: Exception) {
        // Silently fail for now
      }
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
 * Note: We don't store a module reference to avoid memory leaks - the Helium SDK
 * keeps this delegate alive forever, so any captured module would never be GC'd.
 */
class CustomPaywallDelegate(
  private val eventHandler: (HeliumEvent) -> Unit
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
      // First check singleton for orphaned continuation and clean it up
      NativeModuleManager.purchaseContinuation?.let { existingContinuation ->
        existingContinuation(HeliumPaywallTransactionStatus.Cancelled)
        NativeModuleManager.clearPurchase()
      }

      NativeModuleManager.purchaseContinuation = { status ->
        continuation.resume(status)
      }

      // Clean up on cancellation to prevent memory leaks and crashes
      continuation.invokeOnCancellation {
        NativeModuleManager.clearPurchase()
      }

      // Send event to JavaScript with separate parameters
      val eventMap = mutableMapOf<String, Any?>(
        "type" to "purchase",
        "productId" to productDetails.productId
      )
      if (basePlanId != null) {
        eventMap["basePlanId"] = basePlanId
      }
      if (offerId != null) {
        eventMap["offerId"] = offerId
      }

      NativeModuleManager.safeSendEvent("onDelegateActionEvent", eventMap)
    }
  }

  override suspend fun restorePurchases(): Boolean {
    return suspendCancellableCoroutine { continuation ->
      // Check singleton for orphaned continuation and clean it up
      NativeModuleManager.restoreContinuation?.let { existingContinuation ->
        existingContinuation(false)
        NativeModuleManager.clearRestore()
      }

      NativeModuleManager.restoreContinuation = { success ->
        continuation.resume(success)
      }

      // Clean up on cancellation to prevent memory leaks and crashes
      continuation.invokeOnCancellation {
        NativeModuleManager.clearRestore()
      }

      // Send event to JavaScript
      NativeModuleManager.safeSendEvent("onDelegateActionEvent", mapOf("type" to "restore"))
    }
  }
}

/**
 * Default Paywall Delegate that extends PlayStorePaywallDelegate with event dispatching.
 * Similar to the DefaultPurchaseDelegate in iOS implementation.
 */
class DefaultPaywallDelegate(
  activity: Activity,
  private val eventHandler: (HeliumEvent) -> Unit
) : PlayStorePaywallDelegate(activity) {

  override fun onHeliumEvent(event: HeliumEvent) {
    eventHandler(event)
  }
}

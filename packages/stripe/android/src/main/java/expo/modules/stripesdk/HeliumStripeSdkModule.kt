package expo.modules.stripesdk

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HeliumStripeSdkModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("HeliumStripeSdk")

        // No-op implementations — Stripe One Tap is iOS-only for now.
        // All exported JS functions guard on Platform.OS before calling these.

        Function("initializeStripe") { _: Map<String, Any> -> }

        Function("setUserIdAndSyncStripeIfNeeded") { _: String -> }
    }
}

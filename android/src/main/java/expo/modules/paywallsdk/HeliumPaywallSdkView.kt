package expo.modules.paywallsdk

import android.content.Context
import com.tryhelium.paywall.core.HeliumUserTraits
import com.tryhelium.paywall.core.PaywallPresentationConfig
import com.tryhelium.paywall.core.delegate.HeliumNavigationDispatcher
import com.tryhelium.paywall.ui.HeliumPaywallView
import com.tryhelium.paywall.ui.PaywallEligibilityResult
import com.tryhelium.paywall.ui.checkPaywallEligibility
import com.tryhelium.paywall.ui.reportPaywallNotShown
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class HeliumPaywallSdkView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var triggerName: String = ""
  var customPaywallTraits: HeliumUserTraits? = null

  private var loadedTrigger: String? = null
  private var loadedTraits: HeliumUserTraits? = null

  override val shouldUseAndroidLayout = true

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    loadPaywallIfNeeded()
  }

  fun loadPaywallIfNeeded() {
    val trigger = triggerName
    val traits = customPaywallTraits
    if (!isAttachedToWindow || trigger.isEmpty() || (trigger == loadedTrigger && traits == loadedTraits)) return
    loadedTrigger = trigger
    loadedTraits = traits
    removeAllViews()

    val config = PaywallPresentationConfig(customPaywallTraits = traits)
    when (val eligibility = checkPaywallEligibility(trigger, config)) {
      is PaywallEligibilityResult.Eligible -> {
        val paywallView = HeliumPaywallView(context)
        paywallView.loadPaywall(
          trigger = trigger,
          navigationDispatcher = HeliumNavigationDispatcher { },
          customPaywallTraits = traits,
        )
        addView(paywallView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
      }
      is PaywallEligibilityResult.NotEligible -> reportPaywallNotShown(context, trigger, eligibility.reason)
    }
  }
}

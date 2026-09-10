import ExpoModulesCore
import Helium
import SwiftUI

class HeliumPaywallSdkView: ExpoView {
  var triggerName = ""
  var customPaywallTraits: [String: Any]?

  private var hostingController: UIHostingController<AnyView>?
  private var loadedTrigger: String?

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController?.view.frame = bounds
  }

  func loadPaywallIfNeeded() {
    guard !triggerName.isEmpty, triggerName != loadedTrigger else {
      return
    }
    loadedTrigger = triggerName
    let paywall = HeliumPaywall(
      trigger: triggerName,
      config: PaywallPresentationConfig(customPaywallTraits: customPaywallTraits.map { HeliumUserTraits($0) })
    ) { _ in
      EmptyView()
    }
    let rootView = AnyView(paywall.id(triggerName))
    if let hostingController {
      hostingController.rootView = rootView
      return
    }
    let controller = UIHostingController(rootView: rootView)
    controller.view.backgroundColor = .clear
    controller.view.frame = bounds
    addSubview(controller.view)
    hostingController = controller
  }
}

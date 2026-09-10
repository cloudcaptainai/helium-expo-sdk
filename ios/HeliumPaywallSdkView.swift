import ExpoModulesCore
import Helium
import SwiftUI

class HeliumPaywallSdkView: ExpoView {
  var triggerName = ""
  var customPaywallTraits: [String: Any]?

  private var hostingController: UIHostingController<AnyView>?
  private var loadedTrigger: String?
  private var loadedTraits: NSDictionary?
  private var loadCount = 0

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController?.view.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detachFromParentViewController()
    } else {
      attachToParentViewController()
    }
  }

  func loadPaywallIfNeeded() {
    let traits = customPaywallTraits.map { NSDictionary(dictionary: $0) }
    guard !triggerName.isEmpty, triggerName != loadedTrigger || traits != loadedTraits else {
      return
    }
    loadedTrigger = triggerName
    loadedTraits = traits
    loadCount += 1
    let paywall = HeliumPaywall(
      trigger: triggerName,
      config: PaywallPresentationConfig(customPaywallTraits: customPaywallTraits.map { HeliumUserTraits($0) })
    ) { _ in
      EmptyView()
    }
    let rootView = AnyView(paywall.id(loadCount))
    if let hostingController {
      hostingController.rootView = rootView
      return
    }
    let controller = UIHostingController(rootView: rootView)
    controller.view.backgroundColor = .clear
    controller.view.frame = bounds
    addSubview(controller.view)
    hostingController = controller
    attachToParentViewController()
  }

  private func attachToParentViewController() {
    guard let hostingController, window != nil, let parent = nearestViewController() else {
      return
    }
    if hostingController.parent === parent {
      return
    }
    detachFromParentViewController()
    parent.addChild(hostingController)
    hostingController.didMove(toParent: parent)
  }

  private func detachFromParentViewController() {
    guard let hostingController, hostingController.parent != nil else {
      return
    }
    hostingController.willMove(toParent: nil)
    hostingController.removeFromParent()
  }

  private func nearestViewController() -> UIViewController? {
    var responder: UIResponder? = next
    while let current = responder {
      if let viewController = current as? UIViewController {
        return viewController
      }
      responder = current.next
    }
    return nil
  }
}

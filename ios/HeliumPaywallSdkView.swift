import ExpoModulesCore
import Helium
import SwiftUI

class HeliumPaywallSdkView: ExpoView {
  let onPaywallEvent = EventDispatcher()
  let onPaywallNotShown = EventDispatcher()

  var triggerName = ""
  var customPaywallTraits: [String: Any]?

  private var hostingController: UIHostingController<AnyView>?

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController?.view.frame = bounds
  }

  func loadPaywallIfNeeded() {
    guard hostingController == nil, !triggerName.isEmpty else {
      return
    }
    let paywall = HeliumPaywall(
      trigger: triggerName,
      config: PaywallPresentationConfig(customPaywallTraits: customPaywallTraits.map { HeliumUserTraits($0) }),
      eventHandlers: PaywallEventHandlers.withHandlers(onAnyEvent: { [weak self] event in
        self?.onPaywallEvent(eventPayload(event))
      })
    ) { [weak self] _ in
      Color.clear.onAppear {
        self?.onPaywallNotShown([:])
      }
    }
    let controller = UIHostingController(rootView: AnyView(paywall))
    controller.view.backgroundColor = .clear
    controller.view.frame = bounds
    addSubview(controller.view)
    hostingController = controller
  }
}

private func eventPayload(_ event: any HeliumEvent) -> [String: Any] {
  var payload = event.toDictionary()
  applyEventFieldAliases(&payload)
  return payload
}

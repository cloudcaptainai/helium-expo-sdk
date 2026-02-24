import ExpoModulesCore
import Helium
import StripeOneTapPurchase
@preconcurrency import StripeApplePay

public class HeliumStripeSdkModule: Module {
    public func definition() -> ModuleDefinition {
        Name("HeliumStripeSdk")

        Function("initializeStripe") { (config: [String: Any]) in
            guard let apiKey = config["apiKey"] as? String,
                  let stripePublishableKey = config["stripePublishableKey"] as? String,
                  let merchantIdentifier = config["merchantIdentifier"] as? String,
                  let merchantName = config["merchantName"] as? String,
                  let managementURLString = config["managementURL"] as? String,
                  let managementURL = URL(string: managementURLString) else {
                print("[HeliumStripe] Missing or invalid Stripe config, using standard initialization instead")
                Helium.shared.initialize(apiKey: config["apiKey"] as? String ?? "")
                return
            }

            let countryCode = config["countryCode"] as? String ?? "US"
            let currencyCode = config["currencyCode"] as? String ?? "USD"

            let backupDelegate: HeliumPaywallDelegate
            if let delegate = Helium.config.purchaseDelegate {
                backupDelegate = delegate
            } else {
                print("[HeliumStripe] WARNING: purchaseDelegate was nil, using StoreKitDelegate as backup")
                backupDelegate = StoreKitDelegate()
            }

            Helium.shared.initializeWithStripeOneTap(
                apiKey: apiKey,
                stripePublishableKey: stripePublishableKey,
                backupPurchaseDelegate: backupDelegate,
                merchantIdentifier: merchantIdentifier,
                merchantName: merchantName,
                managementURL: managementURL,
                countryCode: countryCode,
                currencyCode: currencyCode
            )
        }

        Function("setUserIdAndSyncStripeIfNeeded") { (userId: String) in
            Helium.shared.setUserIdAndSyncStripeIfNeeded(userId: userId)
        }

        Function("resetStripeEntitlements") { (clearUserId: Bool) in
            Helium.shared.resetStripeEntitlements(clearUserId: clearUserId)
        }

        AsyncFunction("createStripePortalSession") { (returnUrl: String) in
            let url = try await Helium.shared.createStripePortalSession(returnUrl: returnUrl)
            return url.absoluteString
        }
    }
}

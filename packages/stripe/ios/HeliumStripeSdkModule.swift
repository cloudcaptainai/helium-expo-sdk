import ExpoModulesCore
import Helium
import StripeOneTapPurchase
@preconcurrency import StripeApplePay

public class HeliumStripeSdkModule: Module {
    public func definition() -> ModuleDefinition {
        Name("HeliumStripeSdk")

        Function("initializeStripe") { (config: [String: Any]) in
            let apiKey = config["apiKey"] as! String
            let stripePublishableKey = config["stripePublishableKey"] as! String
            let merchantIdentifier = config["merchantIdentifier"] as! String
            let merchantName = config["merchantName"] as! String
            let managementURLString = config["managementURL"] as! String
            let countryCode = config["countryCode"] as? String ?? "US"
            let currencyCode = config["currencyCode"] as? String ?? "USD"

            guard let managementURL = URL(string: managementURLString) else {
                print("[HeliumStripe] Invalid managementURL")
                return
            }

            // Grab delegate set by core's setupCore() as the backup
            let backupDelegate = Helium.config.purchaseDelegate!

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

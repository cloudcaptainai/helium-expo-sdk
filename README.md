# helium-expo-sdk

## **Background**

Get set up with the Helium SDK for iOS in 5 minutes. Reach out over your Helium slack channel, or email [founders@tryhelium.com](mailto:founders@tryhelium.com) for any questions.

### Expo installation

Install the package by running:

```bash
npx expo install expo-helium
```

We recommend using Expo 53 and up.

## **Configuration**

### Initialization

Initialize Helium by calling `initialize()` early in your app's lifecycle, typically in your root component.
`initialize` takes in a configuration object that includes your purchase config, event handlers, and other settings. (If you are using **RevenueCat**, skip to the next section.)

```tsx
import { initialize, createCustomPurchaseConfig, HELIUM_CTA_NAMES } from 'expo-helium';

function App() {
  useEffect(() => {
    initialize({
      // Helium provided api key
      apiKey: '<your-helium-api-key>',

      // Custom user id - e.g. your amplitude analytics user id. 
      customUserId: '<your-custom-user-id>',

      // Purchase configuration (see next section if using RevenueCat)
      purchaseConfig: createCustomPurchaseConfig({
        makePurchase: async (productId) => {
          // Your purchase logic here
          return { status: 'purchased' };
        },
        restorePurchases: async () => {
          // Your restore logic here
          return true;
        }
      }),

      // Event handler for paywall events
      onHeliumPaywallEvent: (event) => {
        switch (event.type) {
          case 'paywallOpen':
            break;
          case 'ctaPressed':
            if (event.ctaName === HELIUM_CTA_NAMES.SCHEDULE_CALL) {
              // Handle schedule call
            }
            break;
          case 'subscriptionSucceeded':
            // Handle successful subscription
            break;
        }
      },

      // Custom user traits
      customUserTraits: {
        "example_trait": "example_value",
      },

    });
  }, []);
}
```

#### Use RevenueCat with Helium

**Important** Make sure that you've already:

- installed and configured RevenueCat's `Purchases` client - if not, follow [`https://www.revenuecat.com/docs/getting-started/configuring-sdk`](https://www.revenuecat.com/docs/getting-started/configuring-sdk) for more details.
- have packages configured for each apple app store SKU
- assigned one of your Offerings as "default"
- initialize RevenueCat (`Purchases.configure()`) _before_ initializing Helium

```tsx
import { createRevenueCatPurchaseConfig } from "expo-helium/revenuecat";

const asyncHeliumInit = async () => {
  initialize({
    apiKey: '<your-helium-api-key>',
    customUserId: '<your-custom-user-id>',
    purchaseConfig: createRevenueCatPurchaseConfig(),
    onHeliumPaywallEvent: (event) => {
      switch (event.type) {
        case 'subscriptionFailed':
          // Custom logic
          break;
        case 'subscriptionSucceeded':
          // Handle a subscription success event
          // e.g. navigate to a premium page
          break;
      }
    },
    // RevenueCat ONLY: supply RevenueCat appUserId
    // (and initialize RevenueCat before Helium initialize)
    revenueCatAppUserId: await Purchases.getAppUserID()
  });
};

useEffect(() => {
  void asyncHeliumInit();
}, []);
```

## **Presenting Paywalls**

`presentUpsell` takes in a dictionary specifying the `triggerName` as well as an optional `onFallback` parameter defining custom fallback behavior (in case the user didn't have a network connection)

```typescript
import { presentUpsell } from 'expo-helium';

function YourComponent() {
  const handlePremiumPress = useCallback(async () => {
    await presentUpsell({
      triggerName: 'premium_feature_press',
      onFallback: () => {
        // Logic to open a default paywall
        openFallbackPaywall();
      }
    });
  }, [presentUpsell]);

  return (
    <Button title="Try Premium" onPress={handlePremiumPress} />
  );
}
```

## **Paywall Events**

Helium emits various events during the lifecycle of a paywall. You can handle these events in your payment delegate. See the [Helium Events](https://docs.tryhelium.com/sdk/helium-events) for more details.

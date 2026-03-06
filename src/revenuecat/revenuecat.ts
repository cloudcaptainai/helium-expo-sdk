import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesError,
  PurchasesPackage,
  SubscriptionOption
} from 'react-native-purchases';
import Purchases, {PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, PurchasesStoreProduct} from 'react-native-purchases';
import {Platform} from 'react-native';
import {HeliumPaywallEvent, HeliumPurchaseConfig, HeliumPurchaseResult} from "../HeliumPaywallSdk.types";
import {setRevenueCatAppUserId} from "../index";

// Rename the factory function
export function createRevenueCatPurchaseConfig(config?: {
  apiKey?: string;
  apiKeyIOS?: string;
  apiKeyAndroid?: string;
  /** Set to true to disable automatic RevenueCat entitlement syncing after Stripe purchases. */
  disableStripePurchaseSync?: boolean;
}): HeliumPurchaseConfig {
  const rcHandler = new RevenueCatHeliumHandler(config);
  return {
    makePurchaseIOS: rcHandler.makePurchaseIOS.bind(rcHandler),
    makePurchaseAndroid: rcHandler.makePurchaseAndroid.bind(rcHandler),
    restorePurchases: rcHandler.restorePurchases.bind(rcHandler),
    onHeliumEvent: rcHandler.onHeliumEvent.bind(rcHandler),
    _delegateType: 'h_revenuecat',
  };
}

export class RevenueCatHeliumHandler {
  private productIdToPackageMapping: Record<string, PurchasesPackage> = {};
  private isMappingInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private stripePurchaseSyncDisabled: boolean = false;

  private rcProductToPackageMapping: Record<string, PurchasesStoreProduct> = {};

  constructor(config?: { apiKey?: string; apiKeyIOS?: string; apiKeyAndroid?: string; disableStripePurchaseSync?: boolean }) {
    // Determine which API key to use based on platform
    let effectiveApiKey: string | undefined;
    if (Platform.OS === 'ios' && config?.apiKeyIOS) {
      effectiveApiKey = config.apiKeyIOS;
    } else if (Platform.OS === 'android' && config?.apiKeyAndroid) {
      effectiveApiKey = config.apiKeyAndroid;
    } else {
      effectiveApiKey = config?.apiKey;
    }

    if (effectiveApiKey) {
      Purchases.configure({apiKey: effectiveApiKey});
    }
    this.stripePurchaseSyncDisabled = config?.disableStripePurchaseSync ?? false;
    void this.initializePackageMapping();
  }

  private async initializePackageMapping(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    this.initializationPromise = (async () => {
      try {
        // Keep this value as up-to-date as possible
        setRevenueCatAppUserId(await Purchases.getAppUserID());

        const offerings = await Purchases.getOfferings();
        const allOfferings = offerings.all;
        for (const offering of Object.values(allOfferings)) {
          offering.availablePackages.forEach((pkg: PurchasesPackage) => {
            if (pkg.product?.identifier) {
              this.productIdToPackageMapping[pkg.product.identifier] = pkg;
            }
          });
        }
        this.isMappingInitialized = true;
      } catch (error) {
        this.isMappingInitialized = false;
      } finally {
        this.initializationPromise = null;
      }
    })();
    return this.initializationPromise;
  }

  private async ensureMappingInitialized(): Promise<void> {
    if (!this.isMappingInitialized && !this.initializationPromise) {
      await this.initializePackageMapping();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  async makePurchaseIOS(productId: string): Promise<HeliumPurchaseResult> {
    // Keep this value as up-to-date as possible
    setRevenueCatAppUserId(await Purchases.getAppUserID());

    await this.ensureMappingInitialized();
    const pkg: PurchasesPackage | undefined = this.productIdToPackageMapping[productId];
    let rcProduct: PurchasesStoreProduct | undefined;
    if (!pkg) {
      // Use cached if available
      rcProduct = this.rcProductToPackageMapping[productId];
      if (!rcProduct) {
        // Try to retrieve now
        try {
          const rcProducts = await Purchases.getProducts([productId]);
          rcProduct = rcProducts.length > 0 ? rcProducts[0] : undefined;
        } catch {
          // 'failed' status will be returned
        }
        if (rcProduct) {
          this.rcProductToPackageMapping[productId] = rcProduct;
        }
      }
    }

    try {
      let purchaseResult;
      if (pkg) {
        purchaseResult = await Purchases.purchasePackage(pkg);
      } else if (rcProduct) {
        purchaseResult = await Purchases.purchaseStoreProduct(rcProduct);
      } else {
        return {status: 'failed', error: `RevenueCat Product/Package not found for ID: ${productId}`};
      }

      const transactionId = purchaseResult.transaction?.transactionIdentifier;
      return this.evaluatePurchaseResult(purchaseResult.customerInfo, productId, transactionId);
    } catch (error) {
      return this.handlePurchasesError(error);
    }
  }

  // Android-specific purchase logic (completely separated from iOS)
  async makePurchaseAndroid(productId: string, basePlanId?: string, offerId?: string): Promise<HeliumPurchaseResult> {
    // Keep this value as up-to-date as possible
    setRevenueCatAppUserId(await Purchases.getAppUserID());

    // Handle subscription with base plan or offer
    if (basePlanId || offerId) {
      const subscriptionOption = await this.findAndroidSubscriptionOption(
        productId,
        basePlanId,
        offerId
      );

      if (subscriptionOption) {
        try {
          const customerInfo = (await Purchases.purchaseSubscriptionOption(subscriptionOption)).customerInfo;

          return this.evaluatePurchaseResult(customerInfo, productId);
        } catch (error) {
          return this.handlePurchasesError(error);
        }
      }
    }

    // Handle one-time purchase or subscription that didn't have matching base plan / offer
    let rcProduct: PurchasesStoreProduct | undefined;
    try {
      // Try non-subscription (NON_SUBSCRIPTION) product first; most likely not a sub at this point
      let products = await Purchases.getProducts([productId], PRODUCT_CATEGORY.NON_SUBSCRIPTION);
      if (products.length > 0) {
        rcProduct = products[0];
      } else {
        // Then try subscription product (let RC pick option since we couldn't find a match)
        products = await Purchases.getProducts([productId]);
        if (products.length > 0) {
          rcProduct = products[0];
        }
      }
      if (!rcProduct) {
        return {status: 'failed', error: `[RC] Android product not found: ${productId}`};
      }
    } catch {
      return {status: 'failed', error: `[RC] Failed to retrieve Android product: ${productId}`};
    }

    try {
      const customerInfo = (await Purchases.purchaseStoreProduct(rcProduct)).customerInfo;

      return this.evaluatePurchaseResult(customerInfo, productId);
    } catch (error) {
      return this.handlePurchasesError(error);
    }
  }

  // Android helper: Find subscription option
  private async findAndroidSubscriptionOption(
    productId: string,
    basePlanId?: string,
    offerId?: string
  ): Promise<SubscriptionOption | undefined> {
    try {
      const products = await Purchases.getProducts([productId]);
      if (products.length === 0) {
        return undefined;
      }

      // RC will return multiple products if multiple base plans per subscription
      // Collect all subscription options from all products into a flat list
      const allSubscriptionOptions = products.flatMap(
        product => product.subscriptionOptions ?? []
      );

      if (allSubscriptionOptions.length === 0) {
        return undefined;
      }

      let subscriptionOption: SubscriptionOption | undefined;

      if (offerId && basePlanId) {
        // Look for specific offer: "basePlanId:offerId"
        const targetId = `${basePlanId}:${offerId}`;
        subscriptionOption = allSubscriptionOptions.find(opt => opt.id === targetId);
      }
      if (!subscriptionOption && basePlanId) {
        // Otherwise the RC option id will simply be base plan id
        subscriptionOption = allSubscriptionOptions.find(opt => opt.id === basePlanId);
      }

      return subscriptionOption;
    } catch (error) {
      return undefined;
    }
  }

  // Helper function to check if a product is active in CustomerInfo
  private isProductActive(customerInfo: CustomerInfo, productId: string): boolean {
    return Object.values(customerInfo.entitlements.active).some((entitlement: PurchasesEntitlementInfo) => entitlement.productIdentifier === productId)
      || customerInfo.activeSubscriptions.includes(productId)
      || customerInfo.allPurchasedProductIdentifiers.includes(productId);
  }

  // Helper function to process purchase result
  private evaluatePurchaseResult(customerInfo: CustomerInfo, productId: string, transactionId?: string): HeliumPurchaseResult {
    if (!this.isProductActive(customerInfo, productId)) {
      console.log('[Helium] Purchase succeeded but product not immediately active in customerInfo:', productId);
    }

    return {status: 'purchased', transactionId, productId};
  }

  // Helper function to handle RevenueCat purchase errors
  private handlePurchasesError(error: unknown): HeliumPurchaseResult {
    const purchasesError = error as PurchasesError;

    if (purchasesError?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
      return {status: 'pending'};
    }

    if (purchasesError?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return {status: 'cancelled'};
    }

    const errorDesc = purchasesError?.message || 'purchase failed.';
    return {status: 'failed', error: `[RC] ${errorDesc} code: ${purchasesError?.code}`};
  }

  async restorePurchases(): Promise<boolean> {
    try {
      const customerInfo = await Purchases.restorePurchases();
      return Object.keys(customerInfo.entitlements.active).length > 0;
    } catch (error) {
      return false;
    }
  }

  onHeliumEvent(event: HeliumPaywallEvent): void {
    if (!this.stripePurchaseSyncDisabled && event.type === 'purchaseSucceeded' && this.isStripePurchase(event)) {
      void this.syncRevenueCatAfterStripePurchase();
    }
  }

  private isStripePurchase(event: HeliumPaywallEvent): boolean {
    if (event.canonicalJoinTransactionId?.startsWith('si_')) {
      return true;
    }
    if (event.productId && /^prod_\w+:price_\w+$/.test(event.productId)) {
      return true;
    }
    return false;
  }

  /**
   * After a Stripe purchase completes, the RevenueCat SDK on-device has no way to
   * know that a new entitlement exists until its backend processes the Stripe webhook.
   * Without this, RevenueCat customer info would remain stale until the next app launch
   * or natural refresh. This method polls RevenueCat with progressive backoff to force
   * a customer info refresh, stopping early if the update listener fires (~50s max).
   */
  private async syncRevenueCatAfterStripePurchase(): Promise<void> {
    let synced = false;

    const listener = (_info: CustomerInfo) => {
      synced = true;
    };
    Purchases.addCustomerInfoUpdateListener(listener);

    const pollPhase = async (attempts: number, intervalMs: number) => {
      for (let i = 0; i < attempts && !synced; i++) {
        await this.delay(intervalMs);
        if (synced) break;
        try {
          await Purchases.invalidateCustomerInfoCache();
          await Purchases.getCustomerInfo();
        } catch {
          /* catch anything unexpected like a network failure */
        }
      }
    };

    await pollPhase(5, 1000);   // Phase 1: every 1s for 5 attempts
    await pollPhase(3, 5000);   // Phase 2: every 5s for 3 attempts
    await pollPhase(2, 15000);  // Phase 3: every 15s for 2 attempts

    Purchases.removeCustomerInfoUpdateListener(listener);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

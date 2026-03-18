import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesError,
  SubscriptionOption
} from 'react-native-purchases';
import Purchases, {PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, PurchasesStoreProduct} from 'react-native-purchases';
import {Platform} from 'react-native';
import {HeliumPaywallEvent, HeliumPurchaseConfig, HeliumPurchaseResult} from "../HeliumPaywallSdk.types";
import {setRevenueCatAppUserId} from "../index";

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
  private stripePurchaseSyncDisabled: boolean = false;
  private isSyncingStripePurchase: boolean = false;

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
    // Keep this value as up-to-date as possible
    void this.syncRevenueCatAppUserId();
  }

  private async syncRevenueCatAppUserId(): Promise<void> {
    try {
      const id = await Purchases.getAppUserID();
      setRevenueCatAppUserId(id);
    } catch {
      console.log('[Helium] Could not sync RevenueCat app user ID.');
    }
  }

  async makePurchaseIOS(productId: string): Promise<HeliumPurchaseResult> {
    // Keep this value as up-to-date as possible
    await this.syncRevenueCatAppUserId();
    const result = await this.attemptPurchaseIOS(productId);

    if (this.isRetryableResult(result)) {
      await this.delay(1000);
      return this.attemptPurchaseIOS(productId);
    }
    return result;
  }

  private async attemptPurchaseIOS(productId: string): Promise<HeliumPurchaseResult> {
    let rcProduct: PurchasesStoreProduct | undefined;
    try {
      rcProduct = await this.getProduct(productId);
    } catch {
      return {status: 'failed', error: `[RevenueCat] Failed to retrieve product: ${productId}`};
    }

    if (!rcProduct) {
      return {status: 'failed', error: `[RevenueCat] iOS product not found: ${productId}`};
    }

    try {
      const purchaseResult = await Purchases.purchaseStoreProduct(rcProduct);
      const transactionId = purchaseResult.transaction?.transactionIdentifier;
      return this.evaluatePurchaseResult(purchaseResult.customerInfo, productId, transactionId);
    } catch (error) {
      return this.handlePurchasesError(error);
    }
  }

  async makePurchaseAndroid(productId: string, basePlanId?: string, offerId?: string): Promise<HeliumPurchaseResult> {
    // Keep this value as up-to-date as possible
    await this.syncRevenueCatAppUserId();
    const result = await this.attemptPurchaseAndroid(productId, basePlanId, offerId);

    if (this.isRetryableResult(result)) {
      await this.delay(1000);
      return this.attemptPurchaseAndroid(productId, basePlanId, offerId);
    }
    return result;
  }

  private async attemptPurchaseAndroid(productId: string, basePlanId?: string, offerId?: string): Promise<HeliumPurchaseResult> {
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
    } catch {
      return {status: 'failed', error: `[RevenueCat] Failed to retrieve Android product: ${productId}`};
    }
    if (!rcProduct) {
      return {status: 'failed', error: `[RevenueCat] Android product not found: ${productId}`};
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
    const underlying = purchasesError?.underlyingErrorMessage;
    const errorMsg = underlying
      ? `[RevenueCat] ${errorDesc} code: ${purchasesError?.code} | ${underlying}`
      : `[RevenueCat] ${errorDesc} code: ${purchasesError?.code}`;
    return {status: 'failed', error: errorMsg};
  }

  async restorePurchases(): Promise<boolean> {
    try {
      const customerInfo = await Purchases.restorePurchases();
      return Object.keys(customerInfo.entitlements.active).length > 0;
    } catch (error) {
      return false;
    }
  }

  private async getProduct(productId: string): Promise<PurchasesStoreProduct | undefined> {
    const products = await Purchases.getProducts([productId]);
    return products.length > 0 ? products[0] : undefined;
  }

  private isRetryableResult(result: HeliumPurchaseResult): boolean {
    return result.status === 'failed';
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
    if (this.isSyncingStripePurchase) {
      return;
    }
    this.isSyncingStripePurchase = true;

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

    try {
      await pollPhase(5, 1000);   // Phase 1: every 1s for 5 attempts
      await pollPhase(3, 5000);   // Phase 2: every 5s for 3 attempts
      await pollPhase(2, 15000);  // Phase 3: every 15s for 2 attempts
    } finally {
      Purchases.removeCustomerInfoUpdateListener(listener);
      this.isSyncingStripePurchase = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

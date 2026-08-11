import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesError,
  SubscriptionOption
} from 'react-native-purchases';
import Purchases, {PURCHASE_TYPE, PURCHASES_ERROR_CODE} from 'react-native-purchases';
import {Platform} from 'react-native';
import {
  HeliumAndroidProductType,
  HeliumPaywallEvent,
  HeliumPurchaseConfig,
  HeliumPurchaseResult
} from "../HeliumPaywallSdk.types";
import {setRevenueCatAppUserId} from "../index";

export interface RevenueCatConfig {
  /** RevenueCat API key (cross-platform). Only needed if RevenueCat is not already configured externally (e.g. via Purchases.configure). */
  apiKey?: string;
  /** iOS-specific RevenueCat API key. Takes precedence over `apiKey` on iOS. Only needed if RevenueCat is not already configured externally. */
  apiKeyIOS?: string;
  /** Android-specific RevenueCat API key. Takes precedence over `apiKey` on Android. Only needed if RevenueCat is not already configured externally. */
  apiKeyAndroid?: string;
  /** Set to true to disable automatic RevenueCat entitlement syncing after Stripe purchases. */
  disableStripePurchaseSync?: boolean;
  /** Set to true to disable automatic RevenueCat entitlement syncing after Paddle purchases. */
  disablePaddlePurchaseSync?: boolean;
}

export function createRevenueCatPurchaseConfig(config?: RevenueCatConfig): HeliumPurchaseConfig {
  const rcHandler = new RevenueCatHeliumHandler(config);
  return {
    makePurchaseIOS: rcHandler.makePurchaseIOS.bind(rcHandler),
    makePurchaseAndroid: rcHandler.makePurchaseAndroid.bind(rcHandler),
    restorePurchases: rcHandler.restorePurchases.bind(rcHandler),
    onHeliumEvent: rcHandler.onHeliumEvent.bind(rcHandler),
    _delegateType: 'h_revenuecat',
  };
}

// RC error codes worth retrying — transient failures that may resolve on a second attempt.
const RETRYABLE_RC_CODES = new Set([
  PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,              // 2
  PURCHASES_ERROR_CODE.NETWORK_ERROR,                    // 4
  PURCHASES_ERROR_CODE.MISSING_RECEIPT_FILE_ERROR,       // 8
  PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,            // 14
]);

type PurchaseAttemptResult = HeliumPurchaseResult & { shouldRetry?: boolean };

// RN's wrapper reads only productId and id off the option; the native SDK resolves it.
const androidSubscriptionOption = (productId: string, optionId: string): SubscriptionOption =>
  ({productId, id: optionId}) as unknown as SubscriptionOption;

export class RevenueCatHeliumHandler {
  private stripePurchaseSyncDisabled: boolean = false;
  private paddlePurchaseSyncDisabled: boolean = false;
  private isSyncingThirdPartyPayment: boolean = false;
  private setUpPromise: Promise<void>;

  constructor(config?: RevenueCatConfig) {
    this.stripePurchaseSyncDisabled = config?.disableStripePurchaseSync ?? false;
    this.paddlePurchaseSyncDisabled = config?.disablePaddlePurchaseSync ?? false;

    // Determine which API key to use based on platform
    let effectiveApiKey: string | undefined;
    if (Platform.OS === 'ios' && config?.apiKeyIOS) {
      effectiveApiKey = config.apiKeyIOS;
    } else if (Platform.OS === 'android' && config?.apiKeyAndroid) {
      effectiveApiKey = config.apiKeyAndroid;
    } else {
      effectiveApiKey = config?.apiKey;
    }

    this.setUpPromise = this.setUp(effectiveApiKey);
  }

  private async setUp(apiKey?: string): Promise<void> {
    if (apiKey) {
      try {
        if (await Purchases.isConfigured()) {
          console.log('[Helium] RevenueCat is already configured, ignoring provided RevenueCat api key.');
        } else {
          Purchases.configure({apiKey: apiKey});
        }
      } catch {
        console.log('[Helium] Failed to configure RevenueCat.');
      }
    }
    // Keep this value as up-to-date as possible
    await this.syncRevenueCatAppUserId();
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
    await this.setUpPromise;
    // Keep this value as up-to-date as possible
    await this.syncRevenueCatAppUserId();
    const result = await this.attemptPurchaseIOS(productId);

    if (this.isRetryableResult(result)) {
      await this.delay(1000);
      return this.attemptPurchaseIOS(productId);
    }
    return result;
  }

  private async attemptPurchaseIOS(productId: string): Promise<PurchaseAttemptResult> {
    try {
      const purchaseResult = await Purchases.purchaseProduct(productId);
      const transactionId = purchaseResult.transaction?.transactionIdentifier;
      return this.evaluatePurchaseResult(purchaseResult.customerInfo, productId, transactionId);
    } catch (error) {
      return this.handlePurchasesError(error);
    }
  }

  async makePurchaseAndroid(
    productId: string,
    basePlanId?: string,
    offerId?: string,
    productType?: HeliumAndroidProductType
  ): Promise<HeliumPurchaseResult> {
    await this.setUpPromise;
    // Keep this value as up-to-date as possible
    await this.syncRevenueCatAppUserId();
    const result = await this.attemptPurchaseAndroid(productId, basePlanId, offerId, productType);

    if (this.isRetryableResult(result)) {
      await this.delay(1000);
      return this.attemptPurchaseAndroid(productId, basePlanId, offerId, productType);
    }
    return result;
  }

  private async attemptPurchaseAndroid(
    productId: string,
    basePlanId?: string,
    offerId?: string,
    productType?: HeliumAndroidProductType
  ): Promise<PurchaseAttemptResult> {
    if (productType === 'inapp') {
      try {
        const customerInfo = (await Purchases.purchaseProduct(productId, null, PURCHASE_TYPE.INAPP)).customerInfo;

        return this.evaluatePurchaseResult(customerInfo, productId);
      } catch (error) {
        return this.handlePurchasesError(error);
      }
    }

    if (!basePlanId) {
      return {
        status: 'failed',
        error: `[Helium] Android subscription "${productId}" has no base plan id. ` +
          `Set the product id to "productId:basePlanId" (optionally ":offerId") in the Helium dashboard.`,
      };
    }

    const optionId = offerId ? `${basePlanId}:${offerId}` : basePlanId;
    try {
      const customerInfo = (await Purchases.purchaseSubscriptionOption(
        androidSubscriptionOption(productId, optionId)
      )).customerInfo;

      return this.evaluatePurchaseResult(customerInfo, productId);
    } catch (error) {
      return this.handlePurchasesError(error);
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
  private handlePurchasesError(error: unknown): PurchaseAttemptResult {
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
    return {status: 'failed', shouldRetry: RETRYABLE_RC_CODES.has(purchasesError?.code), error: errorMsg};
  }

  async restorePurchases(): Promise<boolean> {
    try {
      const customerInfo = await Purchases.restorePurchases();
      return Object.keys(customerInfo.entitlements.active).length > 0;
    } catch (error) {
      return false;
    }
  }

  private isRetryableResult(result: PurchaseAttemptResult): boolean {
    return result.status === 'failed' && !!result.shouldRetry;
  }

  onHeliumEvent(event: HeliumPaywallEvent): void {
    if (event.type === 'purchaseSucceeded' && this.shouldSyncAfterThirdPartyPayment(event)) {
      void this.syncRevenueCatAfterThirdPartyPayment();
    }
  }

  private shouldSyncAfterThirdPartyPayment(event: HeliumPaywallEvent): boolean {
    switch (event.paymentProcessor) {
      case 'stripe':
        return !this.stripePurchaseSyncDisabled;
      case 'paddle':
        return !this.paddlePurchaseSyncDisabled;
      default:
        return false;
    }
  }

  /**
   * After a third-party payment (Stripe or Paddle) completes, the RevenueCat SDK
   * on-device has no way to know that a new entitlement exists until its backend
   * processes the provider webhook. Without this, RevenueCat customer info would
   * remain stale until the next app launch or natural refresh. This method polls
   * RevenueCat with progressive backoff to force a customer info refresh, stopping
   * early if the update listener fires (~50s max).
   */
  private async syncRevenueCatAfterThirdPartyPayment(): Promise<void> {
    if (this.isSyncingThirdPartyPayment) {
      return;
    }
    this.isSyncingThirdPartyPayment = true;

    let synced = false;
    let hasInvalidatedCache = false;

    const listener = (_info: CustomerInfo) => {
      // Ignore emissions until we've invalidated the customer info cache,
      // to ensure react to fresh updates triggered by our polling.
      if (!hasInvalidatedCache) return;
      synced = true;
    };
    Purchases.addCustomerInfoUpdateListener(listener);

    const pollPhase = async (attempts: number, intervalMs: number) => {
      for (let i = 0; i < attempts && !synced; i++) {
        await this.delay(intervalMs);
        if (synced) break;
        try {
          hasInvalidatedCache = true;
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
      this.isSyncingThirdPartyPayment = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

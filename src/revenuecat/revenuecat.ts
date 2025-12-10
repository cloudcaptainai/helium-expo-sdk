import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesError,
  PurchasesPackage,
  SubscriptionOption
} from 'react-native-purchases';
import Purchases, {PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, PurchasesStoreProduct} from 'react-native-purchases';
import {Platform} from 'react-native';
import {HeliumPurchaseConfig, HeliumPurchaseResult} from "../HeliumPaywallSdk.types";
import {setRevenueCatAppUserId} from "../index";

// Rename the factory function
export function createRevenueCatPurchaseConfig(config?: {
  apiKey?: string;
  apiKeyIOS?: string;
  apiKeyAndroid?: string;
}): HeliumPurchaseConfig {
  const rcHandler = new RevenueCatHeliumHandler(config);
  return {
    makePurchaseIOS: rcHandler.makePurchaseIOS.bind(rcHandler),
    makePurchaseAndroid: rcHandler.makePurchaseAndroid.bind(rcHandler),
    restorePurchases: rcHandler.restorePurchases.bind(rcHandler),
  };
}

export class RevenueCatHeliumHandler {
  private productIdToPackageMapping: Record<string, PurchasesPackage> = {};
  private isMappingInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  private rcProductToPackageMapping: Record<string, PurchasesStoreProduct> = {};

  constructor(config?: { apiKey?: string; apiKeyIOS?: string; apiKeyAndroid?: string }) {
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
      let customerInfo: CustomerInfo;
      if (pkg) {
        customerInfo = (await Purchases.purchasePackage(pkg)).customerInfo;
      } else if (rcProduct) {
        customerInfo = (await Purchases.purchaseStoreProduct(rcProduct)).customerInfo;
      } else {
        return {status: 'failed', error: `RevenueCat Product/Package not found for ID: ${productId}`};
      }
      return this.evaluatePurchaseResult(customerInfo, productId);
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

  // Helper function to evaluate purchase result based on product activation status
  private evaluatePurchaseResult(customerInfo: CustomerInfo, productId: string): HeliumPurchaseResult {
    const isActive = this.isProductActive(customerInfo, productId);
    if (isActive) {
      return {status: 'purchased'};
    } else {
      return {
        status: 'failed',
        error: '[RC] Purchase possibly complete but entitlement/subscription not active for this product.'
      };
    }
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
}

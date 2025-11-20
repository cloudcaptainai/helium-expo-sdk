import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesError,
  PurchasesPackage,
  SubscriptionOption
} from 'react-native-purchases';
import Purchases, {LOG_LEVEL, PURCHASES_ERROR_CODE, PurchasesStoreProduct} from 'react-native-purchases';
import {Platform} from 'react-native';
import {HeliumPurchaseConfig, HeliumPurchaseResult} from "../HeliumPaywallSdk.types";
import {setRevenueCatAppUserId} from "../index";

// Rename the factory function
export function createRevenueCatPurchaseConfig(config?: {
  apiKey?: string;
}): HeliumPurchaseConfig {
  const rcHandler = new RevenueCatHeliumHandler(config?.apiKey);
  return {
    makePurchase: rcHandler.makePurchase.bind(rcHandler),
    restorePurchases: rcHandler.restorePurchases.bind(rcHandler),
  };
}

export class RevenueCatHeliumHandler {
  private productIdToPackageMapping: Record<string, PurchasesPackage> = {};
  private isMappingInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  private rcProductToPackageMapping: Record<string, PurchasesStoreProduct> = {};
  private androidSubscriptionOptionCache: Record<string, SubscriptionOption> = {};
  private androidInAppCache: Record<string, PurchasesStoreProduct> = {};

  constructor(apiKey?: string) {
    if (apiKey) {
      Purchases.configure({apiKey});
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

  // Android helper: Parse chained product ID format
  private parseAndroidProductId(productId: string): {
    baseProductId: string;
    basePlanId?: string;
    offerId?: string;
  } {
    const parts = productId.split(':');
    return {
      baseProductId: parts[0],
      basePlanId: parts[1],
      offerId: parts[2]
    };
  }

  // Android helper: Find and cache subscription option
  private async findAndroidSubscriptionOption(
    chainedProductId: string,
    baseProductId: string,
    basePlanId?: string,
    offerId?: string
  ): Promise<SubscriptionOption | undefined> {
    if (this.androidSubscriptionOptionCache[chainedProductId]) {
      return this.androidSubscriptionOptionCache[chainedProductId];
    }

    try {
      const products = await Purchases.getProducts([baseProductId]);
      if (products.length === 0) {
        return undefined;
      }

      const product = products[0];

      if (!product.subscriptionOptions || product.subscriptionOptions.length === 0) {
        return undefined;
      }

      let subscriptionOption: SubscriptionOption | undefined;

      if (offerId && basePlanId) {
        // Look for specific offer: "basePlanId:offerId"
        const targetId = `${basePlanId}:${offerId}`;
        subscriptionOption = product.subscriptionOptions.find(opt => opt.id === targetId);
      } else if (basePlanId) {
        subscriptionOption = product.subscriptionOptions.find(
          opt => opt.id === basePlanId && opt.isBasePlan
        );
      }

      if (subscriptionOption) {
        this.androidSubscriptionOptionCache[chainedProductId] = subscriptionOption;
      }

      return subscriptionOption;
    } catch (error) {
      return undefined;
    }
  }

  async makePurchase(productId: string): Promise<HeliumPurchaseResult> {
    // Keep this value as up-to-date as possible
    setRevenueCatAppUserId(await Purchases.getAppUserID());
    if (Platform.OS === 'android') {
      return this.makePurchaseAndroid(productId);
    }

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
      const isActive = this.isProductActive(customerInfo, productId);
      if (isActive) {
        return {status: 'purchased'};
      } else {
        // This case might occur if the purchase succeeded but the entitlement wasn't immediately active
        // or if a different product became active.
        // Consider if polling/listening might be needed here too, similar to pending.
        // For now, returning failed as the specific product isn't confirmed active.
        return {
          status: 'failed',
          error: 'Purchase possibly complete but entitlement/subscription not active for this product.'
        };
      }
    } catch (error) {
      const purchasesError = error as PurchasesError;

      if (purchasesError?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
        return {status: 'pending'};
      }

      if (purchasesError?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
        return {status: 'cancelled'};
      }

      // Handle other errors
      return {status: 'failed', error: purchasesError?.message || 'RevenueCat purchase failed.'};
    }
  }

  // Android-specific purchase logic (completely separated from iOS)
  private async makePurchaseAndroid(productId: string): Promise<HeliumPurchaseResult> {
    if (productId.includes(':')) {
      const {baseProductId, basePlanId, offerId} = this.parseAndroidProductId(productId);

      const subscriptionOption = await this.findAndroidSubscriptionOption(
        productId,
        baseProductId,
        basePlanId,
        offerId
      );

      if (subscriptionOption) {
        try {
          const customerInfo = (await Purchases.purchaseSubscriptionOption(subscriptionOption)).customerInfo;

          const isActive = this.isProductActive(customerInfo, baseProductId);
          if (isActive) {
            return {status: 'purchased'};
          } else {
            return {
              status: 'failed',
              error: 'Purchase possibly complete but entitlement/subscription not active for this product.'
            };
          }
        } catch (error) {
          const purchasesError = error as PurchasesError;

          if (purchasesError?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
            return {status: 'pending'};
          }

          if (purchasesError?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
            return {status: 'cancelled'};
          }

          return {status: 'failed', error: purchasesError?.message || 'RevenueCat purchase failed.'};
        }
      }
    }

    const parentProductId = productId.includes(':') ? productId.split(':')[0] : productId;
    let rcProduct: PurchasesStoreProduct | undefined = this.androidInAppCache[parentProductId];

    if (!rcProduct) {
      try {
        const products = await Purchases.getProducts([parentProductId]);
        if (products.length === 0) {
          return {status: 'failed', error: `Android product not found: ${parentProductId}`};
        }
        rcProduct = products[0];
      } catch {
        return {status: 'failed', error: `Failed to retrieve Android product: ${parentProductId}`};
      }

      this.androidInAppCache[parentProductId] = rcProduct;
    }

    try {
      const customerInfo = (await Purchases.purchaseStoreProduct(rcProduct)).customerInfo;

      const isActive = this.isProductActive(customerInfo, parentProductId);
      if (isActive) {
        return {status: 'purchased'};
      } else {
        return {
          status: 'failed',
          error: 'Purchase possibly complete but entitlement/subscription not active for this product.'
        };
      }
    } catch (error) {
      const purchasesError = error as PurchasesError;

      if (purchasesError?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
        return {status: 'pending'};
      }

      if (purchasesError?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
        return {status: 'cancelled'};
      }

      return {status: 'failed', error: purchasesError?.message || 'RevenueCat purchase failed.'};
    }
  }

  // Helper function to check if a product is active in CustomerInfo
  private isProductActive(customerInfo: CustomerInfo, productId: string): boolean {
    return Object.values(customerInfo.entitlements.active).some((entitlement: PurchasesEntitlementInfo) => entitlement.productIdentifier === productId)
      || customerInfo.activeSubscriptions.includes(productId)
      || customerInfo.allPurchasedProductIdentifiers.includes(productId);
  }

  async restorePurchases(): Promise<boolean> {
    try {
      const customerInfo = await Purchases.restorePurchases();
      const isActive = Object.keys(customerInfo.entitlements.active).length > 0;
      return isActive;
    } catch (error) {
      return false;
    }
  }
}

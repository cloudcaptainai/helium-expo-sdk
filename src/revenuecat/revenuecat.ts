import type {PurchasesError, PurchasesPackage, SubscriptionOption} from 'react-native-purchases';
import Purchases, {PURCHASES_ERROR_CODE, PurchasesStoreProduct} from 'react-native-purchases';
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
      if (pkg) {
        await Purchases.purchasePackage(pkg);
      } else if (rcProduct) {
        await Purchases.purchaseStoreProduct(rcProduct);
      } else {
        return {status: 'failed', error: `RevenueCat Product/Package not found for ID: ${productId}`};
      }
      return {status: 'purchased'};
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
          await Purchases.purchaseSubscriptionOption(subscriptionOption);
          return {status: 'purchased'};
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

    // Handle one-time purchase or subscription that didn't have matching base plan / offer
    let rcProduct: PurchasesStoreProduct;
    try {
      const products = await Purchases.getProducts([productId]);
      if (products.length === 0) {
        return {status: 'failed', error: `Android product not found: ${productId}`};
      }
      rcProduct = products[0];
    } catch {
      return {status: 'failed', error: `Failed to retrieve Android product: ${productId}`};
    }

    try {
      await Purchases.purchaseStoreProduct(rcProduct);
      return {status: 'purchased'};
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
      for (const product of products) {
        if (!product.subscriptionOptions || product.subscriptionOptions.length === 0) {
          return undefined;
        }

        let subscriptionOption: SubscriptionOption | undefined;

        if (offerId && basePlanId) {
          // Look for specific offer: "basePlanId:offerId"
          const targetId = `${basePlanId}:${offerId}`;
          subscriptionOption = product.subscriptionOptions.find(opt => opt.id === targetId);
        }
        if (!subscriptionOption && basePlanId) {
          // Otherwise the RC option id will simply be base plan id
          subscriptionOption = product.subscriptionOptions.find(
            opt => opt.id === basePlanId
          );
        }

        if (subscriptionOption) {
          return subscriptionOption;
        }
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
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

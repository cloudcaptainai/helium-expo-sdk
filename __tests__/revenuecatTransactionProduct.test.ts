/**
 * A same-group plan change on iOS can make RevenueCat return the existing transaction for a
 * different product than the one tapped. The purchase result must pair that transaction with
 * its own product so the native SDK doesn't attribute it to the tapped one.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../src/index', () => ({ setRevenueCatAppUserId: jest.fn() }));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    isConfigured: jest.fn(async () => true),
    configure: jest.fn(),
    getAppUserID: jest.fn(async () => 'rc_user'),
    getProducts: jest.fn(async (ids: string[]) => ids.map(identifier => ({ identifier }))),
    purchaseStoreProduct: jest.fn(),
  },
  PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION', SUBSCRIPTION: 'SUBSCRIPTION' },
  PURCHASES_ERROR_CODE: {},
}));

import Purchases from 'react-native-purchases';
import { createRevenueCatPurchaseConfig } from '../src/revenuecat';

const customerInfo = {
  entitlements: { active: {} },
  activeSubscriptions: ['annual'],
  allPurchasedProductIdentifiers: ['annual'],
};

function purchaseReturns(transaction: { transactionIdentifier: string; productIdentifier: string } | null) {
  (Purchases.purchaseStoreProduct as jest.Mock).mockResolvedValue({ customerInfo, transaction });
}

describe('RevenueCat iOS purchase result', () => {
  it('reports the transaction product when RevenueCat returns a transaction for another product', async () => {
    purchaseReturns({ transactionIdentifier: 'txn_annual', productIdentifier: 'annual' });

    const result = await createRevenueCatPurchaseConfig().makePurchaseIOS!('monthly');

    expect(result).toEqual({ status: 'purchased', transactionId: 'txn_annual', productId: 'annual' });
  });

  it('reports the tapped product when RevenueCat returns no transaction', async () => {
    purchaseReturns(null);

    const result = await createRevenueCatPurchaseConfig().makePurchaseIOS!('monthly');

    expect(result).toEqual({ status: 'purchased', transactionId: undefined, productId: 'monthly' });
  });
});

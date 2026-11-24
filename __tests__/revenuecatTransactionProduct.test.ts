/**
 * A same-group plan change on iOS that takes effect at renewal makes RevenueCat hand back the
 * existing transaction, which can belong to another product. Only a transaction made during this
 * purchase may be reported, paired with its own product.
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
import { createRevenueCatPurchaseConfig, transactionIdMadeSince } from '../src/revenuecat';

const tappedAtMs = Date.parse('2026-01-10T12:00:00.400Z');

const customerInfo = {
  entitlements: { active: {} },
  activeSubscriptions: ['annual'],
  allPurchasedProductIdentifiers: ['annual'],
};

function purchaseReturns(
  transaction: { transactionIdentifier: string; productIdentifier: string; purchaseDate: string } | null,
) {
  (Purchases.purchaseStoreProduct as jest.Mock).mockResolvedValue({ customerInfo, transaction });
}

describe('RevenueCat iOS purchase result', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(tappedAtMs);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a transaction made during the purchase with its own product', async () => {
    purchaseReturns({ transactionIdentifier: 'txn_annual', productIdentifier: 'annual', purchaseDate: '2026-01-10T12:00:05Z' });

    const result = await createRevenueCatPurchaseConfig().makePurchaseIOS!('monthly');

    expect(result).toEqual({ status: 'purchased', transactionId: 'txn_annual', productId: 'annual' });
  });

  it('leaves out an existing transaction returned by a deferred plan change', async () => {
    purchaseReturns({ transactionIdentifier: 'txn_annual', productIdentifier: 'annual', purchaseDate: '2025-12-01T09:30:00Z' });

    const result = await createRevenueCatPurchaseConfig().makePurchaseIOS!('monthly');

    expect(result).toEqual({ status: 'purchased', transactionId: undefined, productId: 'monthly' });
  });

  it('reports the tapped product when RevenueCat returns no transaction', async () => {
    purchaseReturns(null);

    const result = await createRevenueCatPurchaseConfig().makePurchaseIOS!('monthly');

    expect(result).toEqual({ status: 'purchased', transactionId: undefined, productId: 'monthly' });
  });
});

describe('transactionIdMadeSince', () => {
  it('keeps a transaction dated in the same second as the tap', () => {
    expect(transactionIdMadeSince({ transactionIdentifier: 'txn_1', purchaseDate: '2026-01-10T12:00:00Z' }, tappedAtMs)).toBe('txn_1');
  });

  it('leaves out a transaction without a readable date', () => {
    expect(transactionIdMadeSince({ transactionIdentifier: 'txn_1', purchaseDate: '' }, tappedAtMs)).toBeUndefined();
  });
});

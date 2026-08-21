import Purchases, {PURCHASES_ERROR_CODE} from 'react-native-purchases';
import type {CustomerInfo} from 'react-native-purchases';
import {createRevenueCatPurchaseConfig} from '../src/revenuecat/revenuecat';

jest.mock('../src/index', () => ({
  setRevenueCatAppUserId: jest.fn(),
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    isConfigured: jest.fn(),
    configure: jest.fn(),
    getAppUserID: jest.fn(),
    getProducts: jest.fn(),
    purchaseProduct: jest.fn(),
    purchaseStoreProduct: jest.fn(),
    purchaseSubscriptionOption: jest.fn(),
    restorePurchases: jest.fn(),
  },
  PURCHASE_TYPE: {
    INAPP: 'inapp',
    SUBS: 'subs',
  },
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: '1',
    STORE_PROBLEM_ERROR: '2',
    PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
    MISSING_RECEIPT_FILE_ERROR: '9',
    NETWORK_ERROR: '10',
    UNKNOWN_BACKEND_ERROR: '16',
    PAYMENT_PENDING_ERROR: '20',
  },
}));

const mockPurchases = jest.mocked(Purchases);

const activeCustomerInfo = (productId: string) =>
  ({
    entitlements: {active: {premium: {productIdentifier: productId}}},
    activeSubscriptions: [productId],
    allPurchasedProductIdentifiers: [productId],
  }) as unknown as CustomerInfo;

const purchaseResult = (productId: string, transactionId?: string) =>
  ({
    customerInfo: activeCustomerInfo(productId),
    transaction: transactionId ? {transactionIdentifier: transactionId} : undefined,
  }) as never;

const rcError = (code: string, underlyingErrorMessage?: string) =>
  Object.assign(new Error('rc failure'), {code, underlyingErrorMessage});

beforeEach(() => {
  jest.clearAllMocks();
  mockPurchases.isConfigured.mockResolvedValue(false);
  mockPurchases.getAppUserID.mockResolvedValue('rc-user');
});

afterEach(() => {
  expect(mockPurchases.getProducts).not.toHaveBeenCalled();
  jest.useRealTimers();
});

describe('makePurchaseAndroid subscriptions', () => {
  it('purchases the base plan option when no offer id is given', async () => {
    mockPurchases.purchaseSubscriptionOption.mockResolvedValue(purchaseResult('pro'));
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('pro', 'monthly', undefined, 'subs');

    expect(mockPurchases.purchaseSubscriptionOption).toHaveBeenCalledWith({
      productId: 'pro',
      id: 'monthly',
    });
    expect(result).toEqual({status: 'purchased', transactionId: undefined, productId: 'pro'});
  });

  it('composes basePlanId:offerId when an offer id is given', async () => {
    mockPurchases.purchaseSubscriptionOption.mockResolvedValue(purchaseResult('pro'));
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('pro', 'monthly', 'freetrial', 'subs');

    expect(mockPurchases.purchaseSubscriptionOption).toHaveBeenCalledWith({
      productId: 'pro',
      id: 'monthly:freetrial',
    });
    expect(result.status).toBe('purchased');
  });

  it('fails without calling RevenueCat when the subscription has no base plan id', async () => {
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('annual_3', undefined, undefined, 'subs');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('annual_3');
    expect(result.error).toContain('no base plan id');
    expect(mockPurchases.purchaseSubscriptionOption).not.toHaveBeenCalled();
    expect(mockPurchases.purchaseProduct).not.toHaveBeenCalled();
  });
});

describe('makePurchaseAndroid one-time products', () => {
  it('purchases by id with the one-time product type', async () => {
    mockPurchases.purchaseProduct.mockResolvedValue(purchaseResult('coins_100'));
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('coins_100', undefined, undefined, 'inapp');

    expect(mockPurchases.purchaseProduct).toHaveBeenCalledWith('coins_100', null, 'inapp');
    expect(mockPurchases.purchaseSubscriptionOption).not.toHaveBeenCalled();
    expect(result).toEqual({status: 'purchased', transactionId: undefined, productId: 'coins_100'});
  });

  it('ignores a one-time offer id, which RevenueCat cannot target', async () => {
    mockPurchases.purchaseProduct.mockResolvedValue(purchaseResult('coins_100'));
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('coins_100', undefined, 'launch_deal', 'inapp');

    expect(mockPurchases.purchaseProduct).toHaveBeenCalledWith('coins_100', null, 'inapp');
    expect(result.status).toBe('purchased');
  });
});

describe('purchase failures', () => {
  it('retries once after a transient store error and succeeds', async () => {
    jest.useFakeTimers();
    mockPurchases.purchaseSubscriptionOption
      .mockRejectedValueOnce(rcError(PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR))
      .mockResolvedValueOnce(purchaseResult('pro'));
    const config = createRevenueCatPurchaseConfig();

    const resultPromise = config.makePurchaseAndroid!('pro', 'monthly', undefined, 'subs');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockPurchases.purchaseSubscriptionOption).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('purchased');
  });

  it('does not retry when the option is not available for purchase', async () => {
    jest.useFakeTimers();
    mockPurchases.purchaseSubscriptionOption.mockRejectedValue(
      rcError(PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR, "Couldn't find product.")
    );
    const config = createRevenueCatPurchaseConfig();

    const resultPromise = config.makePurchaseAndroid!('pro', 'monthly', 'gone', 'subs');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockPurchases.purchaseSubscriptionOption).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('code: 5');
    expect(result.error).toContain("Couldn't find product.");
  });

  it('maps a cancellation to cancelled without retrying', async () => {
    mockPurchases.purchaseSubscriptionOption.mockRejectedValue(
      rcError(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)
    );
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('pro', 'monthly', undefined, 'subs');

    expect(result.status).toBe('cancelled');
    expect(mockPurchases.purchaseSubscriptionOption).toHaveBeenCalledTimes(1);
  });

  it('maps a payment pending error to pending without retrying', async () => {
    mockPurchases.purchaseProduct.mockRejectedValue(
      rcError(PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR)
    );
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseAndroid!('coins_100', undefined, undefined, 'inapp');

    expect(result.status).toBe('pending');
    expect(mockPurchases.purchaseProduct).toHaveBeenCalledTimes(1);
  });
});

describe('makePurchaseIOS', () => {
  it('purchases by id and returns the transaction id', async () => {
    mockPurchases.purchaseProduct.mockResolvedValue(purchaseResult('pro_monthly', 'txn-1'));
    const config = createRevenueCatPurchaseConfig();

    const result = await config.makePurchaseIOS!('pro_monthly');

    expect(mockPurchases.purchaseProduct).toHaveBeenCalledWith('pro_monthly');
    expect(result).toEqual({
      status: 'purchased',
      transactionId: 'txn-1',
      productId: 'pro_monthly',
    });
  });
});

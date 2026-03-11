import { Platform } from 'react-native';
import { _setupCore, initialize, setCustomUserId } from 'expo-helium';
import HeliumStripeSdkModule from './HeliumStripeSdkModule';
import type { StripeHeliumConfig } from './HeliumStripeSdk.types';

export type { StripeHeliumConfig } from './HeliumStripeSdk.types';

export async function initializeWithStripe(config: StripeHeliumConfig): Promise<void> {
    if (Platform.OS !== 'ios') {
        console.log('[HeliumStripe] Stripe One Tap is only available on iOS. Using standard initialization.');
        return initialize(config);
    }

    const requiredFields = ['stripePublishableKey', 'merchantIdentifier', 'merchantName', 'managementURL'] as const;
    const missingFields = requiredFields.filter((field) => !config[field]);
    if (missingFields.length > 0) {
        console.warn(`[HeliumStripe] Missing required Stripe config fields: ${missingFields.join(', ')}. Using standard initialization.`);
        return initialize(config);
    }

    await _setupCore(config);

    HeliumStripeSdkModule.initializeStripe({
        apiKey: config.apiKey,
        stripePublishableKey: config.stripePublishableKey,
        merchantIdentifier: config.merchantIdentifier,
        merchantName: config.merchantName,
        managementURL: config.managementURL,
        countryCode: config.countryCode ?? 'US',
        currencyCode: config.currencyCode ?? 'USD',
    });
}

export function setUserIdAndSyncStripeIfNeeded(userId: string): void {
    if (Platform.OS !== 'ios') {
        setCustomUserId(userId);
        return;
    }
    HeliumStripeSdkModule.setUserIdAndSyncStripeIfNeeded(userId);
}

export function resetStripeEntitlements(clearUserId: boolean = false): void {
    if (Platform.OS !== 'ios') {
        console.log('[HeliumStripe] resetStripeEntitlements is only available on iOS');
        return;
    }
    HeliumStripeSdkModule.resetStripeEntitlements(clearUserId);
}

export async function createStripePortalSession(returnUrl: string): Promise<string | undefined> {
    if (Platform.OS !== 'ios') {
        console.log('[HeliumStripe] createStripePortalSession is only available on iOS');
        return undefined;
    }
    try {
        return await HeliumStripeSdkModule.createStripePortalSession(returnUrl);
    } catch (error) {
        console.log('[HeliumStripe] could not create Stripe portal session');
        return undefined;
    }
}

export async function hasActiveStripeEntitlement(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
        console.log('[HeliumStripe] hasActiveStripeEntitlement is only available on iOS');
        return false;
    }
    return HeliumStripeSdkModule.hasActiveStripeEntitlement();
}

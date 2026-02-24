import { Platform } from 'react-native';
import { setupCore } from 'expo-helium';
import HeliumStripeSdkModule from './HeliumStripeSdkModule';
import type { StripeHeliumConfig } from './HeliumStripeSdk.types';

export type { StripeHeliumConfig } from './HeliumStripeSdk.types';

export async function initializeWithStripe(config: StripeHeliumConfig): Promise<void> {
    if (Platform.OS !== 'ios') {
        console.log('[HeliumStripe] Stripe One Tap is only available on iOS. Falling back to standard initialization.');
        const { initialize } = require('expo-helium');
        return initialize(config);
    }

    // Step 1: Set up core (JS listeners + native delegate/config, no Helium.shared.initialize())
    await setupCore(config);

    // Step 2: Stripe setup + Helium init (wraps core's delegate as backup)
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
        console.log('[HeliumStripe] setUserIdAndSyncStripeIfNeeded is only available on iOS');
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

export async function createStripePortalSession(returnUrl: string): Promise<string> {
    if (Platform.OS !== 'ios') {
        console.log('[HeliumStripe] createStripePortalSession is only available on iOS');
        throw new Error('[HeliumStripe] Stripe portal sessions are only available on iOS');
    }
    return HeliumStripeSdkModule.createStripePortalSession(returnUrl);
}

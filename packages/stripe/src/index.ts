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
    const missingFields = requiredFields.filter((field) => !config[field]?.trim());
    if (missingFields.length > 0) {
        console.warn(`[HeliumStripe] Missing required Stripe config fields: ${missingFields.join(', ')}. Using standard initialization.`);
        return initialize(config);
    }

    await _setupCore(config);

    try {
        HeliumStripeSdkModule.initializeStripe({
            apiKey: config.apiKey,
            stripePublishableKey: config.stripePublishableKey,
            merchantIdentifier: config.merchantIdentifier,
            merchantName: config.merchantName,
            managementURL: config.managementURL,
            countryCode: config.countryCode ?? 'US',
            currencyCode: config.currencyCode ?? 'USD',
        });
    } catch (error) {
        console.warn('[HeliumStripe] Failed to initialize Stripe One Tap.', error);
    }
}

export function setUserIdAndSyncStripeIfNeeded(userId: string): void {
    if (Platform.OS !== 'ios') {
        setCustomUserId(userId);
        return;
    }
    HeliumStripeSdkModule.setUserIdAndSyncStripeIfNeeded(userId);
}

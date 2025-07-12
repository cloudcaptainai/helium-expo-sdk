import {
  DelegateActionEvent,
  HeliumConfig,
  HeliumPaywallEvent,
  NativeHeliumConfig,
} from "./HeliumPaywallSdk.types";
import HeliumPaywallSdkModule from "./HeliumPaywallSdkModule";
import { EventSubscription } from 'expo-modules-core';

export { default } from './HeliumPaywallSdkModule';
// export { default as HeliumPaywallSdkView } from './HeliumPaywallSdkView';
export * from  './HeliumPaywallSdk.types';

function addHeliumPaywallEventListener(listener: (event: HeliumPaywallEvent) => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('onHeliumPaywallEvent', listener);
}

function addDelegateActionEventListener(listener: (event: DelegateActionEvent) => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('onDelegateActionEvent', listener);
}

let isInitialized = false;
export const initialize = (config: HeliumConfig) => {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  HeliumPaywallSdkModule.removeAllListeners('onHeliumPaywallEvent');
  HeliumPaywallSdkModule.removeAllListeners('onDelegateActionEvent');

  // Set up listener for paywall events
  addHeliumPaywallEventListener((event) => {
    config.onHeliumPaywallEvent(event);
  });

  // Set up delegate action listener for purchase and restore operations
  addDelegateActionEventListener(async (event) => {
    try {
      if (event.type === 'purchase') {
        if (event.productId) {
          const result = await config.purchaseConfig.makePurchase(event.productId);
          HeliumPaywallSdkModule.handlePurchaseResult(result.status);
        } else {
          HeliumPaywallSdkModule.handlePurchaseResult('failed');
        }
      }
      else if (event.type === 'restore') {
        const success = await config.purchaseConfig.restorePurchases();
        HeliumPaywallSdkModule.handleRestoreResult(success);
      }
    } catch (error) {
      // Send failure result based on action type
      if (event.type === 'purchase') {
        HeliumPaywallSdkModule.handlePurchaseResult('failed');
      } else if (event.type === 'restore') {
        HeliumPaywallSdkModule.handleRestoreResult(false);
      }
    }
  });

  // Create native config object
  const nativeConfig: NativeHeliumConfig = {
    apiKey: config.apiKey,
    customUserId: config.customUserId,
    customAPIEndpoint: config.customAPIEndpoint,
    customUserTraits: config.customUserTraits,
    revenueCatAppUserId: config.revenueCatAppUserId
  };

  // Initialize the native module
  HeliumPaywallSdkModule.initialize(nativeConfig);
};

export const presentUpsell = (triggerName: string, onFallback?: () => void) => {
  // todo check HeliumBridge.getFetchedTriggerNames((triggerNames: string[]) ??
  const downloadStatus = getDownloadStatus();
  if (downloadStatus !== 'downloadSuccess') {
    console.log(
      `Helium trigger "${triggerName}" not found or download status not successful. Status:`,
      downloadStatus
    );
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
    return;
  }

  try {
    HeliumPaywallSdkModule.presentUpsell(triggerName);
  } catch (error) {
    console.log('Helium present error', error);
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
  }
};

export const hideUpsell = HeliumPaywallSdkModule.hideUpsell;
export const hideAllUpsells = HeliumPaywallSdkModule.hideAllUpsells;
export const getDownloadStatus = HeliumPaywallSdkModule.getDownloadStatus;

export {createCustomPurchaseConfig} from './HeliumPaywallSdk.types';

export type {
  HeliumTransactionStatus,
  HeliumConfig,
  HELIUM_CTA_NAMES
} from './HeliumPaywallSdk.types';

import {
  DelegateActionEvent,
  HeliumConfig,
  HeliumPaywallEvent,
  NativeHeliumConfig, 
  PaywallInfo,
  PaywallEventHandlers,
  TypedPaywallEvent,
} from "./HeliumPaywallSdk.types";
import HeliumPaywallSdkModule from "./HeliumPaywallSdkModule";
import { EventSubscription } from 'expo-modules-core';
import * as ExpoFileSystem from 'expo-file-system';

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
          HeliumPaywallSdkModule.handlePurchaseResult(result.status, result.error);
        } else {
          HeliumPaywallSdkModule.handlePurchaseResult('failed', 'No product ID for purchase event.');
        }
      }
      else if (event.type === 'restore') {
        const success = await config.purchaseConfig.restorePurchases();
        HeliumPaywallSdkModule.handleRestoreResult(success);
      }
    } catch (error) {
      // Send failure result based on action type
      if (event.type === 'purchase') {
        console.log('[Helium] Unexpected error: ', error);
        HeliumPaywallSdkModule.handlePurchaseResult('failed');
      } else if (event.type === 'restore') {
        HeliumPaywallSdkModule.handleRestoreResult(false);
      }
    }
  });

  nativeInitializeAsync(config).catch(error => {
    console.error('[Helium] Initialization failed:', error);
  });
};

const nativeInitializeAsync = async (config: HeliumConfig) => {
  let fallbackBundleUrlString;
  let fallbackBundleString;
  
  // Handle fallback bundle - either from new fallbackConfig or deprecated fallbackBundle
  const fallbackBundle = config.fallbackConfig?.fallbackBundle || config.fallbackBundle;
  
  if (fallbackBundle) {
    try {
      const jsonContent = JSON.stringify(fallbackBundle);

      // Write to documents directory
      fallbackBundleUrlString = `${ExpoFileSystem.documentDirectory}helium-fallback.json`;
      // This is ASYNC but that's ok because helium initialize in swift code is async anyways.
      await ExpoFileSystem.writeAsStringAsync(
        fallbackBundleUrlString,
        jsonContent
      );
    } catch (error) {
      // Fallback to string approach if unexpected error occurs
      console.log(
        '[Helium] expo-file-system not available, attempting to pass fallback bundle as string.'
      );
      fallbackBundleString = JSON.stringify(fallbackBundle);
    }
  }

  // Create native config object with fallback configuration
  const nativeConfig: NativeHeliumConfig = {
    apiKey: config.apiKey,
    customUserId: config.customUserId,
    customAPIEndpoint: config.customAPIEndpoint,
    customUserTraits: config.customUserTraits,
    revenueCatAppUserId: config.revenueCatAppUserId,
    fallbackBundleUrlString: fallbackBundleUrlString,
    fallbackBundleString: fallbackBundleString,
    // Pass fallback config parameters
    useLoadingState: config.fallbackConfig?.useLoadingState,
    loadingBudget: config.fallbackConfig?.loadingBudget,
    perTriggerLoadingConfig: config.fallbackConfig?.perTriggerLoadingConfig,
  };

  // Initialize the native module
  HeliumPaywallSdkModule.initialize(nativeConfig);
};

export const presentUpsell = ({
                                triggerName,
                                onFallback,
                                eventHandlers,
                                customPaywallTraits
                              }: {
  triggerName: string;
  onFallback?: () => void;
  eventHandlers?: PaywallEventHandlers;
  customPaywallTraits?: Record<string, any>;
}) => {
  const { canPresent, reason } = HeliumPaywallSdkModule.canPresentUpsell(triggerName);

  if (!canPresent) {
    console.log(
      `[Helium] Cannot present trigger "${triggerName}". Reason: ${reason}`
    );
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
    return;
  }

  try {
    if (eventHandlers || customPaywallTraits) {
      // Convert event handlers to a format the native module expects
      const nativeEventHandlers = eventHandlers ? {
        onOpen: eventHandlers.onOpen ? true : undefined,
        onClose: eventHandlers.onClose ? true : undefined,
        onDismissed: eventHandlers.onDismissed ? true : undefined,
        onPurchaseSucceeded: eventHandlers.onPurchaseSucceeded ? true : undefined,
      } : undefined;
      
      HeliumPaywallSdkModule.presentUpsellWithHandlers(
        triggerName,
        nativeEventHandlers,
        customPaywallTraits
      );
      
      // Set up JS-side event handler routing
      if (eventHandlers) {
        const eventListener = addHeliumPaywallEventListener((event) => {
          // Route typed events to appropriate handlers
          switch (event.type) {
            case 'paywall_open':
              eventHandlers.onOpen?.(event as any);
              break;
            case 'paywall_close':
              eventHandlers.onClose?.(event as any);
              // Clean up listener after close
              eventListener.remove();
              break;
            case 'paywall_dismissed':
              eventHandlers.onDismissed?.(event as any);
              break;
            case 'purchase_succeeded':
              eventHandlers.onPurchaseSucceeded?.(event as any);
              break;
          }
        });
      }
    } else {
      HeliumPaywallSdkModule.presentUpsell(triggerName);
    }
  } catch (error) {
    console.log('Helium present error', error);
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
  }
};

export const hideUpsell = HeliumPaywallSdkModule.hideUpsell;
export const hideAllUpsells = HeliumPaywallSdkModule.hideAllUpsells;
export const getDownloadStatus = HeliumPaywallSdkModule.getDownloadStatus;

export const getPaywallInfo = (trigger: string): PaywallInfo | undefined => {
  const result = HeliumPaywallSdkModule.getPaywallInfo(trigger);
  if (!result) {
    console.log('[Helium] getPaywallInfo unexpected error.');
    return;
  }
  if (result.errorMsg) {
    console.log(`[Helium] ${result.errorMsg}`);
    return;
  }
  return {
    paywallTemplateName: result.templateName ?? 'unknown template',
    shouldShow: result.shouldShow ?? true,
  };
};

export const handleDeepLink = (url: string | null) => {
  if (url) {
    const handled = HeliumPaywallSdkModule.handleDeepLink(url);
    console.log('[Helium] Handled deep link:', handled);
    return handled;
  }
  return false;
};

export {createCustomPurchaseConfig, HELIUM_CTA_NAMES} from './HeliumPaywallSdk.types';

export type {
  HeliumTransactionStatus,
  HeliumConfig,
} from './HeliumPaywallSdk.types';

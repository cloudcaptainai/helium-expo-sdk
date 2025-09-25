import {
  DelegateActionEvent,
  HeliumConfig,
  HeliumPaywallEvent,
  NativeHeliumConfig, PaywallEventHandlers, PaywallInfo, PresentUpsellParams,
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

function addPaywallEventHandlersListener(listener: (event: HeliumPaywallEvent) => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('paywallEventHandlers', listener);
}

let isInitialized = false;
export const initialize = (config: HeliumConfig) => {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  HeliumPaywallSdkModule.removeAllListeners('onHeliumPaywallEvent');
  HeliumPaywallSdkModule.removeAllListeners('onDelegateActionEvent');
  HeliumPaywallSdkModule.removeAllListeners('paywallEventHandlers');

  // Set up listener for paywall events
  addHeliumPaywallEventListener((event) => {
    handlePaywallEvent(event);
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

  addPaywallEventHandlersListener((event) => {
    callPaywallEventHandlers(event);
  });

  nativeInitializeAsync(config).catch(error => {
    console.error('[Helium] Initialization failed:', error);
  });
};

const nativeInitializeAsync = async (config: HeliumConfig) => {
  let fallbackBundleUrlString;
  let fallbackBundleString;
  if (config.fallbackBundle) {
    try {
      const jsonContent = JSON.stringify(config.fallbackBundle);

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
      fallbackBundleString = JSON.stringify(config.fallbackBundle);
    }
  }


  // Create native config object
  const nativeConfig: NativeHeliumConfig = {
    apiKey: config.apiKey,
    customUserId: config.customUserId,
    customAPIEndpoint: config.customAPIEndpoint,
    customUserTraits: config.customUserTraits,
    revenueCatAppUserId: config.revenueCatAppUserId,
    fallbackBundleUrlString: fallbackBundleUrlString,
    fallbackBundleString: fallbackBundleString,
    paywallLoadingConfig: config.paywallLoadingConfig,
  };

  // Initialize the native module
  HeliumPaywallSdkModule.initialize(nativeConfig);
};

let paywallEventHandlers: PaywallEventHandlers | undefined;
let presentOnFallback: (() => void) | undefined;
export const presentUpsell = ({
                                triggerName,
                                onFallback,
                                eventHandlers,
                                customPaywallTraits,
                              }: PresentUpsellParams) => {
  const {canPresent, reason} = HeliumPaywallSdkModule.canPresentUpsell(triggerName);

  if (!canPresent) {
    console.log(
      `[Helium] Cannot present trigger "${triggerName}". Reason: ${reason}`
    );
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
    return;
  }

  try {
    paywallEventHandlers = eventHandlers;
    presentOnFallback = onFallback;
    HeliumPaywallSdkModule.presentUpsell(triggerName, customPaywallTraits);
  } catch (error) {
    console.log('Helium present error', error);
    paywallEventHandlers = undefined;
    presentOnFallback = undefined;
    onFallback?.();
    HeliumPaywallSdkModule.fallbackOpenOrCloseEvent(triggerName, true, 'presented');
  }
};

function callPaywallEventHandlers(event: HeliumPaywallEvent) {
  if (paywallEventHandlers) {
    switch (event.type) {
      case 'paywallOpen':
        paywallEventHandlers?.onOpen?.({
          type: 'paywallOpen',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
          viewType: 'presented',
        });
        break;
      case 'paywallClose':
        paywallEventHandlers?.onClose?.({
          type: 'paywallClose',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
        });
        if (!event.isSecondTry) {
          paywallEventHandlers = undefined;
        }
        presentOnFallback = undefined;
        break;
      case 'paywallDismissed':
        paywallEventHandlers?.onDismissed?.({
          type: 'paywallDismissed',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
      case 'purchaseSucceeded':
        paywallEventHandlers?.onPurchaseSucceeded?.({
          type: 'purchaseSucceeded',
          productId: event.productId ?? 'unknown',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
    }
  }
}

function handlePaywallEvent(event: HeliumPaywallEvent) {
  switch (event.type) {
    case 'paywallSkipped':
      paywallEventHandlers = undefined;
      presentOnFallback = undefined;
      break;
    case 'paywallOpenFailed':
      paywallEventHandlers = undefined;
      presentOnFallback?.();
      presentOnFallback = undefined;
      break;
  }
}

export const hideUpsell = HeliumPaywallSdkModule.hideUpsell;
export const hideAllUpsells = HeliumPaywallSdkModule.hideAllUpsells;
export const getDownloadStatus = HeliumPaywallSdkModule.getDownloadStatus;
export const setRevenueCatAppUserId = HeliumPaywallSdkModule.setRevenueCatAppUserId;

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

import {
  DelegateActionEvent,
  HeliumConfig,
  HeliumPaywallEvent,
  NativeHeliumConfig, PaywallEventHandlers, PaywallInfo, PresentUpsellParams,
} from "./HeliumPaywallSdk.types";
import { ExperimentInfo } from "./HeliumExperimentInfo.types";
import HeliumPaywallSdkModule from "./HeliumPaywallSdkModule";
import { EventSubscription } from 'expo-modules-core';
import * as ExpoFileSystem from 'expo-file-system';

export { default } from './HeliumPaywallSdkModule';
// export { default as HeliumPaywallSdkView } from './HeliumPaywallSdkView';
export * from  './HeliumPaywallSdk.types';
export * from './HeliumExperimentInfo.types';

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
  const purchaseConfig = config.purchaseConfig;
  if (purchaseConfig) {
    addDelegateActionEventListener(async (event) => {
      try {
        if (event.type === 'purchase') {
          if (event.productId) {
            const result = await purchaseConfig.makePurchase(event.productId);
            HeliumPaywallSdkModule.handlePurchaseResult(result.status, result.error);
          } else {
            HeliumPaywallSdkModule.handlePurchaseResult('failed', 'No product ID for purchase event.');
          }
        } else if (event.type === 'restore') {
          const success = await purchaseConfig.restorePurchases();
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
  }

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
    customUserTraits: convertBooleansToMarkers(config.customUserTraits),
    revenueCatAppUserId: config.revenueCatAppUserId,
    fallbackBundleUrlString: fallbackBundleUrlString,
    fallbackBundleString: fallbackBundleString,
    paywallLoadingConfig: convertBooleansToMarkers(config.paywallLoadingConfig),
    useDefaultDelegate: !config.purchaseConfig,
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
    HeliumPaywallSdkModule.presentUpsell(triggerName, convertBooleansToMarkers(customPaywallTraits));
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
    case 'paywallClose':
      if (!event.isSecondTry) {
        paywallEventHandlers = undefined;
      }
      presentOnFallback = undefined;
      break;
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

/**
 * Checks if the user has any active subscription (including non-renewable)
 */
export const hasAnyActiveSubscription = HeliumPaywallSdkModule.hasAnyActiveSubscription;

/**
 * Checks if the user has any entitlement
 */
export const hasAnyEntitlement = HeliumPaywallSdkModule.hasAnyEntitlement;

/**
 * Reset Helium entirely so you can call initialize again. Only for advanced use cases.
 */
export const resetHelium = HeliumPaywallSdkModule.resetHelium;

/**
 * Set custom strings to show in the dialog that Helium will display if a "Restore Purchases" action is not successful.
 * Note that these strings will not be localized by Helium for you.
 */
export const setCustomRestoreFailedStrings = HeliumPaywallSdkModule.setCustomRestoreFailedStrings;

/**
 * Disable the default dialog that Helium will display if a "Restore Purchases" action is not successful.
 * You can handle this yourself if desired by listening for the PurchaseRestoreFailedEvent.
 */
export const disableRestoreFailedDialog = HeliumPaywallSdkModule.disableRestoreFailedDialog;

/**
 * Get experiment allocation info for a specific trigger
 *
 * @param trigger The trigger name to get experiment info for
 * @returns ExperimentInfo if the trigger has experiment data, undefined otherwise
 */
export const getExperimentInfoForTrigger = (trigger: string): ExperimentInfo | undefined => {
  const result = HeliumPaywallSdkModule.getExperimentInfoForTrigger(trigger);
  return result ?? undefined;
};

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

/**
 * Recursively converts boolean values to special marker strings to preserve
 * type information when passing through native bridge.
 *
 * Native bridge converts booleans to NSNumber (0/1), making them
 * indistinguishable from actual numeric values. This helper converts:
 * - true -> "__helium_rn_bool_true__"
 * - false -> "__helium_rn_bool_false__"
 * - All other values remain unchanged
 */
function convertBooleansToMarkers(input: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!input) return undefined;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = convertValueBooleansToMarkers(value);
  }
  return result;
}
/**
 * Helper to recursively convert booleans in any value type
 */
function convertValueBooleansToMarkers(value: any): any {
  if (typeof value === 'boolean') {
    return value ? "__helium_rn_bool_true__" : "__helium_rn_bool_false__";
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    return convertBooleansToMarkers(value);
  } else if (value && Array.isArray(value)) {
    return value.map(convertValueBooleansToMarkers);
  }
  return value;
}

export {createCustomPurchaseConfig, HELIUM_CTA_NAMES} from './HeliumPaywallSdk.types';

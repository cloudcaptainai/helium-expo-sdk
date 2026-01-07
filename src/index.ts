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
import { Platform } from 'react-native';

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
export const initialize = async (config: HeliumConfig) => {
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
    config.onHeliumPaywallEvent?.(event);
  });

  // Set up delegate action listener for purchase and restore operations
  const purchaseConfig = config.purchaseConfig;
  if (purchaseConfig) {
    addDelegateActionEventListener(async (event) => {
      try {
        if (event.type === 'purchase') {
          if (!event.productId) {
            HeliumPaywallSdkModule.handlePurchaseResult('failed', 'No product ID for purchase event.');
            return;
          }

          let result;

          // Platform-specific purchase handling
          if (Platform.OS === 'ios') {
            // iOS: Use makePurchaseIOS if available, otherwise use deprecated makePurchase
            if (purchaseConfig.makePurchaseIOS) {
              result = await purchaseConfig.makePurchaseIOS(event.productId);
            } else if (purchaseConfig.makePurchase) {
              result = await purchaseConfig.makePurchase(event.productId);
            } else {
              console.log('[Helium] No iOS purchase handler configured.');
              HeliumPaywallSdkModule.handlePurchaseResult('failed', 'No iOS purchase handler configured.');
              return;
            }
          } else if (Platform.OS === 'android') {
            // Android: Use makePurchaseAndroid if available
            if (purchaseConfig.makePurchaseAndroid) {
              result = await purchaseConfig.makePurchaseAndroid(
                event.productId,
                event.basePlanId,
                event.offerId
              );
            } else {
              console.log('[Helium] No Android purchase handler configured.');
              HeliumPaywallSdkModule.handlePurchaseResult('failed', 'No Android purchase handler configured.');
              return;
            }
          } else {
            HeliumPaywallSdkModule.handlePurchaseResult('failed', 'Unsupported platform.');
            return;
          }

          HeliumPaywallSdkModule.handlePurchaseResult(result.status, result.error);
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

  await nativeInitializeAsync(config).catch(error => {
    console.error('[Helium] Initialization failed:', error);
  });
};

const nativeInitializeAsync = async (config: HeliumConfig) => {
  let fallbackBundleUrlString;
  let fallbackBundleString;
  if (config.fallbackBundle) {
    try {
      const jsonContent = JSON.stringify(config.fallbackBundle);

      // Feature detection: check which expo-file-system API is available
      // Expo 52/53 has documentDirectory + writeAsStringAsync
      // Expo 54+ has File + Paths (new class-based API)
      const hasLegacyApi = typeof ExpoFileSystem.documentDirectory === 'string'
        && typeof ExpoFileSystem.writeAsStringAsync === 'function';
      const hasNewApi = 'File' in ExpoFileSystem && 'Paths' in ExpoFileSystem;

      if (hasLegacyApi) {
        // Expo 52/53 - use legacy API
        fallbackBundleUrlString = `${ExpoFileSystem.documentDirectory}helium-fallback.json`;
        await ExpoFileSystem.writeAsStringAsync(fallbackBundleUrlString, jsonContent);
      } else if (hasNewApi) {
        // Expo 54+ - use new class-based API
        // @ts-ignore - Types may not be available in older Expo versions
        const file = new ExpoFileSystem.File(ExpoFileSystem.Paths.document, 'helium-fallback.json');
        file.create({ overwrite: true });
        file.write(jsonContent);
        fallbackBundleUrlString = file.uri;
      } else {
        throw new Error('No compatible expo-file-system API found');
      }
    } catch (error) {
      // Just use string approach if expo-file-system is unavailable or fails
      console.log(
        '[Helium] expo-file-system not available, passing fallback bundle as string.'
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
    environment: config.environment,
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
                                dontShowIfAlreadyEntitled,
                              }: PresentUpsellParams) => {
  try {
    paywallEventHandlers = eventHandlers;
    presentOnFallback = onFallback;
    HeliumPaywallSdkModule.presentUpsell(triggerName, convertBooleansToMarkers(customPaywallTraits), dontShowIfAlreadyEntitled);
  } catch (error) {
    console.log('[Helium] presentUpsell error', error);
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
      case 'paywallOpenFailed':
        paywallEventHandlers?.onOpenFailed?.({
          type: 'paywallOpenFailed',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          error: event.error ?? 'Unknown error',
          paywallUnavailableReason: event.paywallUnavailableReason,
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
      case 'customPaywallAction':
        paywallEventHandlers?.onCustomPaywallAction?.({
          type: 'customPaywallAction',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          actionName: event.customPaywallActionName ?? 'unknown',
          params: event.customPaywallActionParams ?? {},
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
    }
    paywallEventHandlers?.onAnyEvent?.(event);
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
      const unavailableReason = event.paywallUnavailableReason;
      if (event.triggerName
        && unavailableReason !== "alreadyPresented"
        && unavailableReason !== "secondTryNoMatch") {
        console.log('[Helium] paywall open failed', unavailableReason);
        presentOnFallback?.();
      }
      presentOnFallback = undefined;
      break;
  }
}

export const hideUpsell = HeliumPaywallSdkModule.hideUpsell;
export const hideAllUpsells = HeliumPaywallSdkModule.hideAllUpsells;
export const getDownloadStatus = HeliumPaywallSdkModule.getDownloadStatus;
export const setRevenueCatAppUserId = HeliumPaywallSdkModule.setRevenueCatAppUserId;

/**
 * Set a custom user ID for the current user
 */
export const setCustomUserId = HeliumPaywallSdkModule.setCustomUserId;

/**
 * Checks if the user has an active entitlement for any product attached to the paywall that will show for provided trigger.
 * @param trigger The trigger name to check entitlement for
 * @returns Promise resolving to true if entitled, false if not, or undefined if not known (i.e. the paywall is not downloaded yet)
 */
export const hasEntitlementForPaywall = async (trigger: string): Promise<boolean | undefined> => {
  const result = await HeliumPaywallSdkModule.hasEntitlementForPaywall(trigger);
  return result?.hasEntitlement;
};

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
 * Override the light/dark mode for Helium paywalls
 * @param mode The mode to set: 'light', 'dark', or 'system' (follows device setting)
 */
export const setLightDarkModeOverride = HeliumPaywallSdkModule.setLightDarkModeOverride;

/**
 * Get experiment allocation info for a specific trigger
 *
 * @param trigger The trigger name to get experiment info for
 * @returns ExperimentInfo if the trigger has experiment data, undefined otherwise
 */
export const getExperimentInfoForTrigger = (trigger: string): ExperimentInfo | undefined => {
  const result = HeliumPaywallSdkModule.getExperimentInfoForTrigger(trigger);
  if (!result) {
    console.log('[Helium] getExperimentInfoForTrigger unexpected error.');
    return;
  }
  if (result.getExperimentInfoErrorMsg) {
    console.log(`[Helium] ${result.getExperimentInfoErrorMsg}`);
    return;
  }
  // Validate required field exists before casting
  if (!result.experimentId) {
    console.log('[Helium] getExperimentInfoForTrigger returned data without required experimentId field.');
    return;
  }
  return result as ExperimentInfo;
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

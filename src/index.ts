import {
  DelegateActionEvent,
  HeliumConfig,
  HeliumLogEvent,
  HeliumPaywallEvent,
  NativeHeliumConfig, PaywallEventHandlers, PaywallInfo, PresentUpsellParams,
  ResetHeliumOptions,
  WebCheckoutProcessor,
} from "./HeliumPaywallSdk.types";
import { ExperimentInfo } from "./HeliumExperimentInfo.types";
import HeliumPaywallSdkModule from "./HeliumPaywallSdkModule";
import { EventSubscription } from 'expo-modules-core';
import * as ExpoFileSystem from 'expo-file-system';
import { Platform } from 'react-native';

let SDK_VERSION = 'unknown';
try {
  SDK_VERSION = require('../package.json').version;
} catch {
  // package.json can't be loaded, accept that we won't get wrapper sdk version
}

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

function addHeliumLogEventListener(listener: (event: HeliumLogEvent) => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('onHeliumLogEvent', listener);
}

function addEntitledEventListener(listener: () => void): EventSubscription {
  return HeliumPaywallSdkModule.addListener('onEntitledEvent', listener);
}

let isInitialized = false;

const HELIUM_EVENT_NAMES = [
  'onHeliumPaywallEvent',
  'onDelegateActionEvent',
  'paywallEventHandlers',
  'onHeliumLogEvent',
  'onEntitledEvent',
] as const;

const removeAllHeliumListeners = () => {
  for (const name of HELIUM_EVENT_NAMES) {
    try {
      HeliumPaywallSdkModule.removeAllListeners(name);
    } catch (e) {
      console.warn(`[Helium] Failed to remove listeners for ${name}:`, e);
    }
  }
};

function setupEventListeners(config: HeliumConfig) {
  removeAllHeliumListeners();

  // Set up listener for paywall events
  addHeliumPaywallEventListener((event) => {
    handlePaywallEvent(event);
    try { config.purchaseConfig?.onHeliumEvent?.(event); } catch {}
    try { config.onHeliumPaywallEvent?.(event); } catch {}
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

          HeliumPaywallSdkModule.handlePurchaseResult(
            result.status,
            result.error,
            result.transactionId,
            result.originalTransactionId,
            result.productId ?? event.productId
          );
        } else if (event.type === 'restore') {
          const success = await purchaseConfig.restorePurchases();
          HeliumPaywallSdkModule.handleRestoreResult(success);
        }
      } catch (error) {
        // Send failure result based on action type
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (event.type === 'purchase') {
          console.log('[Helium] Unexpected error: ', error);
          HeliumPaywallSdkModule.handlePurchaseResult('failed', errorMsg);
        } else if (event.type === 'restore') {
          HeliumPaywallSdkModule.handleRestoreResult(false);
        }
      }
    });
  }

  addPaywallEventHandlersListener((event) => {
    callPaywallEventHandlers(event);
  });

  // Set up listener for native SDK logs
  addHeliumLogEventListener((event) => {
    logHeliumEvent(event);
  });

  // Set up listener for onEntitled callback from native presentPaywall
  addEntitledEventListener(() => {
    presentOnEntitled?.();
    presentOnEntitled = undefined;
  });
}

const buildNativeConfig = async (config: HeliumConfig): Promise<NativeHeliumConfig> => {
  let fallbackBundleUrlString;
  let fallbackBundleString;
  if (config.fallbackBundle) {
    try {
      const jsonContent = JSON.stringify(config.fallbackBundle);

      // Feature detection: check which expo-file-system API is available
      // Expo 52/53 has documentDirectory + writeAsStringAsync
      // Expo 54+ has File + Paths (new class-based API)
      // @ts-ignore - documentDirectory only exists in Expo 52/53 types
      const hasLegacyApi = typeof ExpoFileSystem.documentDirectory === 'string'
        && typeof ExpoFileSystem.writeAsStringAsync === 'function';
      const hasNewApi = 'File' in ExpoFileSystem && 'Paths' in ExpoFileSystem;

      if (hasLegacyApi) {
        // Expo 52/53 - use legacy API
        // @ts-ignore - documentDirectory only exists in Expo 52/53 types
        fallbackBundleUrlString = `${ExpoFileSystem.documentDirectory}helium-expo-fallbacks.json`;
        // @ts-ignore - writeAsStringAsync only exists in Expo 52/53 types
        await ExpoFileSystem.writeAsStringAsync(fallbackBundleUrlString, jsonContent);
      } else if (hasNewApi) {
        // Expo 54+ - use new class-based API
        // @ts-ignore - Types may not be available in older Expo versions
        const file = new ExpoFileSystem.File(ExpoFileSystem.Paths.document, 'helium-expo-fallbacks.json');
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

  return {
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
    wrapperSdkVersion: SDK_VERSION,
    delegateType: config.purchaseConfig?._delegateType,
    androidConsumableProductIds: config.androidConsumableProductIds,
  };
};

/**
 * @internal Not part of the public API.
 */
export const _setupCore = async (config: HeliumConfig) => {
  if (isInitialized) {
    return;
  }
  isInitialized = true;
  try {
    setupEventListeners(config);
    const nativeConfig = await buildNativeConfig(config);
    HeliumPaywallSdkModule.setupCore(nativeConfig);
  } catch (error) {
    isInitialized = false;
    removeAllHeliumListeners();
    console.error('[Helium] Setup failed:', error);
  }
};

export const initialize = async (config: HeliumConfig) => {
  if (!config.apiKey) {
    console.error('[Helium] initialize called without an apiKey; aborting.');
    return;
  }
  if (isInitialized) {
    return;
  }
  isInitialized = true;
  try {
    setupEventListeners(config);
    const nativeConfig = await buildNativeConfig(config);
    HeliumPaywallSdkModule.initialize(nativeConfig);
  } catch (error) {
    isInitialized = false;
    removeAllHeliumListeners();
    console.error('[Helium] Initialization failed:', error);
  }
};

let paywallEventHandlers: PaywallEventHandlers | undefined;
let presentOnPaywallUnavailable: (() => void) | undefined;
let presentOnEntitled: (() => void) | undefined;
export const presentUpsell = ({
                                triggerName,
                                eventHandlers,
                                customPaywallTraits,
                                dontShowIfAlreadyEntitled,
                                androidDisableSystemBackNavigation,
                                onEntitled,
                                onPaywallUnavailable,
                              }: PresentUpsellParams) => {
  try {
    paywallEventHandlers = eventHandlers;
    presentOnPaywallUnavailable = onPaywallUnavailable;
    presentOnEntitled = onEntitled;
    HeliumPaywallSdkModule.presentUpsell(triggerName, convertBooleansToMarkers(customPaywallTraits), dontShowIfAlreadyEntitled, androidDisableSystemBackNavigation);
  } catch (error) {
    console.log('[Helium] presentUpsell error', error);
    paywallEventHandlers = undefined;
    presentOnPaywallUnavailable = undefined;
    presentOnEntitled = undefined;
    onPaywallUnavailable?.();
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
      presentOnPaywallUnavailable = undefined;
      break;
    case 'paywallSkipped':
      paywallEventHandlers = undefined;
      presentOnPaywallUnavailable = undefined;
      break;
    case 'paywallOpenFailed':
      paywallEventHandlers = undefined;
      const unavailableReason = event.paywallUnavailableReason;
      if (event.triggerName
        && unavailableReason !== "alreadyPresented"
        && unavailableReason !== "secondTryNoMatch") {
        console.log('[Helium] paywall open failed', unavailableReason);
        presentOnPaywallUnavailable?.();
      }
      presentOnPaywallUnavailable = undefined;
      break;
  }
}

/**
 * Routes native SDK log events to the appropriate console method.
 * Log levels: 1=error, 2=warn, 3=info, 4=debug, 5=trace
 */
function logHeliumEvent(event: HeliumLogEvent) {
  const { level, message } = event;
  const metadata = event.metadata ?? {};
  const hasMetadata = Object.keys(metadata).length > 0;

  switch (level) {
    case 1: // error
      hasMetadata ? console.error(message, metadata) : console.error(message);
      break;
    case 2: // warn
      hasMetadata ? console.warn(message, metadata) : console.warn(message);
      break;
    case 3: // info
      hasMetadata ? console.info(message, metadata) : console.info(message);
      break;
    case 4: // debug
    case 5: // trace
    default:
      hasMetadata ? console.debug(message, metadata) : console.debug(message);
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
 * An optional anonymous ID from your third-party analytics provider, sent alongside
 * every Helium analytics event so you can correlate Helium data with your own analytics
 * before you have set a custom user ID. Pass `null` to clear.
 *
 * - Amplitude: pass device ID
 * - Mixpanel: pass anonymous ID
 * - PostHog: pass anonymous ID
 *
 * Set this before calling `initialize()` for best results. Can also be updated after initialization.
 */
export const setThirdPartyAnalyticsAnonymousId = (anonymousId: string | null): void => {
  try {
    HeliumPaywallSdkModule.setThirdPartyAnalyticsAnonymousId(anonymousId);
  } catch (e) {
    console.error('[Helium] Failed to set third-party analytics anonymous ID', e);
  }
};

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
export const resetHelium = async (options?: ResetHeliumOptions): Promise<void> => {
  paywallEventHandlers = undefined;
  presentOnPaywallUnavailable = undefined;
  presentOnEntitled = undefined; //oof if you call while another paywall open these can get replaced...
  //should either return early in presentupsell or be more robust and make these live per-presentation
  removeAllHeliumListeners();

  try {
    await HeliumPaywallSdkModule.resetHelium(
      options?.clearUserTraits ?? true,
      true, // always clear for now, these listeners are not yet exposed to RN
      options?.clearExperimentAllocations ?? false,
    );
  } catch (e) {
    // Native reset likely completed; the async bridge response may have been
    // lost (e.g. coroutine cancellation during module teardown). JS state is
    // cleaned up below regardless.
    console.warn('[Helium] resetHelium did not receive native completion:', e);
  } finally {
    isInitialized = false;
  }
};

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
 * Override the light/dark mode for Helium paywalls.
 * @param mode The mode to set: 'light', 'dark', or 'system' (follows device setting)
 *
 * Note: If your app's `app.json` (or `app.config.js`) has `"userInterfaceStyle": "light"` (or `"dark"`),
 * the OS-level appearance is locked and 'system' will not reflect the device's actual
 * dark mode setting. Set `"userInterfaceStyle": "automatic"` for 'system' to work correctly.
 */
export const setLightDarkModeOverride = HeliumPaywallSdkModule.setLightDarkModeOverride;

/**
 * iOS only. Enables External Web Checkout Flow for any Paddle or Stripe products in your paywalls.
 * If not enabled, paywalls with Paddle/Stripe products will not show. Your fallback paywall/s,
 * if provided, will show instead.
 *
 * You must provide redirect URLs so Helium knows where to send the user after checkout completes
 * or is cancelled.
 *
 * @param successURL The URL to redirect to after a successful payment.
 *   Include `{CHECKOUT_SESSION_ID}` in the URL to receive the session ID.
 * @param cancelURL The URL the provider redirects to when the user cancels checkout.
 * @param paymentProcessors Which payment processors to enable. Defaults to both Paddle and Stripe.
 *   Pass `['paddle']` or `['stripe']` if your app only uses one to skip the unused processor's
 *   entitlement network calls.
 */
export const enableExternalWebCheckout = ({
                                            successURL,
                                            cancelURL,
                                            paymentProcessors,
                                          }: {
  successURL: string;
  cancelURL: string;
  paymentProcessors?: WebCheckoutProcessor[];
}): void => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] enableExternalWebCheckout is only available on iOS');
    return;
  }
  try {
    HeliumPaywallSdkModule.enableExternalWebCheckout(successURL, cancelURL, paymentProcessors);
  } catch (e) {
    console.error('[Helium] enableExternalWebCheckout error', e);
  }
};

/**
 * iOS only. Disables External Web Checkout Flow. Paywalls with Paddle or Stripe products
 * will not show. Your fallback paywall/s, if provided, will show instead.
 *
 * NOTE - if you have existing Paddle/Stripe customers, Helium will attempt to continue respecting
 * their entitlements but is not guaranteed to do so.
 */
export const disableExternalWebCheckout = (): void => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] disableExternalWebCheckout is only available on iOS');
    return;
  }
  try {
    HeliumPaywallSdkModule.disableExternalWebCheckout();
  } catch (e) {
    console.error('[Helium] disableExternalWebCheckout error', e);
  }
};

/**
 * iOS only. Allows Web Checkout paywalls (Paddle/Stripe) to show even when no custom user ID
 * has been set via `setCustomUserId`.
 *
 * By default, paywalls with Paddle or Stripe products will not show if user ID is not set.
 * Your fallback paywall/s, if provided, will show instead.
 * Set this to `true` if your app supports purchase-before-signup flows. Once `setCustomUserId`
 * is called later, Helium will automatically link the Paddle/Stripe customer to that user ID.
 *
 * Warning: Use with caution. If the user purchases via web checkout and your app never sets a
 * `customUserId` (or uninstalls the app before doing so), the purchase may be unrecoverable for
 * that user. Only enable this if your app has a clear path for the user to set a custom user ID
 * post-purchase.
 *
 * Defaults to `false`.
 */
export const setAllowWebCheckoutWithoutUserId = (allow: boolean): void => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] setAllowWebCheckoutWithoutUserId is only available on iOS');
    return;
  }
  try {
    HeliumPaywallSdkModule.setAllowWebCheckoutWithoutUserId(allow);
  } catch (e) {
    console.error('[Helium] setAllowWebCheckoutWithoutUserId error', e);
  }
};

/**
 * iOS only. Returns `true` if the user has any active Stripe entitlement.
 */
export const hasActiveStripeEntitlement = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] hasActiveStripeEntitlement is only available on iOS');
    return false;
  }
  try {
    return await HeliumPaywallSdkModule.hasActiveStripeEntitlement();
  } catch (e) {
    console.error('[Helium] hasActiveStripeEntitlement error', e);
    return false;
  }
};

/**
 * iOS only. Returns `true` if the user has any active Paddle entitlement.
 */
export const hasActivePaddleEntitlement = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] hasActivePaddleEntitlement is only available on iOS');
    return false;
  }
  try {
    return await HeliumPaywallSdkModule.hasActivePaddleEntitlement();
  } catch (e) {
    console.error('[Helium] hasActivePaddleEntitlement error', e);
    return false;
  }
};

/**
 * iOS only. Creates a Stripe Customer Portal session and returns the portal URL.
 * The host app can open this URL in a browser or in-app webview to let the user
 * manage their subscriptions, payment methods, and invoices.
 *
 * @param returnUrl The URL Stripe redirects to after the user finishes in the portal.
 * @returns The portal session URL, or `undefined` if the session could not be created.
 */
export const createStripePortalSession = async (returnUrl: string): Promise<string | undefined> => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] createStripePortalSession is only available on iOS');
    return undefined;
  }
  try {
    return await HeliumPaywallSdkModule.createStripePortalSession(returnUrl);
  } catch (e) {
    console.error('[Helium] createStripePortalSession error', e);
    return undefined;
  }
};

/**
 * iOS only. Resets Stripe entitlements and clears the user ID.
 * If your app can support multiple Stripe users on the same device, call this to effectively
 * "log out" a Stripe user.
 */
export const resetStripeEntitlements = (): void => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] resetStripeEntitlements is only available on iOS');
    return;
  }
  try {
    HeliumPaywallSdkModule.resetStripeEntitlements();
  } catch (e) {
    console.error('[Helium] resetStripeEntitlements error', e);
  }
};

/**
 * iOS only. Creates a Paddle Customer Portal session for the current user and returns the
 * portal URL. The host app can open this URL in a browser or in-app webview to let the user
 * manage their subscriptions.
 *
 * @returns The portal session URL, or `undefined` if the session could not be created.
 */
export const createPaddlePortalSession = async (): Promise<string | undefined> => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] createPaddlePortalSession is only available on iOS');
    return undefined;
  }
  try {
    return await HeliumPaywallSdkModule.createPaddlePortalSession();
  } catch (e) {
    console.error('[Helium] createPaddlePortalSession error', e);
    return undefined;
  }
};

/**
 * iOS only. Resets Paddle entitlements and clears the user ID.
 * If your app can support multiple Paddle users on the same device, call this to effectively
 * "log out" a Paddle user.
 */
export const resetPaddleEntitlements = (): void => {
  if (Platform.OS !== 'ios') {
    console.log('[Helium] resetPaddleEntitlements is only available on iOS');
    return;
  }
  try {
    HeliumPaywallSdkModule.resetPaddleEntitlements();
  } catch (e) {
    console.error('[Helium] resetPaddleEntitlements error', e);
  }
};

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
    // Strip null/undefined values — native SDKs ignore them and it complicates bridging code
    if (value == null) continue;
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

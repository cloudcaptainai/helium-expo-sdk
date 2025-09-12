import type { StyleProp, ViewStyle } from 'react-native';

export type OnLoadEventPayload = {
  url: string;
};

export type HeliumPaywallSdkModuleEvents = {
  onHeliumPaywallEvent: (params: HeliumPaywallEvent) => void;
  onDelegateActionEvent: (params: DelegateActionEvent) => void;
};
export type HeliumPaywallEvent = {
  type: string;
  triggerName?: string;
  paywallName?: string;
  /**
   * @deprecated Use `paywallName` instead.
   */
  paywallTemplateName?: string;
  productKey?: string;
  ctaName?: string;
  configId?: string;
  numAttempts?: number;
  downloadTimeTakenMS?: number;
  webviewRenderTimeTakenMS?: number;
  imagesDownloadTimeTakenMS?: number;
  fontsDownloadTimeTakenMS?: number;
  bundleDownloadTimeMS?: number;
  dismissAll?: boolean;
  error?: string;
  /**
   * @deprecated Use `error` instead.
   */
  errorDescription?: string;
  /**
   * Unix timestamp in seconds
   */
  timestamp?: number;
};
export type DelegateActionEvent = {
  type: 'purchase' | 'restore';
  productId?: string;
};

export type HeliumPaywallSdkViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};

export type HeliumTransactionStatus = 'purchased' | 'failed' | 'cancelled' | 'pending' | 'restored';
export type HeliumPurchaseResult = {
  status: HeliumTransactionStatus;
  error?: string; // Optional error message
};
export type HeliumDownloadStatus = 'downloadSuccess' | 'downloadFailure' | 'inProgress' | 'notDownloadedYet';

// --- Purchase Configuration Types ---

/** Interface for providing custom purchase handling logic. */

export interface HeliumPurchaseConfig {
  makePurchase: (productId: string) => Promise<HeliumPurchaseResult>;
  restorePurchases: () => Promise<boolean>;

  /** Optional RevenueCat API Key. If not provided, RevenueCat must be configured elsewhere. */
  apiKey?: string;
}

// Helper function for creating Custom Purchase Config
export function createCustomPurchaseConfig(callbacks: {
  makePurchase: (productId: string) => Promise<HeliumPurchaseResult>;
  restorePurchases: () => Promise<boolean>;
}): HeliumPurchaseConfig {
  return {
    makePurchase: callbacks.makePurchase,
    restorePurchases: callbacks.restorePurchases,
  };
}

export type TriggerLoadingConfig = {
  /** Whether to show loading state for this trigger. Set to nil to use the global `useLoadingState` setting. */
  useLoadingState?: boolean;
  /** Maximum seconds to show loading for this trigger. Set to nil to use the global `loadingBudget` setting. */
  loadingBudget?: number;
};

export type HeliumPaywallLoadingConfig = {
  /**
   * Whether to show a loading state while fetching paywall configuration.
   * When true, shows a loading view for up to `loadingBudget` seconds before falling back.
   * Default: true
   */
  useLoadingState?: boolean;
  /**
   * Maximum time (in seconds) to show the loading state before displaying fallback.
   * After this timeout, the fallback view will be shown even if the paywall is still downloading.
   * Default: 2.0 seconds
   */
  loadingBudget?: number;
  /**
   * Optional per-trigger loading configuration overrides.
   * Use this to customize loading behavior for specific triggers.
   * Keys are trigger names, values are TriggerLoadingConfig instances.
   * Example: Disable loading for "onboarding" trigger while keeping it for others.
   */
  perTriggerLoadingConfig?: Record<string, TriggerLoadingConfig>;
};

export interface HeliumConfig {
  /** Your Helium API Key */
  apiKey: string;
  /** Configuration for handling purchases. Can be custom functions or a pre-built handler config. */
  purchaseConfig: HeliumPurchaseConfig;
  /** Callback for receiving all Helium paywall events. */
  onHeliumPaywallEvent: (event: HeliumPaywallEvent) => void; // Still mandatory

  // Optional configurations
  /** Fallback bundle in the rare situation that paywall is not ready to be shown. Highly recommended. See docs at https://docs.tryhelium.com/guides/fallback-bundle#react-native */
  fallbackBundle?: object;
  /** Configure loading behavior for paywalls that are mid-download. */
  paywallLoadingConfig?: HeliumPaywallLoadingConfig;
  customUserId?: string;
  customAPIEndpoint?: string;
  customUserTraits?: Record<string, any>;
  revenueCatAppUserId?: string;
}

export interface NativeHeliumConfig {
  apiKey: string;
  customUserId?: string;
  customAPIEndpoint?: string;
  customUserTraits?: Record<string, any>;
  revenueCatAppUserId?: string;
  fallbackBundleUrlString?: string;
  fallbackBundleString?: string;
  paywallLoadingConfig?: HeliumPaywallLoadingConfig;
}

export type PresentUpsellParams = {
  triggerName: string;
  /** Optional. This will be called when paywall fails to show due to an unsuccessful paywall download or if an invalid trigger is provided. */
  onFallback?: () => void;
  eventHandlers?: PaywallEventHandlers;
  customPaywallTraits?: Record<string, any>;
};

export interface PaywallInfo {
  paywallTemplateName: string;
  shouldShow: boolean;
}

// Event handler types for per-trigger event handling
export interface PaywallEventHandlers {
  onOpen?: (event: PaywallOpenEvent) => void;
  onClose?: (event: PaywallCloseEvent) => void;
  onDismissed?: (event: PaywallDismissedEvent) => void;
  onPurchaseSucceeded?: (event: PurchaseSucceededEvent) => void;
}

// Typed event interfaces
export interface PaywallOpenEvent {
  type: 'paywall_open';
  triggerName: string;
  paywallName: string;
  viewType?: 'presented' | 'embedded' | 'triggered';
}

export interface PaywallCloseEvent {
  type: 'paywall_close';
  triggerName: string;
  paywallName: string;
}

export interface PaywallDismissedEvent {
  type: 'paywall_dismissed';
  triggerName: string;
  paywallName: string;
}

export interface PurchaseSucceededEvent {
  type: 'purchase_succeeded';
  productId: string;
  triggerName: string;
  paywallName: string;
}

export const HELIUM_CTA_NAMES = {
  SCHEDULE_CALL: 'schedule_call',
  SUBSCRIBE_BUTTON: 'subscribe_button',
}

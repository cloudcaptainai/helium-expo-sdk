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
  errorDescription?: string;
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

// Loading configuration per trigger
export interface TriggerLoadingConfig {
  /** Whether to show loading state for this trigger */
  useLoadingState?: boolean;
  /** How long to wait before showing fallback (in seconds) */
  loadingBudget?: number;
  // Note: loadingView is not supported in RN (would need native view)
}

// Fallback configuration that mirrors Swift's HeliumFallbackConfig
export interface HeliumFallbackConfig {
  /** Whether to use loading state globally (default: true) */
  useLoadingState?: boolean;
  /** Global loading budget in seconds (default: 2.0) */
  loadingBudget?: number;
  /** Per-trigger loading overrides */
  perTriggerLoadingConfig?: Record<string, TriggerLoadingConfig>;
  /** Fallback bundle JSON (highest priority) */
  fallbackBundle?: object;
  /** Dynamic fallback handler - called when native needs fallback */
  onFallback?: (trigger: string) => void;
  // Note: fallbackView and fallbackPerTrigger not supported in RN
}

export interface HeliumConfig {
  /** Your Helium API Key */
  apiKey: string;
  /** Configuration for handling purchases. Can be custom functions or a pre-built handler config. */
  purchaseConfig: HeliumPurchaseConfig;
  /** Callback for receiving all Helium paywall events. */
  onHeliumPaywallEvent: (event: HeliumPaywallEvent) => void; // Still mandatory

  // Optional configurations
  fallbackConfig?: HeliumFallbackConfig; // New unified fallback config
  fallbackBundle?: object; // Deprecated - use fallbackConfig.fallbackBundle
  triggers?: string[];
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
  // New fallback config fields
  useLoadingState?: boolean;
  loadingBudget?: number;
  perTriggerLoadingConfig?: Record<string, TriggerLoadingConfig>;
}

export interface PaywallInfo {
  paywallTemplateName: string;
  shouldShow: boolean;
}

// Event handler types for per-trigger event handling
// These match the Swift PaywallEventService exactly
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
  viewType?: 'presented' | 'embedded';
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

export type TypedPaywallEvent = 
  | PaywallOpenEvent
  | PaywallCloseEvent
  | PaywallDismissedEvent
  | PurchaseSucceededEvent;

export const HELIUM_CTA_NAMES = {
  SCHEDULE_CALL: 'schedule_call',
  SUBSCRIBE_BUTTON: 'subscribe_button',
}

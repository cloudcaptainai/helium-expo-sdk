import type { HeliumPaywallEvent, PaywallEventHandlers, PaywallViewType } from './HeliumPaywallSdk.types';

export function dispatchPaywallEvent(
  handlers: PaywallEventHandlers,
  event: HeliumPaywallEvent,
  viewType: PaywallViewType,
): void {
  const taggedEvent = { ...event, viewType: event.viewType ?? viewType };
  try {
    switch (event.type) {
      case 'paywallOpen':
        handlers.onOpen?.({
          type: 'paywallOpen',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
          viewType,
        });
        break;
      case 'paywallClose':
        handlers.onClose?.({
          type: 'paywallClose',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
      case 'paywallDismissed':
        handlers.onDismissed?.({
          type: 'paywallDismissed',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
      case 'purchaseSucceeded':
        handlers.onPurchaseSucceeded?.({
          type: 'purchaseSucceeded',
          productId: event.productId ?? 'unknown',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          isSecondTry: event.isSecondTry ?? false,
          paymentProcessor: event.paymentProcessor,
        });
        break;
      case 'paywallOpenFailed':
        handlers.onOpenFailed?.({
          type: 'paywallOpenFailed',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          error: event.error ?? 'Unknown error',
          paywallUnavailableReason: event.paywallUnavailableReason,
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
      case 'customPaywallAction':
        handlers.onCustomPaywallAction?.({
          type: 'customPaywallAction',
          triggerName: event.triggerName ?? 'unknown',
          paywallName: event.paywallName ?? 'unknown',
          actionName: event.customPaywallActionName ?? 'unknown',
          params: event.customPaywallActionParams ?? {},
          isSecondTry: event.isSecondTry ?? false,
        });
        break;
    }
    handlers.onAnyEvent?.(taggedEvent);
  } catch (error) {
    console.error('[Helium] paywall event handler failed', error);
  }
}

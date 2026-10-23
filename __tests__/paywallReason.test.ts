/**
 * The server's explanation for a trigger having no paywall rides on the native open and open-failed
 * events as `reason`. These tests pin that the typed handlers receive it next to
 * `paywallUnavailableReason`, that it stays absent when native sends none, and that it survives the
 * per-presentation channel end to end.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-file-system', () => ({}));

jest.mock('../src/HeliumPaywallSdkModule', () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  return {
    __esModule: true,
    default: {
      setWrapperSdkInfo: jest.fn(),
      initialize: jest.fn(),
      setupCore: jest.fn(),
      presentUpsell: jest.fn(),
      resetHelium: jest.fn(),
      fallbackOpenOrCloseEvent: jest.fn(),
      addListener: jest.fn((name: string, listener: (event: any) => void) => {
        (listeners[name] ??= []).push(listener);
        return { remove: () => {} };
      }),
      removeAllListeners: jest.fn((name: string) => {
        listeners[name] = [];
      }),
      /** Test handle: stands in for the native SDK emitting an event over the bridge. */
      __emit: (name: string, event: unknown) => {
        (listeners[name] ?? []).forEach((listener) => listener(event));
      },
    },
  };
});

import { dispatchPaywallEvent } from '../src/paywallEventDispatch';
import type { HeliumPaywallEvent, PaywallEventHandlers } from '../src/HeliumPaywallSdk.types';

type NativeModuleMock = {
  presentUpsell: jest.Mock;
  __emit: (name: string, event: unknown) => void;
};

/** Each test needs the module's presentation map fresh, and it is module-level. */
function loadHelium() {
  let helium!: typeof import('../src/index');
  let native!: NativeModuleMock;
  jest.isolateModules(() => {
    helium = require('../src/index');
    native = require('../src/HeliumPaywallSdkModule').default;
  });
  return { helium, native };
}

/** No fallbackBundle, so initialization completes without touching the file system. */
const CONFIG = { apiKey: 'test-key' };
const TRIGGER = 'go_online';
const SERVER_REASON = 'No live workflow targets this trigger.';

const openFailed: HeliumPaywallEvent = {
  type: 'paywallOpenFailed',
  triggerName: TRIGGER,
  paywallName: 'test-paywall',
  error: 'No paywall for trigger',
  paywallUnavailableReason: 'triggerHasNoPaywall',
  isSecondTry: false,
};

const fallbackOpened: HeliumPaywallEvent = {
  type: 'paywallOpen',
  triggerName: TRIGGER,
  paywallName: 'fallback-paywall',
  paywallUnavailableReason: 'triggerHasNoPaywall',
  isSecondTry: false,
};

const lastCall = (handler: jest.Mock) => handler.mock.calls[handler.mock.calls.length - 1][0];

describe('reason on typed event handlers', () => {
  it('hands onOpenFailed the server reason next to the unavailable reason', () => {
    const handlers: PaywallEventHandlers = { onOpenFailed: jest.fn() };

    dispatchPaywallEvent(handlers, { ...openFailed, reason: SERVER_REASON }, 'presented');

    expect(handlers.onOpenFailed).toHaveBeenCalledWith({
      type: 'paywallOpenFailed',
      triggerName: TRIGGER,
      paywallName: 'test-paywall',
      error: 'No paywall for trigger',
      paywallUnavailableReason: 'triggerHasNoPaywall',
      reason: SERVER_REASON,
      isSecondTry: false,
    });
  });

  it('hands onOpen the server reason when the fallback paywall opened', () => {
    const handlers: PaywallEventHandlers = { onOpen: jest.fn() };

    dispatchPaywallEvent(handlers, { ...fallbackOpened, reason: SERVER_REASON }, 'presented');

    expect(handlers.onOpen).toHaveBeenCalledWith({
      type: 'paywallOpen',
      triggerName: TRIGGER,
      paywallName: 'fallback-paywall',
      paywallUnavailableReason: 'triggerHasNoPaywall',
      reason: SERVER_REASON,
      isSecondTry: false,
      viewType: 'presented',
    });
  });

  it.each([
    ['onOpenFailed', openFailed],
    ['onOpen', fallbackOpened],
  ])('leaves reason undefined on %s when native sends none', (handlerName, event) => {
    const handler = jest.fn();
    const handlers: PaywallEventHandlers = { [handlerName]: handler };

    dispatchPaywallEvent(handlers, event, 'presented');

    expect(lastCall(handler).reason).toBeUndefined();
    expect(lastCall(handler).paywallUnavailableReason).toBe('triggerHasNoPaywall');
  });

  it('passes the reason through onAnyEvent untouched', () => {
    const onAnyEvent = jest.fn();

    dispatchPaywallEvent({ onAnyEvent }, { ...openFailed, reason: SERVER_REASON }, 'presented');

    expect(lastCall(onAnyEvent).reason).toBe(SERVER_REASON);
  });
});

describe('reason over the per-presentation channel', () => {
  it('reaches the handlers of the present that failed', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const onOpenFailed = jest.fn();
    const onAnyEvent = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onOpenFailed, onAnyEvent } });
    native.__emit('paywallEventHandlers', {
      ...openFailed,
      reason: SERVER_REASON,
      presentationId: native.presentUpsell.mock.calls[0][4],
    });

    expect(lastCall(onOpenFailed).reason).toBe(SERVER_REASON);
    expect(lastCall(onAnyEvent)).toEqual({ ...openFailed, reason: SERVER_REASON, viewType: 'presented' });
  });
});

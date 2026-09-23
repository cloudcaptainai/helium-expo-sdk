/**
 * The per-call handlers from `presentUpsell` live in a single slot that global lifecycle events
 * clear. Events that leave the presented paywall on screen must not touch that slot: a repeat
 * present rejected as already presented, a second try with no match, and the dev-mode preview
 * that stacks on top of the paywall.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-file-system', () => ({}));

jest.mock('../src/HeliumPaywallSdkModule', () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  return {
    __esModule: true,
    default: {
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

type NativeModuleMock = {
  presentUpsell: jest.Mock;
  __emit: (name: string, event: unknown) => void;
};

/** Each test needs the module's handler slots fresh, and they are module-level. */
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
const PREVIEW_TRIGGER = 'helium_preview_trigger';

const perCall = (native: NativeModuleMock, type: string, triggerName = TRIGGER) =>
  native.__emit('paywallEventHandlers', { type, triggerName, paywallName: 'test-paywall' });
const global = (native: NativeModuleMock, event: Record<string, unknown>) =>
  native.__emit('onHeliumPaywallEvent', { paywallName: 'test-paywall', ...event });
const eventTypes = (onAnyEvent: jest.Mock) => onAnyEvent.mock.calls.map(([event]) => event.type);

async function presentAndOpen(helium: typeof import('../src/index'), native: NativeModuleMock) {
  await helium.initialize(CONFIG);
  const onAnyEvent = jest.fn();
  const onPaywallUnavailable = jest.fn();
  helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent }, onPaywallUnavailable });
  perCall(native, 'paywallOpen');
  return { onAnyEvent, onPaywallUnavailable };
}

describe('present handler retention', () => {
  it('keeps the on-screen handlers when a repeat present is rejected as already presented', async () => {
    const { helium, native } = loadHelium();
    const { onAnyEvent, onPaywallUnavailable } = await presentAndOpen(helium, native);

    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent }, onPaywallUnavailable });
    global(native, { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'alreadyPresented' });
    perCall(native, 'purchasePressed');
    perCall(native, 'purchaseCancelled');
    perCall(native, 'purchaseRestoreFailed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'purchasePressed', 'purchaseCancelled', 'purchaseRestoreFailed']);
    expect(onPaywallUnavailable).not.toHaveBeenCalled();
  });

  it('keeps the on-screen handlers when a second try has no match', async () => {
    const { helium, native } = loadHelium();
    const { onAnyEvent, onPaywallUnavailable } = await presentAndOpen(helium, native);

    global(native, { type: 'paywallOpenFailed', triggerName: `${TRIGGER}_second_try`, paywallUnavailableReason: 'secondTryNoMatch' });
    perCall(native, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'purchasePressed']);
    expect(onPaywallUnavailable).not.toHaveBeenCalled();
  });

  it('delivers preview paywall events and ignores the preview lifecycle for cleanup', async () => {
    const { helium, native } = loadHelium();
    const { onAnyEvent } = await presentAndOpen(helium, native);

    perCall(native, 'paywallOpen', PREVIEW_TRIGGER);
    perCall(native, 'purchaseRestoreFailed', PREVIEW_TRIGGER);
    global(native, { type: 'paywallOpenFailed', triggerName: PREVIEW_TRIGGER, paywallUnavailableReason: 'paywallsNotDownloaded' });
    global(native, { type: 'paywallClose', triggerName: PREVIEW_TRIGGER, isSecondTry: false });
    perCall(native, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'paywallOpen', 'purchaseRestoreFailed', 'purchasePressed']);
  });

  it('still clears the handlers and reports a real open failure', async () => {
    const { helium, native } = loadHelium();
    const { onAnyEvent, onPaywallUnavailable } = await presentAndOpen(helium, native);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    global(native, { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'paywallsNotDownloaded' });
    perCall(native, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen']);
    expect(onPaywallUnavailable).toHaveBeenCalledTimes(1);
  });

  it('still clears the handlers when the paywall closes', async () => {
    const { helium, native } = loadHelium();
    const { onAnyEvent } = await presentAndOpen(helium, native);

    global(native, { type: 'paywallClose', triggerName: TRIGGER, isSecondTry: false });
    perCall(native, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen']);
  });
});

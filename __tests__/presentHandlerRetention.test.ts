/**
 * Every `presentUpsell` call gets a presentation id that the native bridge stamps on the
 * per-call events, entitled callback, skip callback, and open failures it reports for that
 * call. These tests pin that events reach the presentation they belong to and nothing else:
 * repeat presents rejected natively, previews stacked on the paywall, skips, failures, and
 * the close that ends a presentation.
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
const OTHER_TRIGGER = 'go_offline';
const PREVIEW_TRIGGER = 'helium_preview_trigger';

/** The id the JS layer handed to the native bridge for the nth presentUpsell call. */
const idOfCall = (native: NativeModuleMock, index: number): string => native.presentUpsell.mock.calls[index][4];
const perCall = (native: NativeModuleMock, presentationId: string, type: string, triggerName = TRIGGER, extra: Record<string, unknown> = {}) =>
  native.__emit('paywallEventHandlers', { type, triggerName, paywallName: 'test-paywall', presentationId, ...extra });
const global = (native: NativeModuleMock, event: Record<string, unknown>) =>
  native.__emit('onHeliumPaywallEvent', { paywallName: 'test-paywall', ...event });
const eventTypes = (handler: jest.Mock) => handler.mock.calls.map(([event]) => event.type);

async function presentAndOpen(helium: typeof import('../src/index'), native: NativeModuleMock) {
  await helium.initialize(CONFIG);
  const onAnyEvent = jest.fn();
  const onPaywallUnavailable = jest.fn();
  helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent }, onPaywallUnavailable });
  const id = idOfCall(native, 0);
  perCall(native, id, 'paywallOpen');
  return { id, onAnyEvent, onPaywallUnavailable };
}

describe('presentation routing', () => {
  it('keeps the on-screen presentation when a repeat present is rejected as already presented', async () => {
    const { helium, native } = loadHelium();
    const { id, onAnyEvent, onPaywallUnavailable } = await presentAndOpen(helium, native);
    const rejected = jest.fn();
    const rejectedUnavailable = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent: rejected }, onPaywallUnavailable: rejectedUnavailable });
    const rejectedId = idOfCall(native, 1);
    global(native, { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'alreadyPresented' });
    perCall(native, id, 'purchasePressed');
    perCall(native, id, 'purchaseCancelled');
    perCall(native, id, 'purchaseRestoreFailed');
    perCall(native, rejectedId, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'purchasePressed', 'purchaseCancelled', 'purchaseRestoreFailed']);
    expect(rejected).not.toHaveBeenCalled();
    expect(rejectedUnavailable).not.toHaveBeenCalled();
    expect(onPaywallUnavailable).not.toHaveBeenCalled();
  });

  it('drops the rejected present when native reports the rejection on its own channel', async () => {
    const { helium, native } = loadHelium();
    const { id, onAnyEvent } = await presentAndOpen(helium, native);
    const rejected = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent: rejected } });
    const rejectedId = idOfCall(native, 1);
    perCall(native, rejectedId, 'paywallOpenFailed', TRIGGER, { paywallUnavailableReason: 'alreadyPresented' });
    global(native, { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'alreadyPresented' });
    perCall(native, id, 'purchasePressed');
    perCall(native, rejectedId, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'purchasePressed']);
    expect(eventTypes(rejected)).toEqual(['paywallOpenFailed']);
  });

  it('keeps the first present when a same-trigger repeat lands before it opens', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const first = jest.fn();
    const rejected = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent: first } });
    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent: rejected } });
    const firstId = idOfCall(native, 0);
    const rejectedId = idOfCall(native, 1);
    perCall(native, firstId, 'paywallOpen');
    global(native, { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'alreadyPresented' });
    perCall(native, firstId, 'purchasePressed');
    perCall(native, rejectedId, 'purchasePressed');

    expect(eventTypes(first)).toEqual(['paywallOpen', 'purchasePressed']);
    expect(rejected).not.toHaveBeenCalled();
  });

  it('delivers preview events to the host handlers without ending the presentation', async () => {
    const { helium, native } = loadHelium();
    const { id, onAnyEvent } = await presentAndOpen(helium, native);

    perCall(native, id, 'paywallOpen', PREVIEW_TRIGGER);
    perCall(native, id, 'purchaseRestoreFailed', PREVIEW_TRIGGER);
    perCall(native, id, 'paywallClose', PREVIEW_TRIGGER, { isSecondTry: false });
    perCall(native, id, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'paywallOpen', 'purchaseRestoreFailed', 'paywallClose', 'purchasePressed']);
  });

  it('routes a skip to the present that registered it', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const firstSkip = jest.fn();
    const second = jest.fn();
    const secondSkip = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, onPaywallSkip: firstSkip });
    helium.presentUpsell({ triggerName: OTHER_TRIGGER, eventHandlers: { onAnyEvent: second }, onPaywallSkip: secondSkip });
    native.__emit('onPaywallSkipEvent', { type: 'paywallSkipped', triggerName: TRIGGER, skipReason: 'targetingHoldout', presentationId: idOfCall(native, 0) });
    perCall(native, idOfCall(native, 1), 'paywallOpen', OTHER_TRIGGER);
    perCall(native, idOfCall(native, 1), 'purchasePressed', OTHER_TRIGGER);

    expect(firstSkip).toHaveBeenCalledTimes(1);
    expect(secondSkip).not.toHaveBeenCalled();
    expect(eventTypes(second)).toEqual(['paywallOpen', 'purchasePressed']);
  });

  it('routes an already-entitled skip to that present\'s onEntitled', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const firstEntitled = jest.fn();
    const secondEntitled = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, onEntitled: firstEntitled });
    helium.presentUpsell({ triggerName: OTHER_TRIGGER, onEntitled: secondEntitled });
    native.__emit('onEntitledEvent', { type: 'paywallSkipped', triggerName: TRIGGER, skipReason: 'alreadyEntitled', presentationId: idOfCall(native, 0) });

    expect(firstEntitled).toHaveBeenCalledTimes(1);
    expect(secondEntitled).not.toHaveBeenCalled();
  });

  it('routes an open failure to the present that failed', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const firstUnavailable = jest.fn();
    const second = jest.fn();
    const secondUnavailable = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, onPaywallUnavailable: firstUnavailable });
    helium.presentUpsell({ triggerName: OTHER_TRIGGER, eventHandlers: { onAnyEvent: second }, onPaywallUnavailable: secondUnavailable });
    native.__emit('onPaywallUnavailableEvent', { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'paywallsNotDownloaded', presentationId: idOfCall(native, 0) });
    perCall(native, idOfCall(native, 1), 'paywallOpen', OTHER_TRIGGER);

    expect(firstUnavailable).toHaveBeenCalledTimes(1);
    expect(secondUnavailable).not.toHaveBeenCalled();
    expect(eventTypes(second)).toEqual(['paywallOpen']);
  });

  it('ends a presentation on its own close but still delivers a later entitled event', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const onAnyEvent = jest.fn();
    const onEntitled = jest.fn();

    helium.presentUpsell({ triggerName: TRIGGER, eventHandlers: { onAnyEvent }, onEntitled });
    const id = idOfCall(native, 0);
    perCall(native, id, 'paywallOpen');
    perCall(native, id, 'paywallClose', TRIGGER, { isSecondTry: false });
    perCall(native, id, 'purchasePressed');
    native.__emit('onEntitledEvent', { type: 'purchaseSucceeded', triggerName: TRIGGER, presentationId: id });
    native.__emit('onEntitledEvent', { type: 'purchaseSucceeded', triggerName: TRIGGER, presentationId: id });

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'paywallClose']);
    expect(onEntitled).toHaveBeenCalledTimes(1);
  });

  it('ignores close and skipped events on the global channel', async () => {
    const { helium, native } = loadHelium();
    const { id, onAnyEvent } = await presentAndOpen(helium, native);

    global(native, { type: 'paywallClose', triggerName: TRIGGER, isSecondTry: false });
    global(native, { type: 'paywallSkipped', triggerName: TRIGGER, skipReason: 'targetingHoldout' });
    perCall(native, id, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen', 'purchasePressed']);
  });

  it('still clears the handlers and reports a real open failure', async () => {
    const { helium, native } = loadHelium();
    const { id, onAnyEvent, onPaywallUnavailable } = await presentAndOpen(helium, native);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    native.__emit('onPaywallUnavailableEvent', { type: 'paywallOpenFailed', triggerName: TRIGGER, paywallUnavailableReason: 'webviewRenderFail', presentationId: id });
    perCall(native, id, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen']);
    expect(onPaywallUnavailable).toHaveBeenCalledTimes(1);
  });

  it('clears every presentation on reset', async () => {
    const { helium, native } = loadHelium();
    const { id, onAnyEvent } = await presentAndOpen(helium, native);

    await helium.resetHelium();
    await helium.initialize(CONFIG);
    perCall(native, id, 'purchasePressed');

    expect(eventTypes(onAnyEvent)).toEqual(['paywallOpen']);
  });
});

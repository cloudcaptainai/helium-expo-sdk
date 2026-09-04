/**
 * Skip events reach `onPaywallSkip` over two native channels: the dedicated skip event and, for
 * already-entitled skips when `onEntitled` takes precedence, the entitled event. These tests pin
 * the routing between the channels, the one-shot handler clearing, and the normalization both
 * channels share.
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

const SKIP_EVENT = {
  type: 'paywallSkipped',
  triggerName: 'go_online',
  skipReason: 'targetingHoldout',
};

describe('onPaywallSkip routing', () => {
  it('delivers a skip event once and clears the handler', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const onPaywallSkip = jest.fn();

    helium.presentUpsell({ triggerName: 'go_online', onPaywallSkip });
    native.__emit('onPaywallSkipEvent', SKIP_EVENT);

    expect(onPaywallSkip).toHaveBeenCalledWith(SKIP_EVENT);

    native.__emit('onPaywallSkipEvent', SKIP_EVENT);

    expect(onPaywallSkip).toHaveBeenCalledTimes(1);
  });

  it('routes an already-entitled skip to onEntitled and not onPaywallSkip', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const onEntitled = jest.fn();
    const onPaywallSkip = jest.fn();
    const entitledSkip = {
      type: 'paywallSkipped',
      triggerName: 'go_online',
      skipReason: 'alreadyEntitled',
    };

    helium.presentUpsell({ triggerName: 'go_online', onEntitled, onPaywallSkip });
    native.__emit('onPaywallSkipEvent', entitledSkip);

    expect(onPaywallSkip).not.toHaveBeenCalled();

    native.__emit('onEntitledEvent', entitledSkip);

    expect(onEntitled).toHaveBeenCalledTimes(1);
    expect(onEntitled).toHaveBeenCalledWith(entitledSkip);
    expect(onPaywallSkip).not.toHaveBeenCalled();

    native.__emit('onPaywallSkipEvent', entitledSkip);

    expect(onPaywallSkip).not.toHaveBeenCalled();
  });

  it('normalizes a skip arriving over the entitled channel when no onEntitled is set', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onPaywallSkip = jest.fn();

    helium.presentUpsell({ triggerName: 'go_online', onPaywallSkip });
    native.__emit('onEntitledEvent', { type: 'paywallSkipped' });

    expect(onPaywallSkip).toHaveBeenCalledWith({
      type: 'paywallSkipped',
      triggerName: 'hlm_unknown',
      skipReason: 'unknown',
    });
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('normalizes a skip arriving over the skip channel', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onPaywallSkip = jest.fn();

    helium.presentUpsell({ triggerName: 'go_online', onPaywallSkip });
    native.__emit('onPaywallSkipEvent', { type: 'paywallSkipped' });

    expect(onPaywallSkip).toHaveBeenCalledWith({
      type: 'paywallSkipped',
      triggerName: 'hlm_unknown',
      skipReason: 'unknown',
    });
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('keeps the skip handler of a paywall re-presented from onPaywallUnavailable', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const onPaywallSkip = jest.fn();
    const onPaywallUnavailable = jest.fn(() => {
      helium.presentUpsell({ triggerName: 'second', onPaywallSkip });
    });

    helium.presentUpsell({ triggerName: 'first', onPaywallUnavailable });
    native.__emit('onHeliumPaywallEvent', {
      type: 'paywallOpenFailed',
      triggerName: 'first',
      paywallUnavailableReason: 'notInitialized',
    });

    expect(onPaywallUnavailable).toHaveBeenCalledTimes(1);

    native.__emit('onPaywallSkipEvent', {
      type: 'paywallSkipped',
      triggerName: 'second',
      skipReason: 'targetingHoldout',
    });

    expect(onPaywallSkip).toHaveBeenCalledTimes(1);
  });

  it('clears the skip handler when the paywall closes', async () => {
    const { helium, native } = loadHelium();
    await helium.initialize(CONFIG);
    const onPaywallSkip = jest.fn();

    helium.presentUpsell({ triggerName: 'go_online', onPaywallSkip });
    native.__emit('onHeliumPaywallEvent', { type: 'paywallClose', triggerName: 'go_online' });
    native.__emit('onPaywallSkipEvent', SKIP_EVENT);

    expect(onPaywallSkip).not.toHaveBeenCalled();
  });
});

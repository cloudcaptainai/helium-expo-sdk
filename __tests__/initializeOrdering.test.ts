/**
 * `initialize` writes the paywall bundle to disk before it hands the config to the native SDK, so
 * it is only done some time after the JS call returns. Apps commonly fire it without awaiting and
 * present a paywall moments later, which used to let `presentUpsell` reach the native SDK first
 * and fail as not-initialized.
 *
 * These tests pin the ordering the native SDK sees, whatever the JS caller does.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

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

jest.mock('expo-file-system', () => {
  const pendingWrites: Array<() => void> = [];
  return {
    documentDirectory: 'file:///documents/',
    writeAsStringAsync: jest.fn(() => new Promise<void>((resolve) => {
      pendingWrites.push(resolve);
    })),
    /** Test handle: releases the oldest bundle write that an `initialize` is waiting on. */
    __finishWrite: () => pendingWrites.shift()?.(),
  };
});

type NativeModuleMock = {
  initialize: jest.Mock;
  setupCore: jest.Mock;
  presentUpsell: jest.Mock;
  fallbackOpenOrCloseEvent: jest.Mock;
  __emit: (name: string, event: unknown) => void;
};

type FileSystemMock = { __finishWrite: () => void; writeAsStringAsync: jest.Mock };

/** Each test needs the module's initialization state fresh, and it is module-level. */
function loadHelium() {
  let helium!: typeof import('../src/index');
  let native!: NativeModuleMock;
  let fileSystem!: FileSystemMock;
  jest.isolateModules(() => {
    helium = require('../src/index');
    native = require('../src/HeliumPaywallSdkModule').default;
    fileSystem = require('expo-file-system');
  });
  return { helium, native, fileSystem };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const CONFIG = { apiKey: 'test-key', fallbackBundle: { paywalls: [] } };
/** Distinct from CONFIG so assertions can tell which initialization reached the native SDK. */
const CONFIG_AFTER_RESET = { apiKey: 'test-key-after-reset', fallbackBundle: { paywalls: [] } };
/** Fails while assembling the native config, the one window in which a reset can overtake it. */
const CONFIG_THAT_FAILS_AFTER_WRITE = {
  apiKey: 'test-key',
  fallbackBundle: { paywalls: [] },
  get customUserTraits(): Record<string, any> {
    throw new Error('trait access blew up');
  },
};

/** The native SDK does not throw when it has no configuration; it reports over the event channel. */
const reportOpenFailedFromNative = (native: NativeModuleMock) => {
  native.presentUpsell.mockImplementation((triggerName: string) => {
    native.__emit('onHeliumPaywallEvent', {
      type: 'paywallOpenFailed',
      triggerName,
      error: 'not initialized',
    });
  });
};

describe('presentUpsell ordering against initialize', () => {
  it('holds the native present until the native initialize has been made', async () => {
    const { helium, native, fileSystem } = loadHelium();

    void helium.initialize(CONFIG);
    helium.presentUpsell({ triggerName: 'go_online' });

    expect(native.initialize).not.toHaveBeenCalled();
    expect(native.presentUpsell).not.toHaveBeenCalled();

    fileSystem.__finishWrite();
    await flushMicrotasks();

    expect(native.initialize).toHaveBeenCalledTimes(1);
    expect(native.presentUpsell).toHaveBeenCalledTimes(1);
    expect(native.initialize.mock.invocationCallOrder[0])
      .toBeLessThan(native.presentUpsell.mock.invocationCallOrder[0]);
  });

  it('presents immediately when no initialization is in flight', () => {
    const { helium, native } = loadHelium();

    helium.presentUpsell({ triggerName: 'go_online' });

    expect(native.presentUpsell).toHaveBeenCalledTimes(1);
  });

  it('presents immediately once initialization has completed', async () => {
    const { helium, native, fileSystem } = loadHelium();
    const initializing = helium.initialize(CONFIG);
    fileSystem.__finishWrite();
    await initializing;

    helium.presentUpsell({ triggerName: 'go_online' });

    expect(native.presentUpsell).toHaveBeenCalledTimes(1);
  });

  it('still presents when initialization gave up, so the failure comes from the native SDK', async () => {
    const { helium, native, fileSystem } = loadHelium();
    native.initialize.mockImplementation(() => {
      throw new Error('native initialize blew up');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    void helium.initialize(CONFIG);
    helium.presentUpsell({ triggerName: 'go_online' });
    fileSystem.__finishWrite();
    await flushMicrotasks();

    expect(native.presentUpsell).toHaveBeenCalledTimes(1);
  });

  it('routes the native open failure to onPaywallUnavailable when initialization gave up', async () => {
    const { helium, native, fileSystem } = loadHelium();
    native.initialize.mockImplementation(() => {
      throw new Error('native initialize blew up');
    });
    reportOpenFailedFromNative(native);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const onPaywallUnavailable = jest.fn();

    void helium.initialize(CONFIG);
    helium.presentUpsell({ triggerName: 'go_online', onPaywallUnavailable });
    fileSystem.__finishWrite();
    await flushMicrotasks();

    expect(onPaywallUnavailable).toHaveBeenCalledTimes(1);
  });

  it('waits for the current initialization when a reset abandoned an earlier one', async () => {
    const { helium, native, fileSystem } = loadHelium();
    void helium.initialize(CONFIG);
    await helium.resetHelium();
    void helium.initialize(CONFIG_AFTER_RESET);

    helium.presentUpsell({ triggerName: 'go_online' });

    fileSystem.__finishWrite();
    await flushMicrotasks();
    expect(native.initialize).not.toHaveBeenCalled();
    expect(native.presentUpsell).not.toHaveBeenCalled();

    fileSystem.__finishWrite();
    await flushMicrotasks();
    expect(native.initialize).toHaveBeenCalledTimes(1);
    expect(native.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: CONFIG_AFTER_RESET.apiKey }),
    );
    expect(native.presentUpsell).toHaveBeenCalledTimes(1);
  });

  it('drops a queued present when a reset abandons the initialization it waited on', async () => {
    const { helium, native, fileSystem } = loadHelium();
    void helium.initialize(CONFIG);
    helium.presentUpsell({ triggerName: 'go_online' });

    await helium.resetHelium();
    fileSystem.__finishWrite();
    await flushMicrotasks();

    expect(native.initialize).not.toHaveBeenCalled();
    expect(native.presentUpsell).not.toHaveBeenCalled();
  });

  it('completes the present failure path when the host callback throws', async () => {
    const { helium, native, fileSystem } = loadHelium();
    native.presentUpsell.mockImplementation(() => {
      throw new Error('native presentUpsell blew up');
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const onPaywallUnavailable = jest.fn(() => {
      throw new Error('host onPaywallUnavailable blew up');
    });

    void helium.initialize(CONFIG);
    helium.presentUpsell({ triggerName: 'go_online', onPaywallUnavailable });
    fileSystem.__finishWrite();
    await flushMicrotasks();

    expect(onPaywallUnavailable).toHaveBeenCalledTimes(1);
    expect(native.fallbackOpenOrCloseEvent).toHaveBeenCalledTimes(1);
  });

  it('never throws at the caller when the present recovery path also fails', () => {
    const { helium, native } = loadHelium();
    native.presentUpsell.mockImplementation(() => {
      throw new Error('native presentUpsell blew up');
    });
    native.fallbackOpenOrCloseEvent.mockImplementation(() => {
      throw new Error('native fallbackOpenOrCloseEvent blew up');
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => helium.presentUpsell({ triggerName: 'go_online' })).not.toThrow();
    expect(native.fallbackOpenOrCloseEvent).toHaveBeenCalledTimes(1);
  });

  it('presents immediately again after resetHelium re-arms initialization', async () => {
    const { helium, native, fileSystem } = loadHelium();
    const initializing = helium.initialize(CONFIG);
    fileSystem.__finishWrite();
    await initializing;
    await helium.resetHelium();

    helium.presentUpsell({ triggerName: 'go_online' });

    expect(native.presentUpsell).toHaveBeenCalledTimes(1);
  });
});

describe('initialize against callers that await it', () => {
  it('holds a concurrent initialize until the native initialize has been made', async () => {
    const { helium, native, fileSystem } = loadHelium();
    void helium.initialize(CONFIG);

    let resolved = false;
    const concurrent = helium.initialize(CONFIG).then(() => {
      resolved = true;
    });
    await flushMicrotasks();

    expect(resolved).toBe(false);
    expect(native.initialize).not.toHaveBeenCalled();

    fileSystem.__finishWrite();
    await concurrent;

    expect(native.initialize).toHaveBeenCalledTimes(1);
  });

  it('holds a _setupCore that follows an initialize already in flight', async () => {
    const { helium, native, fileSystem } = loadHelium();
    void helium.initialize(CONFIG);

    let resolved = false;
    const settingUpCore = helium._setupCore(CONFIG).then(() => {
      resolved = true;
    });
    await flushMicrotasks();

    expect(resolved).toBe(false);

    fileSystem.__finishWrite();
    await settingUpCore;

    expect(native.initialize).toHaveBeenCalledTimes(1);
    expect(native.setupCore).not.toHaveBeenCalled();
  });

  it('lets an abandoned initialization fail without disturbing the current one', async () => {
    const { helium, native, fileSystem } = loadHelium();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    void helium.initialize(CONFIG_THAT_FAILS_AFTER_WRITE);
    await helium.resetHelium();
    void helium.initialize(CONFIG_AFTER_RESET);

    // Pin that the abandoned initialization fails after its write, since that is the only point
    // the reset can have overtaken it.
    expect(consoleError).not.toHaveBeenCalled();
    fileSystem.__finishWrite();
    await flushMicrotasks();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Initialization failed'),
      expect.anything(),
    );

    // The surviving initialization still owns the state, so a later caller joins it.
    void helium.initialize(CONFIG_AFTER_RESET);
    await flushMicrotasks();
    expect(fileSystem.writeAsStringAsync).toHaveBeenCalledTimes(2);

    fileSystem.__finishWrite();
    await flushMicrotasks();
    expect(native.initialize).toHaveBeenCalledTimes(1);
    expect(native.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: CONFIG_AFTER_RESET.apiKey }),
    );
  });
});

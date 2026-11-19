jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-file-system', () => ({}));

jest.mock('../src/HeliumPaywallSdkModule', () => ({
  __esModule: true,
  default: {
    setUserTraits: jest.fn(),
    addUserTraits: jest.fn(),
    getUserTraits: jest.fn(),
  },
}));

import HeliumPaywallSdkModule from '../src/HeliumPaywallSdkModule';
import { addUserTraits, getUserTraits, setUserTraits } from '../src';

const nativeModule = HeliumPaywallSdkModule as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

test('setUserTraits converts booleans to bridge markers', () => {
  setUserTraits({ isPremium: true, level: 2, nested: { optedIn: false } });
  expect(nativeModule.setUserTraits).toHaveBeenCalledWith({
    isPremium: '__helium_rn_bool_true__',
    level: 2,
    nested: { optedIn: '__helium_rn_bool_false__' },
  });
});

test('addUserTraits converts booleans to bridge markers', () => {
  addUserTraits({ optedIn: false });
  expect(nativeModule.addUserTraits).toHaveBeenCalledWith({
    optedIn: '__helium_rn_bool_false__',
  });
});

test('getUserTraits returns the native traits', () => {
  nativeModule.getUserTraits.mockReturnValue({ plan: 'pro' });
  expect(getUserTraits()).toEqual({ plan: 'pro' });
});

test('getUserTraits returns an empty object when the bridge throws', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  nativeModule.getUserTraits.mockImplementation(() => {
    throw new Error('boom');
  });
  expect(getUserTraits()).toEqual({});
});

test('setUserTraits does not throw when the bridge throws', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  nativeModule.setUserTraits.mockImplementation(() => {
    throw new Error('boom');
  });
  expect(() => setUserTraits({ plan: 'pro' })).not.toThrow();
});

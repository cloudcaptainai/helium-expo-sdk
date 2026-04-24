
import {
  HeliumPaywallEvent,
  hasActivePaddleEntitlement,
  hasAnyActiveSubscription,
  hasAnyEntitlement,
  hasEntitlementForPaywall,
  heliumHandleURL,
  clearCustomUserId,
  getCustomUserId,
  initialize,
  presentUpsell, enableExternalWebCheckout,
  setCustomUserId,
} from 'expo-helium';
import {useEffect, useState} from "react";
import { Alert, Button, Linking, SafeAreaView, ScrollView, Text, useColorScheme, View } from 'react-native';

const randomUuid = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export default function App() {
  const isDark = useColorScheme() === 'dark';
  const [customUserId, setCustomUserIdState] = useState<string | null>(null);

  const refreshCustomUserId = () => {
    try {
      setCustomUserIdState(getCustomUserId());
    } catch (e) {
      console.error('refreshCustomUserId failed', e);
    }
  };

  const asyncHeliumInit = async () => {
    enableExternalWebCheckout({
      successURL: "heliumexpo://openapps",
      cancelURL: "heliumexpo://openapps",
    })
    await initialize({
      apiKey: process.env.EXPO_PUBLIC_HELIUM_API_KEY ?? '',
    });
    refreshCustomUserId();
  };

  useEffect(() => {
    void asyncHeliumInit();
  }, []);

  useEffect(() => {
    const onUrl = (url: string) => {
      if (!heliumHandleURL(url)) {
        console.log('[App] URL not handled by Helium:', url);
      }
    };
    const sub = Linking.addEventListener('url', (event) => onUrl(event.url));
    void Linking.getInitialURL().then((url) => {
      if (url) onUrl(url);
    });
    return () => sub.remove();
  }, []);

  const runEntitlementChecks = async () => {
    const trigger = process.env.EXPO_PUBLIC_HELIUM_TRIGGER ?? '';
    const format = (value: unknown) =>
      value instanceof Error ? `Error: ${value.message}` : String(value);
    const check = async (label: string, fn: () => Promise<unknown> | unknown) => {
      try {
        return `${label}: ${format(await fn())}`;
      } catch (e) {
        return `${label}: ${format(e)}`;
      }
    };
    const lines = await Promise.all([
      check('hasAnyActiveSubscription', () => hasAnyActiveSubscription()),
      check('hasAnyEntitlement', () => hasAnyEntitlement()),
      check(`hasEntitlementForPaywall(${trigger})`, () => hasEntitlementForPaywall(trigger)),
      check('hasActivePaddleEntitlement', () => hasActivePaddleEntitlement()),
    ]);
    Alert.alert('Entitlement checks', lines.join('\n'));
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#111' : '#eee' }]}>
      <ScrollView style={[styles.container, { backgroundColor: isDark ? '#111' : '#eee' }]}>
        <Text style={[styles.header, { color: isDark ? '#fff' : '#000' }]}>Helium Example</Text>
        <Group name="Paywall actions">
          <Button
            title="Show paywall!"
            onPress={async () => {
              presentUpsell({
                triggerName: process.env.EXPO_PUBLIC_HELIUM_TRIGGER ?? '',
                eventHandlers: {
                  onOpen: async (e) => {
                    console.log('eventHandler open', e.type);
                  },
                  onClose: async (e) => {
                    console.log('eventHandler close', e.type);
                  },
                  onOpenFailed: async (e) => {
                    console.log('eventHandler openFail', e.type);
                  }
                },
                // dontShowIfAlreadyEntitled: true,
                onEntitled: () => {
                  console.log('onEntitled called!')
                },
                onPaywallUnavailable: () => {
                  console.log('onPaywallUnavailable called!')
                },
              });
            }}
          />
        </Group>
        <Group name="Entitlement checks">
          <Button title="Run all checks" onPress={runEntitlementChecks} />
        </Group>
        <Group name="User ID">
          <Text style={{ color: isDark ? '#fff' : '#000', marginBottom: 12 }}>
            Current: {customUserId ?? '(none)'}
          </Text>
          <Button
            title="Set random UUID"
            onPress={() => {
              try {
                setCustomUserId(randomUuid());
                refreshCustomUserId();
              } catch (e) {
                console.error('setCustomUserId failed', e);
              }
            }}
          />
          <Button
            title="Clear"
            onPress={() => {
              try {
                clearCustomUserId();
                refreshCustomUserId();
              } catch (e) {
                console.error('clearCustomUserId failed', e);
              }
            }}
          />
          <Button title="Refresh" onPress={refreshCustomUserId} />
        </Group>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group(props: { name: string; children: React.ReactNode }) {
  const isDark = useColorScheme() === 'dark';
  return (
    <View style={[styles.group, { backgroundColor: isDark ? '#222' : '#fff' }]}>
      <Text style={[styles.groupHeader, { color: isDark ? '#fff' : '#000' }]}>{props.name}</Text>
      {props.children}
    </View>
  );
}

const styles = {
  header: {
    fontSize: 30,
    margin: 20,
  },
  groupHeader: {
    fontSize: 20,
    marginBottom: 20,
  },
  group: {
    margin: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'flex-start' as const,
  },
  container: {
    flex: 1,
    backgroundColor: '#eee',
  },
  view: {
    flex: 1,
    height: 200,
  },
};

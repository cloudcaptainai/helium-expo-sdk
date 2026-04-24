
import {
  HeliumPaywallEvent,
  hasActivePaddleEntitlement,
  hasAnyActiveSubscription,
  hasAnyEntitlement,
  hasEntitlementForPaywall,
  initialize,
  presentUpsell,
} from 'expo-helium';
import {useEffect} from "react";
import { Alert, Button, SafeAreaView, ScrollView, Text, useColorScheme, View } from 'react-native';

export default function App() {
  const isDark = useColorScheme() === 'dark';

  const asyncHeliumInit = async () => {
    await initialize({
      apiKey: process.env.EXPO_PUBLIC_HELIUM_API_KEY ?? '',
      onHeliumPaywallEvent: function (event: HeliumPaywallEvent): void {
        console.log('Helium Paywall Event:', event);
      },
    });
  };

  useEffect(() => {
    void asyncHeliumInit();
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


import {HeliumPaywallEvent, initialize, presentUpsell} from 'expo-helium';
import {useEffect} from "react";
import { Button, SafeAreaView, ScrollView, Text, useColorScheme, View } from 'react-native';

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

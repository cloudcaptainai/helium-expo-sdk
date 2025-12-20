
import {HeliumPaywallEvent, initialize, presentUpsell} from 'expo-paywall-sdk';
import { Button, SafeAreaView, ScrollView, Text, View } from 'react-native';
import {useEffect} from "react";
import {createCustomPurchaseConfig} from "expo-paywall-sdk";

export default function App() {
  const asyncHeliumInit = async () => {
    await initialize({
      apiKey: 'api-key-here',
      onHeliumPaywallEvent: function (event: HeliumPaywallEvent): void {
        console.log('Helium Paywall Event:', event);
      },
    });
  };

  useEffect(() => {
    void asyncHeliumInit();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.container}>
        <Text style={styles.header}>Helium Example</Text>
        <Group name="Paywall actions">
          <Button
            title="Show paywall!"
            onPress={async () => {
              presentUpsell({
                triggerName: 'trigger-name-here',
                onFallback: () => {
                  console.log('fallback!!!')
                }
              });
            }}
          />
        </Group>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group(props: { name: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupHeader}>{props.name}</Text>
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

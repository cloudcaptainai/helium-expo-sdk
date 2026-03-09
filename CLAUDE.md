# CLAUDE.md

## Project overview

Expo module SDK for Helium paywalls. Bridges native iOS (Swift) and Android (Kotlin) SDKs to React Native/Expo via TypeScript.

## Key principles

- **Never crash.** This SDK is distributed to apps with millions of users. Prefer defensive error handling (try/catch) over letting exceptions propagate. A swallowed error is always better than a crash.
- **Avoid using "fallback" in code and comments** unless referring to the Helium fallback paywall flow. This term has a specific meaning in this SDK.

## Key architecture rule

**When modifying the native bridge interface, both iOS and Android native modules MUST be updated.** Expo modules match function arguments positionally — a mismatch causes a runtime crash. Even platform-specific parameters must be declared (and ignored) on the other platform.

Relevant files for bridge changes:
- `src/index.ts` — JS bridge calls
- `src/HeliumPaywallSdk.types.ts` — TypeScript types
- `ios/HeliumPaywallSdkModule.swift` — iOS native module
- `android/src/main/java/expo/modules/paywallsdk/HeliumPaywallSdkModule.kt` — Android native module

## Packages

- `packages/stripe/` — Helium Stripe integration (iOS-only native module, guards on `Platform.OS`)
- `packages/revenuecat/` — RevenueCat integration

## Commands

See `scripts` in `package.json` for available commands.

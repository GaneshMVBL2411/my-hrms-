import { LogBox } from "react-native"

/**
 * Warnings that are true, expected, and not worth a full-screen overlay.
 *
 * This lives in its own module for one reason: when it runs. A warning raised
 * while a module is being *imported* has already been shown by the time the
 * importing file's own body executes, so the two `ignoreLogs` calls this
 * replaced — one in App.tsx, one after `import App` in index.ts — could never
 * have suppressed one. ES imports are evaluated in source order before the
 * body that follows them, so importing this first, ahead of App, is what puts
 * the filter in place before anything has a chance to warn.
 *
 * Each entry below is here because it describes the environment rather than a
 * fault in this app, and because there is nothing to act on:
 *
 *   Expo CLI       the dev-tools websocket does not always establish over a
 *                  LAN without USB debugging. The bundle, the app and the API
 *                  are unaffected.
 *   media library  Android tightened photo permissions and Expo Go cannot ask
 *                  for the full set. The message is advice to make a
 *                  development build, which this project has — so in the build
 *                  people actually use, the limitation it warns about is not
 *                  there.
 *
 * Anything that is a fault in this app belongs on screen, so this list should
 * stay short and each addition should say why it is not one.
 */
LogBox.ignoreLogs([
  "Cannot connect to Expo CLI",
  "Expo Go can no longer provide full access to the media library",
])

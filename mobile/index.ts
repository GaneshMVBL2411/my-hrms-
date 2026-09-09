import { registerRootComponent } from "expo"
import { LogBox } from "react-native"
import App from "./App"

// Suppress non-fatal Expo CLI disconnect warning modal from blocking the UI
LogBox.ignoreLogs([
  "Cannot connect to Expo CLI",
])

registerRootComponent(App)


// First, and deliberately above the App import: the warnings it filters are
// raised while modules are being imported, so the filter has to be installed
// before those imports run. Moving this line below the next one puts it back
// after the warnings it is meant to suppress.
import "./src/logbox"

import { registerRootComponent } from "expo"
import App from "./App"

registerRootComponent(App)


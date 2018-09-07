# roon-extension-denon-telnet
Roon extension for controlling volume on a denon/marantz AVR via the Roon application.

This extension has some advantages over the existing roon-extension-denon plugin:
1. It uses a temporary connection to the AVR, so you can have multiple apps talking to it.
2. It should have a broader compatibilty as it does not try and screen scrap any data.

It also has some disadvantages:
1. It uses polling to get updated information, so if you change something on the AVR directly, it will not be reflected in the app immediately.
2. Configuration is less automated. You must supply an IP and an input source, and the input source name should be the original name, not a re-labelled one.



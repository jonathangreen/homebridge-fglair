# Homebridge FGLair (Fujitsu)

This is a homebridge plugin for Fujitsu heatpumps that use the FGLair app to set their settings.

It has the following features I was unable to find in other Fujitsu heat pump plugins:

- Proper use of authentication tokens, so the plugin doesn't have to log in every time.
- Correctly show the current room temperature at the heatpump.
- Ability to adjust fan speed & slat angle as well as the temperature set-point and heat pump operating mode.

## Installation

1. Install homebridge
2. Install the plugin `npm install -g homebridge-fujitsu`
3. Edit your `config.json` file.

```json
{
  "platforms": [
    {
      "platform": "FGLair",
      "name": "homebridge-fglair",
      "username": "FGLAIR USERNAME",
      "password": "FGLAIR PASSWORD",
      "mac": "(See below)"
    }
  ]
}
```

- `platform`: Must be `FGLair`
- `name`: Name to appear in the Home app
- `username`: FGLair Username
- `password`: FGLair Password
- `mac`- This is used to find the device in your account. If you click the settings cog at the bottom of the app,
    then click `Air conditioner Setting`, then expand the name of the Heat pump you would like to connect to homekit
    the app will show the mac address above the friendly name you have set for the heat pump. It will have the format
    `AC-UTY-xxxxxxxxxxxx`.

## Troubleshooting
If you have any issues, please create a ticket in github. I'll try to help out as I can.

## Current Limitations
- Currently only supports one heat pump. It shouldn't be hard to support multiple, but I only have a single
    unit, so I can't test this. If you have multiple units, make an issue and let me know. We should be able to
    add support. Or even better pull requests to add this support are always welcome.
- Right now you can't adjust the slats position through the default "Home" app. This seems to be a limitation of
    the home app. The slats service that this plugin exposes can be adjusted using 3rd party homekit apps like the
    "[eve](https://apps.apple.com/ca/app/eve-for-matter-homekit/id917695792)" app. I'm hoping to figure out a way
    to make slats work in the home app in the future.

## Contributions
Portions of this software adapted from the projects listed below.  A huge thank you, for all their work.

- homebridge-fujitsu by smithersDBQ https://github.com/smithersDBQ/homebridge-fujitsu
- The pyfujitsu project https://github.com/Mmodarre/pyfujitsu
- Homebridge plugin template https://github.com/homebridge/homebridge-plugin-template

I also was greatly helped along by the API documentation here:
https://docs.aylanetworks.com/reference/create-datapoint-by-dsn

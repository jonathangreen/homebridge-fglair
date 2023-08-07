import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HeatpumpAccessory } from './platformAccessory';
import {FglairApi} from './fglairApi';
import {DeviceInfoResponse} from './apiResponse';

/**
 * FujitsuPlatformPlugin
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class FujitsuPlatformPlugin implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public DeviceApi: FglairApi;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });

    const tokenPath = this.api.user.storagePath() + '/homebridge-fglair.json';
    this.log.debug('Key persistence path: ', tokenPath);

    this.DeviceApi = new FglairApi(config.username, config.password, log, tokenPath);
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    const required = ['name', 'username', 'password', 'mac'];
    for(const setting of required) {
      if(this.config[setting] === undefined) {
        this.log.error(`Required configuration '${setting}' missing. Please define it and restart homebridge.`);
        return;
      }
    }

    this.DeviceApi.getDevices().then(
      devices => {
        this.log.debug('Device Identifier: ', this.config.mac);
        const prefix = 'ac-uty-';
        let mac = this.config.mac.toLowerCase();
        if (mac.startsWith(prefix)) {
          mac = mac.slice(prefix.length);
        }
        if (!(mac in devices)) {
          this.log.error(`Device: '${mac}' not found. Please check configuration.`);
          return;
        }
        const device_info: DeviceInfoResponse = devices[mac];

        // create the device + UUID based on its serial number
        this.log.debug('Creating device: ', device_info.dsn);
        const uuid = this.api.hap.uuid.generate(device_info.dsn);

        // see if an accessory with the same uuid has already been registered and restored from
        // the cached devices we stored in the `configureAccessory` method above
        let existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

        const reset_cached = false;
        if(reset_cached) {
          for (const accessory of this.accessories) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          }
          existingAccessory = undefined;
        }

        this.DeviceApi.getDeviceProperties(device_info.dsn).then(
          device_properties => {
            if (existingAccessory) {
              // the accessory already exists
              this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

              // create the accessory handler for the restored accessory
              // this is imported from `platformAccessory.ts`
              new HeatpumpAccessory(this, existingAccessory, device_info, device_properties);
            } else {
              // the accessory does not yet exist, so we need to create it
              this.log.info('Adding new accessory:', this.config.name);

              // create a new accessory
              const accessory = new this.api.platformAccessory(<string>this.config.name, uuid);

              // create the accessory handler for the newly create accessory
              // this is imported from `platformAccessory.ts`
              new HeatpumpAccessory(this, accessory, device_info, device_properties);

              // link the accessory to your platform
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
          },
        );
      },
    );
  }
}

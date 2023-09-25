import {Characteristic, CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {FujitsuPlatformPlugin} from './platform';
import {DeviceState, NormalizedProperty, OperationMode} from './fglairApi';
import {DeviceInfoResponse, DevicePropertiesResponse} from './apiResponse';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HeatpumpAccessory {
  private readonly thermostat: Service;
  private readonly fan: Service;
  private readonly hslat: Service;
  private readonly vslat: Service;

  private readonly fahrenheit: boolean;

  private remote_state: DeviceState;
  private local_state: DeviceState;

  private dsn: string;

  private main_loop_counter = 0;

  constructor(
    private readonly platform: FujitsuPlatformPlugin,
    private readonly accessory: PlatformAccessory,
    private readonly deviceInfo: DeviceInfoResponse,
    deviceProperties: DevicePropertiesResponse,
  ) {
    this.dsn = deviceInfo.dsn;
    this.remote_state = new DeviceState(platform.log, deviceProperties);
    this.local_state = new DeviceState(platform.log);

    // Temperature in fahrenheit
    this.fahrenheit = platform.config['temperature_unit'] !== undefined && platform.config['temperature_unit'] === 'fahrenheit';

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, deviceInfo.product_name)
      .setCharacteristic(this.platform.Characteristic.Model, deviceInfo.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, deviceInfo.dsn)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, deviceInfo.sw_version)
      .setCharacteristic(this.platform.Characteristic.Name, this.remote_state.device_name.value);

    // Create the thermostat service
    this.thermostat = this.createThermostatService(this.fahrenheit);

    // Create the fan service
    this.fan = this.createFanService(this.thermostat);

    // Create vertical slat
    this.vslat = this.createVerticalSlatService(this.thermostat);

    // Create horizontal slat
    this.hslat = this.createHorizontalSlatService(this.thermostat);

    // Set initial state
    this.updateCurrentTemp();

    // Main update loop (every second)
    setInterval(this.mainUpdateLoop.bind(this), 1000);

    // Timer to update current temp every 2 minutes
    setInterval(this.updateCurrentTemp.bind(this), 2 * 60 * 1000);
  }

  private createThermostatService(fahrenheit: boolean): Service {
    const thermostat = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    thermostat.setPrimaryService(true);
    thermostat.updateCharacteristic(this.platform.Characteristic.ConfiguredName, 'Heatpump');

    let temp_unit;
    if(fahrenheit) {
      temp_unit = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    }
    else {
      temp_unit = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
    thermostat.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, temp_unit);

    this.setHandlers(
      thermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState),
      this.remote_state.operation_mode,
      this.local_state.operation_mode,
    );

    this.setHandlers(
      thermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature),
      this.remote_state.adjust_temperature,
      this.local_state.adjust_temperature,
    ).setProps({
      minStep: fahrenheit ? 1 : 0.5,
    });

    this.setHandlers(
      thermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature),
      this.remote_state.display_temperature,
      null,
    ).setProps({
      minStep: fahrenheit ? 1 : 0.25,
    });

    thermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(() => {
        let CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;

        if (this.remote_state.operation_mode.value === OperationMode.cool ||
          this.remote_state.operation_mode.value === OperationMode.auto ||
          this.remote_state.operation_mode.value === OperationMode.dry) {
          if (this.remote_state.display_temperature.normalized_value > this.remote_state.adjust_temperature.normalized_value) {
            CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
          }
        }

        if (this.remote_state.operation_mode.value === OperationMode.heat ||
          this.remote_state.operation_mode.value === OperationMode.auto) {
          if (this.remote_state.display_temperature.normalized_value < this.remote_state.adjust_temperature.normalized_value) {
            CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
          }
        }

        this.platform.log.debug('CurrentHeatingCoolingState onGet', CurrentHeatingCoolingState);
        return CurrentHeatingCoolingState;
      });

    return thermostat;
  }

  private createFanService(mainService: Service): Service {
    const fan = this.accessory.getService(this.platform.Service.Fan) ||
      this.accessory.addService(this.platform.Service.Fan);

    fan.setPrimaryService(false);
    mainService.addLinkedService(fan);
    fan.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    fan.updateCharacteristic(this.platform.Characteristic.ConfiguredName, 'Fan');

    this.setHandlers(
      fan.getCharacteristic(this.platform.Characteristic.RotationSpeed),
      this.remote_state.fan_speed,
      this.local_state.fan_speed,
    ).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: 25,
    });

    fan.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        const value = this.remote_state.operation_mode.value !== OperationMode.off;
        this.platform.log.debug('On onGet', value);
        return value;
      });

    return fan;
  }

  private createVerticalSlatService(mainService: Service) : Service {
    const vslat = this.accessory.getService('vertical') ||
      this.accessory.addService(this.platform.Service.Slats, 'vertical', 'v');

    vslat.setPrimaryService(false);
    mainService.addLinkedService(vslat);
    vslat.updateCharacteristic(this.platform.Characteristic.SlatType, this.platform.Characteristic.SlatType.VERTICAL);
    vslat.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    vslat.updateCharacteristic(this.platform.Characteristic.ConfiguredName, 'Vertical');

    this.setHandlers(
      vslat.getCharacteristic(this.platform.Characteristic.SwingMode),
      this.remote_state.af_vertical_swing,
      this.local_state.af_vertical_swing,
    );

    this.setHandlers(
      vslat.getCharacteristic(this.platform.Characteristic.TargetTiltAngle),
      this.remote_state.af_vertical_direction,
      this.local_state.af_vertical_direction,
    ).setProps({
      minValue: 0,
      maxValue: 70,
      minStep: 10,
    });

    vslat.getCharacteristic(this.platform.Characteristic.CurrentSlatState)
      .onGet(() => {
        const value = this.slatState(this.remote_state.af_vertical_swing.value);
        this.platform.log.debug('CurrentSlatState onGet', value);
        return value;
      });

    return vslat;
  }

  private createHorizontalSlatService(mainService: Service) : Service {
    const hslat = this.accessory.getService('horizontal') ||
      this.accessory.addService(this.platform.Service.Slats, 'horizontal', 'h');

    hslat.setPrimaryService(false);
    mainService.addLinkedService(hslat);
    hslat.updateCharacteristic(this.platform.Characteristic.SlatType, this.platform.Characteristic.SlatType.HORIZONTAL);
    hslat.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    hslat.updateCharacteristic(this.platform.Characteristic.ConfiguredName, 'Horizontal');

    this.setHandlers(
      hslat.getCharacteristic(this.platform.Characteristic.SwingMode),
      this.remote_state.af_horizontal_swing,
      this.local_state.af_horizontal_swing,
    );

    this.setHandlers(
      hslat.getCharacteristic(this.platform.Characteristic.TargetTiltAngle),
      this.remote_state.af_horizontal_direction,
      this.local_state.af_horizontal_direction,
    ).setProps({
      minValue: -40,
      maxValue: 40,
      minStep: 20,
    });

    hslat.getCharacteristic(this.platform.Characteristic.CurrentSlatState)
      .onGet(() => {
        const value = this.slatState(this.remote_state.af_horizontal_swing.value);
        this.platform.log.debug('CurrentSlatState onGet', value);
        return value;
      });

    return hslat;
  }

  private updateCurrentTemp() {
    this.local_state.get_prop.value = true;
    this.platform.log.debug('updateCurrentTemp');
  }

  private mainUpdateLoop() {
    this.main_loop_counter += 1;
    this.main_loop_counter %= 30;

    // See if we need to send any property updates
    const initialized = this.local_state.getInitialized();
    for (const key in initialized) {
      // Reset any keys in the local state we are about to send.
      this.local_state[key].reset();
    }
    this.platform.log.debug('Event loop: (counter) (local_state)', this.main_loop_counter, initialized);
    if(Object.keys(initialized).length > 0) {
      this.platform.DeviceApi.setDeviceProperties(this.dsn, initialized)
        .then(this.remoteSync.bind(this));
    } else if (this.main_loop_counter === 0) {
      // Sync remote values every 30 seconds
      this.remoteSync();
    }
  }

  private onSetState<ValueType, NormalizedType>(
    x: CharacteristicValue,
    property: NormalizedProperty<ValueType, NormalizedType>,
    name: string) {
    property.normalized_value = x as NormalizedType;
    this.platform.log.debug(`${name} onSet`, x);
  }

  private onGetState<ValueType, NormalizedType>(
    property: NormalizedProperty<ValueType, NormalizedType>,
    name: string,
  ): CharacteristicValue {
    this.platform.log.debug(`${name} onGet`, property.normalized_value);
    return property.normalized_value as CharacteristicValue;
  }

  private setHandlers<ValueType, NormalizedType>(
    characteristic: Characteristic,
    remote_property: NormalizedProperty<ValueType, NormalizedType>,
    local_property: NormalizedProperty<ValueType, NormalizedType> | null,
  ): Characteristic {
    characteristic.onGet(() => this.onGetState(remote_property, characteristic.constructor.name));
    if (local_property !== null) {
      characteristic.onSet(x => this.onSetState(x, local_property, characteristic.constructor.name));
    }

    return characteristic;
  }

  protected remoteSync() {
    this.platform.DeviceApi.getDeviceProperties(this.dsn)
      .then(getPropertiesResponse => {
        this.remote_state.setProperties(getPropertiesResponse);
        this.platform.log.debug('Sync device properties.');
        this.platform.log.debug('Local state: ', this.local_state.getInitialized());
        this.platform.log.debug('Remote state: ', this.remote_state.getInitialized());
      });
  }

  protected slatState(swing: boolean) {
    return swing ? this.platform.Characteristic.CurrentSlatState.SWINGING : this.platform.Characteristic.CurrentSlatState.FIXED;
  }
}

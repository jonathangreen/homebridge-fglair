import {Logger} from 'homebridge';

import fs from 'fs';
import {AuthResponse, DeviceInfoResponse, DevicePropertiesResponse, PropertyContent, PropertyDirectionEnum} from './apiResponse';

class FglairApiTokens {
  public access: string | null = null;
  public refresh: string | null = null;
  public expires: number | null = null;

  constructor(
    protected log: Logger,
    protected tokenPath: string,
  ) {
    this.load();
  }

  fromResponse(response: AuthResponse) {
    this.log.debug('FglairApiTokens.fromResponse: ', response);
    this.expires = Date.now() + (response.expires_in * 1000);
    this.access = response.access_token;
    this.refresh = response.refresh_token;
    this.save();
  }

  load() {
    if (fs.existsSync(this.tokenPath)) {
      const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
      this.access = data.access;
      this.refresh = data.refresh;
      this.expires = data.expires;
    }
  }

  save() {
    const data = JSON.stringify({
      access: this.access,
      refresh: this.refresh,
      expires: this.expires,
    });
    fs.writeFileSync(this.tokenPath, data, {flag: 'w'});
  }

  accessTokenValid(): boolean {
    this.log.debug('FglairApiTokens.accessTokenValid now:', Date.now());
    this.log.debug('FglairApiTokens.accessTokenValid expires:', this.expires);
    return this.expires !== null && this.expires > Date.now();
  }

  initialized(): boolean {
    return this.expires !== null;
  }
}

export class FglairApi {
  protected tokens: FglairApiTokens;

  protected static API_GET_ACCESS_TOKEN_URL = 'https://user-field.aylanetworks.com/users/sign_in.json';
  protected static API_GET_REFRESH_TOKEN_URL = 'https://user-field.aylanetworks.com/users/refresh_token.json';
  protected static API_GET_DEVICES_URL = 'https://ads-field.aylanetworks.com/apiv1/devices.json';
  protected static API_GET_DEVICE_PROPERTIES = 'https://ads-field.aylanetworks.com/apiv1/dsns/{DSN}/properties.json';
  protected static API_SET_DEVICE_PROPERTIES = 'https://ads-field.aylanetworks.com/apiv1/batch_datapoints.json';

  constructor(
    protected username:string,
    protected password: string,
    protected log: Logger,
    protected tokenPath: string,
  ) {
    this.tokens = new FglairApiTokens(log, tokenPath);
  }

  protected headers(auth = true) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if(auth) {
      headers['Authorization'] = 'auth_token ' + this.tokens.access;
    }
    return headers;
  }

  protected async getTokens() {
    const response = await fetch(FglairApi.API_GET_ACCESS_TOKEN_URL, {
      method: 'POST',
      body: JSON.stringify({
        user: {
          email: this.username,
          password: this.password,
          application: {
            app_id: 'CJIOSP-id',
            app_secret: 'CJIOSP-Vb8MQL_lFiYQ7DKjN0eCFXznKZE',
          },
        },
      }),
      headers: this.headers(false),
    });
    const decoded = await response.json() as AuthResponse;
    this.log.debug('FglairApi.getTokens:', decoded);
    this.tokens.fromResponse(decoded);
  }

  protected async authenticate() {
    if (!this.tokens.initialized()) {
      // Tokens not initialized, make an auth request to get
      // our first auth token. This should only happen the first
      // time the api is loaded. After that we should use the
      // refresh token.
      this.log.debug('FglairApi.authenticate: Doing first time auth request.');
      await this.getTokens();
    }

    if (this.tokens.accessTokenValid()) {
      // If the token is valid, nothing to do, so we return.
      // Otherwise, we use the refresh token to get a valid access token.
      this.log.debug('FglairApi.authenticate: Token is valid.');
      return;
    }

    this.log.debug('FglairApi.authenticate: Refreshing token.');
    const response = await fetch(FglairApi.API_GET_REFRESH_TOKEN_URL, {
      method: 'POST',
      body: JSON.stringify({
        user: {
          refresh_token: this.tokens.refresh,
        },
      }),
      headers: this.headers(false),
    });

    const decoded = await response.json() as AuthResponse;
    //this.log.debug('FglairApi.authenticate:', decoded);
    this.tokens.fromResponse(decoded);
  }

  public async getDevices() {
    await this.authenticate();
    const response = await fetch(FglairApi.API_GET_DEVICES_URL, {
      method: 'GET',
      headers: this.headers(),
    });
    const body = await response.json();
    //this.log.debug('GetDevices response:', body);
    const devices: Array<DeviceInfoResponse> = [];
    for(const device of body) {
      const info = device.device as DeviceInfoResponse;
      devices[info.mac.toLowerCase()] = info;
    }
    return devices;
  }

  public async getDeviceProperties(device: string) {
    await this.authenticate();
    const url = FglairApi.API_GET_DEVICE_PROPERTIES.replace('{DSN}', device);
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers(),
    });
    const decoded = await response.json() as DevicePropertiesResponse;
    //this.log.debug('getDeviceProperties response:', decoded);
    return decoded;
  }

  public async setDeviceProperties(device: string, properties: Record<string, string|boolean|number>) {
    this.log.debug('setDeviceProperties started');
    await this.authenticate();
    const datapoints: Array<object> = [];
    for (const property in properties) {
      let property_value = properties[property];
      if (typeof property_value === 'boolean') {
        // The api endpoints expect booleans to be sent as int
        property_value = property_value ? 1 : 0;
      }
      datapoints.push({
        dsn: device,
        name: property,
        datapoint: {
          value: property_value,
        },
      });
    }
    const message_body = JSON.stringify({
      batch_datapoints: datapoints,
    });
    this.log.debug('setDeviceProperties body: ', message_body);
    const response = await fetch(FglairApi.API_SET_DEVICE_PROPERTIES, {
      method: 'POST',
      body: message_body,
      headers: this.headers(),
    });
    const decoded = await response.json();
    this.log.debug('setDeviceProperties response:', decoded);
    return decoded;
  }
}

class Property<Type> {
  public direction: PropertyDirectionEnum | null = null;
  public data_updated_at: Date | null = null;
  protected _value: Type | null = null;

  public get value(): Type {
    if(this._value === null) {
      throw Error('Uninitialized value.');
    }
    return this._value;
  }

  public set value(value: Type) {
    this._value = value;
  }

  public initialized(): boolean {
    return this._value !== null;
  }

  public fromResponse(property_data: PropertyContent) {
    for (const prop in property_data) {
      this[prop] = property_data[prop];
    }
  }

  public reset() {
    this._value = null;
  }
}

export abstract class NormalizedProperty<ValueType, NormalizedType> extends Property<ValueType> {
  protected _normalized_value!: NormalizedType;


  protected abstract normalize(value: ValueType): NormalizedType;
  protected abstract denormalize(value: NormalizedType): ValueType;

  public set value(theValue: ValueType) {
    this._value = theValue;
    this._normalized_value = this.normalize(theValue);
  }

  public get value(): ValueType {
    if(this._value === null) {
      throw Error('Uninitialized value.');
    }
    return this._value;
  }

  public set normalized_value(theValue: NormalizedType) {
    this._normalized_value = theValue;
    this._value = this.denormalize(theValue);
  }

  public get normalized_value(): NormalizedType {
    return this._normalized_value;
  }
}

class DummyNormalizedProperty<type> extends NormalizedProperty<type, type> {
  protected denormalize(value: type): type {
    return value;
  }

  protected normalize(value: type): type {
    return value;
  }

}

// These temperature conversion functions are not particularly accurate,
// but they appear to reflect what the FGLair app is using. Internally
// the temp is always in C, and the app uses this conversion to report
// the temp in F. By using the same conversion homekit should agree with
// the FGLair app.
// Experimentally here are the values I used to determine these
// calculations:
//  F |  C
// ----------
// 88 | 30
// 85 | 28.5
// 65 | 18.5
// 64 | 18
function f_to_c(f: number) {
  return f / 2 - 14;
}

function c_to_f(c: number) {
  return Math.round(2 * c + 28);
}

class AdjustTempProperty extends NormalizedProperty<number, number> {
  protected fahrenheit;

  constructor(fahrenheit: boolean) {
    super();
    this.fahrenheit = fahrenheit;
  }

  protected normalize(value: number): number {
    const c = value / 10;
    if (this.fahrenheit) {
      return c_to_f(c);
    } else {
      return c;
    }
  }

  protected denormalize(value: number): number {
    let c;
    if(this.fahrenheit) {
      c = f_to_c(value);
    } else {
      c = value;
    }

    return c * 10;
  }
}

class CurrentTempProperty extends NormalizedProperty<number, number> {
  protected fahrenheit;

  constructor(fahrenheit: boolean) {
    super();
    this.fahrenheit = fahrenheit;
  }

  protected normalize(value: number): number {
    const c = (value / 100) - 50;
    if(this.fahrenheit) {
      return c_to_f(c);
    } else {
      return c;
    }
  }

  protected denormalize(value: number): number {
    let c;
    if(this.fahrenheit) {
      c = f_to_c(value);
    } else {
      c = value;
    }
    return (c + 50) * 100;
  }
}

class OperationModeProperty extends NormalizedProperty<OperationMode, number> {
  protected normalize(value: OperationMode): number {
    if (value === OperationMode.off || value === OperationMode.turning_on) {
      return 0; // Characteristic.TargetHeatingCoolingState.OFF
    } else if (value === OperationMode.heat) {
      return 1; // Characteristic.TargetHeatingCoolingState.HEAT
    } else if (value === OperationMode.cool || value === OperationMode.dry) {
      return 2; // Characteristic.TargetHeatingCoolingState.COOL
    } else {
      return 3; // Characteristic.TargetHeatingCoolingState.AUTO
    }
  }

  protected denormalize(value: number): OperationMode {
    if (value === 0) {
      return OperationMode.off;
    } else if (value === 1) {
      return OperationMode.heat;
    } else if (value === 2) {
      return OperationMode.cool;
    } else {
      return OperationMode.auto;
    }
  }
}

class FanSpeedProperty extends NormalizedProperty<FanSpeed, number> {
  protected normalize(value: FanSpeed): number {
    if (value === FanSpeed.auto) {
      return 0;
    } else {
      return (value + 1) * 25;
    }
  }

  protected denormalize(value: number): FanSpeed {
    const denormalized = Math.round(value / 25) - 1;
    if (denormalized === -1) {
      return FanSpeed.auto;
    } else {
      return denormalized;
    }
  }
}

class HorizontalDirectionProperty extends NormalizedProperty<number, number> {
  protected normalize(value: number): number {
    return (value - 3) * -20;
  }

  protected denormalize(value: number): number {
    return (value / -20) + 3;
  }
}

class VerticalDirectionProperty extends NormalizedProperty<number, number> {
  protected normalize(value: number): number {
    return (value - 1) * 10;
  }

  protected denormalize(value: number): number {
    return (value / 10) + 1;
  }
}

export enum OperationMode {
  off,
  turning_on,
  auto,
  cool,
  dry,
  fan,
  heat
}

enum FanSpeed {
  quiet = 0,
  low,
  medium,
  high,
  auto
}


export class DeviceState {
  // update temperature setpoint
  public adjust_temperature;

  // 1 - top of range
  // 8 - bottom of range
  public af_horizontal_direction = new HorizontalDirectionProperty();

  // number of steps in range
  public af_horizontal_num_dir = new Property<number>();

  // turns on and off swing
  public af_horizontal_swing = new DummyNormalizedProperty<boolean>();

  // 1 - left
  // 5 - right
  public af_vertical_direction = new VerticalDirectionProperty();

  // number of steps
  public af_vertical_num_dir = new Property<number>();

  // turn on and off swing
  public af_vertical_swing = new DummyNormalizedProperty<boolean>();

  // building name for identifying
  public building_name = new Property<string>();

  // might be useful to tag devices we don't know about
  public device_capabilities = new Property<number>();

  // device name, might be helpful to choose the device
  public device_name = new Property<string>();

  // display temp - in C
  public display_temperature;

  // 1 - quiet
  // 2 - low
  // 3 - medium
  // 4 - high
  // 5 - auto
  public fan_speed = new FanSpeedProperty();

  // This is how display temp is refreshed, it only updates after pinging this endpoint.
  public get_prop = new Property<boolean>();

  // 0 - off
  // 1 - turning on
  // 2 - auto
  // 3 - cooling
  // 4 - dry mode
  // 5 - fan mode
  // 6 - heat
  public operation_mode = new OperationModeProperty();

  // turn on powerful mode
  public powerful_mode = new Property<boolean>();

  constructor(protected log: Logger, device_properties: DevicePropertiesResponse | null = null, fahrenheit = false) {
    this.display_temperature = new CurrentTempProperty(fahrenheit);
    this.adjust_temperature = new AdjustTempProperty(fahrenheit);

    if (device_properties !== null) {
      this.setProperties(device_properties);
    }
  }

  public getInitialized(): Record<string, string|boolean|number> {
    const initialized = {};
    for (const key of Object.keys(this)) {
      if (this[key] instanceof Property && this[key].initialized()) {
        initialized[key] = this[key].value;
      }
    }
    return initialized;
  }

  public setProperties(device_properties: DevicePropertiesResponse) {
    for (const key in device_properties) {
      const property = device_properties[key].property;
      const name = property.name;
      if (this[name] !== null && this[name] !== undefined) {
        this.log.debug('DeviceState.setProperties setting', name);
        this[name].fromResponse(property);
      }
    }
  }
}

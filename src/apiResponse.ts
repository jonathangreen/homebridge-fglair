export interface AuthResponse {
  readonly expires_in: number;
  readonly access_token: string;
  readonly refresh_token: string;
}

export interface DeviceInfoResponse {
  readonly product_name: string;
  readonly model: string;
  readonly dsn: string;
  readonly oem_model: string;
  readonly sw_version: string;
  readonly template_id: number;
  readonly mac: string;
  readonly unique_hardware_id: string | null;
  readonly lan_ip: string;
  readonly connected_at: string;
  readonly key: number;
  readonly lan_enabled: boolean;
  readonly connection_priority: string;
  readonly has_properties: boolean;
  readonly product_class: string;
  readonly connection_status: string;
  readonly lat: string;
  readonly lng: string;
  readonly locality: string;
  readonly device_type: string;
  readonly dealer: string | null;
  readonly manuf_model: string;
}

export const enum PropertyDirectionEnum {
  Input = 'input',
  Output = 'output'
}

export const enum PropertyTypeEnum {
  Boolean = 'boolean',
  Integer = 'integer',
  String = 'string'
}

export interface PropertyContent {
  readonly type: string;
  readonly name: string;
  readonly base_type: PropertyTypeEnum;
  readonly read_only: boolean;
  readonly direction: PropertyDirectionEnum;
  readonly scope: string;
  readonly data_updated_at: string; // format example: 2018-08-28T00:23:57Z
  readonly key: number;
  readonly device_key: number;
  readonly product_name: string;
  readonly track_only_changes: boolean;
  readonly display_name: string;
  readonly host_sw_version: boolean;
  readonly time_series: boolean;
  readonly derived: boolean;
  readonly app_type: null;
  readonly recipe: null;
  readonly value: number | boolean | string;
  readonly generated_from: string;
  readonly generated_at: null;
  readonly denied_roles: Array<string>;
  readonly ack_enabled: boolean;
  readonly retention_days: number;
  readonly ack_status: null;
  readonly ack_message: null;
  readonly acked_at: null;
}

export interface PropertyResponse {
  readonly property: PropertyContent;
}

export interface DevicePropertiesResponse {
  [index: number]: PropertyResponse;
}

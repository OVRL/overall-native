export type BridgeActionType =
  | "GET_PUSH_TOKEN"
  | "OPEN_CAMERA"
  | "OPEN_PHOTO_PICKER"
  | "REQUEST_PERMISSIONS"
  | "VIBRATE"
  | "OPEN_SETTINGS"
  | "GET_LOCATION"
  | "ROUTE_CHANGE";

export interface BridgePayload {
  url?: string;
  action?: "PUSH" | "REPLACE" | "BACK";
  [key: string]: any;
}

export interface BridgeMessage {
  type: BridgeActionType;
  payload?: BridgePayload;
  reqId?: string;
}

export interface BridgeResponse {
  type: string;
  payload?: any;
  reqId?: string;
}

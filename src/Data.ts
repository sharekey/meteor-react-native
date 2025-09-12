import Minimongo from '@meteorrn/minimongo';
import Tracker from './Tracker';
import {
  batchedUpdates,
  runAfterInteractions,
} from '../helpers/reactNativeBindings';
import type DDP from '../lib/ddp';

export type KeyStorage = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

export type ConnectOptions = {
  KeyStorage: KeyStorage;
  suppressUrlErrors?: boolean;
  reachabilityUrl?: string;
  NetInfo?: any;
  isVerbose?: boolean;
  logger?: (msg: any) => void;
  autoConnect?: boolean;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  isPrivate?: boolean;
};

/**
 * @private
 */
const db = new (Minimongo as any)();
db.debug = false;
db.batchedUpdates = batchedUpdates;

/**
 * @private
 */
(process as any).nextTick = setImmediate as any;

/**
 * @private
 */
let afterInteractions: (fn: () => void) => void = runAfterInteractions;

/**
 * @private
 * @param fn
 */
function runAfterOtherComputations(fn: () => void) {
  afterInteractions(() => {
    Tracker.afterFlush(() => {
      fn();
    });
  });
}

/**
 * @namespace Data
 * @type {object}
 * @summary The data layer representation. Returned by {Meteor.getData}
 */
type DataEventName =
  | 'loggingIn'
  | 'loggingOut'
  | 'change'
  | 'onLogin'
  | 'onLoginFailure';

const Data = {
  /**
   * the ws-endpoint url to connect to
   * @privae
   */
  _endpoint: '' as string,
  /**
   * @private
   */
  _options: {} as Partial<ConnectOptions> & { KeyStorage: KeyStorage },
  /**
   * @summary The DDP implementation we use for this library
   * @type {DDP}
   */
  ddp: null as DDP | null,
  subscriptions: {} as Record<string, any>,
  /**
   * The Minimongo database implementation we use for this library
   * @type {Minimongo}
   */
  db: db as any,

  /**
   * @private
   */
  calls: [] as {
    id: string;
    callback?: (err?: unknown, result?: unknown) => void;
  }[],

  /**
   * Returns the base-url of our connection-endpoint,
   * having /websocket being stripped
   * @returns {string} the connection url
   */
  getUrl(): string {
    if (!this._endpoint) return '';
    const i = this._endpoint.indexOf('/websocket');
    return i >= 0 ? this._endpoint.substring(0, i) : this._endpoint;
  },

  /**
   * Runs a callback, once we have our DDP implementation available
   * @param cb {function}
   */
  waitDdpReady(cb: (...args: any[]) => void) {
    if (this.ddp) {
      cb();
    } else {
      runAfterOtherComputations(() => {
        this.waitDdpReady(cb);
      });
    }
  },

  /**
   * @private
   */
  _cbs: [] as {
    eventName: DataEventName;
    callback: (...args: any[]) => void;
  }[],

  /**
   * Listens to various events of change and pipes them into a single callback.
   * The events include
   * - ddp: change
   * - ddp: connected
   * - ddp: disconnected
   * - Accounts: loggingIn
   * - Accounts: loggingOut
   * - DB: change
   * @param cb {function}
   */
  onChange(cb: (...args: any[]) => void) {
    this.db.on('change', cb);
    this.ddp?.on('connected' as any, cb as any);
    this.ddp?.on('disconnected' as any, cb as any);
    this.on('loggingIn', cb);
    this.on('loggingOut', cb);
    this.on('change', cb);
  },

  /**
   * Stops listening the events from `Data.onChange`.
   * Requires the **exact same callback function** to work properly!
   * @param cb {function}
   */
  offChange(cb: (...args: any[]) => void) {
    this.db.off('change', cb);
    this.ddp?.off('connected' as any, cb as any);
    this.ddp?.off('disconnected' as any, cb as any);
    this.off('loggingIn', cb);
    this.off('loggingOut', cb);
    this.off('change', cb);
  },

  /**
   * Listens to a single event, available on this layer.
   * @param eventName {string}
   * @param cb {function}
   */
  on(eventName: DataEventName, cb: (...args: any[]) => void) {
    this._cbs.push({
      eventName: eventName,
      callback: cb,
    });
  },
  /**
   * Stops listening to a single event on this layer.
   * Requires **the exact same function** to work properly!
   * @param eventName {string}
   * @param cb {function}
   */
  off(eventName: DataEventName, cb: (...args: any[]) => void) {
    const idx = this._cbs.findIndex(
      (_cb) => _cb.callback === cb && _cb.eventName === eventName
    );
    if (idx >= 0) this._cbs.splice(idx, 1);
  },
  /**
   * Run all callbacks that listen on a given event by name.
   * @param eventName {string}
   * @param optionalData {object=}
   */
  notify(eventName: DataEventName, optionalData?: unknown) {
    // Notifify that changes have been made
    // Put in timeout so it doesn't block main thread
    setTimeout(() => {
      this._cbs.map((cb) => {
        if (cb.eventName == eventName && typeof cb.callback == 'function') {
          cb.callback(optionalData);
        }
      });
    }, 1);
  },
  /**
   * Queues a function to be called one time, once ddp connection
   * is established.
   * @param callback {function}
   */
  waitDdpConnected(callback: (...args: any[]) => void) {
    if (this.ddp && (this.ddp as any).status == 'connected') {
      callback();
    } else if (this.ddp) {
      (this.ddp as any).once('connected', callback as any);
    } else {
      setTimeout(() => {
        this.waitDdpConnected(callback);
      }, 10);
    }
  },
};

export default Data;

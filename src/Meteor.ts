import Tracker from './Tracker';
import EJSON from 'ejson';
import DDP from '../lib/ddp';
import Random from '../lib/Random';

import Data from './Data';
import Mongo from './Mongo';
import { Collection, getObservers, localCollections } from './Collection';
import call from './Call';
import Vent from './vent/Vent';

import withTracker from './components/withTracker';
import useTracker from './components/useTracker';

import ReactiveDict from './ReactiveDict';

type DdpErrorPayload = {
  error?: number | string;
  reason?: string;
  details?: any;
};

function toMeteorStyleError(
  payload?: DdpErrorPayload | null
): Error | undefined {
  if (!payload) return undefined;
  const err = new Error(payload.reason || 'Subscription failed');
  (err as any).error = payload.error;
  (err as any).reason = payload.reason;
  (err as any).details = payload.details;
  return err;
}

export interface MeteorBase {
  isVerbose: boolean;
  logger: (msg?: any, ...args: any[]) => void;
  _reactiveDict: ReactiveDict;
  Random: typeof Random;
  Mongo: typeof Mongo;
  Tracker: typeof Tracker;
  EJSON: typeof EJSON;
  ReactiveDict: typeof ReactiveDict;
  Collection: typeof Collection;
  collection(): never;
  withTracker: typeof withTracker;
  useTracker: typeof useTracker;
  getData(): typeof Data;
  status(): { connected: boolean; status: string };
  removing: Record<string, boolean>;
  call: typeof call;
  disconnect(): void;
  _subscriptionsRestart(): void;
  waitDdpConnected: (cb: (...args: any[]) => void) => void;
  reconnect(): void;
  connect(endpoint?: string, options?: any): void;
  requireDdp(): DDP;
  subscribe(
    name: string,
    ...args: any[]
  ): { stop(): void; ready(): boolean; subscriptionId: string };
  ddp?: DDP;
  connected?: boolean;
}

/**
 * @namespace Meteor
 * @type {object}
 * @summary the main Object to interact with this library
 */
type Status = 'disconnected' | 'connected' | string;

const Meteor: MeteorBase = {
  isVerbose: false,
  // Default logger; can be overridden via options.logger in connect
  logger: console.info,

  /**
   * Calling this enables extended internal logging to console
   */
  _reactiveDict: new ReactiveDict(),
  Random,
  Mongo,
  Tracker,
  EJSON,
  ReactiveDict,
  Collection,
  collection() {
    throw new Error('Meteor.collection is deprecated. Use Mongo.Collection');
  },
  withTracker,
  useTracker,
  /**
   * returns the Data layer implementation
   * @returns {Data}
   */
  getData() {
    return Data;
  },
  /**
   * Reactive. Returns the current connection status.
   * @returns {object} `{connected: boolean, status: string}`
   */
  status() {
    return {
      connected: !!this._reactiveDict.get('connected'),
      status: Data.ddp ? Data.ddp.status : 'disconnected',
      //retryCount: 0
      //retryTime:
      //reason:
    };
  },

  removing: {} as Record<string, boolean>,
  call: call,
  disconnect() {
    if (Data.ddp) {
      Data.ddp.disconnect();
    }
    Vent.reset();
  },
  /** Ensure DDP instance is available before using it */
  requireDdp(): DDP {
    const ddp = Data.ddp as DDP | null;
    if (!ddp)
      throw new Error('DDP is not initialized. Call Meteor.connect() first.');
    return ddp;
  },
  _subscriptionsRestart() {
    const ddp = this.requireDdp();
    for (var i in Data.subscriptions) {
      const sub = Data.subscriptions[i];
      if (this.isVerbose) {
        try {
          this.logger({
            event: 'restart_sub',
            name: sub.name,
            // params: sub.params,
            localId: sub.id,
            subId: sub.subIdRemember,
          });
        } catch (e) {
          // no-op
        }
      }
      ddp.unsub(sub.subIdRemember);
      this.removing[sub.subIdRemember] = true;
      sub.subIdRemember = ddp.sub(sub.name, sub.params);
    }
    // If we get a double restart, make sure we keep track and
    // remove it later
    Object.keys(this.removing).forEach((item) => {
      ddp.unsub(item);
    });
  },
  waitDdpConnected: Data.waitDdpConnected.bind(Data),
  reconnect() {
    Data.ddp && Data.ddp.connect();
  },
  /**
   * Connect to a Meteor server using a given websocket endpoint.
   * The endpoint needs to start with `ws://` or `wss://`
   * and has to end with `/websocket`.
   *
   * @param endpoint {string} required, websocket of Meteor server to connect with
   * @param options {object=} optional options
   * @param options.suppressUrlErrors {boolean=} suppress error when websocket endpoint is invalid
   * @param options.KeyStorage {KeyStorage=} suppress error when websocket endpoint is invalid
   * @param options.reachabilityUrl {string=} a URL that is used by @react-native-community/netinfo to run a connection
   *   check using a 204 request
   */
  connect(endpoint?: string, options?: any) {
    if (!endpoint) endpoint = Data._endpoint;
    if (!options) options = Data._options;
    if (options.isVerbose !== undefined) {
      this.isVerbose = options.isVerbose;
    }
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }

    if (
      (!endpoint.startsWith('ws') || !endpoint.endsWith('/websocket')) &&
      !options.suppressUrlErrors
    ) {
      throw new Error(
        `Your url "${endpoint}" may be in the wrong format. It should start with "ws://" or "wss://" and end with "/websocket", e.g. "wss://myapp.meteor.com/websocket". To disable this warning, connect with option "suppressUrlErrors" as true, e.g. Meteor.connect("${endpoint}", {suppressUrlErrors:true});`
      );
    }

    if (!options.KeyStorage) {
      throw new Error(
        'No Storage detected. Import an Storage package and add to `options` in the Meteor.connect() method'
      );
    }

    Data._endpoint = endpoint;
    Data._options = options;

    const ddp = new DDP({
      endpoint: endpoint,
      SocketConstructor: WebSocket as any,
      ...options,
    });

    Data.ddp = ddp;
    this.ddp = ddp;
    Vent.attach(ddp);

    const loadInitialUser =
      typeof (this as any)._loadInitialUser === 'function'
        ? (this as any)._loadInitialUser.bind(this)
        : null;

    if (loadInitialUser) {
      Promise.resolve(loadInitialUser({ skipLogin: true })).catch((err) => {
        if (this.isVerbose) {
          console.warn('Failed to seed cached login state', err);
        }
      });
    }

    Data.ddp.on('connected', (info) => {
      const sessionReused = !!(info && info.sessionReused);

      // Clear the collections of any stale data only if we did NOT reuse the session
      if (!sessionReused && Data.db && Data.db.collections) {
        for (var collection in Data.db.collections) {
          if (!localCollections.includes(collection)) {
            // Dont clear data from local collections
            Data.db[collection].remove({});
          }
        }
      }

      if (this.isVerbose) {
        this.logger(
          sessionReused
            ? 'Connected to DDP server (session resumed).'
            : 'Connected to DDP server.'
        );
      }

      if (!sessionReused) {
        const resumePromise = loadInitialUser
          ? Promise.resolve(loadInitialUser())
          : Promise.resolve();

        resumePromise
          .catch((err) => {
            if (this.isVerbose) {
              console.error(
                'Failed to resume user session after reconnect',
                err
              );
            }
          })
          .finally(() => {
            this._subscriptionsRestart();
          });
      }
      this._reactiveDict.set('connected', true);
      this.connected = true;
      Data.notify('change');
    });

    let lastDisconnect: Date | null = null;
    Data.ddp.on('disconnected', () => {
      this.connected = false;
      this._reactiveDict.set('connected', false);

      Data.notify('change');

      if (this.isVerbose) {
        this.logger('Disconnected from DDP server.');
      }

      // Mark subscriptions as ready=false
      for (var i in Data.subscriptions) {
        const sub = Data.subscriptions[i];
        sub.ready = false;
        sub.readyDeps.changed();
      }

      if (!Data.ddp?.autoReconnect) return;

      if (
        !lastDisconnect ||
        new Date().getTime() - lastDisconnect.getTime() > 3000
      ) {
        Data.ddp?.connect();
      }

      lastDisconnect = new Date();
    });

    Data.ddp.on('added', (message: any) => {
      if (!Data.db[message.collection]) {
        Data.db.addCollection(message.collection);
      }
      const document = {
        _id: message.id,
        ...message.fields,
      };

      Data.db[message.collection].upsert(document);
      let observers = getObservers('added', message.collection, document);
      observers.forEach((callback) => {
        try {
          callback(document, null);
        } catch (e) {
          console.error('Error in observe callback', e);
        }
      });
    });

    Data.ddp.on('error', (message) => {
      if (this.isVerbose) {
        console.error('DDP error', message);
      }
    });

    Data.ddp.on('ready', (message: any) => {
      const idsMap = new Map<string, string>();
      for (var i in Data.subscriptions) {
        const sub = Data.subscriptions[i];
        idsMap.set(sub.subIdRemember, sub.id);
      }
      for (var i in message.subs) {
        const serverSubId = message.subs[i];
        const subId = idsMap.get(serverSubId);
        if (subId) {
          const sub = Data.subscriptions[subId];

          // Verbose debug: log which subscription became ready
          if (this.isVerbose) {
            try {
              this.logger({
                event: 'ready',
                subId: serverSubId,
                name: sub.name,
                localId: sub.id,
                // params: sub.params,
              });
            } catch (e) {
              // no-op
            }
          }

          sub.ready = true;
          sub.readyDeps.changed();
          sub.readyCallback && sub.readyCallback();
        }
      }
    });

    Data.ddp.on('changed', (message: any) => {
      const unset: Record<string, any> = {};
      if (message.cleared) {
        message.cleared.forEach((field: string) => {
          (unset as any)[field] = null;
        });
      }

      if (Data.db[message.collection]) {
        const partialUpdate = {
          _id: message.id,
          ...message.fields,
          ...unset,
        };

        const collection = Data.db[message.collection];
        const oldDocument = collection.findOne({ _id: message.id });

        collection.upsert(partialUpdate);
        const newDocument = collection.findOne({ _id: message.id });

        let observers = getObservers(
          'changed',
          message.collection,
          newDocument
        );
        observers.forEach((callback) => {
          try {
            callback(newDocument, oldDocument, message.fields);
          } catch (e) {
            console.error('Error in observe callback', e);
          }
        });
      }
    });

    Data.ddp.on('removed', (message: any) => {
      if (Data.db[message.collection]) {
        const oldDocument = Data.db[message.collection].findOne({
          _id: message.id,
        });
        let observers = getObservers(
          'removed',
          message.collection,
          oldDocument
        );
        Data.db[message.collection].del(message.id);
        observers.forEach((callback) => {
          try {
            callback(message.id, oldDocument);
          } catch (e) {
            console.error('Error in observe callback', e);
          }
        });
      }
    });
    Data.ddp.on('result', (message: any) => {
      const call = Data.calls.find((c) => c.id === message.id);
      if (call && typeof call.callback === 'function') {
        call.callback(message.error, message.result);
      }
      const idx = Data.calls.findIndex((c) => c.id === message.id);
      if (idx >= 0) Data.calls.splice(idx, 1);
    });

    Data.ddp.on('nosub', (message: any) => {
      // Ignore nosub that corresponds to our own restart/unsub bookkeeping
      if (this.removing[message.id]) {
        delete this.removing[message.id];
        return;
      }

      for (const id in Data.subscriptions) {
        const sub = Data.subscriptions[id];
        if (sub.subIdRemember === message.id) {
          // Helpful debug: log which subscription this nosub refers to
          if (this.isVerbose) {
            try {
              this.logger({
                event: 'nosub',
                subId: message.id,
                name: sub.name,
                localId: id,
                // params: sub.params,
              });
            } catch (e) {
              // no-op
            }
          }
          const formattedError = toMeteorStyleError(message.error);
          // If server ended the subscription with an error, surface it
          if (message.error && typeof sub.errorCallback === 'function') {
            try {
              sub.errorCallback(formattedError);
            } catch (e) {
              console.error('Error in subscription onError callback', e);
            }
          }

          // Always notify onStop when a subscription ends on the server
          if (typeof sub.stopCallback === 'function') {
            try {
              sub.stopCallback(formattedError);
            } catch (e) {
              console.error('Error in subscription onStop callback', e);
            }
          }

          // Mirror local stop without sending another unsub
          if (sub.ready) sub.readyDeps.changed();
          delete Data.subscriptions[id];

          // Found and handled matching sub; exit loop
          break;
        }
      }
    });

    if (options.NetInfo !== null) {
      try {
        const NetInfo = getNetInfo(options.NetInfo);

        if (options.reachabilityUrl) {
          NetInfo.configure({
            reachabilityUrl: options.reachabilityUrl,
            useNativeReachability: true,
          });
        }

        // Reconnect if we lose internet
        NetInfo.addEventListener(
          ({ type, isConnected, isInternetReachable, isWifiEnabled }: any) => {
            if (isConnected && Data.ddp?.autoReconnect) {
              Data.ddp?.connect();
            }
          }
        );
      } catch (e) {
        console.warn(
          'Warning: NetInfo not installed, so DDP will not automatically reconnect'
        );
      }
    }
  },
  subscribe(name: string) {
    let params = Array.prototype.slice.call(arguments, 1);
    let callbacks: any = {};
    if (params.length) {
      let lastParam = params[params.length - 1];
      if (typeof lastParam == 'function') {
        callbacks.onReady = params.pop();
      } else if (
        lastParam &&
        (typeof lastParam.onReady == 'function' ||
          typeof lastParam.onError == 'function' ||
          typeof lastParam.onStop == 'function')
      ) {
        callbacks = params.pop();
      }
    }

    // Is there an existing sub with the same name and param, run in an
    // invalidated Computation? This will happen if we are rerunning an
    // existing computation.
    //
    // For example, consider a rerun of:
    //
    //     Tracker.autorun(function () {
    //       Meteor.subscribe("foo", Session.get("foo"));
    //       Meteor.subscribe("bar", Session.get("bar"));
    //     });
    //
    // If "foo" has changed but "bar" has not, we will match the "bar"
    // subcribe to an existing inactive subscription in order to not
    // unsub and resub the subscription unnecessarily.
    //
    // We only look for one such sub; if there are N apparently-identical subs
    // being invalidated, we will require N matching subscribe calls to keep
    // them all active.

    let existing: any = false;
    for (let i in Data.subscriptions) {
      const sub = Data.subscriptions[i];
      if (sub.inactive && sub.name === name && EJSON.equals(sub.params, params))
        existing = sub;
    }

    let id;
    if (existing) {
      id = existing.id;
      existing.inactive = false;

      if (callbacks.onReady) {
        // If the sub is already ready, fire immediately; otherwise store latest callback.
        if (existing.ready) {
          callbacks.onReady();
        } else {
          existing.readyCallback = callbacks.onReady;
        }
      }
      if (callbacks.onStop) {
        existing.stopCallback = callbacks.onStop;
      }
      if (callbacks.onError) {
        existing.errorCallback = callbacks.onError;
      }
    } else {
      // New sub! Generate an id, save it locally, and send message.

      id = Random.id();
      const ddp = Meteor.requireDdp();
      const subIdRemember = ddp.sub(name, params);

      // TODO subscription object should be represented by
      //   a Subscription data-class
      Data.subscriptions[id] = {
        id: id,
        subIdRemember: subIdRemember,
        name: name,
        params: EJSON.clone(params),
        inactive: false,
        ready: false,
        readyDeps: new Tracker.Dependency(),
        readyCallback: callbacks.onReady,
        stopCallback: callbacks.onStop,
        errorCallback: callbacks.onError,
        stop: function () {
          const ddp = Meteor.requireDdp();
          ddp.unsub(this.subIdRemember);
          delete Data.subscriptions[this.id];
          this.ready && this.readyDeps.changed();

          if (callbacks.onStop) {
            callbacks.onStop();
          }
        },
      };
    }

    // return a handle to the application.
    // TODO represent handle by a SubscriptionHandle class
    var handle = {
      stop: function () {
        if (Data.subscriptions[id]) Data.subscriptions[id].stop();
      },
      ready: function () {
        if (!Data.subscriptions[id]) return false;

        let record = Data.subscriptions[id];
        record.readyDeps.depend();
        return record.ready;
      },
      subscriptionId: id,
    };

    if (Tracker.active) {
      // We're in a reactive computation, so we'd like to unsubscribe when the
      // computation is invalidated... but not if the rerun just re-subscribes
      // to the same subscription!  When a rerun happens, we use onInvalidate
      // as a change to mark the subscription "inactive" so that it can
      // be reused from the rerun.  If it isn't reused, it's killed from
      // an afterFlush.
      Tracker.onInvalidate(function (c: any) {
        if (Data.subscriptions[id]) {
          Data.subscriptions[id].inactive = true;
        }

        Tracker.afterFlush(function () {
          if (Data.subscriptions[id] && Data.subscriptions[id].inactive) {
            handle.stop();
          }
        });
      });
    } else {
      if (Data.subscriptions[id]) {
        Data.subscriptions[id].inactive = true;
      }
    }

    return handle;
  },
};

const getNetInfo = (NetInfo?: any) =>
  NetInfo ? NetInfo : require('@react-native-community/netinfo').default;

export default Meteor;

Vent.configure(Meteor);

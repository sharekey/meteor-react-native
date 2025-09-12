import EventEmitter from 'eventemitter3';
import Queue from './queue';
import Socket from './socket';
import { uniqueId } from './utils';

/**
 * This is the latest version, of the protocol we use
 * @type {string}
 * @private
 */
const DDP_VERSION = '1';

/**
 * Contains all public events that externals can listen to.
 * @type {string[]}
 * @private
 */
const PUBLIC_EVENTS: (keyof DDPEventMap)[] = [
  // connection messages
  'connected',
  'disconnected',
  // Subscription messages (Meteor Publications)
  'ready',
  'nosub',
  'added',
  'changed',
  'removed',
  // Method messages (Meteor Methods)
  'result',
  'updated',
  // Error messages
  'error',
];

type DDPStatus = 'connected' | 'disconnected';

type DDPConnectedMessage = { msg: 'connected'; session: string };
type DDPPingMessage = { msg: 'ping'; id?: string };
type DDPReadyMessage = { msg: 'ready'; subs: string[] };
type DDPNoSubMessage = { msg: 'nosub'; id: string; error?: any };
type DDPAddedMessage = {
  msg: 'added';
  collection: string;
  id: string;
  fields?: any;
};
type DDPChangedMessage = {
  msg: 'changed';
  collection: string;
  id: string;
  fields?: any;
  cleared?: string[];
};
type DDPRemovedMessage = { msg: 'removed'; collection: string; id: string };
type DDPResultMessage = {
  msg: 'result';
  id: string;
  result?: any;
  error?: any;
};
type DDPUpdatedMessage = { msg: 'updated'; methods: string[] };
type DDPErrorMessage = { msg: 'error'; [k: string]: any };
type DDPInbound =
  | DDPConnectedMessage
  | DDPPingMessage
  | DDPReadyMessage
  | DDPNoSubMessage
  | DDPAddedMessage
  | DDPChangedMessage
  | DDPRemovedMessage
  | DDPResultMessage
  | DDPUpdatedMessage
  | DDPErrorMessage
  | { msg: string; [k: string]: any };

interface DDPOptions {
  endpoint: string;
  SocketConstructor: new (endpoint: string) => any;
  autoConnect?: boolean;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  logger?: (msg: any) => void;
  isPrivate?: boolean;
  isVerbose?: boolean;
}

/**
 * The default timout in ms until a reconnection attempt starts
 * @type {number}
 * @private
 */
const DEFAULT_RECONNECT_INTERVAL = 5000;

/**
 * Internal interface for event handling.
 * By default, it adds listeners to all public events
 * and process them in a safe way with a try/catch
 * @private
 */
class EventInterface {
  listeners: {
    [K in keyof DDPEventMap]: Record<string, (event: DDPEventMap[K]) => void>;
  };
  ddp!: DDP;
  constructor() {
    this.listeners = Object.create(null);
    PUBLIC_EVENTS.forEach((eventName) => {
      (this.listeners as any)[eventName] = {};
    });
  }

  /**
   * Attaches listeners to all public DDP events.
   * @param ddp
   */
  activate(ddp: DDP) {
    this.ddp = ddp;
    PUBLIC_EVENTS.forEach((eventName) => {
      this.ddp.on(eventName, (event: any) => {
        // TODO for silly logging it might be a good place log here
        this._handleEvent(eventName as any, event as any);
      });
    });

    return this;
  }

  /**
   * Handles a single event by calling all attached listener functions.
   * @param eventName {string} name of the event to handle
   * @param event {object} the actual event to pass to the callbacks
   * @private
   */
  _handleEvent<E extends keyof DDPEventMap>(
    eventName: E,
    event: DDPEventMap[E]
  ) {
    for (let func of Object.values((this.listeners as any)[eventName])) {
      try {
        (func as any)(event);
      } catch (e) {
        // TODO should we delegate this to the 'error' event listeners?
        //   It would at least make sense, since the
        console.error(
          '@meteorrn/core failed to call DDP event handler for ' + eventName,
          e
        );
      }
    }
  }

  on<E extends keyof DDPEventMap>(
    eventName: E,
    func: (event: DDPEventMap[E]) => void
  ) {
    // TODO check params
    const id = Math.random() + '';
    if (!(this.listeners as any)[eventName])
      throw new Error(`Unsupported event name "${eventName}"`);
    (this.listeners as any)[eventName][id] = func as any;

    // TODO represent by an EventHandle class
    return { remove: () => delete (this.listeners as any)[eventName][id] };
  }
}

/**
 * @private
 * @type {EventInterface}
 */
const eventInterface = new EventInterface();

/**
 * Represents a DDP client that interfaces with the Meteor server backend
 * @class
 */
type DDPEventMap = {
  connected: { sessionReused: boolean };
  disconnected: void;
  ready: DDPReadyMessage;
  nosub: DDPNoSubMessage;
  added: DDPAddedMessage;
  changed: DDPChangedMessage;
  removed: DDPRemovedMessage;
  result: DDPResultMessage;
  updated: DDPUpdatedMessage;
  error: any;
};

class DDP extends EventEmitter<DDPEventMap> {
  eventInterface: EventInterface;
  status: DDPStatus;
  logger: (msg: any) => void;
  isPrivate: boolean;
  isVerbose: boolean;
  autoConnect: boolean;
  autoReconnect: boolean;
  reconnectInterval: number;
  messageQueue: Queue<any>;
  socket: Socket;
  private _lastSessionId?: string;
  /**
   * Create a new DDP instance and runs the following init procedure:
   *
   * - init event interfaces for this instance
   * - create a new message Queue
   * - instantiates the WebSocket
   * - open websocket and establish DDP protocol messaging
   * - setup close handling for proper garbage collection etc.
   *
   * @constructor
   * @param options {object} constructor options
   * @param options.autoConnect {boolean=} set to true to auto connect
   * @see {Queue} the internal Queue implementation that is used
   * @see {Socket} the internal Socket implementation that is used
   *
   */
  constructor(options: DDPOptions) {
    super();

    this.eventInterface = eventInterface.activate(this);
    this.status = 'disconnected';
    this.logger = options.logger ?? console.info;
    this.isPrivate = options.isPrivate ?? true;
    this.isVerbose = options.isVerbose ?? false;

    // Default `autoConnect` and `autoReconnect` to true
    this.autoConnect = options.autoConnect !== false;
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectInterval =
      options.reconnectInterval || DEFAULT_RECONNECT_INTERVAL;

    this.messageQueue = new Queue((message) => {
      if (this.status === 'connected') {
        this.socket.send(message);
        return true;
      } else {
        return false;
      }
    });

    this.socket = new Socket(options.SocketConstructor, options.endpoint);

    if (this.isVerbose) {
      this.socket.on('message:out', (outMessage) => {
        try {
          const copy = { SEND: 'SEND', ...outMessage };
          if (this.isPrivate && copy.params !== undefined) {
            delete copy.params;
          }
          this.logger(copy);
        } catch (e) {
          // no-op
        }
      });
    }

    this.socket.on('open', () => {
      this.isVerbose && this.logger('WebSocket connection opened');
      // When the socket opens, send the `connect` message
      // to establish the DDP connection
      const connectMessage: any = {
        msg: 'connect',
        version: DDP_VERSION,
        support: [DDP_VERSION],
      };
      if (this._lastSessionId) {
        connectMessage.session = this._lastSessionId;
      }
      this.socket.send(connectMessage);
    });

    this.socket.on('close', () => {
      this.isVerbose && this.logger('WebSocket connection closed');
      this.status = 'disconnected';
      this.messageQueue.empty();
      this.emit('disconnected');
      if (this.autoReconnect) {
        // Schedule a reconnection
        setTimeout(this.socket.open.bind(this.socket), this.reconnectInterval);
      }
    });

    this.socket.on('message:in', (message: DDPInbound) => {
      if (message.msg === 'connected') {
        // mirror docs/index.js: log the connect message
        this.isVerbose && this.logger(message);
        const previousSessionId = this._lastSessionId;
        this.status = 'connected';
        this._lastSessionId = message.session;
        const sessionReused =
          !!previousSessionId && previousSessionId === message.session;
        this.isVerbose &&
          this.logger(
            `${
              sessionReused ? 'reused' : 'new'
            } session established. OLD: ${previousSessionId}, NEW: ${
              message.session
            }`
          );

        this.messageQueue.process();

        this.emit('connected', { sessionReused });
      } else if (message.msg === 'ping') {
        this.isVerbose && this.logger(message);
        // Reply with a `pong` message to prevent the server from
        // closing the connection
        this.socket.send({ msg: 'pong', id: (message as any).id });
      } else if (PUBLIC_EVENTS.includes(message.msg as any)) {
        if (this.isVerbose) {
          if (
            message.msg === 'ready' ||
            message.msg === 'nosub' ||
            message.msg === 'error'
          ) {
            this.logger(message);
          } else if (message.msg === 'result') {
            if (this.isPrivate) {
              const copy = { ...message };
              if (copy.result !== undefined) delete copy.result;
              this.logger(copy);
            } else {
              this.logger(message);
            }
          } else if (
            message.msg === 'added' ||
            message.msg === 'changed' ||
            message.msg === 'removed'
          ) {
            this.logger(
              this.isPrivate
                ? {
                    msg: message.msg,
                    collection: message.collection,
                    id: message.id,
                  }
                : message
            );
          } else {
            this.logger(message);
          }
        }

        this.emit(message.msg as any, message as any);
      } else {
        const error = new Error(`Unexpected message received`);
        this.isVerbose && this.logger(error);
        this.emit('error', {
          error,
          message,
        });
      }
    });

    // delegate error event one level up
    this.socket.on('error', (event) => {
      this.isVerbose && this.logger(event);
      event.isRaw = event.isRaw || false;
      this.emit('error', event);
    });

    if (this.autoConnect) {
      this.connect();
    }
  }

  /**
   * Emits a new event.
   * @override
   */
  emit<E extends keyof DDPEventMap>(
    event: E,
    payload?: DDPEventMap[E]
  ): boolean {
    Promise.resolve().then(() => super.emit(event, payload as any));
    return true;
  }

  /**
   * Initiates the underlying websocket to open the connection
   */
  connect() {
    this.socket.open();
  }

  /**
   * Closes the underlying socket connection.
   * If `disconnect` is called, the caller likely doesn't want
   * the instance to try to auto-reconnect. Therefore, we set the
   * `autoReconnect` flag to false.
   */
  disconnect() {
    this.autoReconnect = false;
    this.socket.close();
  }

  /**
   * Pushes a method to the message queue.
   * This is what happens under the hood when using {Meteor.call}
   *
   * @param name {string} the name of the Meteor Method that is to be called
   * @param params {any} the params to pass, likely an object
   * @returns {string} a unique message id, beginning from 1, counting up for each message
   */
  method(name: string, params: any) {
    const id = uniqueId();
    this.messageQueue.push({
      msg: 'method',
      id: id,
      method: name,
      params: params,
    });
    return id;
  }

  /**
   * Subscribes to a Meteor Publication by adding a sub message to the
   * message queue.
   * This is what is called when using {Meteor.subscribe}
   * @param name {string} name of the publication to sub
   * @param params  {any} args, passed to the sub, likely an object
   * @returns {string} a unique message id, beginning from 1, counting up for each message
   */
  sub(name: string, params: any) {
    const id = uniqueId();
    this.messageQueue.push({
      msg: 'sub',
      id: id,
      name: name,
      params: params,
    });
    return id;
  }

  /**
   * Subscribes to a Meteor Publication by adding a sub message to the
   * message queue.
   * This is what is called when calling the `stop()` method of a subscription.
   * @param id {string} id of the prior sub message
   * @returns {string} the id of the prior sub message
   */
  unsub(id: string) {
    this.messageQueue.push({
      msg: 'unsub',
      id: id,
    });
    return id;
  }
}

export default DDP;

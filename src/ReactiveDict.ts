import EJSON from 'ejson';
import MongoID from '../lib/mongo-id';
import Tracker from './Tracker';

/**
 * Use EJSON to strinify a given value
 * @param value {any}
 * @returns {string}
 */
const stringify = function (value: any): string {
  if (value === undefined) return 'undefined';
  return EJSON.stringify(value);
};

/**
 * Uses EJSON to parse a ejsonable string
 * @private
 * @param serialized {string}
 * @returns {undefined|*}
 */
const parse = function (serialized: string | undefined): any {
  if (serialized === undefined || serialized === 'undefined') return undefined;
  return EJSON.parse(serialized);
};

/**
 * The reference implementation to Meteor's ReactiveDict
 *
 * A ReactiveDict stores an arbitrary set of key-value pairs.
 * Use it to manage internal state in your components, ie. like the currently selected item in a list.
 * Each key is individully reactive such that calling set for a key will invalidate any Computations
 * that called get with that key, according to the usual contract for reactive data sources.
 *
 * @see https://docs.meteor.com/api/reactive-dict.html
 * @class
 */
export default class ReactiveDict {
  private keys: Record<string, string>;
  private keyDeps: Record<string, any>;
  private keyValueDeps: Record<string, any>;
  constructor(dictName?: Record<string, any>) {
    this.keys = {};
    if (typeof dictName === 'object') {
      for (var i in dictName) {
        this.keys[i] = stringify(dictName[i]);
      }
    }

    this.keyDeps = {};
    this.keyValueDeps = {};
  }
  set(keyOrObject: string | Record<string, any>, value?: any) {
    if (typeof keyOrObject === 'object' && value === undefined) {
      this._setObject(keyOrObject);
      return;
    }
    // the input isn't an object, so it must be a key
    // and we resume with the rest of the function
    const key = keyOrObject as string;

    value = stringify(value);

    let oldSerializedValue = 'undefined';
    if (Object.keys(this.keys).indexOf(key) != -1) {
      oldSerializedValue = this.keys[key] || '';
    }
    if (value === oldSerializedValue) return;

    this.keys[key] = value;
    if (this.keyDeps[key]) {
      this.keyDeps[key].changed();
    }

    //Data.notify('change');
  }
  setDefault(key: string, value: any) {
    // for now, explicitly check for undefined, since there is no
    // ReactiveDict.clear().  Later we might have a ReactiveDict.clear(), in which case
    // we should check if it has the key.
    if (this.keys[key] === undefined) {
      this.set(key, value);
    }
  }
  get(key: string) {
    this._ensureKey(key);
    this.keyDeps[key].depend();
    return parse(this.keys[key]);
  }

  _ensureKey(key: string) {
    if (!this.keyDeps[key]) {
      this.keyDeps[key] = new Tracker.Dependency();
      this.keyValueDeps[key] = {};
    }
  }
  equals(key: string, value: any) {
    // We don't allow objects (or arrays that might include objects) for
    // .equals, because JSON.stringify doesn't canonicalize object key
    // order. (We can make equals have the right return value by parsing the
    // current value and using EJSON.equals, but we won't have a canonical
    // element of keyValueDeps[key] to store the dependency.) You can still use
    // "EJSON.equals(reactiveDict.get(key), value)".
    //
    // XXX we could allow arrays as long as we recursively check that there
    // are no objects
    this._ensureKey(key);
    this.keyDeps[key].depend();
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      typeof value !== 'undefined' &&
      !(value instanceof Date) &&
      !(value instanceof MongoID.ObjectID) &&
      value !== null
    )
      throw new Error('ReactiveDict.equals: value must be scalar');

    let oldValue = undefined as any;
    if (Object.keys(this.keys).indexOf(key) != -1) {
      oldValue = parse(this.keys[key]);
    }
    return EJSON.equals(oldValue, value);
  }
  _setObject(object: Record<string, any>) {
    // XXX: fixed bug, where object was read into array-indices
    Object.entries(object).forEach(([key, value]) => {
      this.set(key, value);
    });
  }
}
